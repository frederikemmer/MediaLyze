from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TranscodeStreamAction(str, Enum):
    keep = "keep"
    drop = "drop"
    copy = "copy"
    encode = "encode"


class TranscodeStreamPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stream_index: int = Field(ge=0)
    action: TranscodeStreamAction = TranscodeStreamAction.copy
    codec: str | None = Field(default=None, max_length=64)
    encoder: str | None = Field(default=None, max_length=128)
    bitrate: int | None = Field(default=None, ge=1)
    crf: float | None = Field(default=None, ge=0, le=255)
    cq: float | None = Field(default=None, ge=0, le=255)
    width: int | None = Field(default=None, ge=16, le=16384)
    height: int | None = Field(default=None, ge=16, le=16384)
    frame_rate: float | None = Field(default=None, gt=0, le=480)
    pixel_format: str | None = Field(default=None, max_length=64)
    profile: str | None = Field(default=None, max_length=128)
    level: str | None = Field(default=None, max_length=64)
    preset: str | None = Field(default=None, max_length=64)
    gop_size: int | None = Field(default=None, ge=1, le=10000)
    language: str | None = Field(default=None, max_length=32)
    title: str | None = Field(default=None, max_length=512)


class ExternalSubtitlePlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subtitle_id: int = Field(ge=1)
    action: Literal["drop", "copy", "encode"] = "drop"
    codec: str | None = Field(default=None, max_length=64)
    language: str | None = Field(default=None, max_length=32)
    title: str | None = Field(default=None, max_length=512)


class TranscodePlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    profile: Literal["compatibility", "storage", "modern", "expert"] = "compatibility"
    container: Literal["mkv", "mp4", "webm"] = "mp4"
    video_streams: list[TranscodeStreamPlan] = Field(default_factory=list)
    audio_streams: list[TranscodeStreamPlan] = Field(default_factory=list)
    subtitle_streams: list[TranscodeStreamPlan] = Field(default_factory=list)
    external_subtitles: list[ExternalSubtitlePlan] = Field(default_factory=list)
    dynamic_range: Literal["preserve", "sdr", "hdr10", "hlg", "dolby_vision"] = "preserve"
    chapters: Literal["keep", "drop"] = "keep"
    metadata: Literal["keep", "drop"] = "keep"
    cover: Literal["keep", "drop"] = "keep"
    attachments: Literal["keep", "drop"] = "keep"
    filename_template: str = Field(
        default="[{resolution}, {dynRange}, {codec}] [{audioLanguages}]",
        min_length=1,
        max_length=512,
    )
    # ``None`` keeps the legacy API behaviour for clients that predate the
    # explicit template controls.  Profile plans use ``False`` so the
    # standard template remains the source of truth even when a locale/UI
    # changes its display string.
    filename_template_override: bool | None = None
    include_subtitle_languages: bool = False
    # ``None`` inherits the persisted global runtime settings. This keeps the
    # request contract backwards-compatible while preserving the global
    # hardware-required default for older API clients.
    output_mode: Literal["transcode_output", "same_directory", "replace_original"] | None = None
    execution_mode: Literal["hardware_required", "cpu_only"] | None = None
    replacement_confirmed: bool = False


class TranscodeEncoderCapability(BaseModel):
    name: str
    codec: str
    hardware: bool = False
    available: bool = True
    tested: bool = False
    test_error: str | None = None
    # Hardware encoders can be available on only a subset of the visible
    # adapters (for example a mixed integrated/discrete Linux host).  Keeping
    # the successful device ids next to the encoder lets automatic selection
    # bind the actual job to a device that passed the probe.
    device_ids: list[str] = Field(default_factory=list)
    options: list[str] = Field(default_factory=list)
    quality_mode: Literal["crf", "cq", "qp", "global_quality"] | None = None
    quality_min: float | None = Field(default=None, ge=0, le=255)
    quality_max: float | None = Field(default=None, ge=0, le=255)
    quality_default: float | None = Field(default=None, ge=0, le=255)
    quality_step: float | None = Field(default=None, gt=0, le=10)


class TranscodeHardwareDevice(BaseModel):
    id: str
    name: str
    vendor: str
    backend: str
    driver_version: str | None = None
    compute_capability: str | None = None
    memory_total_bytes: int | None = None
    render_node: str | None = None
    device_class: Literal["integrated", "dedicated", "unknown"] = "unknown"
    decoder_codecs: list[str] = Field(default_factory=list)
    encoder_names: list[str] = Field(default_factory=list)
    encoder_codecs: list[str] = Field(default_factory=list)
    supported_pixel_formats: list[str] = Field(default_factory=list)
    supported_filters: list[str] = Field(default_factory=list)
    status: Literal["available", "unavailable", "not_detected"] = "not_detected"
    failure_reason: str | None = None
    last_tested_at: datetime | None = None


class TranscodeCapabilitiesRead(BaseModel):
    ffmpeg_available: bool
    ffmpeg_path: str
    version: str | None = None
    ffmpeg_version: str | None = None
    containers: list[str] = Field(default_factory=lambda: ["mkv", "mp4", "webm"])
    encoders: list[TranscodeEncoderCapability] = Field(default_factory=list)
    devices: list[TranscodeHardwareDevice] = Field(default_factory=list)
    decoder_codecs: list[str] = Field(default_factory=list)
    platform: str | None = None
    last_tested_at: datetime | None = None
    dolby_vision_passthrough: bool = False
    error: str | None = None


class TranscodeValidationRead(BaseModel):
    valid: bool
    output_path: str
    output_filename: str
    normalized_plan: TranscodePlan
    ffmpeg_arguments: list[str]
    ffmpeg_command: str
    kept_streams: list[str] = Field(default_factory=list)
    changed_streams: list[str] = Field(default_factory=list)
    removed_streams: list[str] = Field(default_factory=list)
    added_streams: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    detected_hardware_encoders: list[str] = Field(default_factory=list)
    output_mode: str = "same_directory"
    execution_mode: str | None = None
    device_id: str | None = None
    hardware_backend: str | None = None
    ffmpeg_version: str | None = None
    cpu_thread_budget: int | None = None
    cpu_budget_percent: int | None = None


class TranscodeFileSummary(BaseModel):
    id: int | None = None
    filename: str
    relative_path: str
    size_bytes: int | None = None
    duration_seconds: float | None = None
    width: int | None = None
    height: int | None = None
    dynamic_range: str | None = None
    video_codec: str | None = None
    audio_codecs: list[str] = Field(default_factory=list)
    audio_languages: list[str] = Field(default_factory=list)


class TranscodeAttachmentSummary(BaseModel):
    stream_index: int
    codec: str | None = None
    filename: str | None = None
    mimetype: str | None = None
    title: str | None = None


class TranscodeVariantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    group_id: int
    job_id: int | None = None
    original_file_id: int | None = None
    output_file_id: int | None = None
    library_root_id: int | None = None
    output_relative_path: str
    output_filename: str
    output_mode: str = "same_directory"
    source_path_snapshot: str
    output_path_snapshot: str
    analysis_status: str
    created_at: datetime
    updated_at: datetime
    file: TranscodeFileSummary | None = None


class TranscodeJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    group_id: int
    library_id: int
    source_file_id: int | None = None
    result_file_id: int | None = None
    status: str
    profile: str
    plan_version: int
    plan: TranscodePlan
    ffmpeg_arguments: list[str]
    ffmpeg_command: str
    warnings: list[str]
    source_path_snapshot: str
    output_path_snapshot: str
    output_relative_path: str
    output_mode: str = "same_directory"
    output_storage_root: str | None = None
    retry_count: int = 0
    attempt: int = 0
    cpu_budget_percent: int | None = None
    cpu_thread_budget: int | None = None
    device_id: str | None = None
    hardware_backend: str | None = None
    ffmpeg_version: str | None = None
    remove_partial_output: bool = True
    on_error: str = "continue"
    progress_percent: float
    processed_seconds: float
    speed: str | None = None
    eta_seconds: float | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class FileTranscodeRead(BaseModel):
    original: TranscodeFileSummary
    profiles: dict[str, TranscodePlan]
    attachments: list[TranscodeAttachmentSummary] = Field(default_factory=list)
    variants: list[TranscodeVariantRead] = Field(default_factory=list)
    jobs: list[TranscodeJobRead] = Field(default_factory=list)


class TranscodeJobPageRead(BaseModel):
    items: list[TranscodeJobRead] = Field(default_factory=list)
    total: int = 0
