from __future__ import annotations

from sqlalchemy import distinct, func, literal, select, union_all
from sqlalchemy.orm import Session

from backend.app.models.entities import (
    AudioStream,
    ExternalSubtitle,
    Library,
    MediaFile,
    MediaFormat,
    SubtitleStream,
    VideoStream,
)
from backend.app.services.app_settings import get_app_settings
from backend.app.schemas.media import DashboardResponse, DistributionItem
from backend.app.services.container_formats import format_container_label
from backend.app.services.languages import merge_language_counts, normalize_language_code
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.services.spatial_audio import format_spatial_audio_profile
from backend.app.services.stats_cache import stats_cache
from backend.app.services.video_queries import primary_video_streams_subquery


def _distribution(rows: list[tuple[str | None, int]], fallback: str = "unknown") -> list[DistributionItem]:
    return [
        DistributionItem(label=(label or fallback), value=value)
        for label, value in rows
        if value > 0
    ]


def _normalized_language_expr(expression):
    candidate = func.lower(func.trim(func.coalesce(expression, "")))
    return func.coalesce(func.nullif(candidate, ""), "und")


def _normalized_text_expr(expression, fallback: str):
    candidate = func.lower(func.trim(func.coalesce(expression, "")))
    return func.coalesce(func.nullif(candidate, ""), fallback)


def _count_distinct_normalized_languages(
    rows: list[tuple[int, str | None]] | tuple[tuple[int, str | None], ...],
    *,
    fallback: str = "und",
) -> list[tuple[str, int]]:
    values_by_file: dict[int, set[str]] = {}
    for media_file_id, raw_value in rows:
        values_by_file.setdefault(media_file_id, set()).add(normalize_language_code(raw_value) or fallback)

    counts: dict[str, int] = {}
    for values in values_by_file.values():
        for value in values:
            counts[value] = counts.get(value, 0) + 1
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))


def _resolution_label(width: int | None, height: int | None) -> str:
    if not width or not height:
        return "unknown"
    return f"{width}x{height}"


def _group_resolution_distribution(rows, resolution_categories) -> list[DistributionItem]:
    counts: dict[str, int] = {}
    labels: dict[str, str] = {}
    for width, height, count in rows:
        category = classify_resolution_category(width, height, resolution_categories)
        label = category.label if category else _resolution_label(width, height)
        filter_value = category.id if category else None
        key = filter_value or label
        counts[key] = counts.get(key, 0) + count
        labels[key] = label
    return [
        DistributionItem(label=labels[key], value=value, filter_value=key if key != labels[key] else None)
        for key, value in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def build_dashboard(db: Session) -> DashboardResponse:
    cache_key = str(id(db.get_bind()))
    cached = stats_cache.get_dashboard(cache_key)
    if cached is not None:
        return cached

    primary_video_streams = primary_video_streams_subquery()
    app_settings = get_app_settings(db)
    totals = {
        "libraries": db.scalar(select(func.count(Library.id))) or 0,
        "files": db.scalar(select(func.count(MediaFile.id))) or 0,
        "storage_bytes": db.scalar(select(func.coalesce(func.sum(MediaFile.size_bytes), 0))) or 0,
        "duration_seconds": db.scalar(select(func.coalesce(func.sum(MediaFormat.duration), 0.0))) or 0.0,
    }

    container_distribution = [
        DistributionItem(label=label, value=value, filter_value=raw_value)
        for raw_value, value in db.execute(
            select(
                _normalized_text_expr(MediaFile.extension, "unknown"),
                func.count(MediaFile.id),
            )
            .group_by(_normalized_text_expr(MediaFile.extension, "unknown"))
            .order_by(func.count(MediaFile.id).desc(), _normalized_text_expr(MediaFile.extension, "unknown").asc())
        ).all()
        for label in [format_container_label(raw_value)]
        if label
    ]
    video_codec_rows = db.execute(
        select(primary_video_streams.c.codec, func.count(primary_video_streams.c.id))
        .group_by(primary_video_streams.c.codec)
        .order_by(func.count(primary_video_streams.c.id).desc())
    ).all()
    resolution_rows = db.execute(
        select(
            primary_video_streams.c.width,
            primary_video_streams.c.height,
            func.count(primary_video_streams.c.id),
        )
        .group_by(primary_video_streams.c.width, primary_video_streams.c.height)
        .order_by(func.count(primary_video_streams.c.id).desc())
    ).all()
    hdr_rows = db.execute(
        select(
            func.coalesce(primary_video_streams.c.hdr_type, "SDR"),
            func.count(primary_video_streams.c.id),
        )
        .group_by(func.coalesce(primary_video_streams.c.hdr_type, "SDR"))
        .order_by(func.count(primary_video_streams.c.id).desc())
    ).all()
    audio_codec_values = (
        select(
            AudioStream.media_file_id.label("media_file_id"),
            _normalized_text_expr(AudioStream.codec, "unknown").label("value"),
        )
        .distinct()
        .subquery("dashboard_audio_codec_values")
    )
    audio_codec_rows = db.execute(
        select(
            audio_codec_values.c.value,
            func.count(distinct(audio_codec_values.c.media_file_id)),
        )
        .group_by(audio_codec_values.c.value)
        .order_by(func.count(distinct(audio_codec_values.c.media_file_id)).desc())
    ).all()
    audio_language_values = (
        select(
            AudioStream.media_file_id.label("media_file_id"),
            _normalized_language_expr(AudioStream.language).label("value"),
        )
        .distinct()
        .subquery("dashboard_audio_language_values")
    )
    audio_language_rows = _count_distinct_normalized_languages(
        db.execute(select(audio_language_values.c.media_file_id, audio_language_values.c.value)).all(),
        fallback="und",
    )
    audio_spatial_profile_values = (
        select(
            AudioStream.media_file_id.label("media_file_id"),
            _normalized_text_expr(AudioStream.spatial_audio_profile, "").label("value"),
        )
        .where(func.length(func.trim(func.coalesce(AudioStream.spatial_audio_profile, ""))) > 0)
        .distinct()
        .subquery("dashboard_audio_spatial_profile_values")
    )
    audio_spatial_profile_rows = db.execute(
        select(
            audio_spatial_profile_values.c.value,
            func.count(distinct(audio_spatial_profile_values.c.media_file_id)),
        )
        .group_by(audio_spatial_profile_values.c.value)
        .order_by(func.count(distinct(audio_spatial_profile_values.c.media_file_id)).desc())
    ).all()
    audio_spatial_profile_distribution = [
        DistributionItem(label=label, value=value)
        for raw_label, value in audio_spatial_profile_rows
        if value > 0
        for label in [format_spatial_audio_profile(raw_label)]
        if label
    ]

    subtitle_language_values = union_all(
        select(
            SubtitleStream.media_file_id.label("media_file_id"),
            _normalized_language_expr(SubtitleStream.language).label("value"),
        ),
        select(
            ExternalSubtitle.media_file_id.label("media_file_id"),
            _normalized_language_expr(ExternalSubtitle.language).label("value"),
        ),
    ).subquery("dashboard_subtitle_language_values")
    subtitle_language_rows = _count_distinct_normalized_languages(
        db.execute(select(subtitle_language_values.c.media_file_id, subtitle_language_values.c.value)).all(),
        fallback="und",
    )
    subtitle_codec_values = union_all(
        select(
            SubtitleStream.media_file_id.label("media_file_id"),
            _normalized_text_expr(SubtitleStream.codec, "unknown").label("value"),
        ),
        select(
            ExternalSubtitle.media_file_id.label("media_file_id"),
            _normalized_text_expr(ExternalSubtitle.format, "unknown").label("value"),
        ),
    ).subquery("dashboard_subtitle_codec_values")
    subtitle_codec_rows = db.execute(
        select(
            subtitle_codec_values.c.value,
            func.count(distinct(subtitle_codec_values.c.media_file_id)),
        )
        .group_by(subtitle_codec_values.c.value)
        .order_by(func.count(distinct(subtitle_codec_values.c.media_file_id)).desc())
    ).all()
    subtitle_source_values = union_all(
        select(SubtitleStream.media_file_id.label("media_file_id"), literal("internal").label("value")),
        select(ExternalSubtitle.media_file_id.label("media_file_id"), literal("external").label("value")),
    ).subquery("dashboard_subtitle_source_values")
    subtitle_source_distinct_values = (
        select(
            subtitle_source_values.c.media_file_id,
            subtitle_source_values.c.value,
        )
        .distinct()
        .subquery("dashboard_subtitle_source_distinct_values")
    )
    subtitle_source_distribution = _distribution(
        db.execute(
            select(
                subtitle_source_distinct_values.c.value,
                func.count(distinct(subtitle_source_distinct_values.c.media_file_id)),
            )
            .group_by(subtitle_source_distinct_values.c.value)
            .order_by(func.count(distinct(subtitle_source_distinct_values.c.media_file_id)).desc())
        ).all()
    )

    payload = DashboardResponse(
        totals=totals,
        container_distribution=container_distribution,
        video_codec_distribution=_distribution(video_codec_rows),
        resolution_distribution=_group_resolution_distribution(
            resolution_rows,
            app_settings.resolution_categories,
        ),
        hdr_distribution=_distribution(hdr_rows, fallback="SDR"),
        audio_codec_distribution=_distribution(audio_codec_rows),
        audio_spatial_profile_distribution=audio_spatial_profile_distribution,
        audio_language_distribution=[
            DistributionItem(label=label, value=value)
            for label, value in merge_language_counts(audio_language_rows, fallback="und")
        ],
        subtitle_distribution=[
            DistributionItem(label=label, value=value)
            for label, value in subtitle_language_rows
        ],
        subtitle_codec_distribution=_distribution(subtitle_codec_rows),
        subtitle_source_distribution=subtitle_source_distribution,
    )
    stats_cache.set_dashboard(cache_key, payload)
    return payload
