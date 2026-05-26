from __future__ import annotations

from collections.abc import Iterable

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
from backend.app.services.numeric_distributions import build_numeric_distributions
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.services.spatial_audio import format_spatial_audio_profile
from backend.app.services.stats_cache import stats_cache
from backend.app.services.video_codec_buckets import build_video_codec_distribution
from backend.app.services.video_queries import primary_video_streams_subquery

_NUMERIC_PANEL_METRIC_IDS = {
    "quality_score": "quality_score",
    "duration": "duration",
    "size": "size",
    "bitrate": "bitrate",
    "audio_bitrate": "audio_bitrate",
    "chapter_counts": "chapter_count",
}
_DISTRIBUTION_FIELD_BY_PANEL = {
    "container": "container_distribution",
    "video_codec": "video_codec_distribution",
    "resolution": "resolution_distribution",
    "hdr_type": "hdr_distribution",
    "video_bit_depth": "video_bit_depth_distribution",
    "bit_depth": "bit_depth_distribution",
    "audio_codecs": "audio_codec_distribution",
    "audio_spatial_profiles": "audio_spatial_profile_distribution",
    "audio_languages": "audio_language_distribution",
    "audio_artists": "audio_artist_distribution",
    "audio_albums": "audio_album_distribution",
    "audio_genres": "audio_genre_distribution",
    "audio_years": "audio_year_distribution",
    "audio_channels": "audio_channel_distribution",
    "sample_rates": "sample_rate_distribution",
    "track_numbers": "track_number_distribution",
    "bit_rate_modes": "bit_rate_mode_distribution",
    "embedded_covers": "embedded_cover_distribution",
    "audiobook_narrators": "audiobook_narrator_distribution",
    "audiobook_authors": "audiobook_author_distribution",
    "audiobook_publishers": "audiobook_publisher_distribution",
    "audiobook_series": "audiobook_series_distribution",
    "audiobook_series_parts": "audiobook_series_part_distribution",
    "chapter_counts": "chapter_count_distribution",
    "subtitle_languages": "subtitle_distribution",
    "subtitle_codecs": "subtitle_codec_distribution",
    "subtitle_sources": "subtitle_source_distribution",
}


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


def _dashboard_panel_view(payload: DashboardResponse, requested_panels: set[str] | None) -> DashboardResponse:
    if requested_panels is None:
        return payload

    updates = {
        field_name: getattr(payload, field_name) if panel_id in requested_panels else []
        for panel_id, field_name in _DISTRIBUTION_FIELD_BY_PANEL.items()
    }
    updates["numeric_distributions"] = {
        metric_id: distribution
        for metric_id, distribution in payload.numeric_distributions.items()
        if any(
            requested_panel in requested_panels and metric_id == configured_metric_id
            for requested_panel, configured_metric_id in _NUMERIC_PANEL_METRIC_IDS.items()
        )
    }
    return payload.model_copy(update=updates)


def build_dashboard(db: Session, requested_panels: Iterable[str] | None = None) -> DashboardResponse:
    panel_filter = set(requested_panels) if requested_panels is not None else None
    cache_key = str(id(db.get_bind()))
    cached = stats_cache.get_dashboard(cache_key)
    if cached is not None:
        return _dashboard_panel_view(cached, panel_filter)

    def wants(panel_id: str) -> bool:
        del panel_id
        return True

    primary_video_streams = (
        primary_video_streams_subquery()
        if wants("video_codec") or wants("resolution") or wants("hdr_type") or wants("video_bit_depth")
        else None
    )
    app_settings = get_app_settings(db)
    dashboard_library_ids = select(Library.id).where(Library.show_on_dashboard.is_(True))
    totals = {
        "libraries": db.scalar(select(func.count(Library.id)).where(Library.show_on_dashboard.is_(True))) or 0,
        "files": db.scalar(select(func.count(MediaFile.id)).where(MediaFile.library_id.in_(dashboard_library_ids))) or 0,
        "storage_bytes": (
            db.scalar(select(func.coalesce(func.sum(MediaFile.size_bytes), 0)).where(MediaFile.library_id.in_(dashboard_library_ids)))
            or 0
        ),
        "duration_seconds": (
            db.scalar(
                select(func.coalesce(func.sum(MediaFormat.duration), 0.0))
                .select_from(MediaFile)
                .join(MediaFormat, MediaFormat.media_file_id == MediaFile.id, isouter=True)
                .where(MediaFile.library_id.in_(dashboard_library_ids))
            )
            or 0.0
        ),
    }

    container_distribution = (
        [
            DistributionItem(label=label, value=value, filter_value=raw_value)
            for raw_value, value in db.execute(
                select(
                    _normalized_text_expr(MediaFile.extension, "unknown"),
                    func.count(MediaFile.id),
                )
                .where(MediaFile.library_id.in_(dashboard_library_ids))
                .group_by(_normalized_text_expr(MediaFile.extension, "unknown"))
                .order_by(func.count(MediaFile.id).desc(), _normalized_text_expr(MediaFile.extension, "unknown").asc())
            ).all()
            for label in [format_container_label(raw_value)]
            if label
        ]
        if wants("container")
        else []
    )
    video_codec_rows = (
        db.execute(
            select(
                primary_video_streams.c.codec,
                primary_video_streams.c.bit_depth,
                func.count(primary_video_streams.c.id),
            )
            .join(MediaFile, MediaFile.id == primary_video_streams.c.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids))
            .group_by(primary_video_streams.c.codec, primary_video_streams.c.bit_depth)
            .order_by(func.count(primary_video_streams.c.id).desc())
        ).all()
        if primary_video_streams is not None and wants("video_codec")
        else []
    )
    resolution_rows = (
        db.execute(
            select(
                primary_video_streams.c.width,
                primary_video_streams.c.height,
                func.count(primary_video_streams.c.id),
            )
            .join(MediaFile, MediaFile.id == primary_video_streams.c.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids))
            .group_by(primary_video_streams.c.width, primary_video_streams.c.height)
            .order_by(func.count(primary_video_streams.c.id).desc())
        ).all()
        if primary_video_streams is not None and wants("resolution")
        else []
    )
    hdr_rows = (
        db.execute(
            select(
                func.coalesce(primary_video_streams.c.hdr_type, "SDR"),
                func.count(primary_video_streams.c.id),
            )
            .join(MediaFile, MediaFile.id == primary_video_streams.c.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids))
            .group_by(func.coalesce(primary_video_streams.c.hdr_type, "SDR"))
            .order_by(func.count(primary_video_streams.c.id).desc())
        ).all()
        if primary_video_streams is not None and wants("hdr_type")
        else []
    )
    video_bit_depth_rows = (
        db.execute(
            select(
                primary_video_streams.c.bit_depth,
                func.count(primary_video_streams.c.id),
            )
            .join(MediaFile, MediaFile.id == primary_video_streams.c.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids))
            .group_by(primary_video_streams.c.bit_depth)
            .order_by(func.count(primary_video_streams.c.id).desc())
        ).all()
        if primary_video_streams is not None and wants("video_bit_depth")
        else []
    )

    audio_codec_rows = []
    if wants("audio_codecs"):
        audio_codec_values = (
            select(
                AudioStream.media_file_id.label("media_file_id"),
                _normalized_text_expr(AudioStream.codec, "unknown").label("value"),
            )
            .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids))
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

    bit_depth_rows = []
    if wants("bit_depth"):
        audio_bit_depth_values = (
            select(
                AudioStream.media_file_id.label("media_file_id"),
                func.max(AudioStream.bit_depth).label("value"),
            )
            .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids))
            .where(AudioStream.bit_depth.is_not(None))
            .group_by(AudioStream.media_file_id)
            .subquery("dashboard_audio_bit_depth_values")
        )
        bit_depth_rows = db.execute(
            select(
                audio_bit_depth_values.c.value,
                func.count(distinct(audio_bit_depth_values.c.media_file_id)),
            )
            .group_by(audio_bit_depth_values.c.value)
            .order_by(func.count(distinct(audio_bit_depth_values.c.media_file_id)).desc())
        ).all()

    def file_distribution(column, *, enabled: bool):
        if not enabled:
            return []
        expression = _normalized_text_expr(column, "")
        return db.execute(
            select(expression.label("value"), func.count(MediaFile.id))
            .where(MediaFile.library_id.in_(dashboard_library_ids))
            .where(func.length(func.trim(func.coalesce(column, ""))) > 0)
            .group_by(expression)
            .order_by(func.count(MediaFile.id).desc())
        ).all()

    audio_artist_rows = file_distribution(MediaFile.audio_artist, enabled=wants("audio_artists"))
    audio_album_rows = file_distribution(MediaFile.audio_album, enabled=wants("audio_albums"))
    audio_genre_rows = file_distribution(MediaFile.audio_genre, enabled=wants("audio_genres"))
    audio_year_rows = file_distribution(func.substr(MediaFile.audio_date, 1, 4), enabled=wants("audio_years"))
    track_number_rows = file_distribution(MediaFile.track_number, enabled=wants("track_numbers"))
    bit_rate_mode_rows = file_distribution(MediaFile.bit_rate_mode, enabled=wants("bit_rate_modes"))
    audiobook_narrator_rows = file_distribution(MediaFile.audiobook_narrator, enabled=wants("audiobook_narrators"))
    audiobook_author_rows = file_distribution(MediaFile.audiobook_author, enabled=wants("audiobook_authors"))
    audiobook_publisher_rows = file_distribution(MediaFile.audiobook_publisher, enabled=wants("audiobook_publishers"))
    audiobook_series_rows = file_distribution(MediaFile.audiobook_series, enabled=wants("audiobook_series"))
    audiobook_series_part_rows = file_distribution(MediaFile.audiobook_series_part, enabled=wants("audiobook_series_parts"))
    chapter_count_rows = db.execute(
        select(func.coalesce(MediaFile.chapter_count, 0), func.count(MediaFile.id))
        .where(MediaFile.library_id.in_(dashboard_library_ids))
        .group_by(func.coalesce(MediaFile.chapter_count, 0))
        .order_by(func.count(MediaFile.id).desc())
    ).all() if wants("chapter_counts") else []
    audio_channel_rows = db.execute(
        select(MediaFile.audio_channels, func.count(MediaFile.id))
        .where(MediaFile.library_id.in_(dashboard_library_ids), MediaFile.audio_channels.is_not(None))
        .group_by(MediaFile.audio_channels)
        .order_by(func.count(MediaFile.id).desc())
    ).all() if wants("audio_channels") else []
    sample_rate_rows = db.execute(
        select(MediaFile.sample_rate, func.count(MediaFile.id))
        .where(MediaFile.library_id.in_(dashboard_library_ids), MediaFile.sample_rate.is_not(None))
        .group_by(MediaFile.sample_rate)
        .order_by(func.count(MediaFile.id).desc())
    ).all() if wants("sample_rates") else []
    embedded_cover_rows = db.execute(
        select(MediaFile.has_embedded_cover, func.count(MediaFile.id))
        .where(MediaFile.library_id.in_(dashboard_library_ids))
        .group_by(MediaFile.has_embedded_cover)
        .order_by(MediaFile.has_embedded_cover.desc())
    ).all() if wants("embedded_covers") else []

    audio_language_rows: list[tuple[str, int]] = []
    if wants("audio_languages"):
        audio_language_values = (
            select(
                AudioStream.media_file_id.label("media_file_id"),
                _normalized_language_expr(AudioStream.language).label("value"),
            )
            .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids))
            .distinct()
            .subquery("dashboard_audio_language_values")
        )
        audio_language_rows = _count_distinct_normalized_languages(
            db.execute(select(audio_language_values.c.media_file_id, audio_language_values.c.value)).all(),
            fallback="und",
        )

    audio_spatial_profile_distribution = []
    if wants("audio_spatial_profiles"):
        audio_spatial_profile_values = (
            select(
                AudioStream.media_file_id.label("media_file_id"),
                _normalized_text_expr(AudioStream.spatial_audio_profile, "").label("value"),
            )
            .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids))
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

    subtitle_language_rows: list[tuple[str, int]] = []
    if wants("subtitle_languages"):
        subtitle_language_values = union_all(
            select(
                SubtitleStream.media_file_id.label("media_file_id"),
                _normalized_language_expr(SubtitleStream.language).label("value"),
            )
            .join(MediaFile, MediaFile.id == SubtitleStream.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids)),
            select(
                ExternalSubtitle.media_file_id.label("media_file_id"),
                _normalized_language_expr(ExternalSubtitle.language).label("value"),
            )
            .join(MediaFile, MediaFile.id == ExternalSubtitle.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids)),
        ).subquery("dashboard_subtitle_language_values")
        subtitle_language_rows = _count_distinct_normalized_languages(
            db.execute(select(subtitle_language_values.c.media_file_id, subtitle_language_values.c.value)).all(),
            fallback="und",
        )

    subtitle_codec_rows = []
    if wants("subtitle_codecs"):
        subtitle_codec_values = union_all(
            select(
                SubtitleStream.media_file_id.label("media_file_id"),
                _normalized_text_expr(SubtitleStream.codec, "unknown").label("value"),
            )
            .join(MediaFile, MediaFile.id == SubtitleStream.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids)),
            select(
                ExternalSubtitle.media_file_id.label("media_file_id"),
                _normalized_text_expr(ExternalSubtitle.format, "unknown").label("value"),
            )
            .join(MediaFile, MediaFile.id == ExternalSubtitle.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids)),
        ).subquery("dashboard_subtitle_codec_values")
        subtitle_codec_rows = db.execute(
            select(
                subtitle_codec_values.c.value,
                func.count(distinct(subtitle_codec_values.c.media_file_id)),
            )
            .group_by(subtitle_codec_values.c.value)
            .order_by(func.count(distinct(subtitle_codec_values.c.media_file_id)).desc())
        ).all()

    subtitle_source_distribution = []
    if wants("subtitle_sources"):
        subtitle_source_values = union_all(
            select(SubtitleStream.media_file_id.label("media_file_id"), literal("internal").label("value"))
            .join(MediaFile, MediaFile.id == SubtitleStream.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids)),
            select(ExternalSubtitle.media_file_id.label("media_file_id"), literal("external").label("value"))
            .join(MediaFile, MediaFile.id == ExternalSubtitle.media_file_id)
            .where(MediaFile.library_id.in_(dashboard_library_ids)),
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

    numeric_distributions = build_numeric_distributions(
        db,
        dashboard_only=True,
        metric_ids=None,
    )

    payload = DashboardResponse(
        totals=totals,
        container_distribution=container_distribution,
        video_codec_distribution=build_video_codec_distribution(video_codec_rows),
        resolution_distribution=_group_resolution_distribution(
            resolution_rows,
            app_settings.resolution_categories,
        ),
        hdr_distribution=_distribution(hdr_rows, fallback="SDR"),
        video_bit_depth_distribution=[
            DistributionItem(
                label=f"{label}-bit" if label is not None else "unknown",
                value=value,
                filter_value=str(label) if label is not None else None,
            )
            for label, value in video_bit_depth_rows
            if value > 0
        ],
        bit_depth_distribution=[
            DistributionItem(label=f"{label}-bit", value=value, filter_value=str(label))
            for label, value in bit_depth_rows
            if label is not None and value > 0
        ],
        audio_artist_distribution=_distribution(audio_artist_rows),
        audio_album_distribution=_distribution(audio_album_rows),
        audio_genre_distribution=_distribution(audio_genre_rows),
        audio_year_distribution=_distribution(audio_year_rows),
        audio_channel_distribution=[
            DistributionItem(label=str(label), value=value, filter_value=str(label))
            for label, value in audio_channel_rows
        ],
        sample_rate_distribution=[
            DistributionItem(label=f"{label} Hz", value=value, filter_value=str(label))
            for label, value in sample_rate_rows
        ],
        track_number_distribution=_distribution(track_number_rows),
        bit_rate_mode_distribution=_distribution(bit_rate_mode_rows),
        embedded_cover_distribution=[
            DistributionItem(label="yes" if label else "no", value=value, filter_value="yes" if label else "no")
            for label, value in embedded_cover_rows
        ],
        audiobook_narrator_distribution=_distribution(audiobook_narrator_rows),
        audiobook_author_distribution=_distribution(audiobook_author_rows),
        audiobook_publisher_distribution=_distribution(audiobook_publisher_rows),
        audiobook_series_distribution=_distribution(audiobook_series_rows),
        audiobook_series_part_distribution=_distribution(audiobook_series_part_rows),
        chapter_count_distribution=[
            DistributionItem(label=str(label), value=value, filter_value=str(label))
            for label, value in chapter_count_rows
            if label is not None
        ],
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
        numeric_distributions=numeric_distributions,
    )
    stats_cache.set_dashboard(cache_key, payload)
    return _dashboard_panel_view(payload, panel_filter)
