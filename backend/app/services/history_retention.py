from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from backend.app.core.config import Settings, get_settings
from backend.app.models.entities import JobStatus, LibraryHistory, MediaFileHistory, ScanJob
from backend.app.services.app_settings import get_app_settings
from backend.app.services.history_storage import GIGABYTE_BYTES, _json_length, _text_length
from backend.app.utils.time import utc_now


TERMINAL_SCAN_JOB_STATUSES = (JobStatus.completed, JobStatus.failed, JobStatus.canceled)


@dataclass
class HistoryRetentionResult:
    deleted_entries: int = 0
    compaction_deferred: bool = False
    compaction_completed: bool = False


def has_active_scan_jobs(db: Session) -> bool:
    return (
        db.scalar(select(ScanJob.id).where(ScanJob.status.in_([JobStatus.queued, JobStatus.running])).limit(1))
        is not None
    )


def _storage_limit_bytes(limit_gb: float) -> int:
    if limit_gb <= 0:
        return 0
    return int(limit_gb * GIGABYTE_BYTES)


def _prune_media_file_history(db: Session, *, days: int, storage_limit_bytes: int) -> int:
    deleted_entries = 0
    if days > 0:
        cutoff = utc_now() - timedelta(days=days)
        deleted_entries += db.execute(
            delete(MediaFileHistory).where(MediaFileHistory.captured_at < cutoff)
        ).rowcount or 0
        db.commit()

    if storage_limit_bytes <= 0:
        return deleted_entries

    rows = db.execute(
        select(
            MediaFileHistory.id,
            MediaFileHistory.relative_path,
            MediaFileHistory.filename,
            MediaFileHistory.snapshot_hash,
            MediaFileHistory.snapshot,
        ).order_by(MediaFileHistory.captured_at.asc(), MediaFileHistory.id.asc())
    ).all()
    total_bytes = sum(
        _text_length(relative_path) + _text_length(filename) + _text_length(snapshot_hash) + _json_length(snapshot)
        for _id, relative_path, filename, snapshot_hash, snapshot in rows
    )
    ids_to_delete: list[int] = []
    for row_id, relative_path, filename, snapshot_hash, snapshot in rows:
        if total_bytes <= storage_limit_bytes:
            break
        total_bytes -= (
            _text_length(relative_path)
            + _text_length(filename)
            + _text_length(snapshot_hash)
            + _json_length(snapshot)
        )
        ids_to_delete.append(row_id)
    if ids_to_delete:
        deleted_entries += db.execute(delete(MediaFileHistory).where(MediaFileHistory.id.in_(ids_to_delete))).rowcount or 0
        db.commit()
    return deleted_entries


def _prune_library_history(db: Session, *, days: int, storage_limit_bytes: int) -> int:
    deleted_entries = 0
    if days > 0:
        cutoff = utc_now() - timedelta(days=days)
        deleted_entries += db.execute(
            delete(LibraryHistory).where(LibraryHistory.captured_at < cutoff)
        ).rowcount or 0
        db.commit()

    if storage_limit_bytes <= 0:
        return deleted_entries

    rows = db.execute(
        select(LibraryHistory.id, LibraryHistory.snapshot).order_by(LibraryHistory.captured_at.asc(), LibraryHistory.id.asc())
    ).all()
    total_bytes = sum(_json_length(snapshot) for _id, snapshot in rows)
    ids_to_delete: list[int] = []
    for row_id, snapshot in rows:
        if total_bytes <= storage_limit_bytes:
            break
        total_bytes -= _json_length(snapshot)
        ids_to_delete.append(row_id)
    if ids_to_delete:
        deleted_entries += db.execute(delete(LibraryHistory).where(LibraryHistory.id.in_(ids_to_delete))).rowcount or 0
        db.commit()
    return deleted_entries


def _prune_scan_history(db: Session, *, days: int, storage_limit_bytes: int) -> int:
    deleted_entries = 0
    base_query = select(ScanJob.id).where(ScanJob.status.in_(TERMINAL_SCAN_JOB_STATUSES))
    if days > 0:
        cutoff = utc_now() - timedelta(days=days)
        deleted_entries += db.execute(
            delete(ScanJob).where(
                ScanJob.id.in_(
                    base_query.where(ScanJob.finished_at.is_not(None), ScanJob.finished_at < cutoff)
                )
            )
        ).rowcount or 0
        db.commit()

    if storage_limit_bytes <= 0:
        return deleted_entries

    rows = db.execute(
        select(
            ScanJob.id,
            ScanJob.job_type,
            ScanJob.status,
            ScanJob.trigger_source,
            ScanJob.trigger_details,
            ScanJob.scan_summary,
        )
        .where(ScanJob.status.in_(TERMINAL_SCAN_JOB_STATUSES))
        .order_by(ScanJob.finished_at.asc(), ScanJob.id.asc())
    ).all()
    total_bytes = sum(
        _text_length(job_type)
        + _text_length(status.value if hasattr(status, "value") else str(status))
        + _text_length(trigger_source.value if hasattr(trigger_source, "value") else str(trigger_source))
        + _json_length(trigger_details)
        + _json_length(scan_summary)
        for _id, job_type, status, trigger_source, trigger_details, scan_summary in rows
    )
    ids_to_delete: list[int] = []
    for row_id, job_type, status, trigger_source, trigger_details, scan_summary in rows:
        if total_bytes <= storage_limit_bytes:
            break
        total_bytes -= (
            _text_length(job_type)
            + _text_length(status.value if hasattr(status, "value") else str(status))
            + _text_length(trigger_source.value if hasattr(trigger_source, "value") else str(trigger_source))
            + _json_length(trigger_details)
            + _json_length(scan_summary)
        )
        ids_to_delete.append(row_id)
    if ids_to_delete:
        deleted_entries += db.execute(delete(ScanJob).where(ScanJob.id.in_(ids_to_delete))).rowcount or 0
        db.commit()
    return deleted_entries


def _compact_database(db: Session, *, allow_vacuum: bool) -> bool:
    bind = db.get_bind()
    with bind.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        connection.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
        if not allow_vacuum:
            return False
        connection.exec_driver_sql("VACUUM")
    return allow_vacuum


def apply_history_retention(db: Session, settings: Settings | None = None) -> HistoryRetentionResult:
    resolved_settings = settings or get_settings()
    app_settings = get_app_settings(db, resolved_settings)
    deleted_entries = 0

    deleted_entries += _prune_media_file_history(
        db,
        days=app_settings.history_retention.file_history.days,
        storage_limit_bytes=_storage_limit_bytes(app_settings.history_retention.file_history.storage_limit_gb),
    )
    deleted_entries += _prune_library_history(
        db,
        days=app_settings.history_retention.library_history.days,
        storage_limit_bytes=_storage_limit_bytes(app_settings.history_retention.library_history.storage_limit_gb),
    )
    deleted_entries += _prune_scan_history(
        db,
        days=app_settings.history_retention.scan_history.days,
        storage_limit_bytes=_storage_limit_bytes(app_settings.history_retention.scan_history.storage_limit_gb),
    )

    result = HistoryRetentionResult(deleted_entries=deleted_entries)
    if deleted_entries <= 0:
        return result

    active_jobs = has_active_scan_jobs(db)
    result.compaction_deferred = active_jobs
    result.compaction_completed = _compact_database(db, allow_vacuum=not active_jobs)
    return result


def run_pending_history_compaction(db: Session) -> bool:
    if has_active_scan_jobs(db):
        return False
    return _compact_database(db, allow_vacuum=True)
