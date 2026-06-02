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


def _scan_has_file_issues(scan_job: ScanJob, summary: ScanSummaryRead) -> bool:
    return (
        scan_job.errors > 0
        or summary.analysis.analysis_failed > 0
        or summary.duplicates.processing_failed > 0
    )


def _scan_outcome(scan_job: ScanJob, summary: ScanSummaryRead) -> str:
    if scan_job.status == JobStatus.completed:
        if _scan_has_file_issues(scan_job, summary):
            return "completed_with_issues"
        return "successful"
    if scan_job.status == JobStatus.canceled:
        return "canceled"
    return "failed"


def _queue_progress_percent(files_total: int, files_scanned: int) -> float:
    if files_total <= 0 or files_scanned <= 0:
        return 0.0
    return min(100.0, round((files_scanned / files_total) * 100, 1))


def _live_discovered_files(scan_job: ScanJob, summary: ScanSummaryRead) -> int:
    return max(scan_job.discovered_files or 0, summary.discovery.discovered_files)


def _live_unchanged_files(scan_job: ScanJob, summary: ScanSummaryRead) -> int:
    return max(scan_job.unchanged_files or 0, summary.changes.unchanged_files)


def _live_new_files(scan_job: ScanJob, summary: ScanSummaryRead) -> int:
    return max(scan_job.new_files_live or 0, summary.changes.new_files.count)


def _live_deleted_files(scan_job: ScanJob, summary: ScanSummaryRead) -> int:
    return max(scan_job.deleted_files_live or 0, summary.changes.deleted_files.count)


def _live_modified_files(scan_job: ScanJob, summary: ScanSummaryRead) -> int:
    return max(scan_job.modified_files_live or 0, summary.changes.modified_files.count)


def _discovery_phase_detail(
    discovered_files: int,
    unchanged_files: int,
    queued_files: int,
    processed_files: int,
) -> str:
    if discovered_files <= 0:
        return "Scanning directories"
    return (
        f"{discovered_files} files found so far; "
        f"{unchanged_files} unchanged, {queued_files} queued, {processed_files} processed"
    )


def _completed_scan_detail(
    *,
    discovered_files: int,
    unchanged_files: int,
    files_total: int,
    files_scanned: int,
) -> str:
    if files_total > 0:
        return f"{files_scanned} of {files_total} queued files processed"
    if discovered_files > 0 and unchanged_files >= discovered_files:
        return f"{discovered_files} files checked; all unchanged"
    if discovered_files > 0:
        return f"{discovered_files} files checked; nothing needed processing"
    return "No media files found"


def serialize_scan_job(scan_job: ScanJob) -> ScanJobRead:
    summary = _normalize_scan_summary(scan_job.scan_summary)
    discovered_files = _live_discovered_files(scan_job, summary)
    unchanged_files = _live_unchanged_files(scan_job, summary)
    new_files_live = _live_new_files(scan_job, summary)
    deleted_files_live = _live_deleted_files(scan_job, summary)
    modified_files_live = _live_modified_files(scan_job, summary)
    discovery_complete = bool(scan_job.discovery_complete)
    files_total = scan_job.files_total or 0
    files_scanned = scan_job.files_scanned or 0
    has_file_issues = _scan_has_file_issues(scan_job, summary)
    issue_count = max(
        scan_job.errors or 0,
        summary.analysis.analysis_failed + summary.duplicates.processing_failed,
    )
    issue_label = "issue" if issue_count == 1 else "issues"
    progress_percent = 0.0
    progress_mode = "indeterminate"

    is_quality_recompute = scan_job.job_type == "quality_recompute"
    if scan_job.status == JobStatus.queued and is_quality_recompute:
        phase_label = "Queued"
        phase_detail = "Waiting to recompute quality scores"
    elif scan_job.status == JobStatus.queued:
        phase_label = "Queued"
        phase_detail = "Waiting to start"
    elif scan_job.status == JobStatus.running and is_quality_recompute:
        phase_label = "Recomputing quality scores"
        phase_detail = (
            f"{files_scanned} of {files_total} files updated"
            if files_total > 0
            else "Loading analyzed files"
        )
        if files_total > 0:
            progress_percent = _queue_progress_percent(files_total, files_scanned)
            progress_mode = "determinate"
    elif scan_job.status == JobStatus.running and not discovery_complete:
        phase_label = "Discovering files"
        phase_detail = _discovery_phase_detail(discovered_files, unchanged_files, files_total, files_scanned)
    elif scan_job.status == JobStatus.running and files_total > 0:
        phase_label = "Processing queued files"
        phase_detail = f"{files_scanned} of {files_total} queued files processed"
        progress_percent = _queue_progress_percent(files_total, files_scanned)
        progress_mode = "determinate"
    elif scan_job.status == JobStatus.running:
        phase_label = "Finalizing scan"
        phase_detail = _completed_scan_detail(
            discovered_files=discovered_files,
            unchanged_files=unchanged_files,
            files_total=files_total,
            files_scanned=files_scanned,
        )
    elif scan_job.status == JobStatus.completed and has_file_issues:
        phase_label = "Completed with issues"
        phase_detail = (
            f"{files_scanned} of {files_total} queued files processed; {issue_count} {issue_label}"
            if files_total > 0
            else f"{_completed_scan_detail(discovered_files=discovered_files, unchanged_files=unchanged_files, files_total=files_total, files_scanned=files_scanned)}; {issue_count} {issue_label}"
        )
        progress_percent = _queue_progress_percent(files_total, files_scanned)
        progress_mode = "determinate" if files_total > 0 else "indeterminate"
    elif scan_job.status == JobStatus.completed and is_quality_recompute:
        phase_label = "Completed"
        phase_detail = f"{files_scanned} of {files_total} quality scores updated"
        progress_percent = _queue_progress_percent(files_total, files_scanned)
        progress_mode = "determinate" if files_total > 0 else "indeterminate"
    elif scan_job.status == JobStatus.completed:
        phase_label = "Completed"
        phase_detail = _completed_scan_detail(
            discovered_files=discovered_files,
            unchanged_files=unchanged_files,
            files_total=files_total,
            files_scanned=files_scanned,
        )
        progress_percent = _queue_progress_percent(files_total, files_scanned)
        progress_mode = "determinate" if files_total > 0 else "indeterminate"
    elif scan_job.status == JobStatus.canceled and is_quality_recompute:
        phase_label = "Canceled"
        phase_detail = (
            f"Stopped after {files_scanned} of {files_total} scores"
            if files_total > 0
            else "Stopped before recompute started"
        )
        progress_percent = _queue_progress_percent(files_total, files_scanned)
        progress_mode = "determinate" if files_total > 0 else "indeterminate"
    elif scan_job.status == JobStatus.canceled:
        phase_label = "Canceled"
        phase_detail = (
            f"Stopped after {files_scanned} of {files_total} queued files"
            if files_total > 0
            else (
                f"Stopped after checking {discovered_files} files"
                if discovered_files > 0
                else "Stopped before discovery started"
            )
        )
        progress_percent = _queue_progress_percent(files_total, files_scanned)
        progress_mode = "determinate" if files_total > 0 else "indeterminate"
    elif is_quality_recompute:
        phase_label = "Failed"
        phase_detail = (
            f"Failed after {files_scanned} of {files_total} scores"
            if files_total > 0
            else "Quality recompute failed before processing started"
        )
        progress_percent = _queue_progress_percent(files_total, files_scanned)
        progress_mode = "determinate" if files_total > 0 else "indeterminate"
    else:
        phase_label = "Failed"
        phase_detail = (
            f"Failed after {files_scanned} of {files_total} queued files"
            if files_total > 0
            else (
                f"Scan failed after checking {discovered_files} files"
                if discovered_files > 0
                else "Scan failed before discovery started"
            )
        )
        progress_percent = _queue_progress_percent(files_total, files_scanned)
        progress_mode = "determinate" if files_total > 0 else "indeterminate"

    return ScanJobRead(
        id=scan_job.id,
        library_id=scan_job.library_id,
        library_name=scan_job.library.name if scan_job.library else None,
        status=scan_job.status,
        job_type=scan_job.job_type,
        discovered_files=discovered_files,
        unchanged_files=unchanged_files,
        discovery_complete=discovery_complete,
        new_files_live=new_files_live,
        deleted_files_live=deleted_files_live,
        modified_files_live=modified_files_live,
        files_total=files_total,
        files_scanned=files_scanned,
        errors=scan_job.errors,
        started_at=scan_job.started_at,
        finished_at=scan_job.finished_at,
        progress_percent=progress_percent,
        progress_mode=progress_mode,
        phase_label=phase_label,
        phase_detail=phase_detail,
    )


def serialize_recent_scan_job(scan_job: ScanJob) -> RecentScanJobRead:
    summary = _normalize_scan_summary(scan_job.scan_summary)
    return RecentScanJobRead(
        id=scan_job.id,
        library_id=scan_job.library_id,
        library_name=scan_job.library.name if scan_job.library else None,
        status=scan_job.status,
        outcome=_scan_outcome(scan_job, summary),
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
    ).all()
    jobs = sorted(
        jobs,
        key=lambda job: (
            0 if job.status == JobStatus.running else 1,
            0 if job.job_type in {"incremental", "full"} else 1,
            -(job.started_at.timestamp() if job.started_at else 0.0),
            -job.id,
        ),
    )
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
