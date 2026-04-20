from __future__ import annotations

from collections import OrderedDict

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.entities import Library, LibraryHistory
from backend.app.schemas.library_history import (
    DashboardHistoryResponse,
    LibraryHistoryNumericSummaryRead,
    LibraryHistoryPointRead,
    LibraryHistoryResolutionCategoryRead,
    LibraryHistoryResponse,
    LibraryHistoryTrendMetricsRead,
)
from backend.app.schemas.media import NumericDistribution, NumericDistributionBin
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


def _coerce_counts(value) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    counts: dict[str, int] = {}
    for raw_key, raw_count in value.items():
        if not isinstance(raw_key, str) or not raw_key:
            continue
        count = _coerce_int(raw_count)
        if count is None:
            continue
        counts[raw_key] = count
    return counts


def _coerce_totals(value) -> dict[str, int | float]:
    if not isinstance(value, dict):
        return {}
    totals: dict[str, int | float] = {}
    for raw_key, raw_value in value.items():
        if not isinstance(raw_key, str) or not raw_key or isinstance(raw_value, bool):
            continue
        if isinstance(raw_value, int):
            totals[raw_key] = raw_value
        elif isinstance(raw_value, float):
            totals[raw_key] = raw_value
    return totals


def _coerce_numeric_summary(value) -> LibraryHistoryNumericSummaryRead | None:
    if not isinstance(value, dict):
        return None
    count = _coerce_int(value.get("count"))
    if count is None:
        return None
    total = _coerce_float(value.get("sum")) or 0.0
    return LibraryHistoryNumericSummaryRead(
        count=count,
        sum=total,
        average=_coerce_float(value.get("average")),
        minimum=_coerce_float(value.get("minimum")),
        maximum=_coerce_float(value.get("maximum")),
    )


def _coerce_numeric_summaries(value) -> dict[str, LibraryHistoryNumericSummaryRead]:
    if not isinstance(value, dict):
        return {}
    summaries: dict[str, LibraryHistoryNumericSummaryRead] = {}
    for raw_metric_id, raw_summary in value.items():
        if not isinstance(raw_metric_id, str) or not raw_metric_id:
            continue
        summary = _coerce_numeric_summary(raw_summary)
        if summary is not None:
            summaries[raw_metric_id] = summary
    return summaries


def _legacy_summary(value: float | None, weight: int) -> LibraryHistoryNumericSummaryRead | None:
    if value is None or weight <= 0:
        return None
    total = value * weight
    return LibraryHistoryNumericSummaryRead(
        count=weight,
        sum=total,
        average=value,
        minimum=value,
        maximum=value,
    )


def _coerce_category_counts(value) -> dict[str, dict[str, int]]:
    if not isinstance(value, dict):
        return {}
    categories: dict[str, dict[str, int]] = {}
    for raw_metric_id, raw_counts in value.items():
        if not isinstance(raw_metric_id, str) or not raw_metric_id:
            continue
        counts = _coerce_counts(raw_counts)
        if counts:
            categories[raw_metric_id] = counts
    return categories


def _coerce_numeric_distribution(value) -> NumericDistribution | None:
    if not isinstance(value, dict):
        return None
    total = _coerce_int(value.get("total"))
    raw_bins = value.get("bins")
    if total is None or not isinstance(raw_bins, list):
        return None
    bins: list[NumericDistributionBin] = []
    for raw_bin in raw_bins:
        if not isinstance(raw_bin, dict):
            continue
        count = _coerce_int(raw_bin.get("count"))
        if count is None:
            continue
        bins.append(
            NumericDistributionBin(
                lower=_coerce_float(raw_bin.get("lower")),
                upper=_coerce_float(raw_bin.get("upper")),
                count=count,
                percentage=_coerce_float(raw_bin.get("percentage")) or 0.0,
            )
        )
    return NumericDistribution(total=total, bins=bins)


def _coerce_numeric_distributions(value) -> dict[str, NumericDistribution]:
    if not isinstance(value, dict):
        return {}
    distributions: dict[str, NumericDistribution] = {}
    for raw_metric_id, raw_distribution in value.items():
        if not isinstance(raw_metric_id, str) or not raw_metric_id:
            continue
        distribution = _coerce_numeric_distribution(raw_distribution)
        if distribution is not None:
            distributions[raw_metric_id] = distribution
    return distributions


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

    average_bitrate = _coerce_float(raw_metrics.get("average_bitrate"))
    average_audio_bitrate = _coerce_float(raw_metrics.get("average_audio_bitrate"))
    average_duration_seconds = _coerce_float(raw_metrics.get("average_duration_seconds"))
    average_quality_score = _coerce_float(raw_metrics.get("average_quality_score"))

    numeric_summaries = _coerce_numeric_summaries(raw_metrics.get("numeric_summaries"))
    for metric_id, average_value in (
        ("bitrate", average_bitrate),
        ("audio_bitrate", average_audio_bitrate),
        ("duration", average_duration_seconds),
        ("quality_score", average_quality_score),
    ):
        if metric_id not in numeric_summaries:
            legacy_summary = _legacy_summary(average_value, total_files)
            if legacy_summary is not None:
                numeric_summaries[metric_id] = legacy_summary

    category_counts = _coerce_category_counts(raw_metrics.get("category_counts"))
    category_counts.setdefault("resolution", dict(resolution_counts))

    return LibraryHistoryTrendMetricsRead(
        schema_version=_coerce_int(raw_metrics.get("schema_version"), minimum=1) or 1,
        total_files=total_files,
        resolution_counts=resolution_counts,
        average_bitrate=average_bitrate,
        average_audio_bitrate=average_audio_bitrate,
        average_duration_seconds=average_duration_seconds,
        average_quality_score=average_quality_score,
        totals=_coerce_totals(raw_metrics.get("totals")),
        numeric_summaries=numeric_summaries,
        category_counts=category_counts,
        numeric_distributions=_coerce_numeric_distributions(raw_metrics.get("numeric_distributions")),
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


def _add_numeric_summary(
    target: dict[str, dict],
    metric_id: str,
    summary: LibraryHistoryNumericSummaryRead,
) -> None:
    aggregate = target.setdefault(
        metric_id,
        {
            "count": 0,
            "sum": 0.0,
            "minimum": None,
            "maximum": None,
        },
    )
    aggregate["count"] += summary.count
    aggregate["sum"] += summary.sum
    if summary.minimum is not None:
        aggregate["minimum"] = (
            summary.minimum if aggregate["minimum"] is None else min(aggregate["minimum"], summary.minimum)
        )
    if summary.maximum is not None:
        aggregate["maximum"] = (
            summary.maximum if aggregate["maximum"] is None else max(aggregate["maximum"], summary.maximum)
        )


def _finalize_numeric_summaries(values: dict[str, dict]) -> dict[str, LibraryHistoryNumericSummaryRead]:
    summaries: dict[str, LibraryHistoryNumericSummaryRead] = {}
    for metric_id, aggregate in values.items():
        count = int(aggregate.get("count") or 0)
        total = float(aggregate.get("sum") or 0.0)
        summaries[metric_id] = LibraryHistoryNumericSummaryRead(
            count=count,
            sum=total,
            average=total / count if count > 0 else None,
            minimum=aggregate.get("minimum"),
            maximum=aggregate.get("maximum"),
        )
    return summaries


def _add_numeric_distribution(
    target: dict[str, dict[tuple[float | None, float | None], int]],
    metric_id: str,
    distribution: NumericDistribution,
) -> None:
    bins = target.setdefault(metric_id, {})
    for bin_item in distribution.bins:
        key = (bin_item.lower, bin_item.upper)
        bins[key] = bins.get(key, 0) + bin_item.count


def _finalize_numeric_distributions(
    values: dict[str, dict[tuple[float | None, float | None], int]],
) -> dict[str, NumericDistribution]:
    distributions: dict[str, NumericDistribution] = {}
    for metric_id, bins in values.items():
        total = sum(bins.values())
        distributions[metric_id] = NumericDistribution(
            total=total,
            bins=[
                NumericDistributionBin(
                    lower=lower,
                    upper=upper,
                    count=count,
                    percentage=(count / total) * 100.0 if total > 0 else 0.0,
                )
                for (lower, upper), count in sorted(
                    bins.items(),
                    key=lambda item: (
                        float("-inf") if item[0][0] is None else item[0][0],
                        float("inf") if item[0][1] is None else item[0][1],
                    ),
                )
            ],
        )
    return distributions


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
                "totals": {},
                "numeric_summaries": {},
                "category_counts": {},
                "numeric_distributions": {},
            },
        )

        aggregate["total_files"] += metrics.total_files
        for category_id, count in metrics.resolution_counts.items():
            aggregate["resolution_counts"][category_id] = aggregate["resolution_counts"].get(category_id, 0) + count
        for total_key, total_value in metrics.totals.items():
            aggregate["totals"][total_key] = aggregate["totals"].get(total_key, 0) + total_value
        for metric_id, summary in metrics.numeric_summaries.items():
            _add_numeric_summary(aggregate["numeric_summaries"], metric_id, summary)
        for metric_id, counts in metrics.category_counts.items():
            aggregate_counts = aggregate["category_counts"].setdefault(metric_id, {})
            for value_key, count in counts.items():
                aggregate_counts[value_key] = aggregate_counts.get(value_key, 0) + count
        for metric_id, distribution in metrics.numeric_distributions.items():
            _add_numeric_distribution(aggregate["numeric_distributions"], metric_id, distribution)

    points: list[LibraryHistoryPointRead] = []
    for snapshot_day, metrics in points_by_day.items():
        numeric_summaries = _finalize_numeric_summaries(metrics["numeric_summaries"])
        numeric_distributions = _finalize_numeric_distributions(metrics["numeric_distributions"])
        points.append(
            LibraryHistoryPointRead(
                snapshot_day=snapshot_day,
                trend_metrics=LibraryHistoryTrendMetricsRead(
                    schema_version=2,
                    total_files=metrics["total_files"],
                    resolution_counts=metrics["resolution_counts"],
                    average_bitrate=(numeric_summaries.get("bitrate") or LibraryHistoryNumericSummaryRead()).average,
                    average_audio_bitrate=(numeric_summaries.get("audio_bitrate") or LibraryHistoryNumericSummaryRead()).average,
                    average_duration_seconds=(numeric_summaries.get("duration") or LibraryHistoryNumericSummaryRead()).average,
                    average_quality_score=(numeric_summaries.get("quality_score") or LibraryHistoryNumericSummaryRead()).average,
                    totals=metrics["totals"],
                    numeric_summaries=numeric_summaries,
                    category_counts=metrics["category_counts"],
                    numeric_distributions=numeric_distributions,
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
