from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from sqlalchemy import Float, case, cast, func, select
from sqlalchemy.orm import Session

from backend.app.models.entities import (
    JellyfinMediaMatch,
    JellyfinUser,
    JellyfinUserItemData,
    Library,
    MediaFile,
)
from backend.app.schemas.comparison import (
    ComparisonBarEntry,
    ComparisonBucket,
    ComparisonFieldId,
    ComparisonFieldKind,
    ComparisonHeatmapCell,
    ComparisonRendererId,
    ComparisonResponse,
    ComparisonScatterPoint,
)
from backend.app.services.app_settings import get_app_settings
from backend.app.services.container_formats import format_container_label, normalize_container
from backend.app.services.numeric_distributions import NUMERIC_DISTRIBUTION_CONFIGS
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.services.stats_cache import stats_cache

RESOLUTION_MP_BINS: Final[list[tuple[float | None, float | None]]] = [
    (0, 1),
    (1, 2),
    (2, 4),
    (4, 8),
    (8, 12),
    (12, 20),
    (20, None),
]
PLAY_COUNT_BINS: Final[list[tuple[float | None, float | None]]] = [
    (1, 2),
    (2, 5),
    (5, 10),
    (10, 25),
    (25, 50),
    (50, 100),
    (100, None),
]
USERS_PLAYED_BINS: Final[list[tuple[float | None, float | None]]] = [
    (1, 2),
    (2, 3),
    (3, 4),
    (4, 5),
    (5, 6),
    (6, 10),
    (10, 25),
    (25, None),
]


@dataclass(frozen=True)
class ComparisonFieldDefinition:
    field_id: ComparisonFieldId
    kind: ComparisonFieldKind


@dataclass(frozen=True)
class CategoryValue:
    key: str
    label: str


@dataclass(frozen=True)
class ComparisonSourceRow:
    media_file_id: int
    asset_name: str
    size: float | None = None
    duration: float | None = None
    quality_score: float | None = None
    bitrate: float | None = None
    audio_bitrate: float | None = None
    play_count: float = 0
    users_played: float = 0
    audio_channels: float | None = None
    sample_rate: float | None = None
    container: str | None = None
    video_codec: str | None = None
    width: int | None = None
    height: int | None = None
    hdr_type: str | None = None
    audio_artist: str | None = None
    audio_album: str | None = None
    audio_genre: str | None = None
    audio_year: str | None = None
    track_number: str | None = None
    bit_rate_mode: str | None = None
    embedded_cover: bool = False
    chapter_count: float | None = None
    audiobook_narrator: str | None = None
    audiobook_author: str | None = None
    audiobook_publisher: str | None = None
    audiobook_series: str | None = None
    audiobook_series_part: str | None = None


COMPARISON_FIELD_DEFINITIONS: dict[ComparisonFieldId, ComparisonFieldDefinition] = {
    "size": ComparisonFieldDefinition(field_id="size", kind="numeric"),
    "duration": ComparisonFieldDefinition(field_id="duration", kind="numeric"),
    "quality_score": ComparisonFieldDefinition(field_id="quality_score", kind="numeric"),
    "bitrate": ComparisonFieldDefinition(field_id="bitrate", kind="numeric"),
    "audio_bitrate": ComparisonFieldDefinition(field_id="audio_bitrate", kind="numeric"),
    "play_count": ComparisonFieldDefinition(field_id="play_count", kind="numeric"),
    "users_played": ComparisonFieldDefinition(field_id="users_played", kind="numeric"),
    "audio_channels": ComparisonFieldDefinition(field_id="audio_channels", kind="category"),
    "sample_rate": ComparisonFieldDefinition(field_id="sample_rate", kind="category"),
    "resolution_mp": ComparisonFieldDefinition(field_id="resolution_mp", kind="numeric"),
    "container": ComparisonFieldDefinition(field_id="container", kind="category"),
    "video_codec": ComparisonFieldDefinition(field_id="video_codec", kind="category"),
    "resolution": ComparisonFieldDefinition(field_id="resolution", kind="category"),
    "hdr_type": ComparisonFieldDefinition(field_id="hdr_type", kind="category"),
    "audio_artist": ComparisonFieldDefinition(field_id="audio_artist", kind="category"),
    "audio_album": ComparisonFieldDefinition(field_id="audio_album", kind="category"),
    "audio_genre": ComparisonFieldDefinition(field_id="audio_genre", kind="category"),
    "audio_year": ComparisonFieldDefinition(field_id="audio_year", kind="category"),
    "track_number": ComparisonFieldDefinition(field_id="track_number", kind="category"),
    "bit_rate_mode": ComparisonFieldDefinition(field_id="bit_rate_mode", kind="category"),
    "embedded_cover": ComparisonFieldDefinition(field_id="embedded_cover", kind="category"),
    "chapter_count": ComparisonFieldDefinition(field_id="chapter_count", kind="numeric"),
    "audiobook_narrator": ComparisonFieldDefinition(field_id="audiobook_narrator", kind="category"),
    "audiobook_author": ComparisonFieldDefinition(field_id="audiobook_author", kind="category"),
    "audiobook_publisher": ComparisonFieldDefinition(field_id="audiobook_publisher", kind="category"),
    "audiobook_series": ComparisonFieldDefinition(field_id="audiobook_series", kind="category"),
    "audiobook_series_part": ComparisonFieldDefinition(field_id="audiobook_series_part", kind="category"),
}
VIDEO_ONLY_COMPARISON_FIELDS: Final[set[ComparisonFieldId]] = {
    "bitrate",
    "resolution_mp",
    "video_codec",
    "resolution",
    "hdr_type",
}
MUSIC_ALLOWED_COMPARISON_FALLBACK: Final[list[ComparisonFieldId]] = [
    "duration",
    "size",
    "quality_score",
    "audio_bitrate",
    "container",
    "audio_channels",
    "sample_rate",
    "audio_artist",
    "audio_album",
    "audio_genre",
    "audio_year",
    "track_number",
    "bit_rate_mode",
    "embedded_cover",
    "chapter_count",
    "audiobook_narrator",
    "audiobook_author",
    "audiobook_publisher",
    "audiobook_series",
    "audiobook_series_part",
]
NUMERIC_BUCKET_CONFIGS = {
    config.metric_id: config
    for config in NUMERIC_DISTRIBUTION_CONFIGS
}


def _normalize_library_comparison_fields(
    *,
    library_type: str,
    x_field: ComparisonFieldId,
    y_field: ComparisonFieldId,
) -> tuple[ComparisonFieldId, ComparisonFieldId]:
    if library_type not in {"music", "audiobooks"}:
        return x_field, y_field

    allowed_fields = [
        field_id
        for field_id in COMPARISON_FIELD_DEFINITIONS.keys()
        if field_id not in VIDEO_ONLY_COMPARISON_FIELDS
    ]
    first_fallback = next((field for field in MUSIC_ALLOWED_COMPARISON_FALLBACK if field in allowed_fields), "duration")
    second_fallback = next((field for field in allowed_fields if field != first_fallback), "size")

    normalized_x = x_field if x_field in allowed_fields else first_fallback
    normalized_y = y_field if y_field in allowed_fields else second_fallback
    if normalized_x == normalized_y:
        normalized_y = next((field for field in allowed_fields if field != normalized_x), second_fallback)
    return normalized_x, normalized_y


def _normalized_text(value: str | None, fallback: str) -> str:
    candidate = (value or "").strip().lower()
    return candidate or fallback


def _bucket_key(lower: float | None, upper: float | None) -> str:
    lower_key = "" if lower is None else f"{lower:g}"
    upper_key = "" if upper is None else f"{upper:g}"
    return f"{lower_key}:{upper_key}"


def _numeric_bins(field_id: ComparisonFieldId) -> list[tuple[float | None, float | None]]:
    if field_id == "resolution_mp":
        return RESOLUTION_MP_BINS
    if field_id == "play_count":
        return PLAY_COUNT_BINS
    if field_id == "users_played":
        return USERS_PLAYED_BINS
    return NUMERIC_BUCKET_CONFIGS[field_id].bins


def _numeric_bucket(field_id: ComparisonFieldId, value: float) -> ComparisonBucket | None:
    for lower, upper in _numeric_bins(field_id):
        meets_lower = lower is None or value >= lower
        meets_upper = upper is None or value < upper
        if meets_lower and meets_upper:
            return ComparisonBucket(
                key=_bucket_key(lower, upper),
                label=_bucket_key(lower, upper),
                lower=lower,
                upper=upper,
            )
    return None


def _numeric_axis_buckets(field_id: ComparisonFieldId) -> list[ComparisonBucket]:
    return [
        ComparisonBucket(
            key=_bucket_key(lower, upper),
            label=_bucket_key(lower, upper),
            lower=lower,
            upper=upper,
        )
        for lower, upper in _numeric_bins(field_id)
    ]


def _comparison_source_rows(
    db: Session,
    *,
    x_field: ComparisonFieldId,
    y_field: ComparisonFieldId,
    library_id: int | None = None,
) -> list[ComparisonSourceRow]:
    requested_fields = {x_field, y_field}
    selected_columns = [
        MediaFile.id.label("media_file_id"),
        MediaFile.filename.label("asset_name"),
    ]
    column_by_field = {
        "size": cast(MediaFile.size_bytes, Float).label("size"),
        "quality_score": cast(MediaFile.quality_score, Float).label("quality_score"),
        "duration": cast(MediaFile.duration_seconds, Float).label("duration"),
        "bitrate": cast(MediaFile.bitrate, Float).label("bitrate"),
        "audio_bitrate": cast(MediaFile.audio_bitrate, Float).label("audio_bitrate"),
        "audio_channels": cast(MediaFile.audio_channels, Float).label("audio_channels"),
        "sample_rate": cast(MediaFile.sample_rate, Float).label("sample_rate"),
        "container": MediaFile.extension.label("container"),
        "video_codec": MediaFile.primary_video_codec.label("video_codec"),
        "hdr_type": MediaFile.primary_video_hdr_type.label("hdr_type"),
        "audio_artist": MediaFile.audio_artist.label("audio_artist"),
        "audio_album": MediaFile.audio_album.label("audio_album"),
        "audio_genre": MediaFile.audio_genre.label("audio_genre"),
        "audio_year": MediaFile.audio_date.label("audio_date"),
        "track_number": MediaFile.track_number.label("track_number"),
        "bit_rate_mode": MediaFile.bit_rate_mode.label("bit_rate_mode"),
        "embedded_cover": MediaFile.has_embedded_cover.label("embedded_cover"),
        "chapter_count": cast(MediaFile.chapter_count, Float).label("chapter_count"),
        "audiobook_narrator": MediaFile.audiobook_narrator.label("audiobook_narrator"),
        "audiobook_author": MediaFile.audiobook_author.label("audiobook_author"),
        "audiobook_publisher": MediaFile.audiobook_publisher.label("audiobook_publisher"),
        "audiobook_series": MediaFile.audiobook_series.label("audiobook_series"),
        "audiobook_series_part": MediaFile.audiobook_series_part.label("audiobook_series_part"),
    }
    for field_id in requested_fields:
        column = column_by_field.get(field_id)
        if column is not None:
            selected_columns.append(column)
    if requested_fields & {"resolution", "resolution_mp"}:
        selected_columns.extend(
            [
                MediaFile.primary_video_width.label("width"),
                MediaFile.primary_video_height.label("height"),
            ]
        )

    playback = None
    if requested_fields & {"play_count", "users_played"}:
        playback = (
            select(
                JellyfinMediaMatch.media_file_id.label("media_file_id"),
                func.coalesce(func.sum(JellyfinUserItemData.play_count), 0).label("play_count"),
                func.count(
                    func.distinct(
                        case(
                            (
                                JellyfinUserItemData.played.is_(True),
                                JellyfinUserItemData.jellyfin_user_id,
                            ),
                            else_=None,
                        )
                    )
                ).label("users_played"),
            )
            .select_from(JellyfinMediaMatch)
            .join(
                JellyfinUserItemData,
                JellyfinUserItemData.jellyfin_item_id == JellyfinMediaMatch.jellyfin_item_id,
            )
            .join(
                JellyfinUser,
                JellyfinUser.jellyfin_user_id == JellyfinUserItemData.jellyfin_user_id,
            )
            .where(
                JellyfinMediaMatch.status == "matched",
                JellyfinUser.enabled_for_sync.is_(True),
            )
            .group_by(JellyfinMediaMatch.media_file_id)
            .subquery("comparison_playback_aggregate")
        )
        if "play_count" in requested_fields:
            selected_columns.append(cast(func.coalesce(playback.c.play_count, 0), Float).label("play_count"))
        if "users_played" in requested_fields:
            selected_columns.append(cast(func.coalesce(playback.c.users_played, 0), Float).label("users_played"))

    query = (
        select(*selected_columns)
        .select_from(MediaFile)
        .order_by(MediaFile.id.asc())
    )
    if playback is not None:
        query = query.outerjoin(playback, playback.c.media_file_id == MediaFile.id)
    if library_id is not None:
        query = query.where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
    else:
        query = query.join(Library, Library.id == MediaFile.library_id).where(
            Library.show_on_dashboard.is_(True),
            MediaFile.is_transcode_variant.is_(False),
        )

    rows = []
    for result in db.execute(query).all():
        values = dict(result._mapping)
        media_file_id = values["media_file_id"]
        values["asset_name"] = values.get("asset_name") or str(media_file_id)
        if "audio_date" in values:
            values["audio_year"] = (values.pop("audio_date") or "")[:4] or None
        if "embedded_cover" in values:
            values["embedded_cover"] = bool(values["embedded_cover"])
        rows.append(ComparisonSourceRow(**values))
    return rows


def _numeric_value(row: ComparisonSourceRow, field_id: ComparisonFieldId) -> float | None:
    if field_id == "size":
        return row.size if row.size is not None and row.size >= 0 else None
    if field_id == "duration":
        return row.duration if row.duration is not None and row.duration > 0 else None
    if field_id == "quality_score":
        return row.quality_score if row.quality_score is not None and row.quality_score >= 1 else None
    if field_id == "bitrate":
        return row.bitrate if row.bitrate is not None and row.bitrate > 0 else None
    if field_id == "audio_bitrate":
        return row.audio_bitrate if row.audio_bitrate is not None and row.audio_bitrate > 0 else None
    if field_id == "play_count":
        return row.play_count if row.play_count > 0 else None
    if field_id == "users_played":
        return row.users_played if row.users_played > 0 else None
    if field_id == "audio_channels":
        return row.audio_channels if row.audio_channels is not None and row.audio_channels > 0 else None
    if field_id == "sample_rate":
        return row.sample_rate if row.sample_rate is not None and row.sample_rate > 0 else None
    if field_id == "chapter_count":
        return row.chapter_count if row.chapter_count is not None else 0
    if field_id == "resolution_mp":
        if row.width is None or row.height is None or row.width <= 0 or row.height <= 0:
            return None
        return (row.width * row.height) / 1_000_000
    return None


def _category_value(row: ComparisonSourceRow, field_id: ComparisonFieldId, *, resolution_categories) -> CategoryValue:
    if field_id == "container":
        normalized = normalize_container(row.container) or "unknown"
        return CategoryValue(key=normalized, label=format_container_label(normalized) or "Unknown")
    if field_id == "video_codec":
        normalized = _normalized_text(row.video_codec, "unknown")
        return CategoryValue(key=normalized, label=normalized)
    if field_id == "resolution":
        category = classify_resolution_category(row.width, row.height, resolution_categories)
        if category is None:
            return CategoryValue(key="unknown", label="unknown")
        return CategoryValue(key=category.id, label=category.label)
    if field_id == "audio_artist":
        value = _normalized_text(row.audio_artist, "unknown")
        return CategoryValue(key=value, label=value)
    if field_id == "audio_album":
        value = _normalized_text(row.audio_album, "unknown")
        return CategoryValue(key=value, label=value)
    if field_id == "audio_genre":
        value = _normalized_text(row.audio_genre, "unknown")
        return CategoryValue(key=value, label=value)
    if field_id == "audio_year":
        value = _normalized_text(row.audio_year, "unknown")
        return CategoryValue(key=value, label=value)
    if field_id == "track_number":
        value = _normalized_text(row.track_number, "unknown")
        return CategoryValue(key=value, label=value)
    if field_id == "bit_rate_mode":
        value = _normalized_text(row.bit_rate_mode, "unknown")
        return CategoryValue(key=value, label=value)
    if field_id == "embedded_cover":
        return CategoryValue(key="yes" if row.embedded_cover else "no", label="yes" if row.embedded_cover else "no")
    if field_id == "audiobook_narrator":
        value = _normalized_text(row.audiobook_narrator, "unknown")
        return CategoryValue(key=value, label=value)
    if field_id == "audiobook_author":
        value = _normalized_text(row.audiobook_author, "unknown")
        return CategoryValue(key=value, label=value)
    if field_id == "audiobook_publisher":
        value = _normalized_text(row.audiobook_publisher, "unknown")
        return CategoryValue(key=value, label=value)
    if field_id == "audiobook_series":
        value = _normalized_text(row.audiobook_series, "unknown")
        return CategoryValue(key=value, label=value)
    if field_id == "audiobook_series_part":
        value = _normalized_text(row.audiobook_series_part, "unknown")
        return CategoryValue(key=value, label=value)
    if field_id == "audio_channels":
        value = str(int(row.audio_channels)) if row.audio_channels else "unknown"
        return CategoryValue(key=value, label=value)
    if field_id == "sample_rate":
        value = str(int(row.sample_rate)) if row.sample_rate else "unknown"
        return CategoryValue(key=value, label=f"{value} Hz" if value != "unknown" else value)
    normalized = (row.hdr_type or "").strip() or "SDR"
    return CategoryValue(key=normalized, label=normalized)


def _available_renderers(x_kind: ComparisonFieldKind, y_kind: ComparisonFieldKind) -> list[ComparisonRendererId]:
    renderers: list[ComparisonRendererId] = ["heatmap"]
    if x_kind == "numeric" and y_kind == "numeric":
        renderers.append("scatter")
    if y_kind == "numeric":
        renderers.append("bar")
    return renderers


def _sample_scatter_points(
    points: list[ComparisonScatterPoint],
    *,
    sample_limit: int,
) -> tuple[list[ComparisonScatterPoint], bool]:
    if len(points) <= sample_limit:
        return points, False
    if sample_limit <= 1:
        return [points[0]], True
    if sample_limit == 2:
        return [points[0], points[-1]], True

    step = (len(points) - 1) / (sample_limit - 1)
    indices = {
        min(len(points) - 1, round(index * step))
        for index in range(sample_limit)
    }
    return [points[index] for index in sorted(indices)], True


def _build_comparison(
    db: Session,
    *,
    x_field: ComparisonFieldId,
    y_field: ComparisonFieldId,
    library_id: int | None,
    renderer: ComparisonRendererId | None = None,
) -> ComparisonResponse:
    x_definition = COMPARISON_FIELD_DEFINITIONS[x_field]
    y_definition = COMPARISON_FIELD_DEFINITIONS[y_field]
    app_settings = get_app_settings(db)
    resolution_categories = app_settings.resolution_categories
    sample_limit = app_settings.scan_performance.comparison_scatter_point_limit
    available_renderers = _available_renderers(x_definition.kind, y_definition.kind)
    requested_renderer = renderer if renderer in available_renderers else available_renderers[0]
    include_all_renderers = renderer is None
    build_heatmap = include_all_renderers or requested_renderer == "heatmap"
    build_scatter = (include_all_renderers or requested_renderer == "scatter") and "scatter" in available_renderers
    build_bar = (include_all_renderers or requested_renderer == "bar") and "bar" in available_renderers
    rows = _comparison_source_rows(
        db,
        x_field=x_field,
        y_field=y_field,
        library_id=library_id,
    )
    total_files = len(rows)

    included_rows: list[tuple[int, str, float | CategoryValue, float | CategoryValue]] = []
    for row in rows:
        x_value = (
            _numeric_value(row, x_field)
            if x_definition.kind == "numeric"
            else _category_value(row, x_field, resolution_categories=resolution_categories)
        )
        y_value = (
            _numeric_value(row, y_field)
            if y_definition.kind == "numeric"
            else _category_value(row, y_field, resolution_categories=resolution_categories)
        )
        if x_value is None or y_value is None:
            continue
        included_rows.append((row.media_file_id, row.asset_name, x_value, y_value))

    x_category_counts: dict[str, tuple[str, int]] = {}
    y_category_counts: dict[str, tuple[str, int]] = {}
    heatmap_counts: dict[tuple[str, str], int] = {}
    bar_totals: dict[str, tuple[str, float, int]] = {}
    scatter_points: list[ComparisonScatterPoint] = []

    for _media_file_id, asset_name, x_value, y_value in included_rows:
        if x_definition.kind == "numeric":
            x_bucket = _numeric_bucket(x_field, float(x_value))
            if x_bucket is None:
                continue
            x_key = x_bucket.key
            x_label = x_bucket.label
        else:
            x_category = x_value
            x_key = x_category.key
            x_label = x_category.label
            current = x_category_counts.get(x_key)
            x_category_counts[x_key] = (x_label, (current[1] if current else 0) + 1)

        if y_definition.kind == "numeric":
            y_bucket = _numeric_bucket(y_field, float(y_value))
            if y_bucket is None:
                continue
            y_key = y_bucket.key
            y_label = y_bucket.label
        else:
            y_category = y_value
            y_key = y_category.key
            y_label = y_category.label
            current = y_category_counts.get(y_key)
            y_category_counts[y_key] = (y_label, (current[1] if current else 0) + 1)

        if build_heatmap:
            heatmap_counts[(x_key, y_key)] = heatmap_counts.get((x_key, y_key), 0) + 1

        if build_scatter:
            scatter_points.append(
                ComparisonScatterPoint(
                    media_file_id=_media_file_id,
                    asset_name=asset_name,
                    x_value=float(x_value),
                    y_value=float(y_value),
                )
            )

        if build_bar:
            total, count = 0.0, 0
            current = bar_totals.get(x_key)
            if current is not None:
                _current_label, total, count = current
            bar_totals[x_key] = (x_label, total + float(y_value), count + 1)

    x_buckets = (
        _numeric_axis_buckets(x_field)
        if x_definition.kind == "numeric"
        else [
            ComparisonBucket(key=key, label=label)
            for key, (label, _count) in sorted(
                x_category_counts.items(),
                key=lambda item: (-item[1][1], item[1][0], item[0]),
            )
        ]
    )
    y_buckets = (
        _numeric_axis_buckets(y_field)
        if y_definition.kind == "numeric"
        else [
            ComparisonBucket(key=key, label=label)
            for key, (label, _count) in sorted(
                y_category_counts.items(),
                key=lambda item: (-item[1][1], item[1][0], item[0]),
            )
        ]
    )

    sampled_scatter_points, sampled_points = (
        _sample_scatter_points(scatter_points, sample_limit=sample_limit)
        if build_scatter
        else ([], False)
    )

    return ComparisonResponse(
        x_field=x_field,
        y_field=y_field,
        x_field_kind=x_definition.kind,
        y_field_kind=y_definition.kind,
        available_renderers=available_renderers,
        total_files=total_files,
        included_files=len(included_rows),
        excluded_files=max(0, total_files - len(included_rows)),
        sampled_points=sampled_points,
        sample_limit=sample_limit,
        x_buckets=x_buckets,
        y_buckets=y_buckets,
        heatmap_cells=[
            ComparisonHeatmapCell(x_key=x_key, y_key=y_key, count=count)
            for (x_key, y_key), count in sorted(heatmap_counts.items())
        ],
        scatter_points=sampled_scatter_points if build_scatter else None,
        bar_entries=[
            ComparisonBarEntry(
                x_key=bucket.key,
                x_label=bar_totals[bucket.key][0],
                value=bar_totals[bucket.key][1] / bar_totals[bucket.key][2],
                count=bar_totals[bucket.key][2],
            )
            for bucket in x_buckets
            if bucket.key in bar_totals and bar_totals[bucket.key][2] > 0
        ] if build_bar else None,
    )


def get_dashboard_comparison(
    db: Session,
    *,
    x_field: ComparisonFieldId,
    y_field: ComparisonFieldId,
    renderer: ComparisonRendererId | None = None,
) -> ComparisonResponse:
    cache_key = str(id(db.get_bind()))
    cached = stats_cache.get_dashboard_comparison(cache_key, x_field, y_field, renderer)
    if cached is not None:
        return cached
    payload = _build_comparison(
        db,
        x_field=x_field,
        y_field=y_field,
        library_id=None,
        renderer=renderer,
    )
    stats_cache.set_dashboard_comparison(cache_key, x_field, y_field, payload, renderer)
    return payload


def get_library_comparison(
    db: Session,
    *,
    library_id: int,
    x_field: ComparisonFieldId,
    y_field: ComparisonFieldId,
    renderer: ComparisonRendererId | None = None,
) -> ComparisonResponse | None:
    cache_key = str(id(db.get_bind()))
    cached = stats_cache.get_library_comparison(cache_key, library_id, x_field, y_field, renderer)
    if cached is not None:
        return cached
    library = db.get(Library, library_id)
    if library is None:
        return None
    normalized_x_field, normalized_y_field = _normalize_library_comparison_fields(
        library_type=library.type,
        x_field=x_field,
        y_field=y_field,
    )
    payload = _build_comparison(
        db,
        x_field=normalized_x_field,
        y_field=normalized_y_field,
        library_id=library_id,
        renderer=renderer,
    )
    stats_cache.set_library_comparison(cache_key, library_id, x_field, y_field, payload, renderer)
    return payload
