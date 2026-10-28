from __future__ import annotations

from collections import defaultdict
from pathlib import PurePosixPath
from typing import Callable

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session

from backend.app.models.entities import ConnectorItem, ConnectorMediaMatch, MediaFile
from backend.app.services.connector_pathing import (
    prepare_connector_bindings,
    resolve_connector_item_path,
)
from backend.app.services.stats_cache import stats_cache


SUPPORTED_ITEM_TYPES = {"movie", "episode", "audio", "audiobook"}
MATCH_BATCH_SIZE = 250


def _register_casefold_function(db: Session) -> None:
    """Expose Python's Unicode casefold to bounded SQLite candidate queries."""
    if db.get_bind().dialect.name != "sqlite":
        return
    connection = db.connection().connection
    driver_connection = getattr(connection, "driver_connection", connection)
    driver_connection.create_function(
        "casefold", 1, lambda value: value.casefold() if value is not None else None,
        deterministic=True,
    )


def _media_candidates(db: Session, resolved_items: list[tuple[ConnectorItem, object]]) -> list[object]:
    """Fetch only exact-path and filename candidates needed by one item batch."""
    if not resolved_items:
        return []
    sensitive_paths: set[tuple[int, str]] = set()
    insensitive_paths: dict[int, set[str]] = defaultdict(set)
    for _item, locator in resolved_items:
        path = locator.relative_path
        if locator.case_mode == "insensitive":
            insensitive_paths[locator.library_root_id].add(path.casefold())
        else:
            sensitive_paths.add((locator.library_root_id, path))

    predicates = [
        and_(MediaFile.library_root_id == root_id, MediaFile.relative_path == path)
        for root_id, path in sensitive_paths
    ]
    _register_casefold_function(db)
    predicates.extend(
        and_(
            MediaFile.library_root_id == root_id,
            func.casefold(MediaFile.relative_path).in_(path_keys),
        )
        for root_id, path_keys in insensitive_paths.items()
    )
    columns = (
        MediaFile.id,
        MediaFile.library_root_id,
        MediaFile.relative_path,
        MediaFile.filename,
        MediaFile.size_bytes,
        MediaFile.duration_seconds,
    )
    exact_rows = list(db.execute(select(*columns).where(or_(*predicates)))) if predicates else []
    exact_sensitive: set[tuple[int, str]] = set()
    exact_insensitive: set[tuple[int, str]] = set()
    for row in exact_rows:
        if row.library_root_id is not None:
            exact_sensitive.add((row.library_root_id, row.relative_path))
            exact_insensitive.add((row.library_root_id, row.relative_path.casefold()))
    fallback_names = {
        PurePosixPath(locator.relative_path).name.casefold()
        for _item, locator in resolved_items
        if (
            locator.library_root_id,
            locator.relative_path.casefold()
            if locator.case_mode == "insensitive"
            else locator.relative_path,
        ) not in (exact_insensitive if locator.case_mode == "insensitive" else exact_sensitive)
    }
    # Suggestions are global across roots and only needed when the exact path
    # misses; this keeps ordinary full matching on indexed point lookups.
    if fallback_names:
        fallback_rows = list(
            db.execute(
                select(*columns).where(func.casefold(MediaFile.filename).in_(fallback_names))
            )
        )
        # An exact candidate can also be a filename suggestion for another
        # item in this batch. Keep each media file once to avoid false ambiguity.
        seen_ids = {row.id for row in exact_rows}
        exact_rows.extend(row for row in fallback_rows if row.id not in seen_ids)
    return exact_rows


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

    result: defaultdict[str, int] = defaultdict(int)
    # A full catalog sync benefits from one compact media projection. Repeating
    # case-insensitive scans for every item batch grows quadratically on large
    # catalogs, whereas targeted rematches can use narrow candidate queries.
    full_indexes = None
    if not targeted and connector_item_ids is None:
        full_sensitive: dict[tuple[int, str], list[object]] = defaultdict(list)
        full_insensitive: dict[tuple[int, str], list[object]] = defaultdict(list)
        full_by_filename: dict[str, list[object]] = defaultdict(list)
        for row in db.execute(select(
            MediaFile.id, MediaFile.library_root_id, MediaFile.relative_path,
            MediaFile.filename, MediaFile.size_bytes, MediaFile.duration_seconds,
        )).yield_per(500):
            if row.library_root_id is not None:
                full_sensitive[(row.library_root_id, row.relative_path)].append(row)
                full_insensitive[(row.library_root_id, row.relative_path.casefold())].append(row)
            full_by_filename[row.filename.casefold()].append(row)
        full_indexes = (full_sensitive, full_insensitive, full_by_filename)
    last_item_id = 0
    while True:
        batch_query = item_query.where(ConnectorItem.id > last_item_id).order_by(ConnectorItem.id).limit(MATCH_BATCH_SIZE)
        items = list(db.scalars(batch_query))
        if not items:
            break
        last_item_id = items[-1].id
        item_ids = {item.id for item in items}
        db.execute(
            delete(ConnectorMediaMatch).where(
                ConnectorMediaMatch.connector_item_id.in_(item_ids),
            )
        )

        resolved_items: list[tuple[ConnectorItem, object]] = []
        for index, item in enumerate(items):
            if cancellation_check and index == 0:
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

        if full_indexes is not None:
            exact_sensitive, exact_insensitive, by_filename = full_indexes
        else:
            media_rows = _media_candidates(db, resolved_items)
            exact_sensitive = defaultdict(list)
            exact_insensitive = defaultdict(list)
            by_filename = defaultdict(list)
            for row in media_rows:
                if row.library_root_id is not None:
                    exact_sensitive[(row.library_root_id, row.relative_path)].append(row)
                    exact_insensitive[(row.library_root_id, row.relative_path.casefold())].append(row)
                by_filename[row.filename.casefold()].append(row)

        for item, locator in resolved_items:
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
        db.flush()
        del exact_sensitive, exact_insensitive, by_filename, resolved_items, items

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
