from __future__ import annotations

from sqlalchemy import Float, Integer, case, cast, func, or_, select
from sqlalchemy.orm import Session

from backend.app.models.entities import (
    JellyfinItem,
    JellyfinLibrary,
    JellyfinMediaMatch,
    JellyfinUser,
    JellyfinUserItemData,
)
from backend.app.schemas.jellyfin import (
    JellyfinCatalogSummaryRead,
    JellyfinDistributionRead,
    JellyfinLibraryItemPageRead,
    JellyfinLibraryItemRead,
    JellyfinLibraryOverviewRead,
    JellyfinLibraryRead,
    JellyfinUserRead,
)

TICKS_PER_SECOND = 10_000_000


def item_size(item: JellyfinItem) -> int | None:
    if item.size_bytes is not None:
        return item.size_bytes
    value = (item.raw_limited_payload or {}).get("Size")
    return int(value) if isinstance(value, (int, float)) and value >= 0 else None


def item_duration(item: JellyfinItem) -> float | None:
    if item.duration_seconds is not None:
        return item.duration_seconds
    value = (item.raw_limited_payload or {}).get("RunTimeTicks")
    return float(value) / TICKS_PER_SECOND if isinstance(value, (int, float)) and value >= 0 else None


def library_read(db: Session, library: JellyfinLibrary) -> JellyfinLibraryRead:
    linked_name = None
    restricted = "access_scope" in db.info
    linked = None
    if library.linked_library_id is not None:
        from backend.app.models.entities import Library

        linked = db.get(Library, library.linked_library_id)
        linked_name = linked.name if linked else None
    item_count = db.scalar(
        select(func.count(JellyfinItem.id)).where(
            or_(
                JellyfinItem.library_id == library.id,
                (JellyfinItem.library_id.is_(None)) & (JellyfinItem.library_name == library.name),
            )
        )
    ) or 0
    return JellyfinLibraryRead(
        id=library.id,
        name=library.name,
        collection_type=library.collection_type,
        locations=list(library.locations or []),
        mapped_locations=[] if restricted else list(library.mapped_locations or []),
        mapped_status=library.mapped_status if not restricted or linked else "path_unmapped",
        linked_library_id=library.linked_library_id if not restricted or linked else None,
        linked_library_name=linked_name,
        link_method=library.link_method if not restricted or linked else None,
        can_create_medialyze_library=(
            not restricted and library.mapped_status == "accessible" and bool(library.mapped_locations)
        ),
        data_scope="linked" if linked or (not restricted and library.linked_library_id is not None) else "jellyfin_only",
        item_count=item_count,
        last_synced_at=library.last_synced_at,
    )


def _distribution_rows(rows) -> list[JellyfinDistributionRead]:
    return [JellyfinDistributionRead(label=str(label), value=int(value)) for label, value in rows]


def _library_item_filter(library: JellyfinLibrary):
    return or_(
        JellyfinItem.library_id == library.id,
        (JellyfinItem.library_id.is_(None)) & (JellyfinItem.library_name == library.name),
    )


def _size_expression():
    return func.coalesce(
        JellyfinItem.size_bytes,
        cast(func.json_extract(JellyfinItem.raw_limited_payload, "$.Size"), Integer),
    )


def _duration_expression():
    return func.coalesce(
        JellyfinItem.duration_seconds,
        cast(func.json_extract(JellyfinItem.raw_limited_payload, "$.RunTimeTicks"), Float)
        / TICKS_PER_SECOND,
    )


def catalog_summary(db: Session) -> JellyfinCatalogSummaryRead:
    libraries = list(
        db.scalars(select(JellyfinLibrary).where(JellyfinLibrary.linked_library_id.is_(None)))
    )
    library_ids = [library.id for library in libraries]
    names = [library.name for library in libraries]
    item_filter = or_(
        JellyfinItem.library_id.in_(library_ids),
        (JellyfinItem.library_id.is_(None)) & JellyfinItem.library_name.in_(names),
    )
    size_expr = _size_expression()
    duration_expr = _duration_expression()
    aggregates = db.execute(
        select(
            func.count(JellyfinItem.id),
            func.coalesce(func.sum(size_expr), 0),
            func.count(size_expr),
            func.coalesce(func.sum(duration_expr), 0.0),
            func.count(duration_expr),
        ).where(item_filter)
    ).one() if libraries else (0, 0, 0, 0.0, 0)
    return JellyfinCatalogSummaryRead(
        library_count=len(libraries),
        item_count=int(aggregates[0]),
        known_size_bytes=int(aggregates[1]),
        size_known_count=int(aggregates[2]),
        known_duration_seconds=float(aggregates[3]),
        duration_known_count=int(aggregates[4]),
        last_synced_at=max((library.last_synced_at for library in libraries), default=None),
    )


def library_overview(db: Session, library: JellyfinLibrary, user_id: str | None) -> JellyfinLibraryOverviewRead:
    item_filter = _library_item_filter(library)
    size_expr = _size_expression()
    duration_expr = _duration_expression()
    aggregates = db.execute(
        select(
            func.count(JellyfinItem.id),
            func.coalesce(func.sum(size_expr), 0),
            func.count(size_expr),
            func.coalesce(func.sum(duration_expr), 0.0),
            func.count(duration_expr),
            func.min(JellyfinItem.date_created),
            func.max(JellyfinItem.date_created),
        ).where(item_filter)
    ).one()
    item_count = int(aggregates[0])
    type_rows = db.execute(
        select(JellyfinItem.item_type, func.count(JellyfinItem.id))
        .where(item_filter)
        .group_by(JellyfinItem.item_type)
        .order_by(JellyfinItem.item_type.asc())
    ).all()
    year_rows = db.execute(
        select(cast(JellyfinItem.production_year, Integer), func.count(JellyfinItem.id))
        .where(item_filter, JellyfinItem.production_year.is_not(None))
        .group_by(JellyfinItem.production_year)
        .order_by(JellyfinItem.production_year.desc())
    ).all()
    month_label = func.strftime("%Y-%m", JellyfinItem.date_created)
    month_rows = db.execute(
        select(month_label, func.count(JellyfinItem.id))
        .where(item_filter, JellyfinItem.date_created.is_not(None))
        .group_by(month_label)
        .order_by(month_label.asc())
    ).all()
    played_query = (
        select(func.count(func.distinct(JellyfinUserItemData.jellyfin_item_id)))
        .join(JellyfinItem, JellyfinItem.id == JellyfinUserItemData.jellyfin_item_id)
        .join(JellyfinUser, JellyfinUser.jellyfin_user_id == JellyfinUserItemData.jellyfin_user_id)
        .where(
            item_filter,
            JellyfinUser.enabled_for_sync.is_(True),
            JellyfinUserItemData.played.is_(True),
        )
    )
    if user_id:
        played_query = played_query.where(JellyfinUserItemData.jellyfin_user_id == user_id)
    played = int(db.scalar(played_query) or 0)
    playback_item_count = item_count
    if "access_scope" in db.info:
        # Catalog totals are external; playback distributions cover only readable local matches.
        playback_item_count = int(db.scalar(select(func.count(JellyfinItem.id)).where(
            item_filter, JellyfinItem.id.in_(select(JellyfinMediaMatch.jellyfin_item_id).where(
                JellyfinMediaMatch.status == "matched"
            )),
        )) or 0)
    users = list(
        db.scalars(
            select(JellyfinUser)
            .where(JellyfinUser.enabled_for_sync.is_(True))
            .order_by(JellyfinUser.name.asc())
        )
    )
    return JellyfinLibraryOverviewRead(
        library=library_read(db, library),
        item_count=item_count,
        known_size_bytes=int(aggregates[1]),
        size_known_count=int(aggregates[2]),
        known_duration_seconds=float(aggregates[3]),
        duration_known_count=int(aggregates[4]),
        earliest_date_created=aggregates[5],
        latest_date_created=aggregates[6],
        item_type_distribution=_distribution_rows(type_rows),
        production_year_distribution=_distribution_rows(year_rows),
        added_month_distribution=_distribution_rows(month_rows),
        playback_distribution=[
            JellyfinDistributionRead(label="played", value=played),
            JellyfinDistributionRead(label="unplayed", value=max(0, playback_item_count - played)),
        ],
        users=[JellyfinUserRead.model_validate(user) for user in users],
    )


def library_items(
    db: Session,
    library: JellyfinLibrary,
    *,
    offset: int,
    limit: int,
    search: str | None,
    item_type: str | None,
    production_year: int | None,
    played: bool | None,
    user_id: str | None,
    sort_key: str,
    sort_direction: str,
) -> JellyfinLibraryItemPageRead:
    playback_query = (
        select(
            JellyfinUserItemData.jellyfin_item_id.label("item_id"),
            func.coalesce(func.sum(JellyfinUserItemData.play_count), 0).label("play_count"),
            func.coalesce(func.sum(case((JellyfinUserItemData.played.is_(True), 1), else_=0)), 0).label("played_user_count"),
            func.coalesce(func.sum(case((JellyfinUserItemData.is_favorite.is_(True), 1), else_=0)), 0).label("favorite_user_count"),
        )
        .join(JellyfinUser, JellyfinUser.jellyfin_user_id == JellyfinUserItemData.jellyfin_user_id)
        .where(JellyfinUser.enabled_for_sync.is_(True))
        .group_by(JellyfinUserItemData.jellyfin_item_id)
    )
    if user_id:
        playback_query = playback_query.where(JellyfinUserItemData.jellyfin_user_id == user_id)
    playback = playback_query.subquery()

    play_count_expr = func.coalesce(playback.c.play_count, 0)
    played_count_expr = func.coalesce(playback.c.played_user_count, 0)
    favorite_count_expr = func.coalesce(playback.c.favorite_user_count, 0)
    statement = (
        select(
            JellyfinItem,
            play_count_expr.label("aggregated_play_count"),
            played_count_expr.label("aggregated_played_count"),
            favorite_count_expr.label("aggregated_favorite_count"),
            JellyfinMediaMatch.media_file_id,
        )
        .outerjoin(playback, playback.c.item_id == JellyfinItem.id)
        .outerjoin(
            JellyfinMediaMatch,
            (JellyfinMediaMatch.jellyfin_item_id == JellyfinItem.id)
            & (JellyfinMediaMatch.status == "matched"),
        )
        .where(
            or_(
                JellyfinItem.library_id == library.id,
                (JellyfinItem.library_id.is_(None)) & (JellyfinItem.library_name == library.name),
            )
        )
    )
    query = (search or "").strip().casefold()
    if query:
        pattern = f"%{query}%"
        statement = statement.where(
            or_(
                func.lower(JellyfinItem.title).like(pattern),
                func.lower(func.coalesce(JellyfinItem.original_title, "")).like(pattern),
                func.lower(func.coalesce(JellyfinItem.series_name, "")).like(pattern),
                func.lower(func.coalesce(JellyfinItem.season_name, "")).like(pattern),
                func.lower(func.coalesce(JellyfinItem.path, "")).like(pattern),
            )
        )
    if item_type:
        statement = statement.where(func.lower(JellyfinItem.item_type) == item_type.casefold())
    if production_year is not None:
        statement = statement.where(JellyfinItem.production_year == production_year)
    if played is not None:
        statement = statement.where(played_count_expr > 0 if played else played_count_expr == 0)

    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    sorters = {
        "title": func.lower(JellyfinItem.title),
        "year": func.coalesce(JellyfinItem.production_year, -1),
        "duration": func.coalesce(JellyfinItem.duration_seconds, -1),
        "size": func.coalesce(JellyfinItem.size_bytes, -1),
        "play_count": play_count_expr,
        "added": func.coalesce(JellyfinItem.date_created, "1970-01-01"),
    }
    sort_expression = sorters[sort_key]
    statement = statement.order_by(
        sort_expression.desc() if sort_direction == "desc" else sort_expression.asc(),
        JellyfinItem.id.asc(),
    ).offset(offset).limit(limit)

    rows = [
        JellyfinLibraryItemRead(
            id=item.id,
            jellyfin_item_id=item.jellyfin_item_id,
            title=item.title,
            original_title=item.original_title,
            item_type=item.item_type,
            series_name=item.series_name,
            season_name=item.season_name,
            index_number=item.index_number,
            parent_index_number=item.parent_index_number,
            date_created=item.date_created,
            premiere_date=item.premiere_date,
            production_year=item.production_year,
            size_bytes=item_size(item),
            duration_seconds=item_duration(item),
            has_primary_image=bool((item.image_tags or {}).get("Primary")),
            play_count=int(aggregated_play_count or 0),
            played=bool(aggregated_played_count),
            played_user_count=int(aggregated_played_count or 0),
            favorite_user_count=int(aggregated_favorite_count or 0),
            match_status=(item.match_status if "access_scope" not in db.info or media_file_id is not None else "unmatched"),
            media_file_id=media_file_id,
        )
        for item, aggregated_play_count, aggregated_played_count, aggregated_favorite_count, media_file_id in db.execute(statement)
    ]
    return JellyfinLibraryItemPageRead(items=rows, total=total, offset=offset, limit=limit)
