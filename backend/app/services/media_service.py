from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.app.models.entities import MediaFile
from backend.app.schemas.media import MediaFileDetail, MediaFileTableRow
from backend.app.services.languages import normalize_language_code


def _row_from_model(media_file: MediaFile) -> MediaFileTableRow:
    primary_video = min(media_file.video_streams, key=lambda stream: stream.stream_index, default=None)
    duration = media_file.media_format.duration if media_file.media_format else None
    resolution = None
    if primary_video and primary_video.width and primary_video.height:
        resolution = f"{primary_video.width}x{primary_video.height}"

    return MediaFileTableRow(
        id=media_file.id,
        library_id=media_file.library_id,
        relative_path=media_file.relative_path,
        filename=media_file.filename,
        extension=media_file.extension,
        size_bytes=media_file.size_bytes,
        mtime=media_file.mtime,
        last_seen_at=media_file.last_seen_at,
        last_analyzed_at=media_file.last_analyzed_at,
        scan_status=media_file.scan_status,
        quality_score=media_file.quality_score,
        duration=duration,
        video_codec=primary_video.codec if primary_video else None,
        resolution=resolution,
        hdr_type=primary_video.hdr_type if primary_video else None,
        audio_languages=sorted({normalize_language_code(stream.language) or "und" for stream in media_file.audio_streams}),
        subtitle_languages=sorted(
            {normalize_language_code(stream.language) or "und" for stream in media_file.subtitle_streams}
            | {normalize_language_code(subtitle.language) or "und" for subtitle in media_file.external_subtitles}
        ),
    )


def list_library_files(db: Session, library_id: int) -> list[MediaFileTableRow]:
    files = db.scalars(
        select(MediaFile)
        .where(MediaFile.library_id == library_id)
        .options(
            selectinload(MediaFile.media_format),
            selectinload(MediaFile.video_streams),
            selectinload(MediaFile.audio_streams),
            selectinload(MediaFile.subtitle_streams),
            selectinload(MediaFile.external_subtitles),
        )
        .order_by(MediaFile.relative_path.asc())
    ).all()
    return [_row_from_model(media_file) for media_file in files]


def get_media_file_detail(db: Session, file_id: int) -> MediaFileDetail | None:
    media_file = db.scalar(
        select(MediaFile)
        .where(MediaFile.id == file_id)
        .options(
            selectinload(MediaFile.media_format),
            selectinload(MediaFile.video_streams),
            selectinload(MediaFile.audio_streams),
            selectinload(MediaFile.subtitle_streams),
            selectinload(MediaFile.external_subtitles),
        )
    )
    if not media_file:
        return None

    row = _row_from_model(media_file)
    return MediaFileDetail(
        **row.model_dump(),
        media_format=media_file.media_format,
        video_streams=media_file.video_streams,
        audio_streams=media_file.audio_streams,
        subtitle_streams=media_file.subtitle_streams,
        external_subtitles=media_file.external_subtitles,
        raw_ffprobe_json=media_file.raw_ffprobe_json,
    )
