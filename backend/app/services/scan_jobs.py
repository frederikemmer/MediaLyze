from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.app.models.entities import JobStatus, ScanJob
from backend.app.schemas.scan import ScanJobRead


def serialize_scan_job(scan_job: ScanJob) -> ScanJobRead:
    files_total = scan_job.files_total or 0
    files_scanned = scan_job.files_scanned or 0
    progress_percent = 0.0
    if files_total > 0 and files_scanned > 0:
        progress_percent = min(100.0, round((files_scanned / files_total) * 100, 1))

    if scan_job.status == JobStatus.queued:
        phase_label = "Queued"
        phase_detail = "Waiting to start"
    elif scan_job.status == JobStatus.running and files_scanned == 0:
        phase_label = "Discovering files"
        phase_detail = f"{files_total} files found so far" if files_total > 0 else "Scanning directories"
    elif scan_job.status == JobStatus.running:
        phase_label = "Analyzing media"
        phase_detail = f"{files_scanned} of {files_total} files analyzed"
    elif scan_job.status == JobStatus.completed:
        phase_label = "Completed"
        phase_detail = f"{files_scanned} of {files_total} files analyzed"
    elif scan_job.status == JobStatus.canceled:
        phase_label = "Canceled"
        phase_detail = (
            f"Stopped after {files_scanned} of {files_total} files"
            if files_total > 0
            else "Stopped before analysis started"
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
