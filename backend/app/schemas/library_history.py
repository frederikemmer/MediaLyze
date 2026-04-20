from pydantic import BaseModel, Field

from backend.app.schemas._time import UtcDateTime
from backend.app.schemas.media import NumericDistribution


class LibraryHistoryResolutionCategoryRead(BaseModel):
    id: str
    label: str


class LibraryHistoryNumericSummaryRead(BaseModel):
    count: int = 0
    sum: float = 0.0
    average: float | None = None
    minimum: float | None = None
    maximum: float | None = None


class LibraryHistoryTrendMetricsRead(BaseModel):
    schema_version: int = 1
    total_files: int
    resolution_counts: dict[str, int] = Field(default_factory=dict)
    average_bitrate: float | None = None
    average_audio_bitrate: float | None = None
    average_duration_seconds: float | None = None
    average_quality_score: float | None = None
    totals: dict[str, int | float] = Field(default_factory=dict)
    numeric_summaries: dict[str, LibraryHistoryNumericSummaryRead] = Field(default_factory=dict)
    category_counts: dict[str, dict[str, int]] = Field(default_factory=dict)
    numeric_distributions: dict[str, NumericDistribution] = Field(default_factory=dict)


class LibraryHistoryPointRead(BaseModel):
    snapshot_day: str
    trend_metrics: LibraryHistoryTrendMetricsRead


class HistoryTimelineResponse(BaseModel):
    generated_at: UtcDateTime
    oldest_snapshot_day: str | None = None
    newest_snapshot_day: str | None = None
    resolution_categories: list[LibraryHistoryResolutionCategoryRead] = Field(default_factory=list)
    points: list[LibraryHistoryPointRead] = Field(default_factory=list)


class LibraryHistoryResponse(HistoryTimelineResponse):
    library_id: int


class DashboardHistoryResponse(HistoryTimelineResponse):
    visible_library_ids: list[int] = Field(default_factory=list)
