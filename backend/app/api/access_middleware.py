"""Whole-application ASGI gate, including mounts, framework routes and websockets."""

import json
import secrets
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Match
from starlette.concurrency import run_in_threadpool
from sqlalchemy import select
from backend.app.api.access_policy import (
    AUTH_PATHS,
    PUBLIC_AUTH,
    INVENTORY,
    GLOBAL_POLICIES,
    CATALOG_READS,
    OPERATIONAL_GLOBAL_SCOPE,
    authorize,
)
from backend.app.models.access import AccessState
from backend.app.models.entities import Library
from backend.app.services.access import (
    COOKIE,
    CSRF_COOKIE,
    Principal,
    authenticate,
    csrf_token,
    fail,
    rate_limit,
)
from backend.app.services.access_context import principal_context


# Desktop uses a private bridge identity for application APIs, not local user
# accounts. Keep account setup, login, preferences, and rights APIs unavailable
# on this runtime even if a stale browser session or direct client calls them.
DESKTOP_DISABLED_ACCESS_PATHS = {
    "/auth/setup",
    "/auth/login",
    "/auth/guest",
    "/auth/logout",
    "/auth/password",
    "/users",
    "/users/{account_id}",
    "/access/guest",
    "/access/libraries",
    "/me/preferences",
    "/me/account",
}


def _private_key(key):
    key = key.lower().replace("_", "").replace("-", "")
    return any(
        word in key
        for word in (
            "playcount",
            "playeduser",
            "usersplayed",
            "playback",
            "lastplayed",
            "userplays",
            "favorite",
        )
    ) or key in {"played", "userdata"}


def project(value, playback, *, catalog=False):
    if isinstance(value, dict):
        if catalog and (
            ("media_file_id" in value and value["media_file_id"] is None)
            or ("match" in value and value["match"] is None)
        ):
            playback = False
        return {
            k: project(
                v, False if catalog and k in {"provider_payload", "core_payload"} else playback,
                catalog=catalog,
            ) for k, v in value.items() if playback or not _private_key(k)
        }
    if isinstance(value, list):
        return [project(v, playback, catalog=catalog) for v in value]
    return value


def effective_routes(routes):
    """FastAPI 0.138 keeps include_router branches lazy; inspect effective paths."""
    for route in routes:
        contexts = getattr(route, "effective_route_contexts", None)
        if contexts is not None:
            yield from contexts()
        else:
            yield route


class AccessMiddleware:
    def __init__(self, app, settings, protocol_only=False):
        self.app, self.settings, self.protocol_only = app, settings, protocol_only

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            return await self.app(scope, receive, send)
        if scope["type"] != "http":
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            return
        request = Request(scope, receive)
        try:
            return await self.handle(request, scope, receive, send)
        except HTTPException as exc:
            await JSONResponse(
                {"detail": exc.detail},
                status_code=exc.status_code,
                headers={"Cache-Control": "no-store"},
            )(scope, receive, send)

    async def handle(self, request, scope, receive, send):
        settings = self.settings
        factory = request.app.state.auth_session_factory
        path = request.url.path
        prefix = settings.api_prefix
        relative = path[len(prefix) :] if path.startswith(prefix + "/") else None
        method = request.method
        route = None
        params = {}
        # Match only FULL routes. No automatic slash redirect can bypass the gate.
        for candidate in effective_routes(request.app.routes):
            match, child = candidate.matches(scope)
            if match == Match.FULL:
                route, params = candidate, child.get("path_params", {})
                break
        template = getattr(route, "path", None)
        local_template = (
            template[len(prefix) :] if template and template.startswith(prefix + "/") else template
        )
        auth_route = (method, local_template) in AUTH_PATHS
        inventory_key = method + " " + str(local_template)
        known = inventory_key in INVENTORY or (
            local_template == "/performance" and method == "GET" and settings.performance_metrics
        )
        machine = known and str(local_template).startswith("/transcoding/federation/protocol/")
        if self.protocol_only and not machine:
            fail(404, "Not found")
        if relative == "/health" and method == "GET":
            return await JSONResponse({"status": "ok"}, headers={"Cache-Control": "no-store"})(
                scope, receive, send
            )
        # Only the shipped shell and distribution resources are anonymous. The
        # frontend handler separately enforces canonical containment and suffixes.
        shell = (
            relative is None
            and method in {"GET", "HEAD"}
            and (
                path == "/"
                or path.startswith(("/assets/", "/libraries/", "/files/"))
                or path
                in {
                    "/settings",
                    "/accounts",
                    "/storage-map",
                    "/transcoding",
                    "/ui-elements",
                    "/favicon.ico",
                    "/favicon.svg",
                }
            )
        )
        if shell and not self.protocol_only:
            return await self.app(scope, receive, send)
        if not (
            auth_route
            or known
            or (
                path in {"/docs", "/openapi.json", "/redoc", "/docs/oauth2-redirect"}
                and method == "GET"
            )
        ):
            fail(404, "Not found")

        # Desktop has a single local application identity. User management,
        # rights, and browser account flows do not apply to this runtime.
        if settings.is_desktop and local_template in DESKTOP_DISABLED_ACCESS_PATHS:
            fail(404, "Not found")

        def identity():
            with factory() as db:
                configured = db.get(AccessState, 1) is not None
                token = request.headers.get("x-medialyze-desktop")
                if settings.is_desktop:
                    if (
                        token
                        and settings.desktop_token
                        and secrets.compare_digest(
                            token.encode(), settings.desktop_token.get_secret_value().encode()
                        )
                    ):
                        return True, Principal("desktop", "desktop", "", True, {})
                    # Browser account cookies are not Desktop credentials.
                    return False, None
                return configured, authenticate(db, request.cookies.get(COOKIE))

        configured, principal = await run_in_threadpool(identity)
        if machine:
            if not configured and not settings.is_desktop:
                fail(401, "Setup required")
            # Machine encryption/pairing remains authoritative; browser credentials
            # and Origin never substitute for the member proof on either listener.
            if (
                request.headers.get("origin")
                or request.cookies.get(COOKIE)
                or request.headers.get("x-medialyze-desktop")
            ):
                fail()
            return await self.app(scope, receive, send)
        scope.setdefault("state", {})["principal"] = principal
        public = auth_route and local_template in PUBLIC_AUTH
        if not configured and not settings.is_desktop and not public:
            fail(401, "Setup required")
        if not principal and not public:
            fail(401, "Authentication required")
        if (
            principal
            and principal.must_change_password
            and local_template not in {"/auth/password", "/auth/logout", "/auth/status"}
        ):
            fail(403, "Password change required")
        if method not in {"GET", "HEAD", "OPTIONS"} and not (
            principal and principal.kind == "desktop"
        ):
            # Forwarded headers are deliberately not trusted here. The deployment
            # proxy must preserve Host and establish the request's HTTPS scheme.
            origin = request.headers.get("origin")
            expected = f"{request.url.scheme}://{request.url.netloc}"
            if origin != expected or request.headers.get("sec-fetch-site") in {
                "cross-site",
                "same-site",
            }:
                fail(403, "Invalid request origin")
            raw = request.cookies.get(COOKIE)
            expected_csrf = (
                csrf_token(raw) if principal and raw else request.cookies.get(CSRF_COOKIE, "")
            )
            actual_csrf = request.headers.get("x-csrf-token", "")
            if not expected_csrf or not secrets.compare_digest(
                expected_csrf.encode(), actual_csrf.encode()
            ):
                fail(403, "Invalid CSRF token")
        if local_template == "/auth/setup" and method == "POST":
            await run_in_threadpool(
                rate_limit, factory, request.client.host if request.client else "unknown", "setup"
            )
        # Bound JSON inputs before buffering/replaying for policy and validation.
        buffered = None
        if method not in {"GET", "HEAD"}:
            chunks, size = [], 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                size += len(message.get("body", b""))
                if size > 1024 * 1024:
                    fail(413, "Request too large")
                chunks.append(message.get("body", b""))
                if not message.get("more_body"):
                    break
            buffered = b"".join(chunks)

        async def replay():
            nonlocal buffered
            if buffered is not None:
                data, buffered = buffered, None
                return {"type": "http.request", "body": data, "more_body": False}
            return await receive()

        operation = INVENTORY.get(
            inventory_key,
            "performance_snapshot" if known and local_template == "/performance" else None,
        )
        if principal and not auth_route:

            def check():
                with factory() as db:
                    try:
                        body = json.loads(buffered or b"{}")
                    except (ValueError, UnicodeDecodeError):
                        fail(422, "Invalid request")
                    if not isinstance(body, dict):
                        body = {}
                    if not known:
                        if not principal.owner:
                            fail()
                    else:
                        authorize(
                            request,
                            db,
                            principal,
                            INVENTORY.get(inventory_key, "performance_snapshot"),
                            params,
                            body,
                        )
                    ids = (
                        None
                        if principal.owner
                        else tuple(
                            i
                            for i in db.scalars(select(Library.id))
                            if principal.has("library.read", i)
                        )
                    )
                    return ids

            ids = await run_in_threadpool(check)
            scope["state"]["access_external_catalog"] = operation in CATALOG_READS
            global_write = method not in {"GET", "HEAD"} and (
                operation == "app_settings_update"
                or GLOBAL_POLICIES.get(operation, "").endswith(".edit")
                or GLOBAL_POLICIES.get(operation) == "connector.manage"
            )
            # Authorized shared configuration changes and their system follow-up
            # work cover the whole installation. Their response DTOs contain no
            # media details. Only the explicitly authorized installation-wide
            # diagnostic DTOs additionally lift scope for reads.
            scope["state"]["access_scope"] = (
                (ids, principal.has("connector.playback"))
                if ids is not None and not global_write and operation not in OPERATIONAL_GLOBAL_SCOPE
                else None
            )
        # Do not buffer media/CSV/range responses. Only JSON projections need filtering.
        response_start = None
        response_parts = []

        async def protected_send(message):
            nonlocal response_start
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers = [(k, v) for k, v in headers if k.lower() != b"cache-control"]
                headers.append((b"cache-control", b"no-store"))
                if principal:
                    headers.append(
                        (
                            b"x-medialyze-identity",
                            f"{principal.kind}:{principal.id}:{principal.revision}".encode("ascii"),
                        )
                    )
                message = {**message, "headers": headers}
                is_json = any(
                    k.lower() == b"content-type" and b"application/json" in v for k, v in headers
                )
                if (
                    is_json
                    and message["status"] not in {204, 304}
                    and method != "HEAD"
                    and principal
                    # These fixed diagnostic DTOs contain installation-wide
                    # observations, not personal playback rows. Metric labels
                    # may contain "playback" without being private data.
                    and operation != "performance_snapshot"
                    and (not principal.has("connector.playback") or (
                        operation in CATALOG_READS and not principal.owner
                    ))
                    and not auth_route
                ):
                    response_start = message
                    return
            if response_start and message["type"] == "http.response.body":
                response_parts.append(message.get("body", b""))
                if message.get("more_body"):
                    return
                data = json.dumps(
                    project(
                        json.loads(b"".join(response_parts)), principal.has("connector.playback"),
                        catalog=operation in CATALOG_READS and not principal.owner,
                    ),
                    separators=(",", ":"),
                ).encode()
                response_start["headers"] = [
                    (k, v) for k, v in response_start["headers"] if k.lower() != b"content-length"
                ] + [(b"content-length", str(len(data)).encode())]
                await send(response_start)
                await send({"type": "http.response.body", "body": data})
                return
            await send(message)

        token = principal_context.set(principal)
        try:
            await self.app(scope, replay if buffered is not None else receive, protected_send)
        finally:
            principal_context.reset(token)
