from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, HttpUrl, StringConstraints, model_validator


ProfileId = Annotated[
    str,
    StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=2, max_length=96),
]


class CatalogSource(str, Enum):
    official = "official"
    local = "local"


class SupportLevel(str, Enum):
    passthrough_only = "passthrough_only"
    limited = "limited"


class PlaybackMode(str, Enum):
    direct = "direct"
    direct_stream = "direct_stream"
    transcode = "transcode"
    video_transcode = "video_transcode"
    conditional = "conditional"
    unsupported = "unsupported"


class CompatibilityStatus(str, Enum):
    direct_play = "direct_play"
    direct_stream = "direct_stream"
    video_transcode = "video_transcode"
    conditional = "conditional"
    unsupported = "unsupported"


class FindingSeverity(str, Enum):
    info = "info"
    warning = "warning"
    error = "error"


class ProfileSource(BaseModel):
    label: str = Field(min_length=1, max_length=255)
    url: HttpUrl


class HardwareVideoCapability(BaseModel):
    hardware_decode: bool
    max_resolution: str | None = None
    max_width: int | None = Field(default=None, ge=1)
    max_height: int | None = Field(default=None, ge=1)
    max_fps: float | None = Field(default=None, gt=0)
    bit_depth: list[int] = Field(default_factory=list)
    hdr: list[str] = Field(default_factory=list)


class SoftwareCapability(BaseModel):
    mode: PlaybackMode
    max_resolution: str | None = None
    max_width: int | None = Field(default=None, ge=1)
    max_height: int | None = Field(default=None, ge=1)
    max_fps: float | None = Field(default=None, gt=0)
    bit_depth: list[int] = Field(default_factory=list)
    hdr: list[str] = Field(default_factory=list)
    profiles: list[str] = Field(default_factory=list)
    max_channels: int | None = Field(default=None, ge=1)
    conditions: list["CapabilityCondition"] = Field(default_factory=list)


class CapabilityCondition(BaseModel):
    kind: Literal[
        "client_version",
        "os_version",
        "setting",
        "extension",
        "hardware_decode",
        "hdr_display",
        "device_capability",
        "tested_only",
    ]
    value: str = Field(min_length=1, max_length=255)
    note: str | None = Field(default=None, max_length=1000)


class SoftwareRuleMatch(BaseModel):
    containers: list[str] = Field(default_factory=list)
    video_codecs: list[str] = Field(default_factory=list)
    audio_codecs: list[str] = Field(default_factory=list)
    subtitle_formats: list[str] = Field(default_factory=list)
    video_profiles: list[str] = Field(default_factory=list)
    bit_depths: list[int] = Field(default_factory=list)
    hdr: list[str] = Field(default_factory=list)
    min_audio_channels: int | None = Field(default=None, ge=1)
    max_audio_channels: int | None = Field(default=None, ge=1)


class SoftwareCompatibilityRule(BaseModel):
    id: ProfileId
    match: SoftwareRuleMatch
    mode: PlaybackMode
    conditions: list[CapabilityCondition] = Field(default_factory=list)
    note: str | None = Field(default=None, max_length=1000)
    subtitle_action: Literal["direct", "remux", "convert", "burn_in"] | None = None


class ProfileMetadata(BaseModel):
    schema_version: Literal[1] = 1
    profile_version: int = Field(default=1, ge=1)
    id: ProfileId
    name: str = Field(min_length=1, max_length=255)
    status: Literal["official", "local"] = "local"
    verified_by: str | None = Field(default=None, max_length=255)
    added: date
    last_modified: date
    notes: str | None = Field(default=None, max_length=4000)
    sources: list[ProfileSource] = Field(default_factory=list)
    base_profile_id: ProfileId | None = None
    base_profile_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_base_reference(self):
        if (self.base_profile_id is None) != (self.base_profile_version is None):
            raise ValueError("base_profile_id and base_profile_version must be set together")
        return self


HardwareSupport = bool | SupportLevel


class HardwareProfile(ProfileMetadata):
    category: str = Field(min_length=1, max_length=64)
    manufacturer: str = Field(min_length=1, max_length=255)
    year: int | None = Field(default=None, ge=1970, le=2200)
    video: dict[str, HardwareVideoCapability] = Field(default_factory=dict)
    audio: dict[str, HardwareSupport] = Field(default_factory=dict)
    containers: list[str] = Field(default_factory=list)
    subtitles: dict[str, HardwareSupport] = Field(default_factory=dict)
    catalog_source: CatalogSource | None = None


class SoftwareProfile(ProfileMetadata):
    category: str = Field(default="player", min_length=1, max_length=64)
    developer: str = Field(min_length=1, max_length=255)
    platforms: list[str] = Field(default_factory=list)
    video: dict[str, SoftwareCapability] = Field(default_factory=dict)
    audio: dict[str, SoftwareCapability] = Field(default_factory=dict)
    containers: dict[str, SoftwareCapability] = Field(default_factory=dict)
    subtitles: dict[str, SoftwareCapability] = Field(default_factory=dict)
    rules: list[SoftwareCompatibilityRule] = Field(default_factory=list)
    server_fallback: Literal["unsupported", "transcode"] = "unsupported"
    catalog_source: CatalogSource | None = None


class CompatibilityProfile(ProfileMetadata):
    hardware_profile_id: ProfileId
    software_profile_id: ProfileId
    catalog_source: Literal[CatalogSource.local] | None = None


class CompatibilityFinding(BaseModel):
    code: str
    severity: FindingSeverity
    scope: Literal["container", "video", "audio", "subtitle", "metadata", "profile"]
    message: str
    blocking: bool = False
    stream_index: int | None = None


class CompatibilityEvaluation(BaseModel):
    compatibility_profile_id: str
    compatibility_profile_name: str
    hardware_profile_id: str
    hardware_profile_version: int
    software_profile_id: str
    software_profile_version: int
    file_id: int
    status: CompatibilityStatus
    container_status: CompatibilityStatus
    video_status: CompatibilityStatus
    audio_status: CompatibilityStatus
    subtitle_status: CompatibilityStatus
    selected_audio_stream_index: int | None = None
    findings: list[CompatibilityFinding] = Field(default_factory=list)


class ProfileEvaluation(BaseModel):
    profile_type: Literal["hardware", "software"]
    profile_id: str
    profile_name: str
    profile_version: int
    file_id: int
    status: CompatibilityStatus
    container_status: CompatibilityStatus
    video_status: CompatibilityStatus
    audio_status: CompatibilityStatus
    subtitle_status: CompatibilityStatus
    selected_audio_stream_index: int | None = None
    findings: list[CompatibilityFinding] = Field(default_factory=list)


class CompatibilityEvaluateRequest(BaseModel):
    file_id: int = Field(ge=1)


class CompatibilityProfileUpdate(BaseModel):
    profile: dict
