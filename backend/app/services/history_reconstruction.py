from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from math import isfinite

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from backend.app.models.entities import (
    Library,
    LibraryHistory,
    MediaFile,
    MediaFileHistory,
    MediaFileHistoryCaptureReason,
    ScanStatus,
)
from backend.app.schemas.history import HistoryReconstructionRead
from backend.app.services.app_settings import get_app_settings
from backend.app.services.history_snapshots import build_media_file_history_snapshot
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.utils.time import utc_now

_MIN_REASONABLE_MTIME = datetime(1990, 1, 1, tzinfo=UTC)


@dataclass(slots=True)
class _PreparedMediaFile:
    media_file: MediaFile
    inferred_added_at: datetime
    inferred_snapshot_day: date
    size_bytes: int
    duration_seconds: float
    bitrate: float | None
    audio_bitrate: float | None
    quality_score: int
    resolution_category_id: str | None
    is_ready: bool


@dataclass(slots=True)
class _LibraryAccumulator:
    resolution_counts: dict[str, int]
    file_count: int = 0
    total_size_bytes: int = 0
    total_duration_seconds: float = 0.0
    ready_files: int = 0
    pending_files: int = 0
    bitrate_sum: float = 0.0
    bitrate_count: int = 0
    audio_bitrate_sum: float = 0.0
    audio_bitrate_count: int = 0
    duration_sum: float = 0.0
    duration_count: int = 0
    quality_score_sum: float = 0.0
    quality_score_count: int = 0

    def add(self, item: _PreparedMediaFile) -> None:
        self.file_count += 1
        self.total_size_bytes += max(item.size_bytes, 0)
        self.total_duration_seconds += max(item.duration_seconds, 0.0)
        if item.is_ready:
            self.ready_files += 1
            if item.resolution_category_id:
                self.resolution_counts[item.resolution_category_id] = (
                    self.resolution_counts.get(item.resolution_category_id, 0) + 1
                )
            if item.bitrate is not None:
                self.bitrate_sum += item.bitrate
                self.bitrate_count += 1
            if item.audio_bitrate is not None:
                self.audio_bitrate_sum += item.audio_bitrate
                self.audio_bitrate_count += 1
            if item.duration_seconds > 0:
                self.duration_sum += item.duration_seconds
                self.duration_count += 1
            self.quality_score_sum += float(item.quality_score)
            self.quality_score_count += 1
            return
        self.pending_files += 1


def _retention_start_day(now: datetime, days: int) -> date | None:
    if days <= 0:
        return None
    return (now - timedelta(days=days)).date() + timedelta(days=1)


def _valid_mtime_datetime(value: float) -> datetime | None:
    if not isfinite(value) or value <= 0:
        return None
    try:
        candidate = datetime.fromtimestamp(value, UTC)
    except (OverflowError, OSError, ValueError):
        return None
    if candidate < _MIN_REASONABLE_MTIME:
        return None
    return candidate


def _infer_added_at(media_file: MediaFile, now: datetime) -> datetime:
    candidates = [
        _valid_mtime_datetime(media_file.mtime),
        media_file.last_analyzed_at,
        media_file.last_seen_at,
    ]
    resolved = next((candidate for candidate in candidates if candidate is not None), None) or now
    if resolved > now:
        return now
    return resolved


def _build_prepared_media_file(media_file: MediaFile, resolution_categories, now: datetime) -> _PreparedMediaFile:
    inferred_added_at = _infer_added_at(media_file, now)
    primary_video = min(media_file.video_streams, key=lambda stream: stream.stream_index, default=None)
    media_format = media_file.media_format
    duration_seconds = float(media_format.duration or 0.0) if media_format else 0.0
    audio_bitrate = sum(max(stream.bit_rate or 0, 0) for stream in media_file.audio_streams) or None
    resolution_category = (
        classify_resolution_category(primary_video.width, primary_video.height, resolution_categories)
        if primary_video
        else None
    )
    return _PreparedMediaFile(
        media_file=media_file,
        inferred_added_at=inferred_added_at,
        inferred_snapshot_day=inferred_added_at.date(),
        size_bytes=int(media_file.size_bytes or 0),
        duration_seconds=duration_seconds,
        bitrate=float(media_format.bit_rate) if media_format and media_format.bit_rate is not None else None,
        audio_bitrate=float(audio_bitrate) if audio_bitrate is not None else None,
        quality_score=int(media_file.quality_score or 0),
        resolution_category_id=resolution_category.id if resolution_category else None,
        is_ready=media_file.scan_status == ScanStatus.ready,
    )


def _capture_time_for_day(snapshot_day: date) -> datetime:
    return datetime.combine(snapshot_day, time(hour=12, tzinfo=UTC))


def _average(sum_value: float, count: int) -> float | None:
    if count <= 0:
        return None
    return sum_value / count


def _build_reconstructed_library_snapshot(
    library: Library,
    accumulator: _LibraryAccumulator,
    *,
    new_files: int,
) -> dict:
    return {
        "file_count": accumulator.file_count,
        "total_size_bytes": accumulator.total_size_bytes,
        "total_duration_seconds": accumulator.total_duration_seconds,
        "ready_files": accumulator.ready_files,
        "pending_files": accumulator.pending_files,
        "last_scan_at": None,
        "scan_mode": library.scan_mode.value,
        "duplicate_detection_mode": library.duplicate_detection_mode.value,
        "show_on_dashboard": library.show_on_dashboard,
        "scan_delta": {
            "discovered_files": new_files,
            "new_files": new_files,
            "modified_files": 0,
            "deleted_files": 0,
        },
        "trend_metrics": {
            "total_files": accumulator.ready_files,
            "resolution_counts": dict(accumulator.resolution_counts),
            "average_bitrate": _average(accumulator.bitrate_sum, accumulator.bitrate_count),
            "average_audio_bitrate": _average(accumulator.audio_bitrate_sum, accumulator.audio_bitrate_count),
            "average_duration_seconds": _average(accumulator.duration_sum, accumulator.duration_count),
            "average_quality_score": _average(accumulator.quality_score_sum, accumulator.quality_score_count),
        },
    }


def reconstruct_history_from_media_files(db: Session) -> HistoryReconstructionRead:
    now = utc_now()
    app_settings = get_app_settings(db)
    resolution_categories = app_settings.resolution_categories
    file_history_cutoff = (
        now - timedelta(days=app_settings.history_retention.file_history.days)
        if app_settings.history_retention.file_history.days > 0
        else None
    )
    library_history_start_day = _retention_start_day(now, app_settings.history_retention.library_history.days)

    created_library_history_entries = 0
    created_file_history_entries = 0
    oldest_snapshot_day: str | None = None
    newest_snapshot_day: str | None = None

    libraries = db.scalars(select(Library).order_by(Library.id.asc())).all()
    libraries_with_media = 0

    for library in libraries:
        media_files = db.scalars(
            select(MediaFile)
            .where(MediaFile.library_id == library.id)
            .order_by(MediaFile.id.asc())
            .options(
                selectinload(MediaFile.media_format),
                selectinload(MediaFile.video_streams),
                selectinload(MediaFile.audio_streams),
                selectinload(MediaFile.subtitle_streams),
                selectinload(MediaFile.external_subtitles),
            )
        ).all()
        if not media_files:
            continue

        libraries_with_media += 1
        prepared_files = [
            _build_prepared_media_file(media_file, resolution_categories, now) for media_file in media_files
        ]

        earliest_file_history_by_path = dict(
            db.execute(
                select(
                    MediaFileHistory.relative_path,
                    func.min(MediaFileHistory.captured_at),
                )
                .where(MediaFileHistory.library_id == library.id)
                .group_by(MediaFileHistory.relative_path)
            ).all()
        )
        for prepared in prepared_files:
            earliest_existing_capture = earliest_file_history_by_path.get(prepared.media_file.relative_path)
            if earliest_existing_capture is not None and earliest_existing_capture <= prepared.inferred_added_at:
                continue
            if file_history_cutoff is not None and prepared.inferred_added_at < file_history_cutoff:
                continue

            snapshot, snapshot_hash = build_media_file_history_snapshot(prepared.media_file, resolution_categories)
            db.add(
                MediaFileHistory(
                    library_id=library.id,
                    media_file_id=prepared.media_file.id,
                    relative_path=prepared.media_file.relative_path,
                    filename=prepared.media_file.filename,
                    captured_at=prepared.inferred_added_at,
                    capture_reason=MediaFileHistoryCaptureReason.history_reconstruction,
                    snapshot_hash=snapshot_hash,
                    snapshot=snapshot,
                )
            )
            earliest_file_history_by_path[prepared.media_file.relative_path] = prepared.inferred_added_at
            created_file_history_entries += 1

        if not prepared_files:
            continue

        first_existing_snapshot_day = db.scalar(
            select(func.min(LibraryHistory.snapshot_day)).where(LibraryHistory.library_id == library.id)
        )
        stop_day = (
            date.fromisoformat(first_existing_snapshot_day) - timedelta(days=1)
            if isinstance(first_existing_snapshot_day, str) and first_existing_snapshot_day
            else now.date()
        )
        earliest_inferred_day = min(item.inferred_snapshot_day for item in prepared_files)
        start_day = max(earliest_inferred_day, library_history_start_day) if library_history_start_day else earliest_inferred_day
        if stop_day < start_day:
            continue

        events_by_day: dict[date, list[_PreparedMediaFile]] = defaultdict(list)
        accumulator = _LibraryAccumulator(
            resolution_counts={category.id: 0 for category in resolution_categories}
        )
        for prepared in prepared_files:
            if prepared.inferred_snapshot_day < start_day:
                accumulator.add(prepared)
                continue
            if prepared.inferred_snapshot_day > stop_day:
                continue
            events_by_day[prepared.inferred_snapshot_day].append(prepared)

        current_day = start_day
        while current_day <= stop_day:
            new_files = events_by_day.get(current_day, [])
            for prepared in new_files:
                accumulator.add(prepared)
            if accumulator.file_count > 0:
                db.add(
                    LibraryHistory(
                        library_id=library.id,
                        snapshot_day=current_day.isoformat(),
                        captured_at=_capture_time_for_day(current_day),
                        source_scan_job_id=None,
                        snapshot=_build_reconstructed_library_snapshot(
                            library,
                            accumulator,
                            new_files=len(new_files),
                        ),
                    )
                )
                created_library_history_entries += 1
                if oldest_snapshot_day is None or current_day.isoformat() < oldest_snapshot_day:
                    oldest_snapshot_day = current_day.isoformat()
                if newest_snapshot_day is None or current_day.isoformat() > newest_snapshot_day:
                    newest_snapshot_day = current_day.isoformat()
            current_day += timedelta(days=1)

    db.commit()
    return HistoryReconstructionRead(
        generated_at=now,
        libraries_processed=len(libraries),
        libraries_with_media=libraries_with_media,
        created_file_history_entries=created_file_history_entries,
        created_library_history_entries=created_library_history_entries,
        oldest_reconstructed_snapshot_day=oldest_snapshot_day,
        newest_reconstructed_snapshot_day=newest_snapshot_day,
    )
