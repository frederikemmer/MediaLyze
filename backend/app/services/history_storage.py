from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from backend.app.core.config import Settings, get_settings
from backend.app.models.entities import JobStatus, LibraryHistory, MediaFileHistory, ScanJob
from backend.app.schemas.history import (
    HistoryStorageCategoriesRead,
    HistoryStorageCategoryRead,
    HistoryStorageRead,
)
from backend.app.services.app_settings import get_app_settings
from backend.app.utils.time import utc_now


TERMINAL_SCAN_JOB_STATUSES = (JobStatus.completed, JobStatus.failed, JobStatus.canceled)
GIGABYTE_BYTES = 1024 * 1024 * 1024


@dataclass(frozen=True)
class HistoryStorageRecord:
    recorded_at: datetime
    estimated_bytes: int


class HistoryStorageCache:
    def __init__(self) -> None:
        self._lock = Lock()
        self._payloads: dict[str, HistoryStorageRead] = {}

    def get(self, cache_key: str, app_settings) -> HistoryStorageRead | None:
        with self._lock:
            payload = self._payloads.get(cache_key)
            if payload is None:
                return None
            return _apply_retention_settings(payload, app_settings)

    def set(self, cache_key: str, payload: HistoryStorageRead) -> None:
        with self._lock:
            self._payloads[cache_key] = payload.model_copy(deep=True)

    def clear(self) -> None:
        with self._lock:
            self._payloads.clear()


history_storage_cache = HistoryStorageCache()


def _json_length(value) -> int:
    if value is None:
        return 0
    if isinstance(value, str):
        return len(value.encode("utf-8"))
    return len(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8"))


def _text_length(value: str | None) -> int:
    if not value:
        return 0
    return len(value.encode("utf-8"))


def _days_limit_for_bucket(app_settings, bucket_name: str) -> int:
    return int(getattr(app_settings.history_retention, bucket_name).days)


def _storage_limit_bytes_for_bucket(app_settings, bucket_name: str) -> int:
    limit_gb = float(getattr(app_settings.history_retention, bucket_name).storage_limit_gb)
    if limit_gb <= 0:
        return 0
    return int(limit_gb * GIGABYTE_BYTES)


def _forecast_from_records(
    records: list[HistoryStorageRecord],
    *,
    days_limit: int,
    storage_limit_bytes: int,
) -> HistoryStorageCategoryRead:
    if not records:
        return HistoryStorageCategoryRead(
            days_limit=days_limit,
            storage_limit_bytes=storage_limit_bytes,
        )

    sorted_records = sorted(records, key=lambda item: (item.recorded_at, item.estimated_bytes))
    current_estimated_bytes = sum(item.estimated_bytes for item in sorted_records)
    newest_recorded_at = sorted_records[-1].recorded_at
    oldest_recorded_at = sorted_records[0].recorded_at

    recent_cutoff = utc_now() - timedelta(days=30)
    sample_records = [item for item in sorted_records if item.recorded_at >= recent_cutoff]
    if not sample_records:
        sample_records = sorted_records

    per_day_bytes: dict[datetime.date, int] = defaultdict(int)
    for item in sample_records:
        per_day_bytes[item.recorded_at.date()] += item.estimated_bytes

    observed_days = max(1, (max(per_day_bytes) - min(per_day_bytes)).days + 1)
    average_daily_bytes = sum(per_day_bytes.values()) / observed_days

    return HistoryStorageCategoryRead(
        entry_count=len(sorted_records),
        current_estimated_bytes=current_estimated_bytes,
        average_daily_bytes=average_daily_bytes,
        projected_bytes_30d=average_daily_bytes * 30,
        projected_bytes_for_configured_days=average_daily_bytes * days_limit if days_limit > 0 else None,
        days_limit=days_limit,
        storage_limit_bytes=storage_limit_bytes,
        oldest_recorded_at=oldest_recorded_at,
        newest_recorded_at=newest_recorded_at,
    )


def _media_file_history_records(db: Session) -> list[HistoryStorageRecord]:
    rows = db.execute(
        select(
            MediaFileHistory.captured_at,
            MediaFileHistory.relative_path,
            MediaFileHistory.filename,
            MediaFileHistory.snapshot_hash,
            MediaFileHistory.snapshot,
        )
    ).all()
    return [
        HistoryStorageRecord(
            recorded_at=captured_at,
            estimated_bytes=(
                _text_length(relative_path)
                + _text_length(filename)
                + _text_length(snapshot_hash)
                + _json_length(snapshot)
            ),
        )
        for captured_at, relative_path, filename, snapshot_hash, snapshot in rows
        if captured_at is not None
    ]


def _library_history_records(db: Session) -> list[HistoryStorageRecord]:
    rows = db.execute(select(LibraryHistory.captured_at, LibraryHistory.snapshot)).all()
    return [
        HistoryStorageRecord(recorded_at=captured_at, estimated_bytes=_json_length(snapshot))
        for captured_at, snapshot in rows
        if captured_at is not None
    ]


def _scan_history_records(db: Session) -> list[HistoryStorageRecord]:
    rows = db.execute(
        select(
            ScanJob.finished_at,
            ScanJob.job_type,
            ScanJob.status,
            ScanJob.trigger_source,
            ScanJob.trigger_details,
            ScanJob.scan_summary,
        ).where(ScanJob.status.in_(TERMINAL_SCAN_JOB_STATUSES))
    ).all()
    return [
        HistoryStorageRecord(
            recorded_at=finished_at,
            estimated_bytes=(
                _text_length(job_type)
                + _text_length(status.value if hasattr(status, "value") else str(status))
                + _text_length(trigger_source.value if hasattr(trigger_source, "value") else str(trigger_source))
                + _json_length(trigger_details)
                + _json_length(scan_summary)
            ),
        )
        for finished_at, job_type, status, trigger_source, trigger_details, scan_summary in rows
        if finished_at is not None
    ]


def _database_file_bytes(database_path: Path) -> int:
    if not database_path.exists():
        return 0
    return database_path.stat().st_size


def _reclaimable_file_bytes(db: Session) -> int:
    page_size = int(db.execute(text("PRAGMA page_size")).scalar() or 0)
    freelist_count = int(db.execute(text("PRAGMA freelist_count")).scalar() or 0)
    return page_size * freelist_count


def _history_storage_cache_key(settings: Settings, db: Session | None = None) -> str:
    if db is not None:
        bind = db.get_bind()
        url = getattr(bind, "url", None)
        if (
            url is not None
            and str(url).startswith("sqlite")
            and getattr(url, "database", None) in {None, ":memory:"}
        ):
            return f"{settings.database_path.resolve()}::{id(bind)}"
    return str(settings.database_path.resolve())


def _apply_retention_settings(payload: HistoryStorageRead, app_settings) -> HistoryStorageRead:
    next_payload = payload.model_copy(deep=True)
    for bucket_name in ("file_history", "library_history", "scan_history"):
        category = getattr(next_payload.categories, bucket_name)
        days_limit = _days_limit_for_bucket(app_settings, bucket_name)
        category.days_limit = days_limit
        category.storage_limit_bytes = _storage_limit_bytes_for_bucket(app_settings, bucket_name)
        category.projected_bytes_for_configured_days = (
            category.average_daily_bytes * days_limit if days_limit > 0 else None
        )
    return next_payload


def _build_history_storage(
    db: Session,
    resolved_settings: Settings,
    app_settings,
) -> HistoryStorageRead:
    categories = HistoryStorageCategoriesRead(
        file_history=_forecast_from_records(
            _media_file_history_records(db),
            days_limit=_days_limit_for_bucket(app_settings, "file_history"),
            storage_limit_bytes=_storage_limit_bytes_for_bucket(app_settings, "file_history"),
        ),
        library_history=_forecast_from_records(
            _library_history_records(db),
            days_limit=_days_limit_for_bucket(app_settings, "library_history"),
            storage_limit_bytes=_storage_limit_bytes_for_bucket(app_settings, "library_history"),
        ),
        scan_history=_forecast_from_records(
            _scan_history_records(db),
            days_limit=_days_limit_for_bucket(app_settings, "scan_history"),
            storage_limit_bytes=_storage_limit_bytes_for_bucket(app_settings, "scan_history"),
        ),
    )
    return HistoryStorageRead(
        generated_at=utc_now(),
        database_file_bytes=_database_file_bytes(resolved_settings.database_path),
        reclaimable_file_bytes=_reclaimable_file_bytes(db),
        categories=categories,
    )


def get_history_storage(db: Session, settings: Settings | None = None) -> HistoryStorageRead:
    resolved_settings = settings or get_settings()
    app_settings = get_app_settings(db, resolved_settings)
    payload = _build_history_storage(db, resolved_settings, app_settings)
    history_storage_cache.set(_history_storage_cache_key(resolved_settings, db), payload)
    return payload


def get_cached_history_storage(db: Session, settings: Settings | None = None) -> HistoryStorageRead:
    resolved_settings = settings or get_settings()
    app_settings = get_app_settings(db, resolved_settings)
    cache_key = _history_storage_cache_key(resolved_settings, db)
    cached = history_storage_cache.get(cache_key, app_settings)
    if cached is not None:
        return cached

    payload = _build_history_storage(db, resolved_settings, app_settings)
    history_storage_cache.set(cache_key, payload)
    return payload
