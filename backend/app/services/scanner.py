from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import datetime
from fnmatch import fnmatchcase
from copy import deepcopy
import logging
import os
from pathlib import Path
from time import monotonic
import traceback

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, selectinload

from backend.app.core.config import Settings
from backend.app.db.session import SessionLocal
from backend.app.models.entities import (
    AudioStream,
    ExternalSubtitle,
    JobStatus,
    Library,
    MediaFile,
    MediaFormat,
    ScanJob,
    ScanStatus,
    ScanTriggerSource,
    SubtitleStream,
    VideoStream,
)
from backend.app.services.app_settings import get_app_settings, get_ignore_patterns
from backend.app.services.duplicates import get_duplicate_strategy, rebuild_duplicate_groups
from backend.app.services.ffprobe_parser import normalize_ffprobe_payload, run_ffprobe
from backend.app.services.quality import (
    build_quality_score_input,
    build_quality_score_input_from_media_file,
    calculate_quality_score,
)
from backend.app.services.stats_cache import stats_cache
from backend.app.services.subtitles import detect_external_subtitles
from backend.app.utils.glob_patterns import matches_ignore_pattern
from backend.app.utils.time import utc_now

logger = logging.getLogger(__name__)
MAX_FILE_LIST_SAMPLE_SIZE = 50
MAX_FAILED_FILE_SAMPLE_SIZE = 200
MAX_IGNORE_PATTERN_SAMPLE_SIZE = 10
PROGRESS_COMMIT_INTERVAL_SECONDS = 0.75
PHASE_WEIGHTS = {
    "discovering": 15.0,
    "analyzing": 55.0,
    "detecting_duplicates_preparing": 0.0,
    "detecting_duplicates_artifacts": 20.0,
    "detecting_duplicates_grouping": 10.0,
}
PHASE_PREFIX_PROGRESS = {
    "queued": 0.0,
    "discovering": 0.0,
    "analyzing": 15.0,
    "detecting_duplicates_preparing": 70.0,
    "detecting_duplicates_artifacts": 70.0,
    "detecting_duplicates_grouping": 90.0,
    "completed": 100.0,
    "failed": 100.0,
    "canceled": 100.0,
}


class ScanCanceled(Exception):
    pass


@dataclass
class PatternHit:
    count: int = 0
    paths: list[str] = field(default_factory=list)
    truncated_count: int = 0


@dataclass
class DiscoveryResult:
    files: list[Path]
    ignored_total: int = 0
    ignored_dir_total: int = 0
    ignored_file_total: int = 0
    ignored_pattern_hits: dict[str, PatternHit] = field(default_factory=dict)


@dataclass
class SampledPathList:
    count: int = 0
    paths: list[str] = field(default_factory=list)
    truncated_count: int = 0
    sample_limit: int = MAX_FILE_LIST_SAMPLE_SIZE

    def add(self, path: str) -> None:
        self.count += 1
        if len(self.paths) < self.sample_limit:
            self.paths.append(path)
        else:
            self.truncated_count += 1

    def as_dict(self) -> dict:
        return {
            "count": self.count,
            "paths": self.paths,
            "truncated_count": self.truncated_count,
        }


@dataclass
class FailedFileSamples:
    items: list[dict[str, str]] = field(default_factory=list)
    truncated_count: int = 0

    def add(self, path: str, reason: str, details: str | None = None) -> None:
        payload = {"path": path, "reason": reason}
        if details and details != reason:
            payload["details"] = details
        if len(self.items) < MAX_FAILED_FILE_SAMPLE_SIZE:
            self.items.append(payload)
        else:
            self.truncated_count += 1

    def as_dict(self) -> dict:
        return {
            "failed_files": self.items,
            "failed_files_truncated_count": self.truncated_count,
        }


def _library_root(library: Library) -> Path:
    return Path(library.path)


def _candidate_ignore_paths(relative_path: str, *, is_dir: bool = False) -> set[str]:
    normalized_path = relative_path.strip("/")
    if not normalized_path:
        return set()

    candidates = {normalized_path, f"/{normalized_path}"}
    if is_dir:
        candidates.update({f"{normalized_path}/", f"/{normalized_path}/"})
    return candidates


def _matching_ignore_patterns(relative_path: str, patterns: tuple[str, ...], *, is_dir: bool = False) -> list[str]:
    candidates = _candidate_ignore_paths(relative_path, is_dir=is_dir)
    if not candidates:
        return []
    return [pattern for pattern in patterns if any(fnmatchcase(candidate, pattern) for candidate in candidates)]


def _record_pattern_hits(
    relative_path: str,
    matches: list[str],
    ignored_pattern_hits: dict[str, PatternHit],
) -> None:
    for pattern in matches:
        hit = ignored_pattern_hits.setdefault(pattern, PatternHit())
        hit.count += 1
        if len(hit.paths) < MAX_IGNORE_PATTERN_SAMPLE_SIZE:
            hit.paths.append(relative_path)
        else:
            hit.truncated_count += 1


def _coerce_trigger_details(trigger_details: dict | None) -> dict:
    return dict(trigger_details or {})


def _append_coalesced_trigger(existing_details: dict, trigger_source: ScanTriggerSource, trigger_details: dict | None) -> dict:
    details = dict(existing_details or {})
    coalesced_triggers = list(details.get("coalesced_triggers") or [])
    truncated_count = int(details.get("coalesced_triggers_truncated_count") or 0)
    details["coalesced_trigger_count"] = int(details.get("coalesced_trigger_count") or 0) + 1

    entry = {"trigger_source": trigger_source.value, **_coerce_trigger_details(trigger_details)}
    if len(coalesced_triggers) < 20:
        coalesced_triggers.append(entry)
    else:
        truncated_count += 1

    details["coalesced_triggers"] = coalesced_triggers
    details["coalesced_triggers_truncated_count"] = truncated_count
    return details


def _short_error_reason(exc: Exception) -> str:
    message = str(exc).strip()
    if message:
        first_line = message.splitlines()[0].strip()
        if first_line:
            return first_line[:300]
    return exc.__class__.__name__


def _error_details(exc: Exception, *, limit: int = 4000) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    return message[:limit]


def _error_traceback(exc: Exception, *, limit: int = 16000) -> str:
    rendered = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)).strip()
    if not rendered:
        rendered = exc.__class__.__name__
    return rendered[:limit]


def _record_runtime_failure(job: ScanJob, exc: Exception) -> None:
    summary = _runtime_summary(job)
    runtime = summary["runtime"]
    runtime.update(
        {
            "fatal_error_type": exc.__class__.__name__,
            "fatal_error_message": _error_details(exc),
            "fatal_error_traceback": _error_traceback(exc),
            "fatal_error_at": utc_now().isoformat(),
        }
    )
    job.scan_summary = summary


def _iter_media_files(
    root: Path,
    allowed_extensions: tuple[str, ...],
    *,
    ignore_patterns: tuple[str, ...] = (),
    should_cancel: Callable[[], bool] | None = None,
) -> DiscoveryResult:
    suffixes = {extension.lower() for extension in allowed_extensions}
    files: list[Path] = []
    result = DiscoveryResult(files=files)

    for current_root, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        if should_cancel and should_cancel():
            raise ScanCanceled()

        current_root_path = Path(current_root)
        visible_dirnames: list[str] = []
        for dirname in dirnames:
            candidate = current_root_path / dirname
            if candidate.is_symlink():
                continue
            relative_path = candidate.relative_to(root).as_posix()
            matches = _matching_ignore_patterns(relative_path, ignore_patterns, is_dir=True)
            if matches:
                result.ignored_total += 1
                result.ignored_dir_total += 1
                _record_pattern_hits(relative_path, matches, result.ignored_pattern_hits)
                continue
            visible_dirnames.append(dirname)

        dirnames[:] = sorted(visible_dirnames, key=str.lower)

        for filename in sorted(filenames, key=str.lower):
            file_path = current_root_path / filename
            if file_path.is_symlink():
                continue
            relative_path = file_path.relative_to(root).as_posix()
            matches = _matching_ignore_patterns(relative_path, ignore_patterns)
            if matches:
                result.ignored_total += 1
                result.ignored_file_total += 1
                _record_pattern_hits(relative_path, matches, result.ignored_pattern_hits)
                continue
            if file_path.suffix.lower() in suffixes:
                files.append(file_path)
    return result


def _replace_analysis(media_file: MediaFile, normalized, external_subtitles: list[dict[str, str | None]]) -> None:
    if media_file.media_format is None:
        media_file.media_format = MediaFormat()

    media_file.media_format.container_format = normalized.media_format.container_format
    media_file.media_format.duration = normalized.media_format.duration
    media_file.media_format.bit_rate = normalized.media_format.bit_rate
    media_file.media_format.probe_score = normalized.media_format.probe_score
    media_file.video_streams = [
        VideoStream(
            stream_index=stream.stream_index,
            codec=stream.codec,
            profile=stream.profile,
            width=stream.width,
            height=stream.height,
            pix_fmt=stream.pix_fmt,
            color_space=stream.color_space,
            color_transfer=stream.color_transfer,
            color_primaries=stream.color_primaries,
            frame_rate=stream.frame_rate,
            bit_rate=stream.bit_rate,
            hdr_type=stream.hdr_type,
        )
        for stream in normalized.video_streams
    ]
    media_file.audio_streams = [
        AudioStream(
            stream_index=stream.stream_index,
            codec=stream.codec,
            channels=stream.channels,
            channel_layout=stream.channel_layout,
            sample_rate=stream.sample_rate,
            bit_rate=stream.bit_rate,
            language=stream.language,
            default_flag=stream.default_flag,
            forced_flag=stream.forced_flag,
        )
        for stream in normalized.audio_streams
    ]
    media_file.subtitle_streams = [
        SubtitleStream(
            stream_index=stream.stream_index,
            codec=stream.codec,
            language=stream.language,
            default_flag=stream.default_flag,
            forced_flag=stream.forced_flag,
            subtitle_type=stream.subtitle_type,
        )
        for stream in normalized.subtitle_streams
    ]
    media_file.external_subtitles = [
        ExternalSubtitle(path=item["path"], language=item["language"], format=item["format"])
        for item in external_subtitles
    ]


def _persist_quality_breakdown(media_file: MediaFile, breakdown) -> None:
    media_file.quality_score = breakdown.score
    media_file.quality_score_raw = breakdown.score_raw
    media_file.quality_score_breakdown = breakdown.model_dump(mode="json")


def _apply_analysis_result(
    media_file: MediaFile,
    payload: dict,
    subtitles: list[dict[str, str | None]],
    library: Library,
    resolution_categories,
) -> None:
    media_file.scan_status = ScanStatus.analyzing
    normalized = normalize_ffprobe_payload(payload)
    media_file.raw_ffprobe_json = payload
    _replace_analysis(media_file, normalized, subtitles)
    breakdown = calculate_quality_score(
        build_quality_score_input(normalized, subtitles, size_bytes=media_file.size_bytes),
        library.quality_profile,
        resolution_categories,
    )
    _persist_quality_breakdown(media_file, breakdown)
    media_file.last_analyzed_at = utc_now()
    media_file.scan_status = ScanStatus.ready


def _analyze_path(
    file_path: Path,
    library_root: Path,
    settings: Settings,
    ignore_patterns: tuple[str, ...],
) -> tuple[dict, list[dict[str, str | None]]]:
    payload = run_ffprobe(file_path, settings.ffprobe_path, settings.ffprobe_timeout_seconds)
    subtitles = [
        subtitle
        for subtitle in detect_external_subtitles(file_path, settings.subtitle_extensions)
        if not matches_ignore_pattern(
            (file_path.parent / str(subtitle["path"])).relative_to(library_root).as_posix(),
            ignore_patterns,
        )
    ]
    return payload, subtitles


def _empty_scan_summary(ignore_patterns: tuple[str, ...] = ()) -> dict:
    return {
        "ignore_patterns": list(ignore_patterns),
        "discovery": {
            "discovered_files": 0,
            "ignored_total": 0,
            "ignored_dir_total": 0,
            "ignored_file_total": 0,
            "ignored_pattern_hits": [],
        },
        "changes": {
            "queued_for_analysis": 0,
            "unchanged_files": 0,
            "reanalyzed_incomplete_files": 0,
            "new_files": {"count": 0, "paths": [], "truncated_count": 0},
            "modified_files": {"count": 0, "paths": [], "truncated_count": 0},
            "deleted_files": {"count": 0, "paths": [], "truncated_count": 0},
        },
        "analysis": {
            "queued_for_analysis": 0,
            "analyzed_successfully": 0,
            "analysis_failed": 0,
            "failed_files": [],
            "failed_files_truncated_count": 0,
        },
        "duplicates": {
            "mode": None,
            "status": None,
            "phase_started_at": None,
            "phase_finished_at": None,
            "artifacts_total": 0,
            "artifacts_completed": 0,
            "grouping_total": 0,
            "grouping_completed": 0,
            "groups_found": 0,
            "duplicate_files": 0,
            "pending_files": 0,
            "artifact_cache_hits": 0,
            "artifact_cache_misses": 0,
            "eta_seconds": None,
        },
        "runtime": {
            "phase_key": "queued",
            "phase_label": "Queued",
            "phase_detail": "Waiting to start",
            "phase_current": 0,
            "phase_total": 0,
            "phase_progress_percent": 0.0,
            "phase_started_at": None,
            "eta_seconds": None,
            "scan_mode_label": None,
            "duplicate_detection_mode": None,
            "phase_history": [],
        },
    }


def _runtime_summary(job: ScanJob) -> dict:
    summary = deepcopy(job.scan_summary or _empty_scan_summary())
    summary.setdefault("runtime", {})
    summary["runtime"].setdefault("phase_history", [])
    summary.setdefault("duplicates", {})
    return summary


def _estimate_eta_seconds(phase_started_at, current: int, total: int) -> float | None:
    if phase_started_at is None or total <= 0 or current < 5 or current >= total:
        return None
    elapsed = max(0.0, (utc_now() - phase_started_at).total_seconds())
    if elapsed < 3:
        return None
    rate = current / elapsed if elapsed > 0 else 0.0
    if rate <= 0:
        return None
    return max(0.0, (total - current) / rate)


def _set_job_phase(
    job: ScanJob,
    phase_key: str,
    label: str,
    detail: str,
    *,
    current: int = 0,
    total: int = 0,
    scan_mode_label: str | None = None,
    duplicate_detection_mode: str | None = None,
) -> None:
    summary = _runtime_summary(job)
    runtime = summary["runtime"]
    previous_phase_key = runtime.get("phase_key")
    if previous_phase_key and previous_phase_key != phase_key:
        runtime["phase_history"].append(
            {
                "phase_key": previous_phase_key,
                "phase_label": runtime.get("phase_label"),
                "phase_finished_at": utc_now().isoformat(),
            }
        )
    phase_started_at = utc_now()
    phase_progress_percent = round((current / total) * 100, 1) if total > 0 and current > 0 else 0.0
    runtime.update(
        {
            "phase_key": phase_key,
            "phase_label": label,
            "phase_detail": detail,
            "phase_current": current,
            "phase_total": total,
            "phase_progress_percent": phase_progress_percent,
            "phase_started_at": phase_started_at.isoformat(),
            "eta_seconds": _estimate_eta_seconds(phase_started_at, current, total),
            "scan_mode_label": scan_mode_label,
            "duplicate_detection_mode": duplicate_detection_mode,
        }
    )
    job.scan_summary = summary


def _update_job_phase_progress(job: ScanJob, current: int, total: int, *, detail: str | None = None) -> None:
    summary = _runtime_summary(job)
    runtime = summary["runtime"]
    phase_started_at_iso = runtime.get("phase_started_at")
    phase_started_at = None
    if phase_started_at_iso:
        try:
            phase_started_at = datetime.fromisoformat(phase_started_at_iso)
        except Exception:
            phase_started_at = utc_now()
    runtime["phase_current"] = current
    runtime["phase_total"] = total
    runtime["phase_progress_percent"] = round((current / total) * 100, 1) if total > 0 and current > 0 else 0.0
    runtime["eta_seconds"] = _estimate_eta_seconds(phase_started_at, current, total)
    if detail is not None:
        runtime["phase_detail"] = detail
    job.scan_summary = summary


def _clear_duplicate_runtime(summary: dict) -> None:
    duplicates = summary.setdefault("duplicates", {})
    duplicates.setdefault("mode", None)
    duplicates.setdefault("status", None)


def queue_scan_job(
    db: Session,
    library_id: int,
    scan_type: str = "incremental",
    *,
    trigger_source: ScanTriggerSource = ScanTriggerSource.manual,
    trigger_details: dict | None = None,
) -> tuple[ScanJob, bool]:
    existing_job = db.scalar(
        select(ScanJob)
        .where(
            ScanJob.library_id == library_id,
            ScanJob.job_type.in_(["incremental", "full"]),
            ScanJob.status.in_([JobStatus.queued, JobStatus.running]),
        )
        .order_by(ScanJob.id.desc())
    )
    if existing_job is not None:
        existing_job.trigger_details = _append_coalesced_trigger(existing_job.trigger_details, trigger_source, trigger_details)
        db.commit()
        db.refresh(existing_job)
        return existing_job, False

    job = ScanJob(
        library_id=library_id,
        status=JobStatus.queued,
        job_type=scan_type,
        trigger_source=trigger_source,
        trigger_details=_coerce_trigger_details(trigger_details),
        scan_summary=_empty_scan_summary(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job, True


def queue_quality_recompute_job(db: Session, library_id: int) -> tuple[ScanJob, bool]:
    active_jobs = db.scalars(
        select(ScanJob)
        .where(
            ScanJob.library_id == library_id,
            ScanJob.job_type == "quality_recompute",
            ScanJob.status.in_([JobStatus.queued, JobStatus.running]),
        )
        .order_by(ScanJob.id.asc())
    ).all()
    queued_job = next((job for job in active_jobs if job.status == JobStatus.queued), None)
    if queued_job is not None:
        return queued_job, False

    running_job = next((job for job in active_jobs if job.status == JobStatus.running), None)
    if running_job is not None:
        return running_job, False
    if active_jobs:
        return active_jobs[0], False

    job = ScanJob(library_id=library_id, status=JobStatus.queued, job_type="quality_recompute")
    db.add(job)
    db.commit()
    db.refresh(job)
    return job, True


def queue_duplicate_refresh_job(db: Session, library_id: int) -> tuple[ScanJob, bool]:
    active_jobs = db.scalars(
        select(ScanJob)
        .where(
            ScanJob.library_id == library_id,
            ScanJob.job_type == "duplicate_refresh",
            ScanJob.status.in_([JobStatus.queued, JobStatus.running]),
        )
        .order_by(ScanJob.id.asc())
    ).all()
    queued_job = next((job for job in active_jobs if job.status == JobStatus.queued), None)
    if queued_job is not None:
        return queued_job, False

    running_job = next((job for job in active_jobs if job.status == JobStatus.running), None)
    if running_job is not None:
        return running_job, False
    if active_jobs:
        return active_jobs[0], False

    job = ScanJob(library_id=library_id, status=JobStatus.queued, job_type="duplicate_refresh")
    db.add(job)
    db.commit()
    db.refresh(job)
    return job, True


def libraries_needing_quality_backfill(db: Session) -> list[int]:
    rows = db.scalars(
        select(MediaFile.library_id)
        .where(
            or_(
                MediaFile.quality_score_raw <= 0,
                MediaFile.quality_score_breakdown.is_(None),
            )
        )
        .group_by(MediaFile.library_id)
        .order_by(MediaFile.library_id.asc())
    ).all()
    return list(rows)


def _incomplete_analysis_file_ids(db: Session, library_id: int) -> set[int]:
    incomplete_ids = set(
        db.scalars(
            select(MediaFile.id).where(
                MediaFile.library_id == library_id,
                or_(
                    MediaFile.last_analyzed_at.is_(None),
                    MediaFile.raw_ffprobe_json.is_(None),
                    MediaFile.scan_status != ScanStatus.ready,
                ),
            )
        ).all()
    )
    incomplete_ids.update(
        db.scalars(
            select(AudioStream.media_file_id)
            .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
            .where(MediaFile.library_id == library_id, AudioStream.codec.is_(None))
        ).all()
    )
    incomplete_ids.update(
        db.scalars(
            select(SubtitleStream.media_file_id)
            .join(MediaFile, MediaFile.id == SubtitleStream.media_file_id)
            .where(
                MediaFile.library_id == library_id,
                or_(SubtitleStream.codec.is_(None), SubtitleStream.subtitle_type.is_(None)),
            )
        ).all()
    )
    incomplete_ids.update(
        db.scalars(
            select(ExternalSubtitle.media_file_id)
            .join(MediaFile, MediaFile.id == ExternalSubtitle.media_file_id)
            .where(MediaFile.library_id == library_id, ExternalSubtitle.format.is_(None))
        ).all()
    )
    return incomplete_ids


def execute_scan_job(job_id: int, settings: Settings) -> None:
    db = SessionLocal()
    try:
        _run_scan_job(db, settings, job_id)
    except ScanCanceled:
        job = db.get(ScanJob, job_id)
        if job:
            job.status = JobStatus.canceled
            job.finished_at = utc_now()
            db.commit()
    except Exception as exc:
        job = db.get(ScanJob, job_id)
        if job:
            job.status = JobStatus.failed
            job.finished_at = utc_now()
            job.errors += 1
            _record_runtime_failure(job, exc)
            db.commit()
    finally:
        db.close()


def _run_scan_job(db: Session, settings: Settings, job_id: int) -> ScanJob:
    job = db.get(ScanJob, job_id)
    if not job:
        raise ValueError(f"Scan job {job_id} not found")
    if job.status == JobStatus.canceled:
        job.finished_at = job.finished_at or utc_now()
        db.commit()
        return job

    job.status = JobStatus.running
    job.started_at = utc_now()
    job.finished_at = None
    db.commit()
    db.refresh(job)

    if job.job_type == "quality_recompute":
        return run_quality_recompute(db, job.library_id, job)
    if job.job_type == "duplicate_refresh":
        return run_duplicate_refresh(db, settings, job.library_id, job)
    return run_scan(db, settings, job.library_id, job.job_type, job)


def _duplicate_phase_detail(label: str, current: int, total: int, eta_seconds: float | None) -> str:
    detail = f"{label}: {current} of {total}"
    if eta_seconds is not None:
        detail += f", about {int(round(eta_seconds))}s left"
    return detail


def _discovery_phase_detail(current: int, total: int, queued_for_analysis: int) -> str:
    return f"Discovered {current} of {total} files, {queued_for_analysis} queued for analysis"


def _analysis_phase_detail(
    current: int,
    total: int,
    *,
    discovered_files: int,
    unchanged_files: int,
    pending_in_progress: int = 0,
) -> str:
    detail = (
        f"Analyzed {current} of {total} queued files, "
        f"{unchanged_files} unchanged of {discovered_files} discovered"
    )
    if pending_in_progress > 0:
        detail += f", {pending_in_progress} in progress"
    return detail


def _should_commit_progress(last_commit_at: float, *, processed: int, total: int, batch_size: int) -> bool:
    if processed >= total:
        return True
    if batch_size > 0 and processed > 0 and processed % batch_size == 0:
        return True
    return (monotonic() - last_commit_at) >= PROGRESS_COMMIT_INTERVAL_SECONDS


def _run_duplicate_detection(
    db: Session,
    settings: Settings,
    library: Library,
    job: ScanJob,
    *,
    changed_file_paths: dict[int, Path] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> dict[str, int]:
    strategy = get_duplicate_strategy(library.duplicate_detection_mode)
    media_files = db.scalars(
        select(MediaFile)
        .where(MediaFile.library_id == library.id, MediaFile.scan_status == ScanStatus.ready)
        .options(selectinload(MediaFile.media_format))
        .order_by(MediaFile.id.asc())
    ).all()

    _set_job_phase(
        job,
        "detecting_duplicates_preparing",
        "Detecting duplicates",
        f"Preparing {library.duplicate_detection_mode.value} duplicate detection",
        scan_mode_label=job.job_type,
        duplicate_detection_mode=library.duplicate_detection_mode.value,
    )
    summary = _runtime_summary(job)
    summary["duplicates"].update(
        {
            "mode": library.duplicate_detection_mode.value,
            "status": "preparing",
            "phase_started_at": utc_now().isoformat(),
            "phase_finished_at": None,
            "artifacts_total": len(media_files),
            "artifacts_completed": 0,
            "grouping_total": len(media_files),
            "grouping_completed": 0,
            "groups_found": 0,
            "duplicate_files": 0,
            "pending_files": 0,
            "artifact_cache_hits": 0,
            "artifact_cache_misses": 0,
            "eta_seconds": None,
        }
    )
    job.scan_summary = summary
    db.commit()

    _set_job_phase(
        job,
        "detecting_duplicates_artifacts",
        f"Detecting duplicates by {library.duplicate_detection_mode.value}",
        _duplicate_phase_detail("Preparing duplicate artifacts", 0, len(media_files), None),
        total=len(media_files),
        scan_mode_label=job.job_type,
        duplicate_detection_mode=library.duplicate_detection_mode.value,
    )
    job.scan_summary = _runtime_summary(job)
    db.commit()

    artifact_hits = 0
    artifact_misses = 0
    changed_file_paths = changed_file_paths or {}
    artifact_last_commit_at = monotonic()
    for index, media_file in enumerate(media_files, start=1):
        if should_cancel and should_cancel():
            raise ScanCanceled()
        file_path = changed_file_paths.get(media_file.id)
        if file_path is None:
            file_path = _library_root(library) / media_file.relative_path
        if not file_path.exists():
            continue
        current_detail = (
            f"Computing {library.duplicate_detection_mode.value} artifacts for "
            f"{media_file.filename} ({index} of {len(media_files)})"
        )
        _update_job_phase_progress(job, index - 1, len(media_files), detail=current_detail)
        db.commit()
        result = strategy.ensure_artifact(
            media_file,
            file_path,
        )
        if result.cache_hit:
            artifact_hits += 1
        else:
            artifact_misses += 1
        summary = _runtime_summary(job)
        summary["duplicates"]["artifacts_completed"] = index
        summary["duplicates"]["artifact_cache_hits"] = artifact_hits
        summary["duplicates"]["artifact_cache_misses"] = artifact_misses
        job.scan_summary = summary
        detail = _duplicate_phase_detail(
            f"Computing {library.duplicate_detection_mode.value} artifacts",
            index,
            len(media_files),
            _estimate_eta_seconds(datetime.fromisoformat(_runtime_summary(job)["runtime"]["phase_started_at"]), index, len(media_files)),
        )
        _update_job_phase_progress(job, index, len(media_files), detail=detail)
        if _should_commit_progress(
            artifact_last_commit_at,
            processed=index,
            total=max(1, len(media_files)),
            batch_size=10,
        ):
            db.commit()
            artifact_last_commit_at = monotonic()

    _set_job_phase(
        job,
        "detecting_duplicates_grouping",
        "Grouping duplicate candidates",
        _duplicate_phase_detail("Grouping duplicate candidates", 0, len(media_files), None),
        total=max(1, len(media_files)),
        scan_mode_label=job.job_type,
        duplicate_detection_mode=library.duplicate_detection_mode.value,
    )
    summary = _runtime_summary(job)
    summary["duplicates"]["status"] = "grouping"
    job.scan_summary = summary
    db.commit()

    group_stats = rebuild_duplicate_groups(db, library)
    _update_job_phase_progress(
        job,
        len(media_files),
        max(1, len(media_files)),
        detail=_duplicate_phase_detail("Grouping duplicate candidates", len(media_files), max(1, len(media_files)), 0.0),
    )
    summary = _runtime_summary(job)
    summary["duplicates"].update(
        {
            "status": "completed",
            "phase_finished_at": utc_now().isoformat(),
            "grouping_completed": len(media_files),
            "groups_found": group_stats["groups_found"],
            "duplicate_files": group_stats["duplicate_files"],
            "pending_files": group_stats["pending_files"],
            "eta_seconds": 0.0,
        }
    )
    job.scan_summary = summary
    db.commit()
    return group_stats


def run_scan(
    db: Session,
    settings: Settings,
    library_id: int,
    scan_type: str = "incremental",
    existing_job: ScanJob | None = None,
) -> ScanJob:
    cache_key = str(id(db.get_bind()))
    library = db.get(Library, library_id)
    if not library:
        raise ValueError(f"Library {library_id} not found")

    root = _library_root(library)
    job = existing_job or ScanJob(
        library_id=library_id,
        status=JobStatus.running,
        job_type=scan_type,
        started_at=utc_now(),
    )
    if existing_job is None:
        db.add(job)
        db.commit()
        db.refresh(job)
    if not job.scan_summary:
        job.scan_summary = _empty_scan_summary()
    _set_job_phase(job, "discovering", "Discovering files", "Scanning directories", scan_mode_label=scan_type)
    db.commit()

    def _should_cancel() -> bool:
        db.refresh(job)
        return job.status == JobStatus.canceled

    existing_by_path = {
        media_file.relative_path: media_file
        for media_file in db.scalars(select(MediaFile).where(MediaFile.library_id == library_id)).all()
    }
    incomplete_analysis_ids = _incomplete_analysis_file_ids(db, library_id)
    app_settings = get_app_settings(db, settings)
    ignore_patterns = tuple(app_settings.ignore_patterns)
    new_files = SampledPathList()
    modified_files = SampledPathList()
    deleted_files = SampledPathList()
    failed_files = FailedFileSamples()
    unchanged_files = 0
    reanalyzed_incomplete_files = 0
    analyzed_successfully = 0
    changed_file_paths: dict[int, Path] = {}

    def _build_scan_summary(discovery: DiscoveryResult, queued_for_analysis: int) -> dict:
        current_summary = _runtime_summary(job)
        return {
            "ignore_patterns": list(ignore_patterns),
            "discovery": {
                "discovered_files": len(discovery.files),
                "ignored_total": discovery.ignored_total,
                "ignored_dir_total": discovery.ignored_dir_total,
                "ignored_file_total": discovery.ignored_file_total,
                "ignored_pattern_hits": [
                    {
                        "pattern": pattern,
                        "count": hit.count,
                        "paths": hit.paths,
                        "truncated_count": hit.truncated_count,
                    }
                    for pattern, hit in sorted(discovery.ignored_pattern_hits.items(), key=lambda entry: entry[0].lower())
                ],
            },
            "changes": {
                "queued_for_analysis": queued_for_analysis,
                "unchanged_files": unchanged_files,
                "reanalyzed_incomplete_files": reanalyzed_incomplete_files,
                "new_files": new_files.as_dict(),
                "modified_files": modified_files.as_dict(),
                "deleted_files": deleted_files.as_dict(),
            },
            "analysis": {
                "queued_for_analysis": queued_for_analysis,
                "analyzed_successfully": analyzed_successfully,
                "analysis_failed": job.errors,
                **failed_files.as_dict(),
            },
            "duplicates": current_summary.get("duplicates", {}),
            "runtime": current_summary.get("runtime", {}),
        }

    discovery = _iter_media_files(
        root,
        settings.allowed_media_extensions,
        ignore_patterns=ignore_patterns,
        should_cancel=_should_cancel,
    )
    discovery_total = max(1, len(discovery.files))
    _set_job_phase(
        job,
        "discovering",
        "Discovering files",
        _discovery_phase_detail(0, discovery_total, 0),
        total=discovery_total,
        scan_mode_label=scan_type,
    )
    db.commit()
    seen_relative_paths: set[str] = set()
    to_analyze: list[tuple[MediaFile, Path]] = []
    discovery_counter = 0
    discovery_last_commit_at = monotonic()

    for file_path in discovery.files:
        relative_path = file_path.relative_to(root).as_posix()
        seen_relative_paths.add(relative_path)
        discovery_counter += 1
        stat = file_path.stat()
        media_file = existing_by_path.get(relative_path)

        _update_job_phase_progress(
            job,
            discovery_counter,
            discovery_total,
            detail=_discovery_phase_detail(discovery_counter, discovery_total, len(to_analyze)),
        )
        if _should_commit_progress(
            discovery_last_commit_at,
            processed=discovery_counter,
            total=discovery_total,
            batch_size=settings.scan_discovery_batch_size,
        ):
            job.files_total = len(seen_relative_paths)
            job.scan_summary = _build_scan_summary(discovery, len(to_analyze))
            db.commit()
            stats_cache.invalidate(cache_key, job.library_id)
            discovery_last_commit_at = monotonic()
            if _should_cancel():
                raise ScanCanceled()

        if media_file is None:
            media_file = MediaFile(
                library_id=library.id,
                relative_path=relative_path,
                filename=file_path.name,
                extension=file_path.suffix.lower().lstrip("."),
                size_bytes=stat.st_size,
                mtime=stat.st_mtime,
                last_seen_at=utc_now(),
                scan_status=ScanStatus.pending,
            )
            db.add(media_file)
            db.flush()
            new_files.add(relative_path)
            to_analyze.append((media_file, file_path))
            changed_file_paths[media_file.id] = file_path
        else:
            changed = media_file.size_bytes != stat.st_size or media_file.mtime != stat.st_mtime
            analysis_incomplete = media_file.id in incomplete_analysis_ids
            media_file.filename = file_path.name
            media_file.extension = file_path.suffix.lower().lstrip(".")
            media_file.size_bytes = stat.st_size
            media_file.mtime = stat.st_mtime
            media_file.last_seen_at = utc_now()
            if changed or scan_type == "full" or analysis_incomplete:
                if changed:
                    modified_files.add(relative_path)
                    media_file.content_hash = None
                elif analysis_incomplete:
                    reanalyzed_incomplete_files += 1
                media_file.scan_status = ScanStatus.pending
                to_analyze.append((media_file, file_path))
                changed_file_paths[media_file.id] = file_path
            else:
                unchanged_files += 1

    stale_ids = [
        media_file.id
        for relative_path, media_file in existing_by_path.items()
        if relative_path not in seen_relative_paths
    ]
    for relative_path, media_file in existing_by_path.items():
        if relative_path not in seen_relative_paths:
            deleted_files.add(relative_path)
    if stale_ids:
        db.execute(delete(MediaFile).where(MediaFile.id.in_(stale_ids)))

    job.files_total = len(discovery.files)
    job.scan_summary = _build_scan_summary(discovery, len(to_analyze))
    db.commit()
    stats_cache.invalidate(cache_key, job.library_id)
    if _should_cancel():
        raise ScanCanceled()
    _set_job_phase(
        job,
        "analyzing",
        "Analyzing media",
        _analysis_phase_detail(
            0,
            len(to_analyze),
            discovered_files=len(discovery.files),
            unchanged_files=unchanged_files,
        ),
        total=max(1, len(to_analyze)),
        scan_mode_label=scan_type,
        duplicate_detection_mode=library.duplicate_detection_mode.value,
    )
    db.commit()

    def _safe_analyze(
        pair: tuple[MediaFile, Path],
    ) -> tuple[MediaFile, str, dict | None, list[dict[str, str | None]], str | None, str | None]:
        media_file, path = pair
        relative_path = path.relative_to(root).as_posix()
        try:
            payload, subtitles = _analyze_path(path, root, settings, ignore_patterns)
            return media_file, relative_path, payload, subtitles, None, None
        except Exception as exc:
            logger.exception("Media analysis failed for %s", relative_path)
            return media_file, relative_path, None, [], _short_error_reason(exc), _error_details(exc)

    executor = ThreadPoolExecutor(max_workers=settings.ffprobe_worker_count)
    try:
        batch_counter = 0
        next_index = 0
        pending: dict[Future, tuple[MediaFile, Path]] = {}
        max_in_flight = max(1, settings.ffprobe_worker_count * 2)
        analysis_last_commit_at = monotonic()

        while next_index < len(to_analyze) and len(pending) < max_in_flight:
            pair = to_analyze[next_index]
            pending[executor.submit(_safe_analyze, pair)] = pair
            next_index += 1

        while pending:
            if _should_cancel():
                for future in pending:
                    future.cancel()
                executor.shutdown(wait=False, cancel_futures=True)
                raise ScanCanceled()

            done, _ = wait(pending.keys(), timeout=0.5, return_when=FIRST_COMPLETED)
            if not done:
                if _should_commit_progress(
                    analysis_last_commit_at,
                    processed=job.files_scanned,
                    total=max(1, len(to_analyze)),
                    batch_size=0,
                ):
                    _update_job_phase_progress(
                        job,
                        job.files_scanned,
                        max(1, len(to_analyze)),
                        detail=_analysis_phase_detail(
                            job.files_scanned,
                            len(to_analyze),
                            discovered_files=len(discovery.files),
                            unchanged_files=unchanged_files,
                            pending_in_progress=len(pending),
                        ),
                    )
                    job.scan_summary = _build_scan_summary(discovery, len(to_analyze))
                    db.commit()
                    stats_cache.invalidate(cache_key, job.library_id)
                    analysis_last_commit_at = monotonic()
                continue

            for future in done:
                pending.pop(future)
                media_file, relative_path, payload, subtitles, error, error_details = future.result()
                if error is None and payload is not None:
                    try:
                        _apply_analysis_result(
                            media_file,
                            payload,
                            subtitles,
                            library,
                            app_settings.resolution_categories,
                        )
                        analyzed_successfully += 1
                    except Exception as exc:
                        logger.exception("Media normalization failed for %s", relative_path)
                        media_file.scan_status = ScanStatus.failed
                        job.errors += 1
                        failed_files.add(relative_path, _short_error_reason(exc), _error_details(exc))
                else:
                    media_file.scan_status = ScanStatus.failed
                    job.errors += 1
                    failed_files.add(relative_path, error or "Unknown analysis failure", error_details)
                job.files_scanned += 1
                batch_counter += 1
                _update_job_phase_progress(
                    job,
                    job.files_scanned,
                    max(1, len(to_analyze)),
                    detail=_analysis_phase_detail(
                        job.files_scanned,
                        len(to_analyze),
                        discovered_files=len(discovery.files),
                        unchanged_files=unchanged_files,
                    ),
                )
                if _should_commit_progress(
                    analysis_last_commit_at,
                    processed=job.files_scanned,
                    total=max(1, len(to_analyze)),
                    batch_size=settings.scan_commit_batch_size,
                ):
                    job.scan_summary = _build_scan_summary(discovery, len(to_analyze))
                    db.commit()
                    stats_cache.invalidate(cache_key, job.library_id)
                    batch_counter = 0
                    analysis_last_commit_at = monotonic()

                if next_index < len(to_analyze):
                    pair = to_analyze[next_index]
                    pending[executor.submit(_safe_analyze, pair)] = pair
                    next_index += 1

        if batch_counter:
            job.scan_summary = _build_scan_summary(discovery, len(to_analyze))
            db.commit()
            stats_cache.invalidate(cache_key, job.library_id)
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    if _should_cancel():
        raise ScanCanceled()
    duplicate_stats = _run_duplicate_detection(
        db,
        settings,
        library,
        job,
        changed_file_paths=changed_file_paths,
        should_cancel=_should_cancel,
    )
    library.last_scan_at = utc_now()
    job.status = JobStatus.failed if job.errors else JobStatus.completed
    job.finished_at = utc_now()
    job.scan_summary = _build_scan_summary(discovery, len(to_analyze))
    summary = _runtime_summary(job)
    summary["duplicates"].update(duplicate_stats)
    runtime = summary["runtime"]
    runtime.update(
        {
            "phase_key": "completed" if job.status == JobStatus.completed else "failed",
            "phase_label": "Completed" if job.status == JobStatus.completed else "Failed",
            "phase_detail": f"{job.files_scanned} files analyzed, {duplicate_stats['duplicate_files']} duplicate files",
            "phase_current": job.files_total,
            "phase_total": job.files_total,
            "phase_progress_percent": 100.0,
            "eta_seconds": 0.0,
            "duplicate_detection_mode": library.duplicate_detection_mode.value,
            "scan_mode_label": scan_type,
        }
    )
    job.scan_summary = summary
    db.commit()
    stats_cache.invalidate(cache_key, job.library_id)
    db.refresh(job)
    return job


def run_quality_recompute(db: Session, library_id: int, existing_job: ScanJob | None = None) -> ScanJob:
    cache_key = str(id(db.get_bind()))
    library = db.get(Library, library_id)
    if not library:
        raise ValueError(f"Library {library_id} not found")

    job = existing_job or ScanJob(
        library_id=library_id,
        status=JobStatus.running,
        job_type="quality_recompute",
        started_at=utc_now(),
    )
    if existing_job is None:
        db.add(job)
        db.commit()
        db.refresh(job)

    def _should_cancel() -> bool:
        db.refresh(job)
        return job.status == JobStatus.canceled

    media_files = db.scalars(
        select(MediaFile)
        .where(
            MediaFile.library_id == library_id,
            MediaFile.last_analyzed_at.is_not(None),
            MediaFile.raw_ffprobe_json.is_not(None),
            MediaFile.scan_status == ScanStatus.ready,
        )
        .options(
            selectinload(MediaFile.media_format),
            selectinload(MediaFile.video_streams),
            selectinload(MediaFile.audio_streams),
            selectinload(MediaFile.subtitle_streams),
            selectinload(MediaFile.external_subtitles),
        )
        .order_by(MediaFile.id.asc())
    ).all()

    job.files_total = len(media_files)
    job.files_scanned = 0
    if not job.scan_summary:
        job.scan_summary = _empty_scan_summary()
    _set_job_phase(
        job,
        "analyzing",
        "Recomputing quality scores",
        f"0 of {len(media_files)} files updated",
        total=max(1, len(media_files)),
        scan_mode_label="quality_recompute",
    )
    db.commit()
    stats_cache.invalidate(cache_key, library_id)

    batch_counter = 0
    resolution_categories = get_app_settings(db).resolution_categories
    for media_file in media_files:
        if _should_cancel():
            raise ScanCanceled()
        breakdown = calculate_quality_score(
            build_quality_score_input_from_media_file(media_file),
            library.quality_profile,
            resolution_categories,
        )
        _persist_quality_breakdown(media_file, breakdown)
        job.files_scanned += 1
        batch_counter += 1
        _update_job_phase_progress(
            job,
            job.files_scanned,
            max(1, len(media_files)),
            detail=f"{job.files_scanned} of {len(media_files)} files updated",
        )
        if batch_counter >= 200:
            db.commit()
            stats_cache.invalidate(cache_key, library_id)
            batch_counter = 0

    if batch_counter:
        db.commit()
        stats_cache.invalidate(cache_key, library_id)

    job.status = JobStatus.failed if job.errors else JobStatus.completed
    job.finished_at = utc_now()
    summary = _runtime_summary(job)
    summary["runtime"].update(
        {
            "phase_key": "completed" if job.status == JobStatus.completed else "failed",
            "phase_label": "Completed" if job.status == JobStatus.completed else "Failed",
            "phase_detail": f"{job.files_scanned} of {job.files_total} quality scores updated",
            "phase_current": job.files_total,
            "phase_total": job.files_total,
            "phase_progress_percent": 100.0,
            "eta_seconds": 0.0,
            "scan_mode_label": "quality_recompute",
        }
    )
    job.scan_summary = summary
    db.commit()
    stats_cache.invalidate(cache_key, library_id)
    db.refresh(job)
    return job


def run_duplicate_refresh(
    db: Session,
    settings: Settings,
    library_id: int,
    existing_job: ScanJob | None = None,
) -> ScanJob:
    cache_key = str(id(db.get_bind()))
    library = db.get(Library, library_id)
    if not library:
        raise ValueError(f"Library {library_id} not found")

    job = existing_job or ScanJob(
        library_id=library_id,
        status=JobStatus.running,
        job_type="duplicate_refresh",
        started_at=utc_now(),
        scan_summary=_empty_scan_summary(),
    )
    if existing_job is None:
        db.add(job)
        db.commit()
        db.refresh(job)

    def _should_cancel() -> bool:
        db.refresh(job)
        return job.status == JobStatus.canceled

    media_files = db.scalars(
        select(MediaFile)
        .where(MediaFile.library_id == library_id, MediaFile.scan_status == ScanStatus.ready)
        .options(selectinload(MediaFile.media_format))
        .order_by(MediaFile.id.asc())
    ).all()
    job.files_total = len(media_files)
    job.files_scanned = len(media_files)
    if not job.scan_summary:
        job.scan_summary = _empty_scan_summary()
    db.commit()
    stats_cache.invalidate(cache_key, library_id)

    duplicate_stats = _run_duplicate_detection(db, settings, library, job, should_cancel=_should_cancel)
    if _should_cancel():
        raise ScanCanceled()

    job.status = JobStatus.failed if job.errors else JobStatus.completed
    job.finished_at = utc_now()
    summary = _runtime_summary(job)
    summary["duplicates"].update(duplicate_stats)
    summary["runtime"].update(
        {
            "phase_key": "completed" if job.status == JobStatus.completed else "failed",
            "phase_label": "Completed" if job.status == JobStatus.completed else "Failed",
            "phase_detail": f"{duplicate_stats['duplicate_files']} duplicate files across {duplicate_stats['groups_found']} groups",
            "phase_current": job.files_total,
            "phase_total": job.files_total,
            "phase_progress_percent": 100.0,
            "eta_seconds": 0.0,
            "scan_mode_label": "duplicate_refresh",
            "duplicate_detection_mode": library.duplicate_detection_mode.value,
        }
    )
    job.scan_summary = summary
    db.commit()
    stats_cache.invalidate(cache_key, library_id)
    db.refresh(job)
    return job
