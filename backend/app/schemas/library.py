from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.entities import DuplicateDetectionMode, LibraryType, ScanMode
from backend.app.schemas.media import DistributionItem, NumericDistribution, NumericDistributionMetricId
from backend.app.schemas.quality import QualityProfile
from backend.app.schemas._time import UtcDateTime


class LibraryCreate(BaseModel):
    name: str
    path: str
    paths: list[str] = Field(default_factory=list)
    type: LibraryType
    scan_mode: ScanMode = ScanMode.manual
    duplicate_detection_mode: DuplicateDetectionMode = DuplicateDetectionMode.off
    scan_config: dict = Field(default_factory=dict)
    quality_profile: QualityProfile = Field(default_factory=QualityProfile)
    show_on_dashboard: bool = True


class LibraryUpdate(BaseModel):
    name: str | None = None
    type: LibraryType | None = None
    scan_mode: ScanMode | None = None
    duplicate_detection_mode: DuplicateDetectionMode | None = None
    scan_config: dict = Field(default_factory=dict)
    quality_profile: QualityProfile | None = None
    show_on_dashboard: bool | None = None


class LibrarySummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    path: str
    type: LibraryType
    last_scan_at: UtcDateTime | None
    scan_mode: ScanMode
    duplicate_detection_mode: DuplicateDetectionMode
    scan_config: dict
    created_at: UtcDateTime
    updated_at: UtcDateTime
    quality_profile: QualityProfile = Field(default_factory=QualityProfile)
    show_on_dashboard: bool = True
    file_count: int = 0
    total_size_bytes: int = 0
    total_duration_seconds: float = 0
    ready_files: int = 0
    pending_files: int = 0


class LibraryStatistics(BaseModel):
    container_distribution: list[DistributionItem]
    video_codec_distribution: list[DistributionItem]
    resolution_distribution: list[DistributionItem]
    hdr_distribution: list[DistributionItem]
    audio_codec_distribution: list[DistributionItem]
    audio_spatial_profile_distribution: list[DistributionItem]
    audio_language_distribution: list[DistributionItem]
    subtitle_language_distribution: list[DistributionItem]
    subtitle_codec_distribution: list[DistributionItem]
    subtitle_source_distribution: list[DistributionItem]
    numeric_distributions: dict[NumericDistributionMetricId, NumericDistribution]
