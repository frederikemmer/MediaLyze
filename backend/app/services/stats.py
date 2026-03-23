from __future__ import annotations

from sqlalchemy import func, select
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
from backend.app.services.languages import merge_language_counts
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.services.stats_cache import stats_cache
from backend.app.services.video_queries import primary_video_streams_subquery


def _distribution(rows: list[tuple[str | None, int]], fallback: str = "unknown") -> list[DistributionItem]:
    return [
        DistributionItem(label=(label or fallback), value=value)
        for label, value in rows
        if value > 0
    ]


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
    audio_codec_rows = db.execute(
        select(AudioStream.codec, func.count(AudioStream.id))
        .group_by(AudioStream.codec)
        .order_by(func.count(AudioStream.id).desc())
    ).all()
    audio_language_rows = db.execute(
        select(AudioStream.language, func.count(AudioStream.id))
        .group_by(AudioStream.language)
        .order_by(func.count(AudioStream.id).desc())
    ).all()

    subtitle_language_rows = merge_language_counts(
        db.execute(select(SubtitleStream.language, func.count(SubtitleStream.id)).group_by(SubtitleStream.language)).all()
        + db.execute(select(ExternalSubtitle.language, func.count(ExternalSubtitle.id)).group_by(ExternalSubtitle.language)).all(),
        fallback="und",
    )

    payload = DashboardResponse(
        totals=totals,
        video_codec_distribution=_distribution(video_codec_rows),
        resolution_distribution=_group_resolution_distribution(
            resolution_rows,
            app_settings.resolution_categories,
        ),
        hdr_distribution=_distribution(hdr_rows, fallback="SDR"),
        audio_codec_distribution=_distribution(audio_codec_rows),
        audio_language_distribution=[
            DistributionItem(label=label, value=value)
            for label, value in merge_language_counts(audio_language_rows, fallback="und")
        ],
        subtitle_distribution=[
            DistributionItem(label=label, value=value)
            for label, value in subtitle_language_rows
        ],
    )
    stats_cache.set_dashboard(cache_key, payload)
    return payload
