from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.entities import JobStatus, ScanTriggerSource
from backend.app.schemas._time import UtcDateTime


class ScanRequest(BaseModel):
    scan_type: str = "incremental"


class ScanJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    library_id: int
    library_name: str | None = None
    status: JobStatus
    job_type: str
    files_total: int
    files_scanned: int
    errors: int
    started_at: UtcDateTime | None
    finished_at: UtcDateTime | None
    progress_percent: float = 0.0
    phase_key: str = "queued"
    phase_label: str = "queued"
    phase_detail: str | None = None
    phase_progress_percent: float = 0.0
    phase_current: int = 0
    phase_total: int = 0
    eta_seconds: float | None = None
    scan_mode_label: str | None = None
    duplicate_detection_mode: str | None = None
    queued_for_analysis: int = 0
    unchanged_files: int = 0


class ScanFileListRead(BaseModel):
    count: int = 0
    paths: list[str] = Field(default_factory=list)
    truncated_count: int = 0


class ScanFileIssueRead(BaseModel):
    path: str
    reason: str


class ScanPatternHitRead(BaseModel):
    pattern: str
    count: int = 0
    paths: list[str] = Field(default_factory=list)
    truncated_count: int = 0


class ScanDiscoverySummaryRead(BaseModel):
    discovered_files: int = 0
    ignored_total: int = 0
    ignored_dir_total: int = 0
    ignored_file_total: int = 0
    ignored_pattern_hits: list[ScanPatternHitRead] = Field(default_factory=list)


class ScanChangesSummaryRead(BaseModel):
    queued_for_analysis: int = 0
    unchanged_files: int = 0
    reanalyzed_incomplete_files: int = 0
    new_files: ScanFileListRead = Field(default_factory=ScanFileListRead)
    modified_files: ScanFileListRead = Field(default_factory=ScanFileListRead)
    deleted_files: ScanFileListRead = Field(default_factory=ScanFileListRead)


class ScanAnalysisSummaryRead(BaseModel):
    queued_for_analysis: int = 0
    analyzed_successfully: int = 0
    analysis_failed: int = 0
    failed_files: list[ScanFileIssueRead] = Field(default_factory=list)
    failed_files_truncated_count: int = 0


class ScanDuplicatesSummaryRead(BaseModel):
    mode: str | None = None
    status: str | None = None
    phase_started_at: UtcDateTime | None = None
    phase_finished_at: UtcDateTime | None = None
    artifacts_total: int = 0
    artifacts_completed: int = 0
    grouping_total: int = 0
    grouping_completed: int = 0
    groups_found: int = 0
    duplicate_files: int = 0
    pending_files: int = 0
    artifact_cache_hits: int = 0
    artifact_cache_misses: int = 0
    eta_seconds: float | None = None


class ScanSummaryRead(BaseModel):
    ignore_patterns: list[str] = Field(default_factory=list)
    discovery: ScanDiscoverySummaryRead = Field(default_factory=ScanDiscoverySummaryRead)
    changes: ScanChangesSummaryRead = Field(default_factory=ScanChangesSummaryRead)
    analysis: ScanAnalysisSummaryRead = Field(default_factory=ScanAnalysisSummaryRead)
    duplicates: ScanDuplicatesSummaryRead = Field(default_factory=ScanDuplicatesSummaryRead)
    runtime: dict = Field(default_factory=dict)


class RecentScanJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    library_id: int
    library_name: str | None = None
    status: JobStatus
    outcome: str
    job_type: str
    trigger_source: ScanTriggerSource
    started_at: UtcDateTime | None
    finished_at: UtcDateTime | None
    duration_seconds: float | None = None
    discovered_files: int = 0
    ignored_total: int = 0
    new_files: int = 0
    modified_files: int = 0
    deleted_files: int = 0
    analysis_failed: int = 0


class ScanJobDetailRead(RecentScanJobRead):
    trigger_details: dict = Field(default_factory=dict)
    scan_summary: ScanSummaryRead = Field(default_factory=ScanSummaryRead)


class RecentScanJobPageRead(BaseModel):
    items: list[RecentScanJobRead] = Field(default_factory=list)
    has_more: bool = False


class ScanCancelResponse(BaseModel):
    canceled_jobs: int
