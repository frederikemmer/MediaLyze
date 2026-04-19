from __future__ import annotations

from collections import OrderedDict

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.entities import Library, LibraryHistory
from backend.app.schemas.library_history import (
    LibraryHistoryPointRead,
    LibraryHistoryResolutionCategoryRead,
    LibraryHistoryResponse,
    LibraryHistoryTrendMetricsRead,
)
from backend.app.services.app_settings import get_app_settings
from backend.app.utils.time import utc_now


def _coerce_float(value) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _coerce_int(value, *, minimum: int = 0) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return max(minimum, int(value))
    return None


def get_library_history(db: Session, library_id: int) -> LibraryHistoryResponse | None:
    library = db.get(Library, library_id)
    if library is None:
        return None

    current_resolution_categories = get_app_settings(db).resolution_categories
    resolution_categories: OrderedDict[str, str] = OrderedDict(
        (category.id, category.label) for category in current_resolution_categories
    )
    points: list[LibraryHistoryPointRead] = []

    rows = db.scalars(
        select(LibraryHistory)
        .where(LibraryHistory.library_id == library_id)
        .order_by(LibraryHistory.snapshot_day.asc(), LibraryHistory.id.asc())
    ).all()
    for row in rows:
        snapshot = row.snapshot if isinstance(row.snapshot, dict) else {}
        raw_metrics = snapshot.get("trend_metrics")
        if not isinstance(raw_metrics, dict):
            continue

        raw_resolution_counts = raw_metrics.get("resolution_counts")
        resolution_counts: dict[str, int] = {}
        if isinstance(raw_resolution_counts, dict):
            for raw_category_id, raw_count in raw_resolution_counts.items():
                if not isinstance(raw_category_id, str) or not raw_category_id:
                    continue
                count = _coerce_int(raw_count)
                if count is None:
                    continue
                resolution_counts[raw_category_id] = count
                resolution_categories.setdefault(raw_category_id, raw_category_id)

        total_files = _coerce_int(raw_metrics.get("total_files"))
        if total_files is None:
            total_files = 0

        points.append(
            LibraryHistoryPointRead(
                snapshot_day=row.snapshot_day,
                trend_metrics=LibraryHistoryTrendMetricsRead(
                    total_files=total_files,
                    resolution_counts=resolution_counts,
                    average_bitrate=_coerce_float(raw_metrics.get("average_bitrate")),
                    average_audio_bitrate=_coerce_float(raw_metrics.get("average_audio_bitrate")),
                    average_duration_seconds=_coerce_float(raw_metrics.get("average_duration_seconds")),
                    average_quality_score=_coerce_float(raw_metrics.get("average_quality_score")),
                ),
            )
        )

    return LibraryHistoryResponse(
        generated_at=utc_now(),
        library_id=library_id,
        oldest_snapshot_day=points[0].snapshot_day if points else None,
        newest_snapshot_day=points[-1].snapshot_day if points else None,
        resolution_categories=[
            LibraryHistoryResolutionCategoryRead(id=category_id, label=label)
            for category_id, label in resolution_categories.items()
        ],
        points=points,
    )
