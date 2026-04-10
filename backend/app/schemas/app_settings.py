from pydantic import BaseModel, Field


SCAN_WORKER_COUNT_MIN = 1
SCAN_WORKER_COUNT_MAX = 16
PARALLEL_SCAN_JOB_COUNT_MIN = 1
PARALLEL_SCAN_JOB_COUNT_MAX = 8


class ResolutionCategory(BaseModel):
    id: str
    label: str
    min_width: int = Field(ge=0)
    min_height: int = Field(ge=0)


class FeatureFlagsRead(BaseModel):
    show_analyzed_files_csv_export: bool = False
    show_full_width_app_shell: bool = False
    hide_quality_score_meter: bool = False


class FeatureFlagsUpdate(BaseModel):
    show_analyzed_files_csv_export: bool | None = None
    show_full_width_app_shell: bool | None = None
    hide_quality_score_meter: bool | None = None


class ScanPerformanceRead(BaseModel):
    scan_worker_count: int = Field(default=4, ge=SCAN_WORKER_COUNT_MIN, le=SCAN_WORKER_COUNT_MAX)
    parallel_scan_jobs: int = Field(default=2, ge=PARALLEL_SCAN_JOB_COUNT_MIN, le=PARALLEL_SCAN_JOB_COUNT_MAX)


class ScanPerformanceUpdate(BaseModel):
    scan_worker_count: int | None = Field(default=None, ge=SCAN_WORKER_COUNT_MIN, le=SCAN_WORKER_COUNT_MAX)
    parallel_scan_jobs: int | None = Field(default=None, ge=PARALLEL_SCAN_JOB_COUNT_MIN, le=PARALLEL_SCAN_JOB_COUNT_MAX)


class AppSettingsRead(BaseModel):
    ignore_patterns: list[str] = Field(default_factory=list)
    user_ignore_patterns: list[str] = Field(default_factory=list)
    default_ignore_patterns: list[str] = Field(default_factory=list)
    resolution_categories: list[ResolutionCategory] = Field(default_factory=list)
    feature_flags: FeatureFlagsRead = Field(default_factory=FeatureFlagsRead)
    scan_performance: ScanPerformanceRead = Field(default_factory=ScanPerformanceRead)


class AppSettingsUpdate(BaseModel):
    ignore_patterns: list[str] | None = None
    user_ignore_patterns: list[str] | None = None
    default_ignore_patterns: list[str] | None = None
    resolution_categories: list[ResolutionCategory] | None = None
    feature_flags: FeatureFlagsUpdate | None = None
    scan_performance: ScanPerformanceUpdate | None = None
