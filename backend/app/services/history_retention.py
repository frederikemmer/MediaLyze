from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import and_, delete, func, or_, select, text, update
from sqlalchemy.orm import Session

from backend.app.core.config import Settings, get_settings
from backend.app.models.entities import (
    JobStatus,
    LibraryHistory,
    MediaFileHistory,
    ScanJob,
    TranscodeAutomationRun,
    TranscodeJob,
    TranscodeVariant,
)
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
    return bool(
        db.scalar(select(ScanJob.id).where(ScanJob.status.in_([JobStatus.queued, JobStatus.running])).limit(1))
        is not None
        or db.scalar(
            select(TranscodeJob.id)
            .where(TranscodeJob.status.in_([JobStatus.queued, JobStatus.running]))
            .limit(1)
        )
        is not None
        or db.scalar(
            select(TranscodeAutomationRun.id)
            .where(TranscodeAutomationRun.status.in_(["queued", "running"]))
            .limit(1)
        )
        is not None
    )


def _storage_limit_bytes(limit_gb: float) -> int:
    if limit_gb <= 0:
        return 0
    return int(limit_gb * GIGABYTE_BYTES)


HISTORY_RETENTION_BATCH_SIZE = 500


def _history_size_batches(db: Session, model, timestamp, fields, estimate: Callable, filters, ceiling: int):
    """Decode one JSON row at a time; close readers before deleting/committing.

    Keep the existing canonical byte estimates (including unicode/JSON spacing)
    instead of changing storage budgets to SQLite's raw serialized lengths.
    """
    last_time = None
    last_id = None
    while True:
        query = select(model.id, timestamp.label("retention_time"), *fields).where(
            model.id <= ceiling, *filters,
        )
        if last_id is not None:
            if last_time is None:
                query = query.where(or_(
                    timestamp.is_not(None), and_(timestamp.is_(None), model.id > last_id),
                ))
            else:
                query = query.where(or_(
                    timestamp > last_time, and_(timestamp == last_time, model.id > last_id),
                ))
        query = query.order_by(timestamp.asc(), model.id.asc()).limit(HISTORY_RETENTION_BATCH_SIZE)
        sizes = []
        with db.execute(query.execution_options(yield_per=1)) as rows:
            for row in rows:
                sizes.append((row.id, estimate(row)))
                last_time, last_id = row.retention_time, row.id
        if not sizes:
            return
        yield sizes


def _prune_storage_budget(
    db: Session, model, timestamp, fields, estimate: Callable, storage_limit_bytes: int,
    *, filters=(), unlink_variants: bool = False,
) -> int:
    ceiling = db.scalar(select(func.max(model.id)).where(*filters))
    if ceiling is None:
        return 0
    total_bytes = sum(
        size for batch in _history_size_batches(db, model, timestamp, fields, estimate, filters, ceiling)
        for _id, size in batch
    )
    deleted = 0
    if total_bytes <= storage_limit_bytes:
        return deleted
    for batch in _history_size_batches(db, model, timestamp, fields, estimate, filters, ceiling):
        ids = []
        for row_id, size in batch:
            if total_bytes <= storage_limit_bytes:
                break
            total_bytes -= size
            ids.append(row_id)
        if ids:
            eligible = select(model.id).where(model.id.in_(ids), *filters)
            if unlink_variants:
                db.execute(update(TranscodeVariant).where(TranscodeVariant.job_id.in_(eligible)).values(job_id=None))
            deleted += db.execute(delete(model).where(model.id.in_(ids), *filters)).rowcount or 0
            db.commit()
        if total_bytes <= storage_limit_bytes:
            break
    return deleted


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

    return deleted_entries + _prune_storage_budget(
        db, MediaFileHistory, MediaFileHistory.captured_at,
        (MediaFileHistory.relative_path, MediaFileHistory.filename, MediaFileHistory.snapshot_hash, MediaFileHistory.snapshot),
        lambda row: _text_length(row.relative_path) + _text_length(row.filename)
        + _text_length(row.snapshot_hash) + _json_length(row.snapshot),
        storage_limit_bytes,
    )


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

    return deleted_entries + _prune_storage_budget(
        db, LibraryHistory, LibraryHistory.captured_at, (LibraryHistory.snapshot,),
        lambda row: _json_length(row.snapshot), storage_limit_bytes,
    )


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

    return deleted_entries + _prune_storage_budget(
        db, ScanJob, ScanJob.finished_at,
        (ScanJob.job_type, ScanJob.status, ScanJob.trigger_source, ScanJob.trigger_details, ScanJob.scan_summary),
        lambda row: _text_length(row.job_type) + _text_length(row.status.value)
        + _text_length(row.trigger_source.value) + _json_length(row.trigger_details) + _json_length(row.scan_summary),
        storage_limit_bytes, filters=(ScanJob.status.in_(TERMINAL_SCAN_JOB_STATUSES),),
    )


def _transcode_job_estimated_bytes(job: TranscodeJob) -> int:
    return (
        _text_length(job.profile)
        + _json_length(job.plan)
        + _json_length(job.ffmpeg_arguments)
        + _text_length(job.ffmpeg_command)
        + _json_length(job.warnings)
        + _text_length(job.source_path_snapshot)
        + _text_length(job.output_path_snapshot)
        + _text_length(job.error)
        + _json_length(job.rule_snapshot)
        + _text_length(job.automation_trigger)
    )


def _transcode_automation_run_estimated_bytes(run: TranscodeAutomationRun) -> int:
    return (
        _text_length(run.trigger_source)
        + _json_length(run.rule_ids)
        + _json_length(run.library_ids)
        + _json_length(run.source_file_ids)
        + _json_length(run.summary)
        + _text_length(run.error)
    )


def _prune_transcode_history(db: Session, *, days: int, storage_limit_bytes: int) -> int:
    deleted_entries = 0
    terminal_statuses = (JobStatus.completed, JobStatus.failed, JobStatus.canceled)
    if days > 0:
        cutoff = utc_now() - timedelta(days=days)
        expired_job_ids = select(TranscodeJob.id).where(
            TranscodeJob.status.in_(terminal_statuses),
            TranscodeJob.finished_at.is_not(None),
            TranscodeJob.finished_at < cutoff,
        )
        db.execute(
            update(TranscodeVariant)
            .where(TranscodeVariant.job_id.in_(expired_job_ids))
            .values(job_id=None)
        )
        deleted_entries += db.execute(
            delete(TranscodeJob).where(
                TranscodeJob.status.in_(terminal_statuses),
                TranscodeJob.finished_at.is_not(None),
                TranscodeJob.finished_at < cutoff,
            )
        ).rowcount or 0
        db.commit()
    if storage_limit_bytes <= 0:
        return deleted_entries
    return deleted_entries + _prune_storage_budget(
        db, TranscodeJob, TranscodeJob.finished_at,
        (TranscodeJob.profile, TranscodeJob.plan, TranscodeJob.ffmpeg_arguments, TranscodeJob.ffmpeg_command,
         TranscodeJob.warnings, TranscodeJob.source_path_snapshot, TranscodeJob.output_path_snapshot,
         TranscodeJob.error, TranscodeJob.rule_snapshot, TranscodeJob.automation_trigger),
        _transcode_job_estimated_bytes, storage_limit_bytes,
        filters=(TranscodeJob.status.in_(terminal_statuses),), unlink_variants=True,
    )


def _prune_transcode_automation_runs(db: Session, *, days: int, storage_limit_bytes: int) -> int:
    deleted_entries = 0
    terminal_statuses = ("completed", "failed", "canceled")
    if days > 0:
        cutoff = utc_now() - timedelta(days=days)
        deleted_entries += db.execute(
            delete(TranscodeAutomationRun).where(
                TranscodeAutomationRun.status.in_(terminal_statuses),
                TranscodeAutomationRun.finished_at.is_not(None),
                TranscodeAutomationRun.finished_at < cutoff,
            )
        ).rowcount or 0
        db.commit()
    if storage_limit_bytes <= 0:
        return deleted_entries
    return deleted_entries + _prune_storage_budget(
        db, TranscodeAutomationRun, TranscodeAutomationRun.finished_at,
        (TranscodeAutomationRun.trigger_source, TranscodeAutomationRun.rule_ids, TranscodeAutomationRun.library_ids,
         TranscodeAutomationRun.source_file_ids, TranscodeAutomationRun.summary, TranscodeAutomationRun.error),
        _transcode_automation_run_estimated_bytes, storage_limit_bytes,
        filters=(TranscodeAutomationRun.status.in_(terminal_statuses),),
    )


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
    deleted_entries += _prune_transcode_history(
        db,
        days=app_settings.history_retention.transcode_history.days,
        storage_limit_bytes=_storage_limit_bytes(
            app_settings.history_retention.transcode_history.storage_limit_gb
        ),
    )
    deleted_entries += _prune_transcode_automation_runs(
        db,
        days=app_settings.history_retention.transcode_history.days,
        storage_limit_bytes=_storage_limit_bytes(
            app_settings.history_retention.transcode_history.storage_limit_gb
        ),
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
