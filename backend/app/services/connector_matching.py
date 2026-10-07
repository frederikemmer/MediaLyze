from __future__ import annotations

from collections import defaultdict
from pathlib import PurePosixPath
from typing import Callable

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from backend.app.models.entities import ConnectorItem, ConnectorMediaMatch, MediaFile
from backend.app.services.connector_pathing import (
    prepare_connector_bindings,
    resolve_connector_item_path,
)
from backend.app.services.stats_cache import stats_cache


SUPPORTED_ITEM_TYPES = {"movie", "episode", "audio", "audiobook"}


def recompute_connector_matches(
    db: Session,
    *,
    connection_id: int | None = None,
    connector_item_ids: set[int] | None = None,
    media_file_ids: set[int] | None = None,
    media_file_locators: set[tuple[int, str]] | None = None,
    cancellation_check: Callable[[], None] | None = None,
    commit: bool = True,
) -> dict[str, int]:
    item_query = select(ConnectorItem)
    accessibility_cache: dict[int, bool] = {}
    prepared_bindings = prepare_connector_bindings(db, connection_id=connection_id)
    if connection_id is not None:
        item_query = item_query.where(ConnectorItem.connection_id == connection_id)
    if connector_item_ids is not None:
        if not connector_item_ids:
            return {}
        item_query = item_query.where(ConnectorItem.id.in_(connector_item_ids))

    targeted = media_file_ids is not None or media_file_locators is not None
    if targeted:
        requested_file_ids = media_file_ids or set()
        affected_item_ids = set(
            db.scalars(
                select(ConnectorMediaMatch.connector_item_id).where(
                    ConnectorMediaMatch.media_file_id.in_(requested_file_ids),
                )
            )
        ) if requested_file_ids else set()
        root_and_paths = list(
            db.execute(
                select(MediaFile.library_root_id, MediaFile.relative_path).where(
                    MediaFile.id.in_(requested_file_ids)
                )
            )
        ) if requested_file_ids else []
        root_and_paths.extend(media_file_locators or set())
        changed_path_keys: dict[int, set[str]] = defaultdict(set)
        for root_id, relative_path in root_and_paths:
            if root_id is None:
                continue
            changed_path_keys[int(root_id)].add(str(relative_path).casefold())
        for root_id, path_keys in changed_path_keys.items():
            affected_item_ids.update(
                db.scalars(
                    item_query.with_only_columns(ConnectorItem.id).where(
                        ConnectorItem.resolved_library_root_id == root_id,
                        ConnectorItem.resolved_relative_path_key.in_(path_keys),
                    )
                )
            )
        if not affected_item_ids:
            return {}
        item_query = item_query.where(ConnectorItem.id.in_(affected_item_ids))

    items = list(db.scalars(item_query.order_by(ConnectorItem.id)))
    item_ids = {item.id for item in items}
    if item_ids:
        db.execute(
            delete(ConnectorMediaMatch).where(
                ConnectorMediaMatch.connector_item_id.in_(item_ids),
            )
        )

    result: defaultdict[str, int] = defaultdict(int)
    resolved_items: list[tuple[ConnectorItem, object]] = []
    for index, item in enumerate(items):
        if cancellation_check and index % 250 == 0:
            cancellation_check()
        if item.item_type.casefold() not in SUPPORTED_ITEM_TYPES:
            item.resolved_library_root_id = None
            item.resolved_relative_path = None
            item.resolved_relative_path_key = None
            item.resolved_binding_id = None
            item.match_status = "unsupported_item_type"
            item.mismatch_reason = "unsupported_item_type"
            result["unsupported_item_type"] += 1
            continue

        resolution = resolve_connector_item_path(
            db,
            item,
            accessibility_cache=accessibility_cache,
            prepared_bindings=prepared_bindings,
        )
        if resolution.locator is None:
            item.resolved_library_root_id = None
            item.resolved_relative_path = None
            item.resolved_relative_path_key = None
            item.resolved_binding_id = None
            item.match_status = resolution.status
            item.mismatch_reason = resolution.reason
            result[resolution.status] += 1
            continue
        locator = resolution.locator
        item.resolved_library_root_id = locator.library_root_id
        item.resolved_relative_path = locator.relative_path
        item.resolved_relative_path_key = locator.relative_path.casefold()
        item.resolved_binding_id = locator.binding_id
        resolved_items.append((item, locator))

    resolved_root_ids = {locator.library_root_id for _item, locator in resolved_items}
    resolved_filenames = {
        PurePosixPath(locator.relative_path).name.casefold()
        for _item, locator in resolved_items
    }
    media_query = select(
        MediaFile.id,
        MediaFile.library_root_id,
        MediaFile.relative_path,
        MediaFile.filename,
        MediaFile.size_bytes,
        MediaFile.duration_seconds,
    )
    # Full runs already touch the entire connector catalog, so one compact
    # projection of the media catalog is faster than thousands of point
    # queries. Targeted runs retain their small-query behavior.
    if targeted and len(resolved_filenames) <= 500:
        media_query = media_query.where(
            or_(
                MediaFile.library_root_id.in_(resolved_root_ids),
                func.lower(MediaFile.filename).in_(resolved_filenames),
            )
        )
    media_rows = list(db.execute(media_query)) if resolved_items else []
    exact_sensitive: dict[tuple[int, str], list[object]] = defaultdict(list)
    exact_insensitive: dict[tuple[int, str], list[object]] = defaultdict(list)
    by_filename: dict[str, list[object]] = defaultdict(list)
    for row in media_rows:
        if row.library_root_id is not None:
            exact_sensitive[(row.library_root_id, row.relative_path)].append(row)
            exact_insensitive[(row.library_root_id, row.relative_path.casefold())].append(row)
        by_filename[row.filename.casefold()].append(row)

    for index, (item, locator) in enumerate(resolved_items):
        if cancellation_check and index % 250 == 0:
            cancellation_check()
        lookup_key = (
            locator.library_root_id,
            locator.relative_path.casefold()
            if locator.case_mode == "insensitive"
            else locator.relative_path,
        )
        candidates = (
            exact_insensitive.get(lookup_key, [])
            if locator.case_mode == "insensitive"
            else exact_sensitive.get(lookup_key, [])
        )
        if len(candidates) > 1:
            item.match_status = "ambiguous_file"
            item.mismatch_reason = "ambiguous_file"
            result["ambiguous_file"] += 1
            continue
        if len(candidates) == 1:
            db.add(
                ConnectorMediaMatch(
                    connector_item_id=item.id,
                    media_file_id=candidates[0].id,
                    binding_id=locator.binding_id,
                    match_method="path",
                    confidence=1.0,
                    status="matched",
                )
            )
            item.match_status = "matched"
            item.mismatch_reason = None
            result["matched"] += 1
            continue

        filename = PurePosixPath(locator.relative_path).name.casefold()
        suggestions = [
            candidate
            for candidate in by_filename.get(filename, [])
            if (item.size_bytes is None or candidate.size_bytes == item.size_bytes)
            and (
                item.duration_seconds is None
                or candidate.duration_seconds is None
                or abs(candidate.duration_seconds - item.duration_seconds) <= 3
            )
        ]
        item.match_status = "ambiguous_file" if len(suggestions) > 1 else "no_local_file"
        item.mismatch_reason = item.match_status
        result[item.match_status] += 1

    if commit:
        db.commit()
        stats_cache.invalidate_connectors(str(id(db.get_bind())))
    else:
        db.flush()
    return dict(result)


def compare_legacy_jellyfin_matches(db: Session, connection_id: int) -> dict[str, int]:
    from backend.app.models.entities import JellyfinItem, JellyfinMediaMatch

    legacy = dict(
        db.execute(
            select(JellyfinItem.jellyfin_item_id, JellyfinMediaMatch.media_file_id)
            .join(JellyfinMediaMatch, JellyfinMediaMatch.jellyfin_item_id == JellyfinItem.id)
        ).all()
    )
    generic = dict(
        db.execute(
            select(ConnectorItem.remote_id, ConnectorMediaMatch.media_file_id)
            .join(
                ConnectorMediaMatch,
                ConnectorMediaMatch.connector_item_id == ConnectorItem.id,
            )
            .where(ConnectorItem.connection_id == connection_id)
        ).all()
    )
    counters = defaultdict(int)
    for remote_id in set(legacy) | set(generic):
        old = legacy.get(remote_id)
        new = generic.get(remote_id)
        if old is not None and new == old:
            counters["same_match"] += 1
        elif old is not None and new is None:
            counters["old_only"] += 1
        elif old is None and new is not None:
            counters["new_only"] += 1
        elif old is not None and new is not None:
            counters["different_media_file"] += 1
    counters["ambiguous"] = db.scalar(
        select(func.count()).select_from(ConnectorItem).where(
            ConnectorItem.connection_id == connection_id,
            ConnectorItem.match_status.in_(["ambiguous_binding", "ambiguous_file"]),
        )
    ) or 0
    counters["unmapped"] = db.scalar(
        select(func.count()).select_from(ConnectorItem).where(
            ConnectorItem.connection_id == connection_id,
            ConnectorItem.match_status == "unmapped",
        )
    ) or 0
    return dict(counters)
