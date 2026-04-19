from pydantic import BaseModel, Field

from backend.app.schemas._time import UtcDateTime


class HistoryStorageCategoryRead(BaseModel):
    entry_count: int = 0
    current_estimated_bytes: int = 0
    average_daily_bytes: float = 0.0
    projected_bytes_30d: float = 0.0
    projected_bytes_for_configured_days: float | None = None
    days_limit: int = 0
    storage_limit_bytes: int = 0
    oldest_recorded_at: UtcDateTime | None = None
    newest_recorded_at: UtcDateTime | None = None


class HistoryStorageCategoriesRead(BaseModel):
    file_history: HistoryStorageCategoryRead = Field(default_factory=HistoryStorageCategoryRead)
    library_history: HistoryStorageCategoryRead = Field(default_factory=HistoryStorageCategoryRead)
    scan_history: HistoryStorageCategoryRead = Field(default_factory=HistoryStorageCategoryRead)


class HistoryStorageRead(BaseModel):
    generated_at: UtcDateTime
    database_file_bytes: int = 0
    reclaimable_file_bytes: int = 0
    categories: HistoryStorageCategoriesRead = Field(default_factory=HistoryStorageCategoriesRead)
