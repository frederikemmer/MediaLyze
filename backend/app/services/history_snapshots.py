from __future__ import annotations

import hashlib
import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.entities import (
    Library,
    LibraryHistory,
    MediaFile,
    MediaFileHistory,
    MediaFileHistoryCaptureReason,
)
from backend.app.services.library_service import get_library_summary
from backend.app.services.media_service import serialize_media_file_detail
from backend.app.utils.time import utc_now


def _canonicalize_snapshot(snapshot: dict) -> tuple[dict, str]:
    payload = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return snapshot, hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_media_file_history_snapshot(media_file: MediaFile, resolution_categories) -> tuple[dict, str]:
    snapshot = serialize_media_file_detail(media_file, resolution_categories).model_dump(mode="json")
    return _canonicalize_snapshot(snapshot)


def create_media_file_history_entry_if_changed(
    db: Session,
    media_file: MediaFile,
    capture_reason: MediaFileHistoryCaptureReason,
    resolution_categories,
    *,
    captured_at: datetime | None = None,
) -> bool:
    snapshot, snapshot_hash = build_media_file_history_snapshot(media_file, resolution_categories)
    latest_hash = db.scalar(
        select(MediaFileHistory.snapshot_hash)
        .where(
            MediaFileHistory.library_id == media_file.library_id,
            MediaFileHistory.relative_path == media_file.relative_path,
        )
        .order_by(MediaFileHistory.captured_at.desc(), MediaFileHistory.id.desc())
        .limit(1)
    )
    if latest_hash == snapshot_hash:
        return False

    db.add(
        MediaFileHistory(
            library_id=media_file.library_id,
            media_file_id=media_file.id,
            relative_path=media_file.relative_path,
            filename=media_file.filename,
            captured_at=captured_at or utc_now(),
            capture_reason=capture_reason,
            snapshot_hash=snapshot_hash,
            snapshot=snapshot,
        )
    )
    return True


def build_library_history_snapshot(
    db: Session,
    library: Library,
    *,
    scan_summary: dict | None = None,
) -> dict:
    summary = get_library_summary(db, library.id)
    aggregate = summary.model_dump(mode="json") if summary is not None else {}
    scan_summary = scan_summary or {}
    changes = scan_summary.get("changes") or {}
    return {
        "file_count": aggregate.get("file_count", 0),
        "total_size_bytes": aggregate.get("total_size_bytes", 0),
        "total_duration_seconds": aggregate.get("total_duration_seconds", 0.0),
        "ready_files": aggregate.get("ready_files", 0),
        "pending_files": aggregate.get("pending_files", 0),
        "last_scan_at": aggregate.get("last_scan_at"),
        "scan_mode": library.scan_mode.value,
        "duplicate_detection_mode": library.duplicate_detection_mode.value,
        "show_on_dashboard": library.show_on_dashboard,
        "scan_delta": {
            "discovered_files": ((scan_summary.get("discovery") or {}).get("discovered_files") or 0),
            "new_files": ((changes.get("new_files") or {}).get("count") or 0),
            "modified_files": ((changes.get("modified_files") or {}).get("count") or 0),
            "deleted_files": ((changes.get("deleted_files") or {}).get("count") or 0),
        },
    }


def upsert_library_history_snapshot(
    db: Session,
    library: Library,
    *,
    source_scan_job_id: int | None = None,
    scan_summary: dict | None = None,
    captured_at: datetime | None = None,
) -> LibraryHistory:
    captured_at_value = captured_at or utc_now()
    snapshot_day = captured_at_value.date().isoformat()
    snapshot = build_library_history_snapshot(db, library, scan_summary=scan_summary)
    history_row = db.scalar(
        select(LibraryHistory).where(
            LibraryHistory.library_id == library.id,
            LibraryHistory.snapshot_day == snapshot_day,
        )
    )
    if history_row is None:
        history_row = LibraryHistory(
            library_id=library.id,
            snapshot_day=snapshot_day,
        )
        db.add(history_row)
    history_row.captured_at = captured_at_value
    history_row.source_scan_job_id = source_scan_job_id
    history_row.snapshot = snapshot
    return history_row
