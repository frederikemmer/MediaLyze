from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    # Optional for requests: the target worker resolves the concrete encoder
    # from the requested codec and its own capability probe.
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
    # ``local`` is the compatibility default for existing API clients.  The
    # new editor sends ``automatic`` when federation is enabled.
    target_mode: Literal["local", "automatic", "member"] = "local"
    target_member_id: str | None = Field(default=None, max_length=128)
    target_device_id: str | None = Field(default=None, max_length=128)


class TranscodeProfileStreamRule(BaseModel):
    """An ordered, source-independent stream rule stored in a profile.

    A profile deliberately never stores a concrete stream index.  The index is
    resolved only when a profile is materialized for one particular file.
    """

    model_config = ConfigDict(extra="forbid")

    match_codecs: list[str] = Field(default_factory=list, max_length=32)
    match_languages: list[str] = Field(default_factory=list, max_length=32)
    match_default: bool | None = None
    action: Literal["copy", "convert", "remove"] = "copy"
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

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_rule_shape(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        match = payload.pop("match", None)
        if isinstance(match, dict):
            aliases = {
                "codecs": "match_codecs",
                "codec": "match_codecs",
                "languages": "match_languages",
                "language": "match_languages",
                "default": "match_default",
                "default_flag": "match_default",
            }
            for source, target in aliases.items():
                if target not in payload and source in match:
                    candidate = match[source]
                    if target in {"match_codecs", "match_languages"} and isinstance(candidate, str):
                        candidate = [candidate]
                    payload[target] = candidate
        if "target_codec" in payload and "codec" not in payload:
            payload["codec"] = payload.pop("target_codec")
        action = str(payload.get("action", "copy")).lower()
        payload["action"] = {"encode": "convert", "drop": "remove", "keep": "copy"}.get(action, action)
        return payload


class TranscodeProfileDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    container: Literal["source", "mkv", "mp4", "webm"] = "source"
    video_rules: list[TranscodeProfileStreamRule] = Field(default_factory=list, max_length=128)
    audio_rules: list[TranscodeProfileStreamRule] = Field(default_factory=list, max_length=128)
    subtitle_rules: list[TranscodeProfileStreamRule] = Field(default_factory=list, max_length=128)
    external_subtitle_rules: list[TranscodeProfileStreamRule] = Field(default_factory=list, max_length=128)
    default_video_action: Literal["copy", "convert", "remove"] = "copy"
    default_audio_action: Literal["copy", "convert", "remove"] = "copy"
    default_subtitle_action: Literal["copy", "convert", "remove"] = "copy"
    default_external_subtitle_action: Literal["copy", "convert", "remove"] = "remove"
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
    filename_template_override: bool = False
    include_subtitle_languages: bool = False
    execution_mode: Literal["inherit", "hardware_required", "cpu_only"] = "inherit"


class TranscodeProfileCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    definition: TranscodeProfileDefinition | None = None

    @model_validator(mode="before")
    @classmethod
    def accept_flat_definition_fields(cls, value: Any) -> Any:
        if not isinstance(value, dict) or "definition" in value:
            return value
        payload = dict(value)
        definition_keys = set(TranscodeProfileDefinition.model_fields)
        definition = {key: payload.pop(key) for key in list(payload) if key in definition_keys}
        if definition:
            payload["definition"] = definition
        return payload


class TranscodeProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    definition: TranscodeProfileDefinition | None = None

    @model_validator(mode="before")
    @classmethod
    def accept_flat_definition_fields(cls, value: Any) -> Any:
        if not isinstance(value, dict) or "definition" in value:
            return value
        payload = dict(value)
        definition_keys = set(TranscodeProfileDefinition.model_fields)
        definition = {key: payload.pop(key) for key in list(payload) if key in definition_keys}
        if definition:
            payload["definition"] = definition
        return payload


class TranscodeProfileDuplicate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)


class TranscodeProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    version: int
    is_builtin: bool
    builtin_key: str | None = None
    definition: TranscodeProfileDefinition
    used_by_rule_count: int = 0
    created_at: datetime
    updated_at: datetime


class TranscodeProfilePlanRead(BaseModel):
    profile: TranscodeProfileRead
    plan: TranscodePlan


class TranscodeCondition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["condition"] = "condition"
    field: str = Field(min_length=1, max_length=128)
    operator: str = Field(min_length=1, max_length=32)
    value: Any = None


class TranscodeConditionGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["group"] = "group"
    operator: Literal["and", "or"] = "and"
    children: list[Annotated[Union[TranscodeCondition, "TranscodeConditionGroup"], Field(discriminator="type")]] = Field(
        min_length=1,
        max_length=128,
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_group_shape(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        if "operator" not in payload and "logic" in payload:
            payload["operator"] = payload.pop("logic")
        if "children" not in payload and "conditions" in payload:
            payload["children"] = payload.pop("conditions")
        return payload


TranscodeConditionGroup.model_rebuild()
TranscodeConditionNode = Annotated[
    Union[TranscodeCondition, TranscodeConditionGroup],
    Field(discriminator="type"),
]


class TranscodeRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)
    enabled: bool = False
    priority: int = Field(default=0, ge=0)
    library_ids: list[int] = Field(min_length=1, max_length=256)
    conditions: TranscodeConditionGroup | None = None
    profile_id: int = Field(ge=1)
    output_mode: Literal["transcode_output", "same_directory", "replace_original"] = "transcode_output"
    output_subfolder: str = Field(default="", max_length=512)

    @model_validator(mode="before")
    @classmethod
    def accept_condition_aliases(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        if "conditions" not in payload and "condition" in payload:
            payload["conditions"] = payload.pop("condition")
        return payload


class TranscodeRuleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    enabled: bool | None = None
    priority: int | None = Field(default=None, ge=0)
    library_ids: list[int] | None = Field(default=None, min_length=1, max_length=256)
    conditions: TranscodeConditionGroup | None = None
    profile_id: int | None = Field(default=None, ge=1)
    output_mode: Literal["transcode_output", "same_directory", "replace_original"] | None = None
    output_subfolder: str | None = Field(default=None, max_length=512)

    @model_validator(mode="before")
    @classmethod
    def accept_condition_aliases(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        payload = dict(value)
        if "conditions" not in payload and "condition" in payload:
            payload["conditions"] = payload.pop("condition")
        return payload


class TranscodeRuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    enabled: bool
    priority: int
    version: int
    library_ids: list[int]
    conditions: TranscodeConditionGroup | None = None
    profile_id: int
    profile_name: str
    profile_version: int
    output_mode: str
    output_subfolder: str
    replacement_approved: bool = False
    created_at: datetime
    updated_at: datetime


class TranscodeRuleReorder(BaseModel):
    rule_ids: list[int] = Field(min_length=1, max_length=4096)


class TranscodeReplacementApproval(BaseModel):
    confirm: bool = True


class TranscodeAutomationScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule_ids: list[int] = Field(default_factory=list, max_length=4096)
    library_ids: list[int] = Field(default_factory=list, max_length=256)
    source_file_ids: list[int] = Field(default_factory=list, max_length=100000)
    retry_failed: bool = False
    limit: int = Field(default=5000, ge=1, le=100000)


class TranscodeAutomationDecisionRead(BaseModel):
    file_id: int
    library_id: int
    relative_path: str
    filename: str
    status: Literal["matched", "queued", "blocked", "skipped", "unmatched"]
    reason: str | None = None
    rule_id: int | None = None
    rule_name: str | None = None
    rule_version: int | None = None
    profile_id: int | None = None
    profile_name: str | None = None
    profile_version: int | None = None
    output_path: str | None = None
    output_relative_path: str | None = None
    plan: TranscodePlan | None = None


class TranscodeAutomationPreviewRead(BaseModel):
    generated_at: datetime
    total_files: int = 0
    matched: int = 0
    queued: int = 0
    blocked: int = 0
    skipped: int = 0
    unmatched: int = 0
    items: list[TranscodeAutomationDecisionRead] = Field(default_factory=list)


class TranscodeAutomationRunRead(BaseModel):
    id: int
    status: Literal["queued", "running", "completed", "failed", "canceled"]
    trigger: str
    rule_ids: list[int] = Field(default_factory=list)
    library_ids: list[int] = Field(default_factory=list)
    source_file_ids: list[int] = Field(default_factory=list)
    retry_failed: bool = False
    page_size: int = 50
    files_total: int = 0
    matched: int = 0
    queued: int = 0
    blocked: int = 0
    skipped: int = 0
    unmatched: int = 0
    completed: int = 0
    failed: int = 0
    canceled: int = 0
    current_page: int = 0
    summary: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    cancellation_requested: bool = False
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class TranscodeAutomationCancelRead(BaseModel):
    run_id: int
    status: str
    cancellation_requested: bool = True


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
    # Native adapter ordinal used by APIs such as Windows D3D11/AMF/QSV.
    # Keeping it separate from ``id`` lets hybrid systems bind a probe and a
    # later transcode job to the same physical adapter even when the driver
    # exposes a discrete GPU first.
    native_device_index: int | None = Field(default=None, ge=0)
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


class TranscodeMatrixBenchmarkRunRead(BaseModel):
    run: int = Field(ge=1)
    duration_seconds: float | None = Field(default=None, ge=0)
    success: bool
    error: str | None = None


class TranscodeMatrixBenchmarkLevelRead(BaseModel):
    concurrency: int = Field(ge=1)
    runs: list[TranscodeMatrixBenchmarkRunRead] = Field(default_factory=list)
    median_seconds: float | None = Field(default=None, ge=0)
    slowdown_percent: float | None = None
    passed: bool = False
    error: str | None = None


class TranscodeMatrixBenchmarkRead(BaseModel):
    tolerance_percent: float = Field(default=20, ge=0)
    test_ceiling: int = Field(default=20, ge=1)
    repetitions: int = Field(default=3, ge=1)
    width: int = Field(default=256, ge=1)
    height: int = Field(default=256, ge=1)
    frame_rate: int = Field(default=30, ge=1)
    frames: int = Field(default=240, ge=1)
    stream_loops: int = Field(default=7, ge=0)
    baseline_median_seconds: float | None = Field(default=None, ge=0)
    slowdown_limit_seconds: float | None = Field(default=None, ge=0)
    levels: list[TranscodeMatrixBenchmarkLevelRead] = Field(default_factory=list)


class TranscodeMatrixCellRead(BaseModel):
    decode_codec: str
    encode_codec: str
    status: Literal["hardware", "software", "unsupported", "not_tested"]
    decoder: str | None = None
    encoder: str | None = None
    max_parallel_jobs: int | None = Field(default=None, ge=1)
    max_parallel_jobs_is_lower_bound: bool = False
    parallel_benchmark: TranscodeMatrixBenchmarkRead | None = None
    detail: str | None = None


class TranscodeDeviceMatrixRead(BaseModel):
    device_id: str
    device_name: str
    backend: str
    device_class: Literal["integrated", "dedicated", "unknown"] = "unknown"
    tested_at: datetime
    decode_codecs: list[str] = Field(default_factory=list)
    encode_codecs: list[str] = Field(default_factory=list)
    cells: list[TranscodeMatrixCellRead] = Field(default_factory=list)


class TranscodeCapabilityMatrixRead(BaseModel):
    status: Literal["not_run", "completed", "failed"] = "not_run"
    tested_at: datetime | None = None
    ffmpeg_version: str | None = None
    capability_fingerprint: str | None = None
    matrices: list[TranscodeDeviceMatrixRead] = Field(default_factory=list)
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
    source_video_codec: str | None = None
    source_dynamic_range: str | None = None
    result_file_id: int | None = None
    status: str
    profile: str
    profile_id: int | None = None
    profile_version: int | None = None
    rule_id: int | None = None
    rule_version: int | None = None
    rule_snapshot: dict[str, Any] | None = None
    automation_run_id: int | None = None
    automation_trigger: str | None = None
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
    global_job_id: str | None = None
    origin_installation_id: str | None = None
    target_installation_id: str | None = None
    target_member_id: str | None = None
    target_member_name: str | None = None
    assignment_mode: Literal["local", "automatic", "member"] = "local"
    processing_phase: str = "queued"
    phase_detail: str | None = None
    execution_attempt: int = 0
    remote_attempt_id: str | None = None
    source_transfer_id: str | None = None
    result_transfer_id: str | None = None
    source_transfer_bytes: int = 0
    source_transfer_total_bytes: int = 0
    result_transfer_bytes: int = 0
    result_transfer_total_bytes: int = 0
    transfer_speed_bytes_per_second: float | None = None
    transfer_eta_seconds: float | None = None


class FileTranscodeRead(BaseModel):
    original: TranscodeFileSummary
    profiles: dict[str, TranscodePlan]
    saved_profiles: list[TranscodeProfilePlanRead] = Field(default_factory=list)
    attachments: list[TranscodeAttachmentSummary] = Field(default_factory=list)
    variants: list[TranscodeVariantRead] = Field(default_factory=list)
    jobs: list[TranscodeJobRead] = Field(default_factory=list)


class TranscodeJobPageRead(BaseModel):
    items: list[TranscodeJobRead] = Field(default_factory=list)
    total: int = 0


class TranscodeFederationSettingsRead(BaseModel):
    enabled: bool = False
    federation_id: str
    installation_id: str
    federation_name: str
    display_name: str
    pairing_code: str
    pairing_code_from_environment: bool = False
    pairing_code_expires_at: int = 0
    discovery_enabled: bool = True
    accept_jobs: bool = True
    endpoint_urls: list[str] = Field(default_factory=list)
    hostname_urls: list[str] = Field(default_factory=list)
    ip_urls: list[str] = Field(default_factory=list)
    resource_policy: dict[str, Any] = Field(default_factory=dict)
    protocol_version: int = 1
    temp_budget_bytes: int = 0
    result_retention_hours: int = 24


class TranscodeFederationSettingsUpdate(BaseModel):
    enabled: bool | None = None
    federation_name: str | None = Field(default=None, min_length=1, max_length=255)
    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    discovery_enabled: bool | None = None
    accept_jobs: bool | None = None
    endpoint_urls: list[str] | None = Field(default=None, max_length=16)
    resource_policy: dict[str, Any] | None = None


class TranscodeFederationMemberRead(BaseModel):
    id: int
    installation_id: str
    federation_id: str
    display_name: str
    endpoint_urls: list[str] = Field(default_factory=list)
    protocol_version: int = 1
    application_version: str | None = None
    status: str
    connection_status: str
    reachable: bool = False
    accept_jobs: bool = False
    resources: dict[str, Any] = Field(default_factory=dict)
    capabilities: TranscodeCapabilitiesRead | None = None
    capability_matrix: TranscodeCapabilityMatrixRead | None = None
    active_jobs: int = 0
    network_mbps: float = 0.0
    preferred_endpoint_url: str | None = None
    endpoint_metrics: dict[str, Any] = Field(default_factory=dict)
    network_latency_ms: float | None = None
    network_probe_at: datetime | None = None
    last_seen_at: datetime | None = None
    last_sync_at: datetime | None = None
    last_error: str | None = None


class TranscodeFederationPeerRead(BaseModel):
    installation_id: str
    federation_id: str | None = None
    display_name: str
    endpoint_urls: list[str] = Field(default_factory=list)
    protocol_version: int = 1
    application_version: str | None = None
    reachable: bool = False
    last_seen_at: datetime | None = None


class TranscodeFederationRead(BaseModel):
    settings: TranscodeFederationSettingsRead
    members: list[TranscodeFederationMemberRead] = Field(default_factory=list)
    discovered: list[TranscodeFederationPeerRead] = Field(default_factory=list)


class TranscodeFederationPairRequest(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)
    pairing_code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class TranscodeFederationPasscodeResetRead(BaseModel):
    pairing_code: str
    pairing_code_from_environment: bool = False
    pairing_code_expires_at: int = 0


class TranscodeFederationProtocolPairRequest(BaseModel):
    protocol_version: int = 1
    federation_id: str = Field(min_length=1, max_length=128)
    installation_id: str = Field(min_length=1, max_length=128)
    display_name: str = Field(min_length=1, max_length=255)
    endpoint_urls: list[str] = Field(default_factory=list, max_length=16)
    pairing_code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")
    client_nonce: str = Field(min_length=16, max_length=128)
    application_version: str | None = Field(default=None, max_length=64)
    accept_jobs: bool = True
    resources: dict[str, Any] = Field(default_factory=dict)
    capabilities: dict[str, Any] = Field(default_factory=dict)
    capability_matrix: dict[str, Any] = Field(default_factory=dict)
    network_mbps: float = Field(default=100.0, ge=0, le=100000)
    resource_policy: dict[str, Any] = Field(default_factory=dict)


class TranscodeFederationProtocolSecureEnvelope(BaseModel):
    version: int = 1
    timestamp: int
    nonce: str
    ciphertext: str
    tag: str
