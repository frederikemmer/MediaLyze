from __future__ import annotations

from collections import defaultdict
from copy import deepcopy

from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from backend.app.core.config import Settings
from backend.app.models.entities import (
    AudioStream,
    ExternalSubtitle,
    Library,
    MediaFile,
    MediaFormat,
    ScanJob,
    ScanStatus,
    SubtitleStream,
    VideoStream,
)
from backend.app.schemas.library import LibraryCreate, LibraryStatistics, LibrarySummary, LibraryUpdate
from backend.app.schemas.media import DistributionItem
from backend.app.services.app_settings import get_app_settings as load_app_settings
from backend.app.services.languages import merge_language_counts
from backend.app.services.path_access import is_watch_supported_for_library, resolve_library_path
from backend.app.services.quality import normalize_quality_profile
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.services.stats_cache import stats_cache
from backend.app.services.video_queries import primary_video_streams_subquery


DEFAULT_SCAN_CONFIG = {
    "interval_minutes": 60,
    "debounce_seconds": 15,
}


def _normalize_subtitle_codec(value: str | None) -> str:
    candidate = (value or "").strip().lower()
    return candidate or "unknown"


def _normalize_audio_codec(value: str | None) -> str:
    candidate = (value or "").strip().lower()
    return candidate or "unknown"


def _sorted_count_items(counts: dict[str, int]) -> list[tuple[str, int]]:
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))


def _resolution_label(width: int | None, height: int | None) -> str:
    if not width or not height:
        return "unknown"
    return f"{width}x{height}"


def _group_resolution_distribution(
    rows: list[tuple[int | None, int | None, int]],
    *,
    resolution_categories,
) -> list[DistributionItem]:
    counts: dict[str, int] = defaultdict(int)
    labels: dict[str, str] = {}

    for width, height, value in rows:
        category = classify_resolution_category(width, height, resolution_categories)
        label = category.label if category else "unknown"
        filter_value = category.id if category else None
        key = filter_value or label
        counts[key] += value
        labels[key] = label

    return [
        DistributionItem(label=labels[key], value=value, filter_value=key if key in labels and key != labels[key] else None)
        for key, value in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def _library_summary_from_model(library: Library, aggregate: dict[str, int | float] | None = None) -> LibrarySummary:
    summary = LibrarySummary.model_validate(library)
    for key, value in (aggregate or {}).items():
        setattr(summary, key, value)
    return summary


def _distribution_items(rows: list[tuple[str | None, int]], *, fallback: str = "unknown") -> list[DistributionItem]:
    return [
        DistributionItem(label=(label or fallback), value=value)
        for label, value in rows
        if value > 0
    ]


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


def _normalize_library_scan_settings(
    settings: Settings,
    path_value: str,
    scan_mode,
    scan_config: dict | None,
) -> tuple:
    if scan_mode == "watch" and not is_watch_supported_for_library(settings, path_value):
        return "scheduled", normalize_scan_config("scheduled", {"interval_minutes": 60})
    return scan_mode, normalize_scan_config(scan_mode, scan_config)


def create_library(db: Session, settings: Settings, payload: LibraryCreate) -> Library:
    cache_key = str(id(db.get_bind()))
    app_settings = load_app_settings(db, settings)
    safe_path = resolve_library_path(settings, payload.path)
    scan_mode, scan_config = _normalize_library_scan_settings(
        settings,
        str(safe_path),
        payload.scan_mode,
        payload.scan_config,
    )
    library = Library(
        name=payload.name,
        path=str(safe_path),
        type=payload.type,
        scan_mode=scan_mode,
        scan_config=scan_config,
        quality_profile=normalize_quality_profile(payload.quality_profile, app_settings.resolution_categories),
    )
    db.add(library)
    db.commit()
    db.refresh(library)
    stats_cache.invalidate(cache_key)
    return library


def update_library_settings(
    db: Session,
    settings: Settings,
    library_id: int,
    payload: LibraryUpdate,
) -> tuple[Library | None, bool]:
    cache_key = str(id(db.get_bind()))
    library = db.get(Library, library_id)
    if not library:
        return None, False

    quality_profile_changed = False
    app_settings = load_app_settings(db, settings)

    if payload.name is not None:
        next_name = payload.name.strip()
        if not next_name:
            raise ValueError("Library name must not be empty")
        library.name = next_name

    if payload.scan_mode is not None:
        library.scan_mode, library.scan_config = _normalize_library_scan_settings(
            settings,
            library.path,
            payload.scan_mode,
            payload.scan_config,
        )
    if payload.quality_profile is not None:
        next_quality_profile = normalize_quality_profile(payload.quality_profile, app_settings.resolution_categories)
        current_quality_profile = normalize_quality_profile(library.quality_profile, app_settings.resolution_categories)
        if next_quality_profile != current_quality_profile or library.quality_profile != current_quality_profile:
            library.quality_profile = next_quality_profile
            quality_profile_changed = True
    db.commit()
    db.refresh(library)
    stats_cache.invalidate(cache_key, library.id)
    return library, quality_profile_changed


def delete_library(db: Session, library_id: int) -> bool:
    cache_key = str(id(db.get_bind()))
    existing = db.scalar(select(Library.id).where(Library.id == library_id))
    if existing is None:
        return False

    media_file_ids = select(MediaFile.id).where(MediaFile.library_id == library_id)
    db.execute(delete(ExternalSubtitle).where(ExternalSubtitle.media_file_id.in_(media_file_ids)))
    db.execute(delete(SubtitleStream).where(SubtitleStream.media_file_id.in_(media_file_ids)))
    db.execute(delete(AudioStream).where(AudioStream.media_file_id.in_(media_file_ids)))
    db.execute(delete(VideoStream).where(VideoStream.media_file_id.in_(media_file_ids)))
    db.execute(delete(MediaFormat).where(MediaFormat.media_file_id.in_(media_file_ids)))
    db.execute(delete(MediaFile).where(MediaFile.library_id == library_id))
    db.execute(delete(ScanJob).where(ScanJob.library_id == library_id))
    db.execute(delete(Library).where(Library.id == library_id))
    db.commit()
    stats_cache.invalidate(cache_key, library_id)
    return True


def library_exists(db: Session, library_id: int) -> bool:
    return db.scalar(select(Library.id).where(Library.id == library_id)) is not None


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


def _library_aggregate(db: Session, library_id: int) -> dict[str, int | float]:
    row = db.execute(
        select(
            func.count(MediaFile.id),
            func.coalesce(func.sum(MediaFile.size_bytes), 0),
            func.coalesce(func.sum(MediaFormat.duration), 0.0),
            func.sum(case((MediaFile.scan_status == ScanStatus.ready, 1), else_=0)),
            func.sum(case((MediaFile.scan_status != ScanStatus.ready, 1), else_=0)),
        )
        .select_from(MediaFile)
        .join(MediaFormat, MediaFormat.media_file_id == MediaFile.id, isouter=True)
        .where(MediaFile.library_id == library_id)
    ).one()

    count, size_bytes, duration, ready_files, pending_files = row
    return {
        "file_count": count or 0,
        "total_size_bytes": size_bytes or 0,
        "total_duration_seconds": duration or 0.0,
        "ready_files": ready_files or 0,
        "pending_files": pending_files or 0,
    }


def list_libraries(db: Session) -> list[LibrarySummary]:
    cache_key = str(id(db.get_bind()))
    cached = stats_cache.get_libraries(cache_key)
    if cached is not None:
        return cached

    libraries = db.scalars(select(Library).order_by(Library.name.asc())).all()
    aggregates = _library_aggregate_map(db)
    result = [_library_summary_from_model(library, aggregates.get(library.id)) for library in libraries]
    stats_cache.set_libraries(cache_key, result)
    return result


def get_library_summary(db: Session, library_id: int) -> LibrarySummary | None:
    cache_key = str(id(db.get_bind()))
    cached = stats_cache.get_library_summary(cache_key, library_id)
    if cached is not None:
        return cached

    library = db.get(Library, library_id)
    if not library:
        return None

    payload = _library_summary_from_model(library, _library_aggregate(db, library_id))
    stats_cache.set_library_summary(cache_key, library_id, payload)
    return payload


def get_library_statistics(db: Session, library_id: int) -> LibraryStatistics | None:
    cache_key = str(id(db.get_bind()))
    cached = stats_cache.get_library_statistics(cache_key, library_id)
    if cached is not None:
        return cached

    if not library_exists(db, library_id):
        return None

    app_settings = load_app_settings(db)
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
    audio_codec_distribution = db.execute(
        select(AudioStream.codec, func.count(AudioStream.id))
        .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
        .where(MediaFile.library_id == library_id)
        .group_by(AudioStream.codec)
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
    for language, count in merge_language_counts(
        db.execute(
            select(ExternalSubtitle.language, func.count(ExternalSubtitle.id))
            .join(MediaFile, MediaFile.id == ExternalSubtitle.media_file_id)
            .where(MediaFile.library_id == library_id)
            .group_by(ExternalSubtitle.language)
        ).all(),
        fallback="und",
    ):
        subtitle_counts[language] += count

    subtitle_codec_counts: dict[str, int] = defaultdict(int)
    for codec, count in db.execute(
        select(SubtitleStream.codec, func.count(SubtitleStream.id))
        .join(MediaFile, MediaFile.id == SubtitleStream.media_file_id)
        .where(MediaFile.library_id == library_id)
        .group_by(SubtitleStream.codec)
        .order_by(func.count(SubtitleStream.id).desc())
    ).all():
        subtitle_codec_counts[_normalize_subtitle_codec(codec)] += count
    for codec, count in db.execute(
        select(ExternalSubtitle.format, func.count(ExternalSubtitle.id))
        .join(MediaFile, MediaFile.id == ExternalSubtitle.media_file_id)
        .where(MediaFile.library_id == library_id)
        .group_by(ExternalSubtitle.format)
        .order_by(func.count(ExternalSubtitle.id).desc())
    ).all():
        subtitle_codec_counts[_normalize_subtitle_codec(codec)] += count

    subtitle_source_distribution = [
        DistributionItem(
            label="internal",
            value=db.scalar(
                select(func.count(SubtitleStream.id))
                .join(MediaFile, MediaFile.id == SubtitleStream.media_file_id)
                .where(MediaFile.library_id == library_id)
            )
            or 0,
        ),
        DistributionItem(
            label="external",
            value=db.scalar(
                select(func.count(ExternalSubtitle.id))
                .join(MediaFile, MediaFile.id == ExternalSubtitle.media_file_id)
                .where(MediaFile.library_id == library_id)
            )
            or 0,
        ),
    ]

    payload = LibraryStatistics(
        video_codec_distribution=_distribution_items(video_codec_distribution),
        resolution_distribution=_group_resolution_distribution(
            resolution_distribution,
            resolution_categories=app_settings.resolution_categories,
        ),
        hdr_distribution=_distribution_items(hdr_distribution, fallback="SDR"),
        audio_codec_distribution=[
            DistributionItem(label=_normalize_audio_codec(key), value=value)
            for key, value in audio_codec_distribution
        ],
        audio_language_distribution=[
            DistributionItem(label=key, value=value)
            for key, value in merge_language_counts(audio_language_distribution, fallback="und")
        ],
        subtitle_language_distribution=[
            DistributionItem(label=key, value=value)
            for key, value in _sorted_count_items(subtitle_counts)
        ],
        subtitle_codec_distribution=[
            DistributionItem(label=key, value=value)
            for key, value in _sorted_count_items(subtitle_codec_counts)
        ],
        subtitle_source_distribution=[
            item for item in subtitle_source_distribution if item.value > 0
        ],
    )
    stats_cache.set_library_statistics(cache_key, library_id, payload)
    return payload
