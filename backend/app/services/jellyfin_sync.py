from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import ExitStack, nullcontext
from datetime import UTC, datetime
from threading import Event
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from backend.app.core.config import get_settings
from backend.app.models.entities import (
    JellyfinConnection,
    JellyfinLibrary,
    JellyfinPathMapping,
    JellyfinPlaybackEvent,
    JellyfinSyncStageItem,
    JellyfinSyncStageLibrary,
    JellyfinSyncStagePlaybackEvent,
    JellyfinSyncStageUser,
    JellyfinSyncStageUserData,
    JellyfinUser,
    Library,
)
from backend.app.services.jellyfin_client import JellyfinClient, JellyfinError, JellyfinItemPage
from backend.app.services.jellyfin_credentials import read_jellyfin_api_key
from backend.app.services.jellyfin_jobs import update_jellyfin_sync_job_progress
from backend.app.services.jellyfin_matching import (
    map_library_locations,
    normalize_jellyfin_path,
    recompute_jellyfin_matches,
)
from backend.app.services.jellyfin_progress import (
    begin_jellyfin_progress,
    clear_jellyfin_progress,
    complete_jellyfin_progress_track,
    jellyfin_cancellation_requested,
    reset_jellyfin_cancellation,
    set_jellyfin_progress_tracks,
    update_jellyfin_progress,
    update_jellyfin_progress_track,
)
from backend.app.services.jellyfin_staging import (
    cleanup_staging,
    commit_stage_page,
    promote_staging,
)
from backend.app.services.stats_cache import stats_cache
from backend.app.utils.time import utc_now

JELLYFIN_USER_SYNC_WORKERS = 4


class JellyfinSyncCancelled(JellyfinError):
    pass


def _raise_if_sync_cancelled() -> None:
    if jellyfin_cancellation_requested():
        raise JellyfinSyncCancelled("Jellyfin synchronization was canceled")


def _iter_item_pages(
    client: object,
    *,
    user_id: str | None = None,
    user_data_only: bool = False,
    progress_callback=None,
) -> Iterator[JellyfinItemPage]:
    iterator = getattr(client, "iter_item_pages", None)
    if callable(iterator):
        yield from iterator(
            user_id=user_id,
            user_data_only=user_data_only,
            progress_callback=progress_callback,
        )
        return
    # Compatibility for small test/fake clients and third-party extensions that
    # still implement the pre-streaming get_items contract.
    payloads = client.get_items(user_id=user_id, progress_callback=progress_callback)  # type: ignore[attr-defined]
    yield JellyfinItemPage(items=payloads, start_index=0, total_record_count=len(payloads))


def get_or_create_jellyfin_connection(db: Session) -> JellyfinConnection:
    connection = db.get(JellyfinConnection, 1)
    if connection is None:
        connection = JellyfinConnection(id=1)
        db.add(connection)
        db.flush()
    return connection


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _normalize_jellyfin_id(value: object) -> str:
    candidate = str(value or "").strip()
    if not candidate:
        return ""
    try:
        return UUID(candidate).hex
    except ValueError:
        return candidate.casefold()


def _sync_playback_events(
    db: Session,
    *,
    client: object,
    sync_run_id: str,
    now: datetime,
) -> tuple[int, str]:
    iterator = getattr(client, "iter_playback_activity_pages", None)
    if not callable(iterator):
        return 0, "unavailable"

    enabled_user_ids = list(
        db.scalars(
            select(JellyfinUser.jellyfin_user_id).where(JellyfinUser.enabled_for_sync.is_(True))
        )
    )
    newest_by_user = dict(
        db.execute(
            select(
                JellyfinPlaybackEvent.jellyfin_user_id,
                func.max(JellyfinPlaybackEvent.played_at),
            )
            .where(JellyfinPlaybackEvent.jellyfin_user_id.in_(enabled_user_ids))
            .group_by(JellyfinPlaybackEvent.jellyfin_user_id)
        ).all()
    )
    newest = (
        min(newest_by_user.values())
        if enabled_user_ids and len(newest_by_user) == len(enabled_user_ids)
        else None
    )
    min_date = None
    if newest is not None:
        normalized = newest if newest.tzinfo is not None else newest.replace(tzinfo=UTC)
        min_date = normalized.astimezone(UTC).isoformat().replace("+00:00", "Z")

    imported = 0
    try:
        for page in iterator(min_date=min_date):
            _raise_if_sync_cancelled()
            rows: list[dict] = []
            for payload in page.items:
                activity_id = payload.get("Id")
                item_id = _normalize_jellyfin_id(payload.get("ItemId"))
                user_id = _normalize_jellyfin_id(payload.get("UserId"))
                played_at = _parse_datetime(payload.get("Date"))
                if (
                    not isinstance(activity_id, int)
                    or isinstance(activity_id, bool)
                    or not item_id
                    or not user_id
                    or played_at is None
                ):
                    continue
                rows.append(
                    {
                        "sync_run_id": sync_run_id,
                        "jellyfin_activity_id": activity_id,
                        "jellyfin_item_id": item_id,
                        "jellyfin_user_id": user_id,
                        "played_at": played_at,
                        "last_synced_at": now,
                    }
                )
            imported += commit_stage_page(
                db,
                JellyfinSyncStagePlaybackEvent,
                rows,
                conflict_columns=("sync_run_id", "jellyfin_activity_id"),
            )
            update_jellyfin_progress(
                "playback_events",
                current=min(
                    page.start_index
                    + (
                        page.processed_count
                        if page.processed_count is not None
                        else len(page.items)
                    ),
                    page.total_record_count,
                ),
                total=page.total_record_count,
            )
    except JellyfinError:
        # Playback history is an optional elevated Jellyfin endpoint. Keep the
        # canonical catalog/user-data sync usable on servers that do not expose it.
        return 0, "unavailable"
    return imported, "available"


def _folder_remote_id(folder: dict) -> str:
    remote_id = str(folder.get("ItemId") or "").strip()
    if remote_id:
        return remote_id
    name = str(folder.get("Name") or "").strip()
    locations = "|".join(sorted(str(value) for value in folder.get("Locations") or []))
    return f"legacy:{name}:{locations}"


def _stage_library_rows(db: Session, sync_run_id: str, folders: list[dict], now: datetime) -> list[dict]:
    mappings = list(db.scalars(select(JellyfinPathMapping).where(JellyfinPathMapping.enabled.is_(True))))
    medialyze_libraries = list(db.scalars(select(Library).options(selectinload(Library.roots))))
    medialyze_library_ids = {library.id for library in medialyze_libraries}
    existing_records = list(db.scalars(select(JellyfinLibrary)))
    existing_by_remote_id = {
        library.remote_item_id: library for library in existing_records if library.remote_item_id
    }
    existing_by_name: dict[str, list[JellyfinLibrary]] = {}
    for library in existing_records:
        existing_by_name.setdefault(library.name, []).append(library)

    rows: list[dict] = []
    for folder in folders:
        name = str(folder.get("Name") or "").strip()
        if not name:
            continue
        remote_id = _folder_remote_id(folder)
        locations = [str(location) for location in folder.get("Locations") or []]
        mapped_locations, mapped_status = map_library_locations(locations, mappings)
        existing = existing_by_remote_id.get(remote_id)
        if existing is None:
            existing = next(
                (
                    candidate
                    for candidate in existing_by_name.get(name, [])
                    if not candidate.remote_item_id
                    or str(candidate.remote_item_id).startswith("legacy:")
                ),
                None,
            )
        linked_library_id = None
        link_method = None
        if existing is not None and existing.link_method == "manual":
            if existing.linked_library_id in medialyze_library_ids:
                linked_library_id = existing.linked_library_id
                link_method = "manual"
                mapped_status = "linked"
        else:
            mapped_keys = {normalize_jellyfin_path(path) for path in mapped_locations}
            for medialyze_library in medialyze_libraries:
                root_keys = {
                    normalize_jellyfin_path(root.path) for root in medialyze_library.roots
                } or {normalize_jellyfin_path(medialyze_library.path)}
                if mapped_keys & root_keys:
                    linked_library_id = medialyze_library.id
                    link_method = "path"
                    mapped_status = "linked"
                    break
        rows.append(
            {
                "sync_run_id": sync_run_id,
                "remote_item_id": remote_id,
                "name": name,
                "collection_type": folder.get("CollectionType"),
                "locations": locations,
                "mapped_locations": mapped_locations,
                "mapped_status": mapped_status,
                "linked_library_id": linked_library_id,
                "link_method": link_method,
                "last_synced_at": now,
            }
        )
    return rows


def _folder_for_path(path: str | None, folders: list[dict]) -> dict | None:
    if not path:
        return None
    normalized = normalize_jellyfin_path(path)
    candidates: list[tuple[int, dict]] = []
    for folder in folders:
        for location in folder.get("Locations") or []:
            prefix = normalize_jellyfin_path(str(location))
            if normalized == prefix or normalized.startswith(f"{prefix}/"):
                candidates.append((len(prefix), folder))
    return max(candidates, key=lambda pair: pair[0], default=(0, None))[1]


def _stage_item_row(sync_run_id: str, payload: dict, folders: list[dict], now: datetime) -> dict | None:
    jellyfin_id = _normalize_jellyfin_id(payload.get("Id"))
    if not jellyfin_id:
        return None
    path = str(payload.get("Path")) if payload.get("Path") else None
    folder = _folder_for_path(path, folders)
    limited_payload = {
        key: payload[key]
        for key in ("Size", "RunTimeTicks", "MediaType", "CollectionType", "IsFolder")
        if key in payload
    }
    if "Size" not in limited_payload:
        media_sources = payload.get("MediaSources")
        if isinstance(media_sources, list):
            source_size = next(
                (
                    source.get("Size")
                    for source in media_sources
                    if isinstance(source, dict) and isinstance(source.get("Size"), (int, float))
                ),
                None,
            )
            if source_size is not None:
                limited_payload["Size"] = source_size
    raw_size = limited_payload.get("Size")
    runtime_ticks = limited_payload.get("RunTimeTicks")
    return {
        "sync_run_id": sync_run_id,
        "jellyfin_item_id": jellyfin_id,
        "library_remote_item_id": _folder_remote_id(folder) if folder else None,
        "library_name": str(folder.get("Name") or "").strip() if folder else None,
        "item_type": str(payload.get("Type") or "Unknown"),
        "path": path,
        "parent_id": payload.get("ParentId"),
        "series_id": payload.get("SeriesId"),
        "season_id": payload.get("SeasonId"),
        "title": str(payload.get("Name") or "Untitled"),
        "original_title": payload.get("OriginalTitle"),
        "series_name": payload.get("SeriesName"),
        "season_name": payload.get("SeasonName"),
        "index_number": payload.get("IndexNumber"),
        "parent_index_number": payload.get("ParentIndexNumber"),
        "date_created": _parse_datetime(payload.get("DateCreated")),
        "premiere_date": _parse_datetime(payload.get("PremiereDate")),
        "production_year": payload.get("ProductionYear"),
        "overview": payload.get("Overview"),
        "provider_ids": payload.get("ProviderIds") or {},
        "image_tags": payload.get("ImageTags") or {},
        "backdrop_image_tags": payload.get("BackdropImageTags") or [],
        "raw_limited_payload": limited_payload,
        "size_bytes": int(raw_size) if isinstance(raw_size, (int, float)) and raw_size >= 0 else None,
        "duration_seconds": (
            float(runtime_ticks) / 10_000_000
            if isinstance(runtime_ticks, (int, float)) and runtime_ticks >= 0
            else None
        ),
        "last_synced_at": now,
    }


def _stage_user_data_row(
    sync_run_id: str,
    jellyfin_item_id: str,
    jellyfin_user_id: str,
    payload: dict,
    now: datetime,
) -> dict:
    return {
        "sync_run_id": sync_run_id,
        "jellyfin_item_id": jellyfin_item_id,
        "jellyfin_user_id": jellyfin_user_id,
        "play_count": int(payload.get("PlayCount") or 0),
        "played": bool(payload.get("Played")),
        "playback_position_ticks": int(payload.get("PlaybackPositionTicks") or 0),
        "last_played_date": _parse_datetime(payload.get("LastPlayedDate")),
        "is_favorite": bool(payload.get("IsFavorite")),
        "last_synced_at": now,
    }


def _sync_enabled_user_data(
    db: Session,
    *,
    sync_run_id: str,
    enabled_users: list[dict],
    base_url: str,
    api_key: str,
    now: datetime,
) -> None:
    """Fetch user-scoped pages concurrently while keeping SQLite writes serialized."""
    completed_users = 0
    total_users = len(enabled_users)
    for batch_start in range(0, len(enabled_users), JELLYFIN_USER_SYNC_WORKERS):
        batch = enabled_users[batch_start : batch_start + JELLYFIN_USER_SYNC_WORKERS]
        set_jellyfin_progress_tracks(
            [
                (str(user_row["jellyfin_user_id"]), str(user_row["name"]))
                for user_row in batch
            ]
        )
        batch_abort = Event()

        def check_batch_cancellation(abort_event: Event = batch_abort) -> None:
            if abort_event.is_set():
                raise JellyfinSyncCancelled("Jellyfin user synchronization stopped")
            _raise_if_sync_cancelled()

        with ExitStack() as stack:
            streams: list[tuple[dict, Iterator[JellyfinItemPage]]] = []
            for user_row in batch:
                user_client = JellyfinClient(
                    base_url,
                    api_key,
                    cancellation_check=check_batch_cancellation,
                )
                client = stack.enter_context(
                    user_client
                    if hasattr(user_client, "__enter__")
                    else nullcontext(user_client)
                )
                streams.append(
                    (
                        user_row,
                        _iter_item_pages(
                            client,
                            user_id=str(user_row["jellyfin_user_id"]),
                            user_data_only=True,
                        ),
                    )
                )

            executor = stack.enter_context(
                ThreadPoolExecutor(
                    max_workers=len(streams),
                    thread_name_prefix="jellyfin-user-sync",
                )
            )
            pending = {
                executor.submit(next, pages, None): (user_row, pages)
                for user_row, pages in streams
            }
            try:
                while pending:
                    _raise_if_sync_cancelled()
                    completed, _ = wait(pending, return_when=FIRST_COMPLETED)
                    for future in completed:
                        user_row, pages = pending.pop(future)
                        page = future.result()
                        user_id = str(user_row["jellyfin_user_id"])
                        if page is None:
                            db.execute(
                                JellyfinSyncStageUser.__table__.update()
                                .where(
                                    JellyfinSyncStageUser.sync_run_id == sync_run_id,
                                    JellyfinSyncStageUser.jellyfin_user_id == user_id,
                                )
                                .values(last_synced_at=now)
                            )
                            db.commit()
                            complete_jellyfin_progress_track(user_id)
                            completed_users += 1
                            update_jellyfin_progress(
                                "user_states",
                                detail=str(user_row["name"]),
                                current=completed_users,
                                total=total_users,
                            )
                            continue

                        rows = []
                        for payload in page.items:
                            remote_item_id = _normalize_jellyfin_id(payload.get("Id"))
                            if not remote_item_id:
                                continue
                            user_data = payload.get("UserData")
                            if not isinstance(user_data, dict):
                                user_data = {}
                            rows.append(
                                _stage_user_data_row(
                                    sync_run_id,
                                    remote_item_id,
                                    user_id,
                                    user_data,
                                    now,
                                )
                            )
                        commit_stage_page(
                            db,
                            JellyfinSyncStageUserData,
                            rows,
                            conflict_columns=(
                                "sync_run_id",
                                "jellyfin_item_id",
                                "jellyfin_user_id",
                            ),
                        )
                        current = min(
                            page.start_index + len(page.items),
                            page.total_record_count,
                        )
                        update_jellyfin_progress_track(
                            user_id,
                            current=current,
                            total=page.total_record_count,
                        )
                        pending[executor.submit(next, pages, None)] = (
                            user_row,
                            pages,
                        )
            finally:
                batch_abort.set()


def run_jellyfin_sync(db: Session, *, job_id: int | None = None) -> dict[str, int | str]:
    connection = get_or_create_jellyfin_connection(db)
    if not connection.enabled:
        raise JellyfinError("Jellyfin integration is disabled")
    api_key = read_jellyfin_api_key(connection, get_settings().jellyfin_api_key_file)
    if job_id is None:
        reset_jellyfin_cancellation()
    begin_jellyfin_progress(
        job_id,
        (
            lambda **progress: update_jellyfin_sync_job_progress(db, job_id, **progress)
            if job_id is not None
            else None
        ),
    )
    now = utc_now()
    sync_run_id = f"job-{job_id}" if job_id is not None else uuid4().hex
    cleanup_staging(db, sync_run_id)
    connection.last_status = "running"
    connection.last_error = None
    connection.last_sync_started_at = now
    db.commit()
    update_jellyfin_progress("connecting")
    library_count = 0
    item_count = 0
    user_count = 0
    playback_event_count = 0
    playback_history_status = "unavailable"

    try:
        jellyfin_client = JellyfinClient(
            connection.base_url,
            api_key,
            cancellation_check=_raise_if_sync_cancelled,
        )
        client_context = jellyfin_client if hasattr(jellyfin_client, "__enter__") else nullcontext(jellyfin_client)
        with client_context as client:
            system_info = client.get_system_info()
            _raise_if_sync_cancelled()
            connection = get_or_create_jellyfin_connection(db)
            connection.server_name = system_info.get("ServerName")
            connection.server_version = system_info.get("Version")
            db.commit()

            update_jellyfin_progress("users", current=0, total=None)
            remote_users = client.get_users()
            stored_users = {
                user.jellyfin_user_id: user for user in db.scalars(select(JellyfinUser))
            }
            user_rows: list[dict] = []
            for payload in remote_users:
                _raise_if_sync_cancelled()
                user_id = _normalize_jellyfin_id(payload.get("Id"))
                if not user_id:
                    continue
                stored = stored_users.get(user_id)
                user_rows.append(
                    {
                        "sync_run_id": sync_run_id,
                        "jellyfin_user_id": user_id,
                        "name": str(payload.get("Name") or (stored.name if stored else "Unknown user")),
                        "enabled_for_sync": bool(stored.enabled_for_sync) if stored else True,
                        "last_synced_at": stored.last_synced_at if stored else None,
                    }
                )
            commit_stage_page(
                db,
                JellyfinSyncStageUser,
                user_rows,
                conflict_columns=("sync_run_id", "jellyfin_user_id"),
            )
            user_count = len(user_rows)
            update_jellyfin_progress("users", current=user_count, total=user_count)

            update_jellyfin_progress("libraries")
            folders = client.get_virtual_folders()
            _raise_if_sync_cancelled()
            library_rows = _stage_library_rows(db, sync_run_id, folders, now)
            commit_stage_page(
                db,
                JellyfinSyncStageLibrary,
                library_rows,
                conflict_columns=("sync_run_id", "remote_item_id"),
            )
            library_count = len(library_rows)

            # Fetch the canonical catalog once. Pages are validated and persisted
            # immediately; cleanup happens only after every page completed.
            update_jellyfin_progress("items")

            def report_catalog_progress(current: int, total: int | None) -> None:
                _raise_if_sync_cancelled()
                update_jellyfin_progress("items", current=current, total=total)

            for page in _iter_item_pages(client, progress_callback=report_catalog_progress):
                rows = []
                for payload in page.items:
                    _raise_if_sync_cancelled()
                    row = _stage_item_row(sync_run_id, payload, folders, now)
                    if row is not None:
                        rows.append(row)
                commit_stage_page(
                    db,
                    JellyfinSyncStageItem,
                    rows,
                    conflict_columns=("sync_run_id", "jellyfin_item_id"),
                )
                update_jellyfin_progress(
                    "items",
                    current=min(page.start_index + len(page.items), page.total_record_count),
                    total=page.total_record_count,
                )

            enabled_user_rows = [row for row in user_rows if row["enabled_for_sync"]]
            update_jellyfin_progress(
                "user_states",
                current=0,
                total=len(enabled_user_rows),
            )
            _sync_enabled_user_data(
                db,
                sync_run_id=sync_run_id,
                enabled_users=enabled_user_rows,
                base_url=connection.base_url,
                api_key=api_key,
                now=now,
            )
            update_jellyfin_progress("playback_events", current=0, total=None)
            playback_event_count, playback_history_status = _sync_playback_events(
                db,
                client=client,
                sync_run_id=sync_run_id,
                now=now,
            )

        item_count = int(
            db.scalar(
                select(func.count()).select_from(JellyfinSyncStageItem).where(
                    JellyfinSyncStageItem.sync_run_id == sync_run_id
                )
            )
            or 0
        )
        update_jellyfin_progress("promoting", current=item_count, total=item_count)
        _raise_if_sync_cancelled()
        promote_staging(db, sync_run_id)
        _raise_if_sync_cancelled()

        update_jellyfin_progress("matching")
        match_summary = recompute_jellyfin_matches(
            db,
            cancellation_check=_raise_if_sync_cancelled,
            commit=False,
        )
        _raise_if_sync_cancelled()
        finished_at = utc_now()
        connection = get_or_create_jellyfin_connection(db)
        connection.last_status = "success"
        connection.last_error = None
        connection.last_sync_finished_at = finished_at
        connection.last_successful_sync_at = finished_at
        db.commit()
        stats_cache.invalidate_connectors(str(id(db.get_bind())))
        return {
            "status": "success",
            "libraries_synced": library_count,
            "items_synced": item_count,
            "users_synced": user_count,
            "playback_events_synced": playback_event_count,
            "playback_history_status": playback_history_status,
            **match_summary,
        }
    except JellyfinSyncCancelled:
        db.rollback()
        connection = get_or_create_jellyfin_connection(db)
        connection.last_status = "canceled"
        connection.last_error = None
        connection.last_sync_finished_at = utc_now()
        db.commit()
        return {
            "status": "canceled",
            "libraries_synced": 0,
            "items_synced": 0,
            "users_synced": 0,
            "matches_created": 0,
            "unmatched_items": 0,
        }
    except Exception as exc:
        db.rollback()
        connection = get_or_create_jellyfin_connection(db)
        connection.last_status = "error"
        connection.last_error = str(exc)[:2048]
        connection.last_sync_finished_at = utc_now()
        db.commit()
        raise
    finally:
        db.rollback()
        cleanup_staging(db, sync_run_id)
        clear_jellyfin_progress()
        reset_jellyfin_cancellation()
