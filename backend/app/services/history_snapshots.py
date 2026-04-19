from __future__ import annotations

import hashlib
import json
from datetime import datetime

from sqlalchemy import Float, and_, case, cast, func, select
from sqlalchemy.orm import Session

from backend.app.models.entities import (
    Library,
    LibraryHistory,
    MediaFile,
    MediaFileHistory,
    MediaFileHistoryCaptureReason,
    MediaFormat,
    ScanStatus,
)
from backend.app.services.app_settings import get_app_settings
from backend.app.services.library_service import get_library_summary
from backend.app.services.media_service import serialize_media_file_detail
from backend.app.services.numeric_distributions import (
    audio_bitrate_value_expression,
    bitrate_value_expression,
    build_audio_bitrate_subquery,
)
from backend.app.services.video_queries import primary_video_streams_subquery
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


def _resolution_category_id_expression(primary_video_streams, resolution_categories):
    max_edge = func.max(primary_video_streams.c.width, primary_video_streams.c.height)
    min_edge = func.min(primary_video_streams.c.width, primary_video_streams.c.height)
    return case(
        *[
            (
                and_(max_edge >= category.min_width, min_edge >= category.min_height),
                category.id,
            )
            for category in resolution_categories
        ],
        else_=resolution_categories[-1].id if resolution_categories else None,
    )


def _build_library_trend_metrics_snapshot(db: Session, library_id: int) -> dict:
    resolution_categories = get_app_settings(db).resolution_categories
    ready_files_filter = (
        MediaFile.library_id == library_id,
        MediaFile.scan_status == ScanStatus.ready,
    )
    total_files = db.scalar(
        select(func.count(MediaFile.id)).where(*ready_files_filter)
    ) or 0

    resolution_counts = {category.id: 0 for category in resolution_categories}
    primary_video_streams = primary_video_streams_subquery("library_history_primary_video_streams")
    resolution_category_id = _resolution_category_id_expression(primary_video_streams, resolution_categories)
    resolution_rows = db.execute(
        select(
            resolution_category_id.label("resolution_category_id"),
            func.count(MediaFile.id).label("file_count"),
        )
        .select_from(MediaFile)
        .join(primary_video_streams, primary_video_streams.c.media_file_id == MediaFile.id)
        .where(*ready_files_filter)
        .group_by(resolution_category_id)
    ).all()
    for category_id, file_count in resolution_rows:
        if category_id:
            resolution_counts[str(category_id)] = int(file_count or 0)

    audio_bitrate_totals = build_audio_bitrate_subquery("library_history_audio_bitrate_totals")
    audio_bitrate_expression = audio_bitrate_value_expression(audio_bitrate_totals)
    averages = db.execute(
        select(
            func.avg(cast(bitrate_value_expression(), Float)).label("average_bitrate"),
            func.avg(cast(audio_bitrate_expression, Float)).label("average_audio_bitrate"),
            func.avg(cast(MediaFormat.duration, Float)).label("average_duration_seconds"),
            func.avg(cast(MediaFile.quality_score, Float)).label("average_quality_score"),
        )
        .select_from(MediaFile)
        .outerjoin(MediaFormat, MediaFormat.media_file_id == MediaFile.id)
        .outerjoin(audio_bitrate_totals, audio_bitrate_totals.c.media_file_id == MediaFile.id)
        .where(*ready_files_filter)
    ).one()

    return {
        "total_files": int(total_files),
        "resolution_counts": resolution_counts,
        "average_bitrate": float(averages.average_bitrate) if averages.average_bitrate is not None else None,
        "average_audio_bitrate": (
            float(averages.average_audio_bitrate) if averages.average_audio_bitrate is not None else None
        ),
        "average_duration_seconds": (
            float(averages.average_duration_seconds) if averages.average_duration_seconds is not None else None
        ),
        "average_quality_score": (
            float(averages.average_quality_score) if averages.average_quality_score is not None else None
        ),
    }


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
        "trend_metrics": _build_library_trend_metrics_snapshot(db, library.id),
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
