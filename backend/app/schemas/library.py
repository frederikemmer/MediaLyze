from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.entities import LibraryType, ScanMode


class LibraryCreate(BaseModel):
    name: str
    path: str
    type: LibraryType
    scan_mode: ScanMode = ScanMode.manual
    scan_config: dict = Field(default_factory=dict)


class LibraryUpdate(BaseModel):
    name: str | None = None
    scan_mode: ScanMode | None = None
    scan_config: dict = Field(default_factory=dict)


class LibrarySummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    path: str
    type: LibraryType
    last_scan_at: datetime | None
    scan_mode: ScanMode
    scan_config: dict
    created_at: datetime
    updated_at: datetime
    file_count: int = 0
    total_size_bytes: int = 0
    total_duration_seconds: float = 0
    ready_files: int = 0
    pending_files: int = 0


class LibraryDetail(LibrarySummary):
    video_codec_distribution: list[dict]
    resolution_distribution: list[dict]
    hdr_distribution: list[dict]
    audio_codec_distribution: list[dict]
    audio_language_distribution: list[dict]
    subtitle_language_distribution: list[dict]
    subtitle_codec_distribution: list[dict]
    subtitle_source_distribution: list[dict]
