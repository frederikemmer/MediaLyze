from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Float, and_, case, cast, func, literal, select
from sqlalchemy.orm import Session

from backend.app.models.entities import AudioStream, Library, MediaFile, MediaFormat
from backend.app.schemas.media import (
    NumericDistribution,
    NumericDistributionBin,
    NumericDistributionMetricId,
)


@dataclass(frozen=True)
class NumericDistributionMetricConfig:
    metric_id: NumericDistributionMetricId
    bins: tuple[tuple[float | None, float | None], ...]


NUMERIC_DISTRIBUTION_CONFIGS: tuple[NumericDistributionMetricConfig, ...] = (
    NumericDistributionMetricConfig(
        metric_id="quality_score",
        bins=tuple((float(score), float(score + 1)) for score in range(1, 11)),
    ),
    NumericDistributionMetricConfig(
        metric_id="duration",
        bins=(
            (0.0, 1800.0),
            (1800.0, 3600.0),
            (3600.0, 5400.0),
            (5400.0, 7200.0),
            (7200.0, 9000.0),
            (9000.0, 10800.0),
            (10800.0, None),
        ),
    ),
    NumericDistributionMetricConfig(
        metric_id="size",
        bins=(
            (0.0, 500_000_000.0),
            (500_000_000.0, 1_000_000_000.0),
            (1_000_000_000.0, 2_000_000_000.0),
            (2_000_000_000.0, 4_000_000_000.0),
            (4_000_000_000.0, 8_000_000_000.0),
            (8_000_000_000.0, 16_000_000_000.0),
            (16_000_000_000.0, None),
        ),
    ),
    NumericDistributionMetricConfig(
        metric_id="bitrate",
        bins=(
            (0.0, 2_000_000.0),
            (2_000_000.0, 4_000_000.0),
            (4_000_000.0, 8_000_000.0),
            (8_000_000.0, 12_000_000.0),
            (12_000_000.0, 20_000_000.0),
            (20_000_000.0, 40_000_000.0),
            (40_000_000.0, None),
        ),
    ),
    NumericDistributionMetricConfig(
        metric_id="audio_bitrate",
        bins=(
            (0.0, 128_000.0),
            (128_000.0, 256_000.0),
            (256_000.0, 512_000.0),
            (512_000.0, 1_024_000.0),
            (1_024_000.0, 2_048_000.0),
            (2_048_000.0, None),
        ),
    ),
)


def build_audio_bitrate_subquery(name: str = "audio_bitrate_totals"):
    return (
        select(
            AudioStream.media_file_id.label("media_file_id"),
            func.sum(func.coalesce(AudioStream.bit_rate, 0)).label("total_audio_bitrate"),
        )
        .group_by(AudioStream.media_file_id)
        .subquery(name)
    )


def bitrate_value_expression():
    return case(
        (
            MediaFormat.bit_rate.is_not(None),
            cast(MediaFormat.bit_rate, Float),
        ),
        (
            and_(MediaFormat.duration.is_not(None), MediaFormat.duration > 0, MediaFile.size_bytes > 0),
            cast(MediaFile.size_bytes, Float) * 8.0 / MediaFormat.duration,
        ),
        else_=None,
    )


def audio_bitrate_value_expression(audio_bitrate_totals):
    return case(
        (audio_bitrate_totals.c.total_audio_bitrate > 0, cast(audio_bitrate_totals.c.total_audio_bitrate, Float)),
        else_=None,
    )


def _apply_library_scope(query, *, library_id: int | None, dashboard_only: bool):
    if library_id is not None:
        return query.where(MediaFile.library_id == library_id)
    if dashboard_only:
        return query.join(Library, Library.id == MediaFile.library_id).where(Library.show_on_dashboard.is_(True))
    return query


def _metric_value_subquery(metric_id: NumericDistributionMetricId, library_id: int | None, dashboard_only: bool):
    if metric_id == "quality_score":
        query = (
            select(
                MediaFile.id.label("media_file_id"),
                cast(MediaFile.quality_score, Float).label("value"),
            )
            .select_from(MediaFile)
            .where(MediaFile.quality_score >= 1)
        )
        query = _apply_library_scope(query, library_id=library_id, dashboard_only=dashboard_only)
        return query.subquery(f"{metric_id}_distribution_values")

    if metric_id == "duration":
        query = (
            select(
                MediaFile.id.label("media_file_id"),
                cast(MediaFormat.duration, Float).label("value"),
            )
            .select_from(MediaFile)
            .join(MediaFormat, MediaFormat.media_file_id == MediaFile.id)
            .where(MediaFormat.duration.is_not(None), MediaFormat.duration > 0)
        )
        query = _apply_library_scope(query, library_id=library_id, dashboard_only=dashboard_only)
        return query.subquery(f"{metric_id}_distribution_values")

    if metric_id == "size":
        query = (
            select(
                MediaFile.id.label("media_file_id"),
                cast(MediaFile.size_bytes, Float).label("value"),
            )
            .select_from(MediaFile)
            .where(MediaFile.size_bytes >= 0)
        )
        query = _apply_library_scope(query, library_id=library_id, dashboard_only=dashboard_only)
        return query.subquery(f"{metric_id}_distribution_values")

    if metric_id == "bitrate":
        value_expression = bitrate_value_expression()
        query = (
            select(
                MediaFile.id.label("media_file_id"),
                cast(value_expression, Float).label("value"),
            )
            .select_from(MediaFile)
            .outerjoin(MediaFormat, MediaFormat.media_file_id == MediaFile.id)
            .where(value_expression.is_not(None), value_expression > 0)
        )
        query = _apply_library_scope(query, library_id=library_id, dashboard_only=dashboard_only)
        return query.subquery(f"{metric_id}_distribution_values")

    audio_bitrate_totals = build_audio_bitrate_subquery(f"{metric_id}_distribution_audio_bitrate_totals")
    audio_bitrate_expression = audio_bitrate_value_expression(audio_bitrate_totals)
    query = (
        select(
            MediaFile.id.label("media_file_id"),
            cast(audio_bitrate_expression, Float).label("value"),
        )
        .select_from(MediaFile)
        .outerjoin(audio_bitrate_totals, audio_bitrate_totals.c.media_file_id == MediaFile.id)
        .where(audio_bitrate_expression.is_not(None))
    )
    query = _apply_library_scope(query, library_id=library_id, dashboard_only=dashboard_only)
    return query.subquery(f"{metric_id}_distribution_values")


def _bin_clause(value_expression, lower: float | None, upper: float | None):
    clauses = []
    if lower is not None:
        clauses.append(value_expression >= lower)
    if upper is not None:
        clauses.append(value_expression < upper)
    if not clauses:
        return literal(True)
    return and_(*clauses)


def _build_distribution(
    db: Session,
    *,
    metric_id: NumericDistributionMetricId,
    library_id: int | None,
    dashboard_only: bool,
) -> NumericDistribution:
    config = next(item for item in NUMERIC_DISTRIBUTION_CONFIGS if item.metric_id == metric_id)
    values = _metric_value_subquery(metric_id, library_id, dashboard_only)
    total = db.scalar(select(func.count()).select_from(values)) or 0
    if total <= 0:
        return NumericDistribution(
            total=0,
            bins=[
                NumericDistributionBin(lower=lower, upper=upper, count=0, percentage=0.0)
                for lower, upper in config.bins
            ],
        )

    bin_index_expression = case(
        *[
            (_bin_clause(values.c.value, lower, upper), index)
            for index, (lower, upper) in enumerate(config.bins)
        ],
        else_=-1,
    )

    rows = db.execute(
        select(
            bin_index_expression.label("bin_index"),
            func.count().label("count"),
        )
        .select_from(values)
        .group_by(bin_index_expression)
    ).all()
    counts = {
        int(bin_index): int(count)
        for bin_index, count in rows
        if int(bin_index) >= 0
    }

    return NumericDistribution(
        total=int(total),
        bins=[
            NumericDistributionBin(
                lower=lower,
                upper=upper,
                count=counts.get(index, 0),
                percentage=(counts.get(index, 0) / total) * 100.0,
            )
            for index, (lower, upper) in enumerate(config.bins)
        ],
    )


def build_numeric_distributions(
    db: Session,
    *,
    library_id: int | None = None,
    dashboard_only: bool = False,
    metric_ids: set[NumericDistributionMetricId] | None = None,
) -> dict[NumericDistributionMetricId, NumericDistribution]:
    return {
        config.metric_id: _build_distribution(
            db,
            metric_id=config.metric_id,
            library_id=library_id,
            dashboard_only=dashboard_only,
        )
        for config in NUMERIC_DISTRIBUTION_CONFIGS
        if metric_ids is None or config.metric_id in metric_ids
    }
