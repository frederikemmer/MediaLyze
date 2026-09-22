from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.app.schemas._time import UtcDateTime


class ConnectorConnectionCreate(BaseModel):
    provider: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    base_url: str = Field(default="", max_length=2048)
    secret: str = Field(default="", max_length=12000)
    config: dict = Field(default_factory=dict)
    enabled: bool = False
    sync_interval_minutes: int = Field(default=60, ge=5, le=10080)
    path_mapping_mode: Literal["automatic", "manual"] = "automatic"
    library_mapping_mode: Literal["automatic", "manual"] = "automatic"



class ConnectorConnectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    base_url: str | None = Field(default=None, max_length=2048)
    secret: str | None = Field(default=None, max_length=12000)
    config: dict | None = None
    enabled: bool | None = None
    sync_interval_minutes: int | None = Field(default=None, ge=5, le=10080)
    path_mapping_mode: Literal["automatic", "manual"] | None = None
    library_mapping_mode: Literal["automatic", "manual"] | None = None



class ConnectorConnectionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str
    name: str
    base_url: str
    config: dict
    capabilities: dict
    enabled: bool
    path_mapping_mode: str
    library_mapping_mode: str
    sync_interval_minutes: int
    server_name: str | None
    server_version: str | None
    last_status: str
    last_error: str | None
    last_sync_started_at: UtcDateTime | None
    last_sync_finished_at: UtcDateTime | None
    last_successful_sync_at: UtcDateTime | None
    has_secret: bool = False
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ConnectorTestRequest(BaseModel):
    base_url: str | None = Field(default=None, max_length=2048)
    secret: str | None = Field(default=None, max_length=12000)


class ConnectorTestRead(BaseModel):
    success: bool
    server_name: str | None = None
    server_version: str | None = None
    error: str | None = None


class ConnectorLocationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    connector_library_id: int
    remote_path: str
    normalized_path: str


class ConnectorLibraryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    connection_id: int
    remote_id: str
    name: str
    media_type: str | None
    provider_payload: dict
    last_synced_at: UtcDateTime | None
    locations: list[ConnectorLocationRead] = Field(default_factory=list)
    linked_library_ids: list[int] = Field(default_factory=list)


class ConnectorBindingWrite(BaseModel):
    id: int | None = Field(default=None, ge=1)
    location_id: int = Field(ge=1)
    library_root_id: int = Field(ge=1)
    source_prefix: str = Field(min_length=1, max_length=4096)
    target_subpath: str = Field(default="", max_length=2048)
    case_mode: Literal["sensitive", "insensitive"] = "sensitive"
    priority: int = Field(default=0, ge=-1000, le=1000)
    active: bool = True


class ConnectorBindingBatchUpdate(BaseModel):
    bindings: list[ConnectorBindingWrite] = Field(default_factory=list, max_length=10000)

    @model_validator(mode="after")
    def reject_duplicate_ids(self) -> "ConnectorBindingBatchUpdate":
        ids = [binding.id for binding in self.bindings if binding.id is not None]
        if len(ids) != len(set(ids)):
            raise ValueError("Binding ids must be unique")
        return self


class ConnectorBindingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    location_id: int
    library_root_id: int
    source_prefix: str
    normalized_source_prefix: str
    target_subpath: str
    case_mode: str
    priority: int
    active: bool
    origin: str
    confidence: float
    evidence_count: int
    verification_status: str
    last_verified_at: UtcDateTime | None


class ConnectorMappingRecommendationRead(BaseModel):
    kind: Literal["create_library"] = "create_library"
    suggested_name: str
    suggested_type: str
    reason: str
    accessible_paths: list[str] = Field(default_factory=list)


class ConnectorMappingLocationRead(BaseModel):
    id: int
    remote_path: str
    bindings: list[ConnectorBindingRead] = Field(default_factory=list)


class ConnectorMappingLibraryRead(BaseModel):
    id: int
    remote_id: str
    name: str
    media_type: str | None
    linked_library_ids: list[int] = Field(default_factory=list)
    required_library_ids: list[int] = Field(default_factory=list)
    locations: list[ConnectorMappingLocationRead] = Field(default_factory=list)
    recommendation: ConnectorMappingRecommendationRead | None = None


class ConnectorMappingCoverageRead(BaseModel):
    total_items: int = 0
    matched_items: int = 0
    attention_items: int = 0
    matched_percent: float = 0.0


class ConnectorMappingOverviewRead(BaseModel):
    connection_id: int
    path_mapping_mode: str
    library_mapping_mode: str
    coverage: ConnectorMappingCoverageRead
    libraries: list[ConnectorMappingLibraryRead] = Field(default_factory=list)


class ConnectorLibraryLinkWrite(BaseModel):
    connector_library_id: int = Field(ge=1)
    library_ids: list[int] = Field(default_factory=list, max_length=10000)


class ConnectorLibraryLinkBatchUpdate(BaseModel):
    links: list[ConnectorLibraryLinkWrite] = Field(default_factory=list, max_length=10000)

    @model_validator(mode="after")
    def reject_duplicate_connector_libraries(self) -> "ConnectorLibraryLinkBatchUpdate":
        ids = [link.connector_library_id for link in self.links]
        if len(ids) != len(set(ids)):
            raise ValueError("Connector library ids must be unique")
        for link in self.links:
            if len(link.library_ids) != len(set(link.library_ids)):
                raise ValueError("MediaLyze library ids must be unique")
        return self


class ConnectorItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    connection_id: int
    connector_library_id: int | None
    remote_id: str
    item_type: str
    remote_path: str | None
    title: str
    size_bytes: int | None
    duration_seconds: float | None
    match_status: str
    mismatch_reason: str | None
    last_synced_at: UtcDateTime | None


class ConnectorItemPageRead(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[ConnectorItemRead]


class ConnectorUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    remote_id: str
    name: str
    enabled_for_sync: bool
    last_synced_at: UtcDateTime | None


class ConnectorUsersUpdate(BaseModel):
    enabled_user_ids: list[str] = Field(default_factory=list, max_length=10000)

    @model_validator(mode="after")
    def reject_duplicate_ids(self) -> "ConnectorUsersUpdate":
        if len(self.enabled_user_ids) != len(set(self.enabled_user_ids)):
            raise ValueError("Connector user ids must be unique")
        return self


class ConnectorPlaybackUserDataRead(BaseModel):
    remote_user_id: str
    user_name: str
    play_count: int
    played: bool
    playback_position_ticks: int
    last_played_date: UtcDateTime | None
    is_favorite: bool


class ConnectorPlaybackEventRead(BaseModel):
    remote_event_id: str
    remote_user_id: str
    user_name: str
    played_at: UtcDateTime


class ConnectorPlaybackSourceRead(BaseModel):
    connection_id: int
    connection_name: str
    provider: str
    connector_item_id: int
    user_data: list[ConnectorPlaybackUserDataRead] = Field(default_factory=list)
    playback_events: list[ConnectorPlaybackEventRead] = Field(default_factory=list)
    individual_playback_history_start_at: UtcDateTime | None = None


class ConnectorSyncStartRead(BaseModel):
    job_id: int
    status: str
    trigger_source: str
    accepted: bool


class ConnectorSyncCancelRead(BaseModel):
    job_id: int | None = None
    status: str | None = None
    cancellation_requested: bool


class ConnectorSyncJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    connection_id: int
    job_type: str = "sync"
    sync_run_id: str | None = None
    status: str
    trigger_source: str
    cancellation_requested: bool
    progress_phase: str | None
    progress_detail: str | None
    progress_current: int
    progress_total: int | None
    queued_at: UtcDateTime
    started_at: UtcDateTime | None
    finished_at: UtcDateTime | None
    error: str | None
    sync_summary: dict


class FileConnectorSourceRead(BaseModel):
    connection_id: int
    connection_name: str
    provider: str
    connector_item_id: int
    remote_id: str
    title: str
    item_type: str
    remote_path: str | None
    match_method: str
    preferred: bool = False
    original_title: str | None = None
    series_name: str | None = None
    season_name: str | None = None
    season_number: int | None = None
    episode_number: int | None = None
    episode_title: str | None = None
    date_created: UtcDateTime | None = None
    premiere_date: UtcDateTime | None = None
    production_year: int | None = None
    overview: str | None = None
    provider_ids: dict = Field(default_factory=dict)
    provider_payload: dict = Field(default_factory=dict)
