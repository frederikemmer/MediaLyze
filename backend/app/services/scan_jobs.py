from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, selectinload

from backend.app.models.entities import JobStatus, ScanJob
from backend.app.schemas.scan import RecentScanJobPageRead, RecentScanJobRead, ScanJobDetailRead, ScanJobRead, ScanSummaryRead
from backend.app.utils.time import utc_now


def _duration_seconds(started_at: datetime | None, finished_at: datetime | None) -> float | None:
    if started_at is None or finished_at is None:
        return None
    return max(0.0, (finished_at - started_at).total_seconds())


def _normalize_scan_summary(value: dict | None) -> ScanSummaryRead:
    try:
        return ScanSummaryRead.model_validate(value or {})
    except Exception:
        return ScanSummaryRead()


def _scan_outcome(scan_job: ScanJob) -> str:
    if scan_job.status == JobStatus.completed:
        return "successful"
    if scan_job.status == JobStatus.canceled:
        return "canceled"
    return "failed"


def serialize_scan_job(scan_job: ScanJob) -> ScanJobRead:
    files_total = scan_job.files_total or 0
    files_scanned = scan_job.files_scanned or 0
    summary = _normalize_scan_summary(scan_job.scan_summary)
    queued_for_analysis = max(summary.analysis.queued_for_analysis, summary.changes.queued_for_analysis)
    unchanged_files = summary.changes.unchanged_files
    runtime = dict(summary.runtime or {})
    phase_key = str(runtime.get("phase_key") or "queued")
    phase_label = str(runtime.get("phase_label") or "Queued")
    phase_detail = runtime.get("phase_detail")
    phase_progress_percent = float(runtime.get("phase_progress_percent") or 0.0)
    phase_current = int(runtime.get("phase_current") or 0)
    phase_total = int(runtime.get("phase_total") or 0)
    eta_seconds = runtime.get("eta_seconds")
    scan_mode_label = runtime.get("scan_mode_label")
    duplicate_detection_mode = runtime.get("duplicate_detection_mode")
    is_quality_recompute = scan_job.job_type == "quality_recompute" or scan_mode_label == "quality_recompute"

    if not runtime.get("phase_key"):
        if scan_job.status == JobStatus.queued:
            phase_key = "queued"
            phase_label = "Queued"
        elif files_total <= 0:
            phase_key = "discovering"
            phase_label = "Discovering files"
            phase_detail = "Scanning directories"
        else:
            phase_key = "analyzing"
            phase_label = "Recomputing quality scores" if is_quality_recompute else "Analyzing media"
            phase_current = files_scanned
            phase_total = files_total if is_quality_recompute else (queued_for_analysis or files_total)
            phase_progress_percent = round((files_scanned / phase_total) * 100, 1) if phase_total > 0 else 0.0
            phase_detail = (
                f"{files_scanned} of {phase_total} files updated"
                if is_quality_recompute
                else f"{files_scanned} of {phase_total} files analyzed"
            )

    if phase_key == "analyzing" and not is_quality_recompute:
        if queued_for_analysis > 0:
            phase_total = queued_for_analysis
        if phase_total <= 0 and files_total > 0:
            phase_total = files_total
        if phase_total > 0:
            phase_current = min(phase_total, max(phase_current, files_scanned))
        elif phase_current <= 0 and files_scanned > 0:
            phase_current = files_scanned
        phase_progress_percent = round((phase_current / phase_total) * 100, 1) if phase_total > 0 else 0.0
        if phase_total > 0:
            if unchanged_files > 0:
                phase_detail = (
                    f"{phase_current} of {phase_total} queued files analyzed, {unchanged_files} unchanged"
                )
            else:
                phase_detail = f"{phase_current} of {phase_total} files analyzed"
    elif phase_key == "analyzing" and is_quality_recompute:
        if phase_total <= 0 and files_total > 0:
            phase_total = files_total
        if phase_total > 0:
            phase_current = min(phase_total, max(phase_current, files_scanned))
            phase_progress_percent = round((phase_current / phase_total) * 100, 1)
        elif phase_current <= 0 and files_scanned > 0:
            phase_current = files_scanned
        if not phase_detail and phase_total > 0:
            phase_detail = f"{phase_current} of {phase_total} files updated"

    progress_percent = 0.0
    if phase_key == "discovering":
        progress_percent = min(15.0, phase_progress_percent * 0.15)
    elif phase_key == "analyzing":
        progress_percent = phase_progress_percent if is_quality_recompute else 15.0 + (phase_progress_percent * 0.55)
    elif phase_key in {"detecting_duplicates_preparing", "detecting_duplicates_artifacts"}:
        progress_percent = 70.0 + (phase_progress_percent * 0.20)
    elif phase_key == "detecting_duplicates_grouping":
        progress_percent = 90.0 + (phase_progress_percent * 0.10)
    elif phase_key in {"completed", "failed", "canceled"}:
        progress_percent = 100.0
    elif files_total > 0 and files_scanned > 0:
        progress_percent = min(100.0, round((files_scanned / files_total) * 100, 1))

    return ScanJobRead(
        id=scan_job.id,
        library_id=scan_job.library_id,
        library_name=scan_job.library.name if scan_job.library else None,
        status=scan_job.status,
        job_type=scan_job.job_type,
        files_total=files_total,
        files_scanned=files_scanned,
        errors=scan_job.errors,
        started_at=scan_job.started_at,
        finished_at=scan_job.finished_at,
        progress_percent=round(progress_percent, 1),
        phase_key=phase_key,
        phase_label=phase_label,
        phase_detail=phase_detail,
        phase_progress_percent=phase_progress_percent,
        phase_current=phase_current,
        phase_total=phase_total,
        eta_seconds=float(eta_seconds) if eta_seconds is not None else None,
        scan_mode_label=str(scan_mode_label) if scan_mode_label is not None else None,
        duplicate_detection_mode=str(duplicate_detection_mode) if duplicate_detection_mode is not None else None,
        queued_for_analysis=queued_for_analysis,
        unchanged_files=unchanged_files,
    )


def serialize_recent_scan_job(scan_job: ScanJob) -> RecentScanJobRead:
    summary = _normalize_scan_summary(scan_job.scan_summary)
    return RecentScanJobRead(
        id=scan_job.id,
        library_id=scan_job.library_id,
        library_name=scan_job.library.name if scan_job.library else None,
        status=scan_job.status,
        outcome=_scan_outcome(scan_job),
        job_type=scan_job.job_type,
        trigger_source=scan_job.trigger_source,
        started_at=scan_job.started_at,
        finished_at=scan_job.finished_at,
        duration_seconds=_duration_seconds(scan_job.started_at, scan_job.finished_at),
        discovered_files=summary.discovery.discovered_files,
        ignored_total=summary.discovery.ignored_total,
        new_files=summary.changes.new_files.count,
        modified_files=summary.changes.modified_files.count,
        deleted_files=summary.changes.deleted_files.count,
        analysis_failed=summary.analysis.analysis_failed,
    )


def serialize_scan_job_detail(scan_job: ScanJob) -> ScanJobDetailRead:
    summary = _normalize_scan_summary(scan_job.scan_summary)
    recent = serialize_recent_scan_job(scan_job)
    return ScanJobDetailRead(
        **recent.model_dump(),
        trigger_details=scan_job.trigger_details or {},
        scan_summary=summary,
    )


def list_active_scan_jobs(db: Session) -> list[ScanJobRead]:
    jobs = db.scalars(
        select(ScanJob)
        .where(ScanJob.status.in_([JobStatus.queued, JobStatus.running]))
        .options(selectinload(ScanJob.library))
        .order_by(ScanJob.started_at.desc(), ScanJob.id.desc())
    ).all()
    seen_libraries: set[int] = set()
    deduplicated: list[ScanJobRead] = []
    for job in jobs:
        if job.library_id in seen_libraries:
            continue
        seen_libraries.add(job.library_id)
        deduplicated.append(serialize_scan_job(job))
    return deduplicated


def list_library_scan_jobs(db: Session, library_id: int, limit: int = 10) -> list[ScanJobRead]:
    jobs = db.scalars(
        select(ScanJob)
        .where(ScanJob.library_id == library_id)
        .options(selectinload(ScanJob.library))
        .order_by(ScanJob.id.desc())
        .limit(limit)
    ).all()
    return [serialize_scan_job(job) for job in jobs]


def list_recent_scan_jobs(
    db: Session,
    limit: int = 20,
    *,
    since_hours: int | None = None,
    before_finished_at: datetime | None = None,
    before_id: int | None = None,
) -> RecentScanJobPageRead:
    statement = (
        select(ScanJob)
        .where(
            ScanJob.status.in_([JobStatus.completed, JobStatus.failed, JobStatus.canceled]),
            ScanJob.job_type.in_(["incremental", "full"]),
        )
        .options(selectinload(ScanJob.library))
        .order_by(ScanJob.finished_at.desc(), ScanJob.id.desc())
    )

    if since_hours is not None:
        cutoff = utc_now() - timedelta(hours=since_hours)
        statement = statement.where(ScanJob.finished_at.is_not(None), ScanJob.finished_at >= cutoff)

    if before_finished_at is not None:
        cursor_filter = ScanJob.finished_at < before_finished_at
        if before_id is not None:
            cursor_filter = or_(
                ScanJob.finished_at < before_finished_at,
                and_(ScanJob.finished_at == before_finished_at, ScanJob.id < before_id),
            )
        statement = statement.where(cursor_filter)

    jobs = db.scalars(statement.limit(limit + 1)).all()
    has_more = len(jobs) > limit
    return RecentScanJobPageRead(
        items=[serialize_recent_scan_job(job) for job in jobs[:limit]],
        has_more=has_more,
    )


def get_scan_job_detail(db: Session, job_id: int) -> ScanJobDetailRead | None:
    job = db.scalar(
        select(ScanJob)
        .where(
            ScanJob.id == job_id,
            ScanJob.job_type.in_(["incremental", "full"]),
        )
        .options(selectinload(ScanJob.library))
    )
    if job is None:
        return None
    return serialize_scan_job_detail(job)
