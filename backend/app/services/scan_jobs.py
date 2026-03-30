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
    progress_percent = 0.0
    if files_total > 0 and files_scanned > 0:
        progress_percent = min(100.0, round((files_scanned / files_total) * 100, 1))

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
    elif scan_job.status == JobStatus.running and files_scanned == 0:
        phase_label = "Discovering files"
        phase_detail = f"{files_total} files found so far" if files_total > 0 else "Scanning directories"
    elif scan_job.status == JobStatus.running:
        phase_label = "Analyzing media"
        phase_detail = f"{files_scanned} of {files_total} files analyzed"
    elif scan_job.status == JobStatus.completed and is_quality_recompute:
        phase_label = "Completed"
        phase_detail = f"{files_scanned} of {files_total} quality scores updated"
    elif scan_job.status == JobStatus.completed:
        phase_label = "Completed"
        phase_detail = f"{files_scanned} of {files_total} files analyzed"
    elif scan_job.status == JobStatus.canceled and is_quality_recompute:
        phase_label = "Canceled"
        phase_detail = (
            f"Stopped after {files_scanned} of {files_total} scores"
            if files_total > 0
            else "Stopped before recompute started"
        )
    elif scan_job.status == JobStatus.canceled:
        phase_label = "Canceled"
        phase_detail = (
            f"Stopped after {files_scanned} of {files_total} files"
            if files_total > 0
            else "Stopped before analysis started"
        )
    elif is_quality_recompute:
        phase_label = "Failed"
        phase_detail = (
            f"Failed after {files_scanned} of {files_total} scores"
            if files_total > 0
            else "Quality recompute failed before processing started"
        )
    else:
        phase_label = "Failed"
        phase_detail = (
            f"Failed after {files_scanned} of {files_total} files"
            if files_total > 0
            else "Scan failed before analysis started"
        )

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
        progress_percent=progress_percent,
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
