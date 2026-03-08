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
from backend.app.schemas.media import DashboardResponse, DistributionItem
from backend.app.services.languages import merge_language_counts
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


def build_dashboard(db: Session) -> DashboardResponse:
    primary_video_streams = primary_video_streams_subquery()
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

    internal_subtitles = db.scalar(select(func.count(SubtitleStream.id))) or 0
    external_subtitles = db.scalar(select(func.count(ExternalSubtitle.id))) or 0

    return DashboardResponse(
        totals=totals,
        video_codec_distribution=_distribution(video_codec_rows),
        resolution_distribution=[
            DistributionItem(label=_resolution_label(width, height), value=count)
            for width, height, count in resolution_rows
        ],
        hdr_distribution=_distribution(hdr_rows, fallback="SDR"),
        audio_codec_distribution=_distribution(audio_codec_rows),
        audio_language_distribution=[
            DistributionItem(label=label, value=value)
            for label, value in merge_language_counts(audio_language_rows, fallback="und")
        ],
        subtitle_distribution=[
            DistributionItem(label="internal", value=internal_subtitles),
            DistributionItem(label="external", value=external_subtitles),
        ],
    )
