from __future__ import annotations

from collections import OrderedDict

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.entities import Library, LibraryHistory
from backend.app.schemas.library_history import (
    DashboardHistoryResponse,
    LibraryHistoryPointRead,
    LibraryHistoryResolutionCategoryRead,
    LibraryHistoryResponse,
    LibraryHistoryTrendMetricsRead,
)
from backend.app.services.app_settings import get_app_settings
from backend.app.services.stats_cache import stats_cache
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


def _resolution_categories(db: Session) -> OrderedDict[str, str]:
    current_resolution_categories = get_app_settings(db).resolution_categories
    return OrderedDict((category.id, category.label) for category in current_resolution_categories)


def _parse_history_metrics(
    snapshot: dict,
    *,
    resolution_categories: OrderedDict[str, str],
) -> LibraryHistoryTrendMetricsRead | None:
    raw_metrics = snapshot.get("trend_metrics")
    if not isinstance(raw_metrics, dict):
        return None

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

    return LibraryHistoryTrendMetricsRead(
        total_files=total_files,
        resolution_counts=resolution_counts,
        average_bitrate=_coerce_float(raw_metrics.get("average_bitrate")),
        average_audio_bitrate=_coerce_float(raw_metrics.get("average_audio_bitrate")),
        average_duration_seconds=_coerce_float(raw_metrics.get("average_duration_seconds")),
        average_quality_score=_coerce_float(raw_metrics.get("average_quality_score")),
    )


def get_library_history(db: Session, library_id: int) -> LibraryHistoryResponse | None:
    library = db.get(Library, library_id)
    if library is None:
        return None

    resolution_categories = _resolution_categories(db)
    points: list[LibraryHistoryPointRead] = []

    rows = db.scalars(
        select(LibraryHistory)
        .where(LibraryHistory.library_id == library_id)
        .order_by(LibraryHistory.snapshot_day.asc(), LibraryHistory.id.asc())
    ).all()
    for row in rows:
        snapshot = row.snapshot if isinstance(row.snapshot, dict) else {}
        metrics = _parse_history_metrics(snapshot, resolution_categories=resolution_categories)
        if metrics is None:
            continue

        points.append(
            LibraryHistoryPointRead(
                snapshot_day=row.snapshot_day,
                trend_metrics=metrics,
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


def _weighted_average(total: float, weight: int) -> float | None:
    if weight <= 0:
        return None
    return total / weight


def get_dashboard_history(db: Session) -> DashboardHistoryResponse:
    cache_key = str(id(db.get_bind()))
    cached = stats_cache.get_dashboard_history(cache_key)
    if cached is not None:
        return cached

    resolution_categories = _resolution_categories(db)
    visible_library_ids = db.scalars(
        select(Library.id)
        .where(Library.show_on_dashboard.is_(True))
        .order_by(Library.id.asc())
    ).all()
    points_by_day: OrderedDict[str, dict] = OrderedDict()

    rows = db.scalars(
        select(LibraryHistory)
        .join(Library, Library.id == LibraryHistory.library_id)
        .where(Library.show_on_dashboard.is_(True))
        .order_by(LibraryHistory.snapshot_day.asc(), LibraryHistory.library_id.asc(), LibraryHistory.id.asc())
    ).all()
    for row in rows:
        snapshot = row.snapshot if isinstance(row.snapshot, dict) else {}
        metrics = _parse_history_metrics(snapshot, resolution_categories=resolution_categories)
        if metrics is None:
            continue

        aggregate = points_by_day.setdefault(
            row.snapshot_day,
            {
                "total_files": 0,
                "resolution_counts": {},
                "weighted_totals": {
                    "average_bitrate": {"total": 0.0, "weight": 0},
                    "average_audio_bitrate": {"total": 0.0, "weight": 0},
                    "average_duration_seconds": {"total": 0.0, "weight": 0},
                    "average_quality_score": {"total": 0.0, "weight": 0},
                },
            },
        )

        aggregate["total_files"] += metrics.total_files
        for category_id, count in metrics.resolution_counts.items():
            aggregate["resolution_counts"][category_id] = aggregate["resolution_counts"].get(category_id, 0) + count

        weighted_totals = aggregate["weighted_totals"]
        weight = metrics.total_files
        if weight > 0:
            for field_name in (
                "average_bitrate",
                "average_audio_bitrate",
                "average_duration_seconds",
                "average_quality_score",
            ):
                value = getattr(metrics, field_name)
                if value is None:
                    continue
                weighted_totals[field_name]["total"] += value * weight
                weighted_totals[field_name]["weight"] += weight

    points: list[LibraryHistoryPointRead] = []
    for snapshot_day, metrics in points_by_day.items():
        weighted_totals = metrics["weighted_totals"]
        points.append(
            LibraryHistoryPointRead(
                snapshot_day=snapshot_day,
                trend_metrics=LibraryHistoryTrendMetricsRead(
                    total_files=metrics["total_files"],
                    resolution_counts=metrics["resolution_counts"],
                    average_bitrate=_weighted_average(
                        weighted_totals.get("average_bitrate", {}).get("total", 0.0),
                        weighted_totals.get("average_bitrate", {}).get("weight", 0),
                    ),
                    average_audio_bitrate=_weighted_average(
                        weighted_totals.get("average_audio_bitrate", {}).get("total", 0.0),
                        weighted_totals.get("average_audio_bitrate", {}).get("weight", 0),
                    ),
                    average_duration_seconds=_weighted_average(
                        weighted_totals.get("average_duration_seconds", {}).get("total", 0.0),
                        weighted_totals.get("average_duration_seconds", {}).get("weight", 0),
                    ),
                    average_quality_score=_weighted_average(
                        weighted_totals.get("average_quality_score", {}).get("total", 0.0),
                        weighted_totals.get("average_quality_score", {}).get("weight", 0),
                    ),
                ),
            )
        )

    payload = DashboardHistoryResponse(
        generated_at=utc_now(),
        oldest_snapshot_day=points[0].snapshot_day if points else None,
        newest_snapshot_day=points[-1].snapshot_day if points else None,
        resolution_categories=[
            LibraryHistoryResolutionCategoryRead(id=category_id, label=label)
            for category_id, label in resolution_categories.items()
        ],
        points=points,
        visible_library_ids=visible_library_ids,
    )
    stats_cache.set_dashboard_history(cache_key, payload)
    return payload
