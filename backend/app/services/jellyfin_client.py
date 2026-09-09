from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from random import uniform
from time import sleep
from typing import Callable
from urllib.parse import urljoin, urlparse

import httpx


class JellyfinError(RuntimeError):
    pass


class JellyfinConfigurationError(JellyfinError):
    pass


class JellyfinConnectionError(JellyfinError):
    pass


class JellyfinResponseError(JellyfinError):
    pass


@dataclass(slots=True)
class JellyfinImage:
    content: bytes
    content_type: str


@dataclass(slots=True)
class JellyfinItemPage:
    items: list[dict]
    start_index: int
    total_record_count: int


@dataclass(slots=True)
class JellyfinActivityPage:
    items: list[dict]
    start_index: int
    total_record_count: int
    processed_count: int | None = None


class JellyfinClient:
    ITEM_PAGE_SIZE = 500
    REQUEST_ATTEMPTS = 3
    RETRYABLE_STATUS_CODES = {429, 502, 503, 504}

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        timeout_seconds: float = 30.0,
        cancellation_check: Callable[[], None] | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = self._validate_base_url(base_url)
        self.api_key = api_key.strip()
        if not self.api_key:
            raise JellyfinConfigurationError("A Jellyfin API key is required")
        self.timeout_seconds = timeout_seconds
        self.cancellation_check = cancellation_check
        self._client = httpx.Client(
            timeout=httpx.Timeout(timeout_seconds, connect=min(timeout_seconds, 10.0)),
            follow_redirects=False,
            transport=transport,
        )

    def __enter__(self) -> JellyfinClient:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    @staticmethod
    def _validate_base_url(value: str) -> str:
        candidate = value.strip().rstrip("/")
        parsed = urlparse(candidate)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise JellyfinConfigurationError("Jellyfin URL must be an absolute http(s) URL")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise JellyfinConfigurationError("Jellyfin URL must not contain credentials, a query, or a fragment")
        return candidate

    @staticmethod
    def _origin(url: str) -> tuple[str, str, int | None]:
        parsed = urlparse(url)
        return parsed.scheme.casefold(), (parsed.hostname or "").casefold(), parsed.port

    def _check_cancelled(self) -> None:
        if self.cancellation_check is not None:
            self.cancellation_check()

    def _sleep_before_retry(self, response: httpx.Response | None, attempt: int) -> None:
        delay: float | None = None
        if response is not None:
            retry_after = response.headers.get("retry-after")
            if retry_after:
                try:
                    delay = max(0.0, min(float(retry_after), 30.0))
                except ValueError:
                    try:
                        delay = max(
                            0.0,
                            min((parsedate_to_datetime(retry_after) - parsedate_to_datetime(response.headers.get("date", ""))).total_seconds(), 30.0),
                        )
                    except (TypeError, ValueError, OverflowError):
                        delay = None
        if delay is None:
            delay = min(0.5 * (2**attempt) + uniform(0.0, 0.2), 5.0)
        # Keep cancellation responsive during a server-requested wait.
        remaining = delay
        while remaining > 0:
            self._check_cancelled()
            step = min(0.25, remaining)
            sleep(step)
            remaining -= step

    def _get_streamed_response(
        self,
        url: str,
        *,
        params: dict | None,
    ) -> httpx.Response:
        """Read a response incrementally so cancellation can stop large payloads."""
        request = self._client.build_request(
            "GET",
            url,
            params=params,
            headers={
                "Authorization": f'MediaBrowser Token="{self.api_key}"',
                "Accept": "application/json",
            },
        )
        response = self._client.send(request, stream=True)
        try:
            content = bytearray()
            for chunk in response.iter_bytes():
                self._check_cancelled()
                content.extend(chunk)
            self._check_cancelled()
            # iter_bytes() has already decoded gzip/deflate/brotli content. Do not
            # carry the wire-level encoding metadata onto the buffered response,
            # otherwise httpx attempts to decode the JSON body a second time.
            decoded_headers = httpx.Headers(response.headers)
            for header in ("content-encoding", "content-length", "transfer-encoding"):
                decoded_headers.pop(header, None)
            return httpx.Response(
                response.status_code,
                headers=decoded_headers,
                content=bytes(content),
                request=response.request,
                extensions=response.extensions,
            )
        finally:
            response.close()

    def _request(self, path: str, *, params: dict | None = None) -> httpx.Response:
        url = f"{self.base_url}{path}"
        redirects = 0
        while True:
            for attempt in range(self.REQUEST_ATTEMPTS):
                self._check_cancelled()
                try:
                    response = self._get_streamed_response(
                        url,
                        params=params,
                    )
                except (httpx.TimeoutException, httpx.NetworkError) as exc:
                    if attempt + 1 >= self.REQUEST_ATTEMPTS:
                        raise JellyfinConnectionError(f"Could not connect to Jellyfin: {exc}") from exc
                    self._sleep_before_retry(None, attempt)
                    continue
                if response.status_code in self.RETRYABLE_STATUS_CODES and attempt + 1 < self.REQUEST_ATTEMPTS:
                    self._sleep_before_retry(response, attempt)
                    continue
                break

            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise JellyfinConnectionError("Jellyfin returned a redirect without a location")
                redirected_url = urljoin(str(response.request.url), location)
                if self._origin(redirected_url) != self._origin(url):
                    raise JellyfinConnectionError("Jellyfin redirected the request to a different origin")
                redirects += 1
                if redirects > 3:
                    raise JellyfinConnectionError("Jellyfin returned too many redirects")
                url = redirected_url
                params = None
                continue

            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                detail = "authentication failed" if status in {401, 403} else f"HTTP {status}"
                raise JellyfinConnectionError(f"Jellyfin request failed: {detail}") from exc
            self._check_cancelled()
            return response

    @staticmethod
    def _json(response: httpx.Response, endpoint: str) -> object:
        try:
            return response.json()
        except ValueError as exc:
            raise JellyfinResponseError(f"Jellyfin {endpoint} returned invalid JSON") from exc

    def get_system_info(self) -> dict:
        payload = self._json(self._request("/System/Info"), "system info")
        if not isinstance(payload, dict):
            raise JellyfinResponseError("Jellyfin system info response must be an object")
        return payload

    def get_users(self) -> list[dict]:
        payload = self._json(self._request("/Users"), "users")
        if not isinstance(payload, list) or any(not isinstance(user, dict) for user in payload):
            raise JellyfinResponseError("Jellyfin users response must be a list of objects")
        if any(
            not isinstance(user.get("Id"), str)
            or not user["Id"].strip()
            or not isinstance(user.get("Name"), str)
            for user in payload
        ):
            raise JellyfinResponseError("Jellyfin user entries require Id and Name")
        return payload

    def get_virtual_folders(self) -> list[dict]:
        payload = self._json(self._request("/Library/VirtualFolders"), "libraries")
        if not isinstance(payload, list) or any(not isinstance(folder, dict) for folder in payload):
            raise JellyfinResponseError("Jellyfin libraries response must be a list of objects")
        for folder in payload:
            if not isinstance(folder.get("Name"), str) or not isinstance(folder.get("Locations"), list):
                raise JellyfinResponseError("Jellyfin library entries require Name and Locations")
        return payload

    def iter_item_pages(
        self,
        *,
        user_id: str | None = None,
        user_data_only: bool = False,
        progress_callback: Callable[[int, int | None], None] | None = None,
    ) -> Iterator[JellyfinItemPage]:
        start_index = 0
        expected_total: int | None = None
        while True:
            params: dict[str, str | bool | int] = {
                "Recursive": True,
                "IncludeItemTypes": "Movie,Episode,Audio,AudioBook",
                "Fields": (
                    "Path,DateCreated,OriginalTitle,Overview,ProviderIds,PremiereDate,"
                    "ProductionYear,SeriesInfo,MediaSources"
                ),
                "ImageTypeLimit": 1,
                "EnableImageTypes": "Primary,Backdrop,Thumb",
                "EnableTotalRecordCount": True,
                "StartIndex": start_index,
                "Limit": self.ITEM_PAGE_SIZE,
            }
            if user_id:
                params["UserId"] = user_id
            if user_data_only:
                params["Fields"] = ""
                params["ImageTypeLimit"] = 0
                params["EnableImageTypes"] = ""
            payload = self._json(self._request("/Items", params=params), "items")
            if not isinstance(payload, dict):
                raise JellyfinResponseError("Jellyfin items response must be an object")
            page = payload.get("Items")
            total = payload.get("TotalRecordCount")
            if not isinstance(page, list) or any(not isinstance(item, dict) for item in page):
                raise JellyfinResponseError("Jellyfin items response requires an Items list")
            if any(
                not isinstance(item.get("Id"), str) or not item["Id"].strip()
                for item in page
            ):
                raise JellyfinResponseError("Jellyfin item entries require Id")
            if not isinstance(total, int) or isinstance(total, bool) or total < 0:
                raise JellyfinResponseError("Jellyfin items response requires TotalRecordCount")
            if expected_total is None:
                expected_total = total
            elif total != expected_total:
                raise JellyfinResponseError("Jellyfin item count changed while paging")
            next_index = start_index + len(page)
            if next_index > total or (next_index < total and not page):
                raise JellyfinResponseError("Jellyfin returned an incomplete item page")
            if progress_callback is not None:
                progress_callback(next_index, total)
            yield JellyfinItemPage(items=page, start_index=start_index, total_record_count=total)
            if next_index >= total:
                return
            if next_index <= start_index:
                raise JellyfinResponseError("Jellyfin item paging did not advance")
            start_index = next_index

    def get_items(
        self,
        *,
        user_id: str | None = None,
        user_data_only: bool = False,
        progress_callback: Callable[[int, int | None], None] | None = None,
    ) -> list[dict]:
        return [
            item
            for page in self.iter_item_pages(
                user_id=user_id,
                user_data_only=user_data_only,
                progress_callback=progress_callback,
            )
            for item in page.items
        ]

    def iter_playback_activity_pages(
        self,
        *,
        min_date: str | None = None,
    ) -> Iterator[JellyfinActivityPage]:
        """Yield Jellyfin's persisted playback-start activity entries.

        Jellyfin's activity endpoint also returns playback-stop rows for the
        broad ``Playback`` type filter. Keep only the start types because those
        are the independently identifiable playback events.
        """
        start_index = 0
        while True:
            params: dict[str, str | int | bool] = {
                "StartIndex": start_index,
                "Limit": self.ITEM_PAGE_SIZE,
                "HasUserId": True,
                "Type": "Playback",
                "SortBy": "DateCreated",
                "SortOrder": "Ascending",
            }
            if min_date:
                params["MinDate"] = min_date
            payload = self._json(
                self._request("/System/ActivityLog/Entries", params=params),
                "playback activity",
            )
            if not isinstance(payload, dict):
                raise JellyfinResponseError("Jellyfin playback activity response must be an object")
            page = payload.get("Items")
            total = payload.get("TotalRecordCount")
            if not isinstance(page, list) or any(not isinstance(item, dict) for item in page):
                raise JellyfinResponseError(
                    "Jellyfin playback activity response requires an Items list"
                )
            if not isinstance(total, int) or isinstance(total, bool) or total < 0:
                raise JellyfinResponseError(
                    "Jellyfin playback activity response requires TotalRecordCount"
                )
            yield JellyfinActivityPage(
                items=[
                    item
                    for item in page
                    if item.get("Type") in {"VideoPlayback", "AudioPlayback", "Playback"}
                ],
                start_index=start_index,
                total_record_count=total,
                processed_count=len(page),
            )
            next_index = start_index + len(page)
            if next_index >= total:
                return
            if next_index <= start_index:
                raise JellyfinResponseError("Jellyfin playback activity paging did not advance")
            start_index = next_index

    def get_image(self, item_id: str, image_type: str, *, tag: str | None = None) -> JellyfinImage:
        params = {"tag": tag} if tag else None
        response = self._request(f"/Items/{item_id}/Images/{image_type}", params=params)
        return JellyfinImage(
            content=response.content,
            content_type=response.headers.get("content-type", "application/octet-stream").split(";", 1)[0].casefold(),
        )
