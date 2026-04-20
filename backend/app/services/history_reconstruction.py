from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from math import isfinite
from typing import Callable

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
from backend.app.schemas.history import HistoryReconstructionPhase, HistoryReconstructionRead
from backend.app.services.app_settings import get_app_settings
from backend.app.services.container_formats import normalize_container
from backend.app.services.history_snapshots import (
    _numeric_distribution,
    _numeric_distribution_bins,
    _numeric_summary,
    build_media_file_history_snapshot,
)
from backend.app.services.languages import normalize_language_code
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.services.spatial_audio import format_spatial_audio_profile
from backend.app.utils.time import utc_now

_MIN_REASONABLE_MTIME = datetime(1990, 1, 1, tzinfo=UTC)
ProgressCallback = Callable[..., None]


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
    resolution_mp: float | None
    container: str
    scan_status: str
    video_codec: str | None
    hdr_type: str | None
    audio_codecs: set[str]
    audio_spatial_profiles: set[str]
    audio_languages: set[str]
    subtitle_languages: set[str]
    subtitle_codecs: set[str]
    subtitle_sources: set[str]
    is_ready: bool


@dataclass(slots=True)
class _LibraryAccumulator:
    resolution_counts: dict[str, int]
    numeric_values: dict[str, list[float]]
    category_counts: dict[str, dict[str, int]]
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
        self.numeric_values["size"].append(float(max(item.size_bytes, 0)))
        if item.quality_score >= 1:
            self.numeric_values["quality_score"].append(float(item.quality_score))
        self.category_counts["container"][item.container] = self.category_counts["container"].get(item.container, 0) + 1
        self.category_counts["scan_status"][item.scan_status] = self.category_counts["scan_status"].get(item.scan_status, 0) + 1
        if item.is_ready:
            self.ready_files += 1
            if item.resolution_category_id:
                self.resolution_counts[item.resolution_category_id] = (
                    self.resolution_counts.get(item.resolution_category_id, 0) + 1
                )
                self.category_counts["resolution"][item.resolution_category_id] = (
                    self.category_counts["resolution"].get(item.resolution_category_id, 0) + 1
                )
            if item.video_codec:
                self.category_counts["video_codec"][item.video_codec] = (
                    self.category_counts["video_codec"].get(item.video_codec, 0) + 1
                )
            self.category_counts["hdr_type"][item.hdr_type or "SDR"] = (
                self.category_counts["hdr_type"].get(item.hdr_type or "SDR", 0) + 1
            )
            if item.bitrate is not None:
                self.bitrate_sum += item.bitrate
                self.bitrate_count += 1
                self.numeric_values["bitrate"].append(item.bitrate)
            if item.audio_bitrate is not None:
                self.audio_bitrate_sum += item.audio_bitrate
                self.audio_bitrate_count += 1
                self.numeric_values["audio_bitrate"].append(item.audio_bitrate)
            if item.duration_seconds > 0:
                self.duration_sum += item.duration_seconds
                self.duration_count += 1
                self.numeric_values["duration"].append(item.duration_seconds)
            if item.resolution_mp is not None:
                self.numeric_values["resolution_mp"].append(item.resolution_mp)
            self.quality_score_sum += float(item.quality_score)
            self.quality_score_count += 1
            for metric_id, values in (
                ("audio_codecs", item.audio_codecs),
                ("audio_spatial_profiles", item.audio_spatial_profiles),
                ("audio_languages", item.audio_languages),
                ("subtitle_languages", item.subtitle_languages),
                ("subtitle_codecs", item.subtitle_codecs),
                ("subtitle_sources", item.subtitle_sources),
            ):
                for value in values:
                    self.category_counts[metric_id][value] = self.category_counts[metric_id].get(value, 0) + 1
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
    resolution_mp = (
        (float(primary_video.width) * float(primary_video.height)) / 1_000_000
        if primary_video and primary_video.width and primary_video.height
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
        resolution_mp=resolution_mp,
        container=normalize_container(media_file.extension) or "unknown",
        scan_status=media_file.scan_status.value,
        video_codec=(primary_video.codec or "").strip().lower() if primary_video and primary_video.codec else None,
        hdr_type=(primary_video.hdr_type or "").strip() if primary_video and primary_video.hdr_type else "SDR",
        audio_codecs={(stream.codec or "").strip().lower() or "unknown" for stream in media_file.audio_streams},
        audio_spatial_profiles={
            label
            for label in (format_spatial_audio_profile(stream.spatial_audio_profile) for stream in media_file.audio_streams)
            if label
        },
        audio_languages={normalize_language_code(stream.language) or "und" for stream in media_file.audio_streams},
        subtitle_languages=(
            {normalize_language_code(stream.language) or "und" for stream in media_file.subtitle_streams}
            | {normalize_language_code(subtitle.language) or "und" for subtitle in media_file.external_subtitles}
        ),
        subtitle_codecs=(
            {(stream.codec or "").strip().lower() or "unknown" for stream in media_file.subtitle_streams}
            | {(subtitle.format or "").strip().lower() or "unknown" for subtitle in media_file.external_subtitles}
        ),
        subtitle_sources=(
            ({"internal"} if media_file.subtitle_streams else set())
            | ({"external"} if media_file.external_subtitles else set())
        ),
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
    numeric_summaries = {
        metric_id: _numeric_summary(values)
        for metric_id, values in accumulator.numeric_values.items()
    }
    distribution_bins = _numeric_distribution_bins()
    numeric_distributions = {
        metric_id: _numeric_distribution(values, distribution_bins[metric_id])
        for metric_id, values in accumulator.numeric_values.items()
    }
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
            "schema_version": 2,
            "total_files": accumulator.ready_files,
            "resolution_counts": dict(accumulator.resolution_counts),
            "average_bitrate": _average(accumulator.bitrate_sum, accumulator.bitrate_count),
            "average_audio_bitrate": _average(accumulator.audio_bitrate_sum, accumulator.audio_bitrate_count),
            "average_duration_seconds": _average(accumulator.duration_sum, accumulator.duration_count),
            "average_quality_score": _average(accumulator.quality_score_sum, accumulator.quality_score_count),
            "totals": {
                "file_count": accumulator.file_count,
                "ready_files": accumulator.ready_files,
                "pending_files": accumulator.pending_files,
                "total_size_bytes": accumulator.total_size_bytes,
                "total_duration_seconds": accumulator.total_duration_seconds,
            },
            "numeric_summaries": numeric_summaries,
            "category_counts": {
                metric_id: dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))
                for metric_id, counts in accumulator.category_counts.items()
            },
            "numeric_distributions": numeric_distributions,
        },
    }


def _progress_percent(libraries_total: int, libraries_processed: int, library_phase_progress: float = 0.0) -> float:
    if libraries_total <= 0:
        return 0.0
    completed = min(float(libraries_processed) + max(0.0, min(library_phase_progress, 1.0)), float(libraries_total))
    return round((completed / float(libraries_total)) * 100.0, 1)


def _emit_progress(progress_callback: ProgressCallback | None, **payload) -> None:
    if progress_callback is None:
        return
    progress_callback(**payload)


def _progress_update_step(total: int) -> int:
    if total <= 0:
        return 1
    return max(1, total // 100)


def reconstruct_history_from_media_files(
    db: Session,
    *,
    progress_callback: ProgressCallback | None = None,
) -> HistoryReconstructionRead:
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
    libraries_total = len(libraries)

    _emit_progress(
        progress_callback,
        phase=HistoryReconstructionPhase.loading_libraries,
        progress_percent=0.0,
        libraries_total=libraries_total,
        libraries_processed=0,
        libraries_with_media=0,
        current_library_name=None,
        phase_total=libraries_total,
        phase_completed=0,
        created_file_history_entries=0,
        created_library_history_entries=0,
    )

    for library_index, library in enumerate(libraries):
        _emit_progress(
            progress_callback,
            phase=HistoryReconstructionPhase.loading_library,
            progress_percent=_progress_percent(libraries_total, library_index, 0.0),
            libraries_total=libraries_total,
            libraries_processed=library_index,
            libraries_with_media=libraries_with_media,
            current_library_name=library.name,
            phase_total=0,
            phase_completed=0,
            created_file_history_entries=created_file_history_entries,
            created_library_history_entries=created_library_history_entries,
        )
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
            _emit_progress(
                progress_callback,
                phase=HistoryReconstructionPhase.loading_libraries,
                progress_percent=_progress_percent(libraries_total, library_index + 1, 0.0),
                libraries_total=libraries_total,
                libraries_processed=library_index + 1,
                libraries_with_media=libraries_with_media,
                current_library_name=None,
                phase_total=libraries_total,
                phase_completed=library_index + 1,
                created_file_history_entries=created_file_history_entries,
                created_library_history_entries=created_library_history_entries,
            )
            continue

        libraries_with_media += 1
        prepared_files: list[_PreparedMediaFile] = []
        prepared_step = _progress_update_step(len(media_files))
        for prepared_index, media_file in enumerate(media_files, start=1):
            prepared_files.append(_build_prepared_media_file(media_file, resolution_categories, now))
            if prepared_index % prepared_step == 0 or prepared_index == len(media_files):
                _emit_progress(
                    progress_callback,
                    phase=HistoryReconstructionPhase.reconstructing_file_history,
                    progress_percent=_progress_percent(
                        libraries_total,
                        library_index,
                        0.5 * (prepared_index / len(media_files)),
                    ),
                    libraries_total=libraries_total,
                    libraries_processed=library_index,
                    libraries_with_media=libraries_with_media,
                    current_library_name=library.name,
                    phase_total=len(media_files),
                    phase_completed=prepared_index,
                    created_file_history_entries=created_file_history_entries,
                    created_library_history_entries=created_library_history_entries,
                )

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
        file_history_emit_step = _progress_update_step(len(prepared_files))
        for prepared_index, prepared in enumerate(prepared_files, start=1):
            earliest_existing_capture = earliest_file_history_by_path.get(prepared.media_file.relative_path)
            if earliest_existing_capture is not None and earliest_existing_capture <= prepared.inferred_added_at:
                pass
            elif file_history_cutoff is not None and prepared.inferred_added_at < file_history_cutoff:
                pass
            else:
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

            if prepared_index % file_history_emit_step == 0 or prepared_index == len(prepared_files):
                _emit_progress(
                    progress_callback,
                    phase=HistoryReconstructionPhase.reconstructing_file_history,
                    progress_percent=_progress_percent(
                        libraries_total,
                        library_index,
                        0.5 * (prepared_index / len(prepared_files)),
                    ),
                    libraries_total=libraries_total,
                    libraries_processed=library_index,
                    libraries_with_media=libraries_with_media,
                    current_library_name=library.name,
                    phase_total=len(prepared_files),
                    phase_completed=prepared_index,
                    created_file_history_entries=created_file_history_entries,
                    created_library_history_entries=created_library_history_entries,
                )

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
            _emit_progress(
                progress_callback,
                phase=HistoryReconstructionPhase.loading_libraries,
                progress_percent=_progress_percent(libraries_total, library_index + 1, 0.0),
                libraries_total=libraries_total,
                libraries_processed=library_index + 1,
                libraries_with_media=libraries_with_media,
                current_library_name=None,
                phase_total=libraries_total,
                phase_completed=library_index + 1,
                created_file_history_entries=created_file_history_entries,
                created_library_history_entries=created_library_history_entries,
            )
            continue
        total_snapshot_days = (stop_day - start_day).days + 1

        events_by_day: dict[date, list[_PreparedMediaFile]] = defaultdict(list)
        accumulator = _LibraryAccumulator(
            resolution_counts={category.id: 0 for category in resolution_categories},
            numeric_values={
                "quality_score": [],
                "duration": [],
                "size": [],
                "bitrate": [],
                "audio_bitrate": [],
                "resolution_mp": [],
            },
            category_counts={
                "container": {},
                "video_codec": {},
                "resolution": {category.id: 0 for category in resolution_categories},
                "hdr_type": {},
                "audio_codecs": {},
                "audio_spatial_profiles": {},
                "audio_languages": {},
                "subtitle_languages": {},
                "subtitle_codecs": {},
                "subtitle_sources": {},
                "scan_status": {},
            },
        )
        for prepared in prepared_files:
            if prepared.inferred_snapshot_day < start_day:
                accumulator.add(prepared)
                continue
            if prepared.inferred_snapshot_day > stop_day:
                continue
            events_by_day[prepared.inferred_snapshot_day].append(prepared)

        current_day = start_day
        snapshot_step = _progress_update_step(total_snapshot_days)
        completed_snapshot_days = 0
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
            completed_snapshot_days += 1
            if completed_snapshot_days % snapshot_step == 0 or completed_snapshot_days == total_snapshot_days:
                _emit_progress(
                    progress_callback,
                    phase=HistoryReconstructionPhase.reconstructing_library_history,
                    progress_percent=_progress_percent(
                        libraries_total,
                        library_index,
                        0.5 + (0.5 * (completed_snapshot_days / total_snapshot_days)),
                    ),
                    libraries_total=libraries_total,
                    libraries_processed=library_index,
                    libraries_with_media=libraries_with_media,
                    current_library_name=library.name,
                    phase_total=total_snapshot_days,
                    phase_completed=completed_snapshot_days,
                    created_file_history_entries=created_file_history_entries,
                    created_library_history_entries=created_library_history_entries,
                )
            current_day += timedelta(days=1)

        _emit_progress(
            progress_callback,
            phase=HistoryReconstructionPhase.loading_libraries,
            progress_percent=_progress_percent(libraries_total, library_index + 1, 0.0),
            libraries_total=libraries_total,
            libraries_processed=library_index + 1,
            libraries_with_media=libraries_with_media,
            current_library_name=None,
            phase_total=libraries_total,
            phase_completed=library_index + 1,
            created_file_history_entries=created_file_history_entries,
            created_library_history_entries=created_library_history_entries,
        )

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
