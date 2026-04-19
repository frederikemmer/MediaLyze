from pydantic import BaseModel, Field

from backend.app.schemas._time import UtcDateTime


class LibraryHistoryResolutionCategoryRead(BaseModel):
    id: str
    label: str


class LibraryHistoryTrendMetricsRead(BaseModel):
    total_files: int
    resolution_counts: dict[str, int] = Field(default_factory=dict)
    average_bitrate: float | None = None
    average_audio_bitrate: float | None = None
    average_duration_seconds: float | None = None
    average_quality_score: float | None = None


class LibraryHistoryPointRead(BaseModel):
    snapshot_day: str
    trend_metrics: LibraryHistoryTrendMetricsRead


class LibraryHistoryResponse(BaseModel):
    generated_at: UtcDateTime
    library_id: int
    oldest_snapshot_day: str | None = None
    newest_snapshot_day: str | None = None
    resolution_categories: list[LibraryHistoryResolutionCategoryRead] = Field(default_factory=list)
    points: list[LibraryHistoryPointRead] = Field(default_factory=list)
