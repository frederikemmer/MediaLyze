from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from sqlalchemy import Float, cast, func, select
from sqlalchemy.orm import Session

from backend.app.models.entities import Library, MediaFile, MediaFormat
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
from backend.app.services.numeric_distributions import (
    NUMERIC_DISTRIBUTION_CONFIGS,
    audio_bitrate_value_expression,
    bitrate_value_expression,
    build_audio_bitrate_subquery,
)
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.services.stats_cache import stats_cache
from backend.app.services.video_queries import primary_video_streams_subquery

RESOLUTION_MP_BINS: Final[list[tuple[float | None, float | None]]] = [
    (0, 1),
    (1, 2),
    (2, 4),
    (4, 8),
    (8, 12),
    (12, 20),
    (20, None),
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
    size: float | None
    duration: float | None
    quality_score: float | None
    bitrate: float | None
    audio_bitrate: float | None
    container: str | None
    video_codec: str | None
    width: int | None
    height: int | None
    hdr_type: str | None


COMPARISON_FIELD_DEFINITIONS: dict[ComparisonFieldId, ComparisonFieldDefinition] = {
    "size": ComparisonFieldDefinition(field_id="size", kind="numeric"),
    "duration": ComparisonFieldDefinition(field_id="duration", kind="numeric"),
    "quality_score": ComparisonFieldDefinition(field_id="quality_score", kind="numeric"),
    "bitrate": ComparisonFieldDefinition(field_id="bitrate", kind="numeric"),
    "audio_bitrate": ComparisonFieldDefinition(field_id="audio_bitrate", kind="numeric"),
    "resolution_mp": ComparisonFieldDefinition(field_id="resolution_mp", kind="numeric"),
    "container": ComparisonFieldDefinition(field_id="container", kind="category"),
    "video_codec": ComparisonFieldDefinition(field_id="video_codec", kind="category"),
    "resolution": ComparisonFieldDefinition(field_id="resolution", kind="category"),
    "hdr_type": ComparisonFieldDefinition(field_id="hdr_type", kind="category"),
}
NUMERIC_BUCKET_CONFIGS = {
    config.metric_id: config
    for config in NUMERIC_DISTRIBUTION_CONFIGS
}


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


def _comparison_source_rows(db: Session, *, library_id: int | None = None) -> list[ComparisonSourceRow]:
    primary_video_streams = primary_video_streams_subquery("comparison_primary_video_streams")
    audio_bitrate_totals = build_audio_bitrate_subquery("comparison_audio_bitrate_totals")
    audio_bitrate_expression = audio_bitrate_value_expression(audio_bitrate_totals)
    query = (
        select(
            MediaFile.id.label("media_file_id"),
            MediaFile.filename.label("asset_name"),
            cast(MediaFile.size_bytes, Float).label("size"),
            cast(MediaFile.quality_score, Float).label("quality_score"),
            cast(MediaFormat.duration, Float).label("duration"),
            cast(bitrate_value_expression(), Float).label("bitrate"),
            cast(audio_bitrate_expression, Float).label("audio_bitrate"),
            MediaFile.extension.label("container"),
            primary_video_streams.c.codec.label("video_codec"),
            primary_video_streams.c.width.label("width"),
            primary_video_streams.c.height.label("height"),
            primary_video_streams.c.hdr_type.label("hdr_type"),
        )
        .select_from(MediaFile)
        .outerjoin(MediaFormat, MediaFormat.media_file_id == MediaFile.id)
        .outerjoin(primary_video_streams, primary_video_streams.c.media_file_id == MediaFile.id)
        .outerjoin(audio_bitrate_totals, audio_bitrate_totals.c.media_file_id == MediaFile.id)
        .order_by(MediaFile.id.asc())
    )
    if library_id is not None:
        query = query.where(MediaFile.library_id == library_id)
    else:
        query = query.join(Library, Library.id == MediaFile.library_id).where(Library.show_on_dashboard.is_(True))

    return [
        ComparisonSourceRow(
            media_file_id=row.media_file_id,
            asset_name=row.asset_name or str(row.media_file_id),
            size=row.size,
            duration=row.duration,
            quality_score=row.quality_score,
            bitrate=row.bitrate,
            audio_bitrate=row.audio_bitrate,
            container=row.container,
            video_codec=row.video_codec,
            width=row.width,
            height=row.height,
            hdr_type=row.hdr_type,
        )
        for row in db.execute(query).all()
    ]


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
) -> ComparisonResponse:
    x_definition = COMPARISON_FIELD_DEFINITIONS[x_field]
    y_definition = COMPARISON_FIELD_DEFINITIONS[y_field]
    app_settings = get_app_settings(db)
    resolution_categories = app_settings.resolution_categories
    sample_limit = app_settings.scan_performance.comparison_scatter_point_limit
    rows = _comparison_source_rows(db, library_id=library_id)
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

        heatmap_counts[(x_key, y_key)] = heatmap_counts.get((x_key, y_key), 0) + 1

        if x_definition.kind == "numeric" and y_definition.kind == "numeric":
            scatter_points.append(
                ComparisonScatterPoint(
                    media_file_id=_media_file_id,
                    asset_name=asset_name,
                    x_value=float(x_value),
                    y_value=float(y_value),
                )
            )

        if y_definition.kind == "numeric":
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

    sampled_scatter_points, sampled_points = _sample_scatter_points(
        scatter_points,
        sample_limit=sample_limit,
    )

    return ComparisonResponse(
        x_field=x_field,
        y_field=y_field,
        x_field_kind=x_definition.kind,
        y_field_kind=y_definition.kind,
        available_renderers=_available_renderers(x_definition.kind, y_definition.kind),
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
        scatter_points=sampled_scatter_points if "scatter" in _available_renderers(x_definition.kind, y_definition.kind) else None,
        bar_entries=[
            ComparisonBarEntry(
                x_key=bucket.key,
                x_label=bar_totals[bucket.key][0],
                value=bar_totals[bucket.key][1] / bar_totals[bucket.key][2],
                count=bar_totals[bucket.key][2],
            )
            for bucket in x_buckets
            if bucket.key in bar_totals and bar_totals[bucket.key][2] > 0
        ] if "bar" in _available_renderers(x_definition.kind, y_definition.kind) else None,
    )


def get_dashboard_comparison(
    db: Session,
    *,
    x_field: ComparisonFieldId,
    y_field: ComparisonFieldId,
) -> ComparisonResponse:
    cache_key = str(id(db.get_bind()))
    cached = stats_cache.get_dashboard_comparison(cache_key, x_field, y_field)
    if cached is not None:
        return cached
    payload = _build_comparison(db, x_field=x_field, y_field=y_field, library_id=None)
    stats_cache.set_dashboard_comparison(cache_key, x_field, y_field, payload)
    return payload


def get_library_comparison(
    db: Session,
    *,
    library_id: int,
    x_field: ComparisonFieldId,
    y_field: ComparisonFieldId,
) -> ComparisonResponse | None:
    cache_key = str(id(db.get_bind()))
    cached = stats_cache.get_library_comparison(cache_key, library_id, x_field, y_field)
    if cached is not None:
        return cached
    if db.get(Library, library_id) is None:
        return None
    payload = _build_comparison(db, x_field=x_field, y_field=y_field, library_id=library_id)
    stats_cache.set_library_comparison(cache_key, library_id, x_field, y_field, payload)
    return payload
