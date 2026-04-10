from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.entities import DuplicateDetectionMode, LibraryType, ScanMode
from backend.app.schemas.media import DistributionItem
from backend.app.schemas.quality import QualityProfile
from backend.app.schemas._time import UtcDateTime


class LibraryCreate(BaseModel):
    name: str
    path: str
    type: LibraryType
    scan_mode: ScanMode = ScanMode.manual
    duplicate_detection_mode: DuplicateDetectionMode = DuplicateDetectionMode.off
    scan_config: dict = Field(default_factory=dict)
    quality_profile: QualityProfile = Field(default_factory=QualityProfile)


class LibraryUpdate(BaseModel):
    name: str | None = None
    scan_mode: ScanMode | None = None
    duplicate_detection_mode: DuplicateDetectionMode | None = None
    scan_config: dict = Field(default_factory=dict)
    quality_profile: QualityProfile | None = None


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
