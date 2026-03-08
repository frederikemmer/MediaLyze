from __future__ import annotations

from collections import defaultdict
from copy import deepcopy

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from backend.app.core.config import Settings
from backend.app.models.entities import AudioStream, Library, MediaFile, MediaFormat, ScanStatus, SubtitleStream, VideoStream
from backend.app.schemas.library import LibraryCreate, LibraryDetail, LibrarySummary, LibraryUpdate
from backend.app.services.languages import merge_language_counts
from backend.app.utils.pathing import ensure_relative_to_root
from backend.app.services.video_queries import primary_video_streams_subquery


DEFAULT_SCAN_CONFIG = {
    "interval_minutes": 60,
    "debounce_seconds": 15,
}


def normalize_scan_config(scan_mode, scan_config: dict | None) -> dict:
    candidate = dict(scan_config or {})
    normalized = deepcopy(DEFAULT_SCAN_CONFIG)

    interval_minutes = candidate.get("interval_minutes", normalized["interval_minutes"])
    debounce_seconds = candidate.get("debounce_seconds", normalized["debounce_seconds"])

    try:
        normalized["interval_minutes"] = max(5, int(interval_minutes))
    except (TypeError, ValueError):
        normalized["interval_minutes"] = DEFAULT_SCAN_CONFIG["interval_minutes"]

    try:
        normalized["debounce_seconds"] = max(3, int(debounce_seconds))
    except (TypeError, ValueError):
        normalized["debounce_seconds"] = DEFAULT_SCAN_CONFIG["debounce_seconds"]

    if scan_mode == "manual":
        return {}
    if scan_mode == "scheduled":
        return {"interval_minutes": normalized["interval_minutes"]}
    if scan_mode == "watch":
        return {"debounce_seconds": normalized["debounce_seconds"]}
    return normalized


def create_library(db: Session, settings: Settings, payload: LibraryCreate) -> Library:
    safe_path = ensure_relative_to_root(settings.media_root / payload.path, settings.media_root)
    if not safe_path.exists() or not safe_path.is_dir():
        raise ValueError("Library path must exist as a directory under MEDIA_ROOT")
    library = Library(
        name=payload.name,
        path=str(safe_path),
        type=payload.type,
        scan_mode=payload.scan_mode,
        scan_config=normalize_scan_config(payload.scan_mode, payload.scan_config),
    )
    db.add(library)
    db.commit()
    db.refresh(library)
    return library


def update_library_settings(db: Session, library_id: int, payload: LibraryUpdate) -> Library | None:
    library = db.get(Library, library_id)
    if not library:
        return None

    library.scan_mode = payload.scan_mode
    library.scan_config = normalize_scan_config(payload.scan_mode, payload.scan_config)
    db.commit()
    db.refresh(library)
    return library


def _library_aggregate_map(db: Session) -> dict[int, dict[str, int | float]]:
    rows = db.execute(
        select(
            MediaFile.library_id,
            func.count(MediaFile.id),
            func.coalesce(func.sum(MediaFile.size_bytes), 0),
            func.coalesce(func.sum(MediaFormat.duration), 0.0),
            func.sum(case((MediaFile.scan_status == ScanStatus.ready, 1), else_=0)),
            func.sum(case((MediaFile.scan_status != ScanStatus.ready, 1), else_=0)),
        )
        .join(MediaFormat, MediaFormat.media_file_id == MediaFile.id, isouter=True)
        .group_by(MediaFile.library_id)
    ).all()

    aggregates: dict[int, dict[str, int | float]] = {}
    for library_id, count, size_bytes, duration, ready_files, pending_files in rows:
        aggregates[library_id] = {
            "file_count": count or 0,
            "total_size_bytes": size_bytes or 0,
            "total_duration_seconds": duration or 0.0,
            "ready_files": ready_files or 0,
            "pending_files": pending_files or 0,
        }
    return aggregates


def list_libraries(db: Session) -> list[LibrarySummary]:
    libraries = db.scalars(select(Library).order_by(Library.name.asc())).all()
    aggregates = _library_aggregate_map(db)
    result: list[LibrarySummary] = []
    for library in libraries:
        summary = LibrarySummary.model_validate(library)
        for key, value in aggregates.get(library.id, {}).items():
            setattr(summary, key, value)
        result.append(summary)
    return result


def get_library_detail(db: Session, library_id: int) -> LibraryDetail | None:
    library = db.get(Library, library_id)
    if not library:
        return None

    summary = LibrarySummary.model_validate(library)
    for key, value in _library_aggregate_map(db).get(library.id, {}).items():
        setattr(summary, key, value)

    primary_video_streams = primary_video_streams_subquery("library_primary_video_streams")

    video_codec_distribution = db.execute(
        select(primary_video_streams.c.codec, func.count(primary_video_streams.c.id))
        .join(MediaFile, MediaFile.id == primary_video_streams.c.media_file_id)
        .where(MediaFile.library_id == library_id)
        .group_by(primary_video_streams.c.codec)
        .order_by(func.count(primary_video_streams.c.id).desc())
    ).all()
    resolution_distribution = db.execute(
        select(
            primary_video_streams.c.width,
            primary_video_streams.c.height,
            func.count(primary_video_streams.c.id),
        )
        .join(MediaFile, MediaFile.id == primary_video_streams.c.media_file_id)
        .where(MediaFile.library_id == library_id)
        .group_by(primary_video_streams.c.width, primary_video_streams.c.height)
        .order_by(func.count(primary_video_streams.c.id).desc())
    ).all()
    hdr_distribution = db.execute(
        select(
            func.coalesce(primary_video_streams.c.hdr_type, "SDR"),
            func.count(primary_video_streams.c.id),
        )
        .join(MediaFile, MediaFile.id == primary_video_streams.c.media_file_id)
        .where(MediaFile.library_id == library_id)
        .group_by(func.coalesce(primary_video_streams.c.hdr_type, "SDR"))
        .order_by(func.count(primary_video_streams.c.id).desc())
    ).all()
    audio_language_distribution = db.execute(
        select(AudioStream.language, func.count(AudioStream.id))
        .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
        .where(MediaFile.library_id == library_id)
        .group_by(AudioStream.language)
        .order_by(func.count(AudioStream.id).desc())
    ).all()
    subtitle_counts: dict[str, int] = defaultdict(int)
    for language, count in merge_language_counts(
        db.execute(
            select(SubtitleStream.language, func.count(SubtitleStream.id))
            .join(MediaFile, MediaFile.id == SubtitleStream.media_file_id)
            .where(MediaFile.library_id == library_id)
            .group_by(SubtitleStream.language)
        ).all(),
        fallback="und",
    ):
        subtitle_counts[language] += count

    return LibraryDetail(
        **summary.model_dump(),
        video_codec_distribution=[{"label": key or "unknown", "value": value} for key, value in video_codec_distribution],
        resolution_distribution=[
            {"label": f"{width}x{height}" if width and height else "unknown", "value": value}
            for width, height, value in resolution_distribution
        ],
        hdr_distribution=[{"label": key or "SDR", "value": value} for key, value in hdr_distribution],
        audio_language_distribution=[
            {"label": key, "value": value}
            for key, value in merge_language_counts(audio_language_distribution, fallback="und")
        ],
        subtitle_language_distribution=[
            {"label": key, "value": value}
            for key, value in sorted(subtitle_counts.items(), key=lambda item: item[1], reverse=True)
        ],
    )
