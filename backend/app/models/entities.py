from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, Boolean, Enum as SqlEnum, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.db.base import Base
from backend.app.db.types import UTCDateTime
from backend.app.services.quality import default_quality_profile
from backend.app.utils.time import utc_now


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )


class LibraryType(str, Enum):
    movies = "movies"
    series = "series"
    music = "music"
    audiobooks = "audiobooks"
    mixed = "mixed"
    other = "other"


class QualityProfileMediaType(str, Enum):
    video = "video"
    music = "music"
    audiobook = "audiobook"


class ScanMode(str, Enum):
    manual = "manual"
    scheduled = "scheduled"
    scheduled_daily = "scheduled_daily"
    watch = "watch"


class DuplicateDetectionMode(str, Enum):
    off = "off"
    filename = "filename"
    filehash = "filehash"
    both = "both"


class ScanStatus(str, Enum):
    pending = "pending"
    analyzing = "analyzing"
    ready = "ready"
    failed = "failed"


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    canceled = "canceled"
    failed = "failed"


class ConnectorMappingMode(str, Enum):
    automatic = "automatic"
    manual = "manual"


class ScanTriggerSource(str, Enum):
    manual = "manual"
    scheduled = "scheduled"
    watchdog = "watchdog"
    transcode = "transcode"


class JellyfinSyncTriggerSource(str, Enum):
    manual = "manual"
    scheduled = "scheduled"


class MediaFileHistoryCaptureReason(str, Enum):
    scan_analysis = "scan_analysis"
    quality_recompute = "quality_recompute"
    history_reconstruction = "history_reconstruction"


class MediaContentCategory(str, Enum):
    main = "main"
    bonus = "bonus"


class HistoryAddedDateSource(str, Enum):
    medialyze = "medialyze"
    jellyfin = "jellyfin"
    connector = "connector"


class Library(TimestampMixin, Base):
    __tablename__ = "libraries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    path: Mapped[str] = mapped_column(String(2048), nullable=False)
    type: Mapped[LibraryType] = mapped_column(SqlEnum(LibraryType, native_enum=False), nullable=False)
    last_scan_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    scan_mode: Mapped[ScanMode] = mapped_column(
        SqlEnum(ScanMode, native_enum=False),
        default=ScanMode.manual,
        nullable=False,
    )
    duplicate_detection_mode: Mapped[DuplicateDetectionMode] = mapped_column(
        SqlEnum(DuplicateDetectionMode, native_enum=False),
        default=DuplicateDetectionMode.off,
        nullable=False,
    )
    scan_config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    quality_profile: Mapped[dict] = mapped_column(JSON, default=default_quality_profile, nullable=False)
    quality_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("quality_profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    show_on_dashboard: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    history_added_date_source: Mapped[HistoryAddedDateSource] = mapped_column(
        SqlEnum(HistoryAddedDateSource, native_enum=False),
        default=HistoryAddedDateSource.medialyze,
        nullable=False,
    )
    preferred_connector_connection_id: Mapped[int | None] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="SET NULL"),
        nullable=True,
    )

    media_files: Mapped[list[MediaFile]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    roots: Mapped[list[LibraryRoot]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="LibraryRoot.id",
    )
    assigned_quality_profile: Mapped[QualityProfileDefinition | None] = relationship(
        back_populates="libraries",
        foreign_keys=[quality_profile_id],
    )
    scan_jobs: Mapped[list[ScanJob]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    media_file_history_entries: Mapped[list[MediaFileHistory]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    duplicate_group_suppressions: Mapped[list[DuplicateGroupSuppression]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    library_history_entries: Mapped[list[LibraryHistory]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    series_entries: Mapped[list[MediaSeries]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class LibraryRoot(TimestampMixin, Base):
    __tablename__ = "library_roots"
    __table_args__ = (
        Index("ix_library_roots_library_id", "library_id"),
        Index("ix_library_roots_library_path_key", "library_id", "path_key", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False)
    path: Mapped[str] = mapped_column(String(2048), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    path_key: Mapped[str] = mapped_column(String(2048), nullable=False)

    library: Mapped[Library] = relationship(back_populates="roots")
    media_files: Mapped[list[MediaFile]] = relationship(back_populates="library_root")


class ConnectorConnection(TimestampMixin, Base):
    __tablename__ = "connector_connections"
    __table_args__ = (
        Index("ix_connector_connections_provider", "provider"),
        UniqueConstraint("provider", "name", name="uq_connector_connections_provider_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    base_url: Mapped[str] = mapped_column(String(2048), default="", nullable=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    capabilities: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    path_mapping_mode: Mapped[ConnectorMappingMode] = mapped_column(
        SqlEnum(ConnectorMappingMode, native_enum=False),
        default=ConnectorMappingMode.automatic,
        nullable=False,
    )
    library_mapping_mode: Mapped[ConnectorMappingMode] = mapped_column(
        SqlEnum(ConnectorMappingMode, native_enum=False),
        default=ConnectorMappingMode.automatic,
        nullable=False,
    )
    sync_interval_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    server_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    server_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_status: Mapped[str] = mapped_column(String(32), default="never", nullable=False)
    last_error: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    last_sync_started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    last_sync_finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    last_successful_sync_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class ConnectorCredential(TimestampMixin, Base):
    __tablename__ = "connector_credentials"

    connection_id: Mapped[int] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="CASCADE"), primary_key=True
    )
    secret_payload: Mapped[str] = mapped_column(String(12000), default="", nullable=False)


class ConnectorLibrary(TimestampMixin, Base):
    __tablename__ = "connector_libraries"
    __table_args__ = (
        UniqueConstraint("connection_id", "remote_id", name="uq_connector_libraries_connection_remote"),
        Index("ix_connector_libraries_connection", "connection_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="CASCADE"), nullable=False
    )
    remote_id: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class ConnectorLibraryLocation(TimestampMixin, Base):
    __tablename__ = "connector_library_locations"
    __table_args__ = (
        UniqueConstraint("connector_library_id", "normalized_path", name="uq_connector_locations_library_path"),
        Index("ix_connector_locations_library", "connector_library_id"),
        Index("ix_connector_locations_normalized_path", "normalized_path"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    connector_library_id: Mapped[int] = mapped_column(
        ForeignKey("connector_libraries.id", ondelete="CASCADE"), nullable=False
    )
    remote_path: Mapped[str] = mapped_column(String(4096), nullable=False)
    normalized_path: Mapped[str] = mapped_column(String(4096), nullable=False)


class ConnectorLibraryLink(TimestampMixin, Base):
    __tablename__ = "connector_library_links"
    __table_args__ = (
        UniqueConstraint(
            "connector_library_id", "library_id", name="uq_connector_library_links_pair"
        ),
        Index("ix_connector_library_links_library", "library_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    connector_library_id: Mapped[int] = mapped_column(
        ForeignKey("connector_libraries.id", ondelete="CASCADE"), nullable=False
    )
    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False
    )
    link_method: Mapped[str] = mapped_column(String(16), default="derived", nullable=False)


class ConnectorRootBinding(TimestampMixin, Base):
    __tablename__ = "connector_root_bindings"
    __table_args__ = (
        Index("ix_connector_root_bindings_location", "location_id"),
        Index("ix_connector_root_bindings_root", "library_root_id"),
        Index("ix_connector_root_bindings_active", "location_id", "active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(
        ForeignKey("connector_library_locations.id", ondelete="CASCADE"), nullable=False
    )
    library_root_id: Mapped[int] = mapped_column(
        ForeignKey("library_roots.id", ondelete="CASCADE"), nullable=False
    )
    source_prefix: Mapped[str] = mapped_column(String(4096), nullable=False)
    normalized_source_prefix: Mapped[str] = mapped_column(String(4096), nullable=False)
    target_subpath: Mapped[str] = mapped_column(String(2048), default="", nullable=False)
    case_mode: Mapped[str] = mapped_column(String(16), default="sensitive", nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    origin: Mapped[str] = mapped_column(String(16), default="automatic", nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    evidence_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    verification_status: Mapped[str] = mapped_column(
        String(16), default="imported", nullable=False
    )
    last_verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class ConnectorItem(TimestampMixin, Base):
    __tablename__ = "connector_items"
    __table_args__ = (
        UniqueConstraint("connection_id", "remote_id", name="uq_connector_items_connection_remote"),
        Index("ix_connector_items_connection", "connection_id"),
        Index("ix_connector_items_library", "connector_library_id"),
        Index("ix_connector_items_match_status", "connection_id", "match_status"),
        Index("ix_connector_items_remote_path", "connection_id", "normalized_remote_path"),
        Index(
            "ix_connector_items_resolved_locator",
            "resolved_library_root_id",
            "resolved_relative_path_key",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="CASCADE"), nullable=False
    )
    connector_library_id: Mapped[int | None] = mapped_column(
        ForeignKey("connector_libraries.id", ondelete="SET NULL"), nullable=True
    )
    remote_id: Mapped[str] = mapped_column(String(255), nullable=False)
    item_type: Mapped[str] = mapped_column(String(64), nullable=False)
    remote_path: Mapped[str | None] = mapped_column(String(4096), nullable=True)
    normalized_remote_path: Mapped[str | None] = mapped_column(String(4096), nullable=True)
    title: Mapped[str] = mapped_column(String(1024), default="", nullable=False)
    original_title: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    series_name: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    season_name: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    index_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parent_index_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_created: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    premiere_date: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    production_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    overview: Mapped[str | None] = mapped_column(String(12000), nullable=True)
    provider_ids: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    provider_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    match_status: Mapped[str] = mapped_column(String(32), default="unmapped", nullable=False)
    mismatch_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    suggested_media_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("media_files.id", ondelete="SET NULL"), nullable=True
    )
    resolved_library_root_id: Mapped[int | None] = mapped_column(
        ForeignKey("library_roots.id", ondelete="SET NULL"), nullable=True
    )
    resolved_relative_path: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    resolved_relative_path_key: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    resolved_binding_id: Mapped[int | None] = mapped_column(
        ForeignKey("connector_root_bindings.id", ondelete="SET NULL"), nullable=True
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class ConnectorMediaMatch(TimestampMixin, Base):
    __tablename__ = "connector_media_matches"
    __table_args__ = (
        UniqueConstraint("connector_item_id", name="uq_connector_media_matches_item"),
        Index("ix_connector_media_matches_media_file", "media_file_id"),
        Index("ix_connector_media_matches_binding", "binding_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    connector_item_id: Mapped[int] = mapped_column(
        ForeignKey("connector_items.id", ondelete="CASCADE"), nullable=False
    )
    media_file_id: Mapped[int] = mapped_column(
        ForeignKey("media_files.id", ondelete="CASCADE"), nullable=False
    )
    binding_id: Mapped[int | None] = mapped_column(
        ForeignKey("connector_root_bindings.id", ondelete="SET NULL"), nullable=True
    )
    match_method: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="matched", nullable=False)


class ConnectorUser(TimestampMixin, Base):
    __tablename__ = "connector_users"
    __table_args__ = (
        UniqueConstraint("connection_id", "remote_id", name="uq_connector_users_connection_remote"),
        Index("ix_connector_users_connection", "connection_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="CASCADE"), nullable=False
    )
    remote_id: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    enabled_for_sync: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class ConnectorUserItemData(Base):
    __tablename__ = "connector_user_item_data"
    __table_args__ = (
        UniqueConstraint(
            "connector_item_id", "connector_user_id", name="uq_connector_user_item_data"
        ),
        Index("ix_connector_user_item_data_user", "connector_user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    connector_item_id: Mapped[int] = mapped_column(
        ForeignKey("connector_items.id", ondelete="CASCADE"), nullable=False
    )
    connector_user_id: Mapped[int] = mapped_column(
        ForeignKey("connector_users.id", ondelete="CASCADE"), nullable=False
    )
    play_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    played: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    playback_position_ticks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_played_date: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)


class ConnectorPlaybackEvent(Base):
    __tablename__ = "connector_playback_events"
    __table_args__ = (
        UniqueConstraint(
            "connection_id", "remote_event_id", name="uq_connector_playback_events_remote"
        ),
        Index("ix_connector_playback_events_item_played_at", "connector_item_id", "played_at"),
        Index("ix_connector_playback_events_user", "connector_user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="CASCADE"), nullable=False
    )
    remote_event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    connector_item_id: Mapped[int] = mapped_column(
        ForeignKey("connector_items.id", ondelete="CASCADE"), nullable=False
    )
    connector_user_id: Mapped[int] = mapped_column(
        ForeignKey("connector_users.id", ondelete="CASCADE"), nullable=False
    )
    played_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)


class ConnectorSyncJob(Base):
    __tablename__ = "connector_sync_jobs"
    __table_args__ = (
        Index("ix_connector_sync_jobs_connection_status", "connection_id", "status"),
        Index("ix_connector_sync_jobs_queued_at", "queued_at"),
        UniqueConstraint("connection_id", "active_lock", name="uq_connector_sync_jobs_active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[JobStatus] = mapped_column(
        SqlEnum(JobStatus, native_enum=False), default=JobStatus.queued, nullable=False
    )
    trigger_source: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)
    job_type: Mapped[str] = mapped_column(String(24), default="sync", nullable=False)
    sync_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active_lock: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cancellation_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    heartbeat_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    progress_phase: Mapped[str | None] = mapped_column(String(64), nullable=True)
    progress_detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    progress_current: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    progress_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    queued_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    error: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    sync_summary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class ConnectorSyncStageLibrary(Base):
    __tablename__ = "connector_sync_stage_libraries"

    sync_run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="CASCADE"), primary_key=True
    )
    remote_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class ConnectorSyncStageLocation(Base):
    __tablename__ = "connector_sync_stage_locations"

    sync_run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="CASCADE"), primary_key=True
    )
    library_remote_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    normalized_path: Mapped[str] = mapped_column(String(4096), primary_key=True)
    remote_path: Mapped[str] = mapped_column(String(4096), nullable=False)


class ConnectorSyncStageItem(Base):
    __tablename__ = "connector_sync_stage_items"

    sync_run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="CASCADE"), primary_key=True
    )
    remote_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    library_remote_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    item_type: Mapped[str] = mapped_column(String(64), nullable=False)
    remote_path: Mapped[str | None] = mapped_column(String(4096), nullable=True)
    normalized_remote_path: Mapped[str | None] = mapped_column(String(4096), nullable=True)
    title: Mapped[str] = mapped_column(String(1024), default="", nullable=False)
    original_title: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    series_name: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    season_name: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    index_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parent_index_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_created: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    premiere_date: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    production_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    overview: Mapped[str | None] = mapped_column(String(12000), nullable=True)
    provider_ids: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    core_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    provider_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class ConnectorSyncStageUser(Base):
    __tablename__ = "connector_sync_stage_users"

    sync_run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="CASCADE"), primary_key=True
    )
    remote_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class ConnectorSyncStageUserData(Base):
    __tablename__ = "connector_sync_stage_user_data"

    sync_run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="CASCADE"), primary_key=True
    )
    item_remote_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_remote_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    play_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    played: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    playback_position_ticks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_played_date: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class ConnectorSyncStagePlaybackEvent(Base):
    __tablename__ = "connector_sync_stage_playback_events"

    sync_run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    connection_id: Mapped[int] = mapped_column(
        ForeignKey("connector_connections.id", ondelete="CASCADE"), primary_key=True
    )
    remote_event_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    item_remote_id: Mapped[str] = mapped_column(String(255), nullable=False)
    user_remote_id: Mapped[str] = mapped_column(String(255), nullable=False)
    played_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class JellyfinConnection(TimestampMixin, Base):
    __tablename__ = "jellyfin_connection"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    base_url: Mapped[str] = mapped_column(String(2048), default="", nullable=False)
    api_key: Mapped[str] = mapped_column(String(2048), default="", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sync_interval_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    server_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    server_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_status: Mapped[str] = mapped_column(String(32), default="never", nullable=False)
    last_error: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    last_sync_started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    last_sync_finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    last_successful_sync_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class JellyfinSyncJob(Base):
    __tablename__ = "jellyfin_sync_jobs"
    __table_args__ = (
        Index("ix_jellyfin_sync_jobs_status", "status"),
        Index("ix_jellyfin_sync_jobs_queued_at", "queued_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[JobStatus] = mapped_column(
        SqlEnum(JobStatus, native_enum=False),
        default=JobStatus.queued,
        nullable=False,
    )
    trigger_source: Mapped[JellyfinSyncTriggerSource] = mapped_column(
        SqlEnum(JellyfinSyncTriggerSource, native_enum=False),
        default=JellyfinSyncTriggerSource.manual,
        nullable=False,
    )
    # SQLite permits multiple NULL values in a UNIQUE column. Keeping the
    # constant value 1 only while a job is active gives us a database-backed
    # single-flight lock across request and scheduler threads.
    active_lock: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    cancellation_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    heartbeat_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    progress_phase: Mapped[str | None] = mapped_column(String(64), nullable=True)
    progress_detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    progress_current: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    progress_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    queued_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    error: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    sync_summary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class JellyfinSyncStageLibrary(Base):
    __tablename__ = "jellyfin_sync_stage_libraries"
    __table_args__ = (Index("ix_jellyfin_sync_stage_libraries_run", "sync_run_id"),)

    sync_run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    remote_item_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    collection_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    locations: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    mapped_locations: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    mapped_status: Mapped[str] = mapped_column(String(32), nullable=False)
    linked_library_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    link_method: Mapped[str | None] = mapped_column(String(16), nullable=True)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class JellyfinSyncStageUser(Base):
    __tablename__ = "jellyfin_sync_stage_users"
    __table_args__ = (Index("ix_jellyfin_sync_stage_users_run", "sync_run_id"),)

    sync_run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    jellyfin_user_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    enabled_for_sync: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class JellyfinSyncStageItem(Base):
    __tablename__ = "jellyfin_sync_stage_items"
    __table_args__ = (
        Index("ix_jellyfin_sync_stage_items_run", "sync_run_id"),
        Index("ix_jellyfin_sync_stage_items_library", "sync_run_id", "library_remote_item_id"),
    )

    sync_run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    jellyfin_item_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    library_remote_item_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    library_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    item_type: Mapped[str] = mapped_column(String(64), nullable=False)
    path: Mapped[str | None] = mapped_column(String(4096), nullable=True)
    parent_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    series_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    season_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    title: Mapped[str] = mapped_column(String(1024), nullable=False)
    original_title: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    series_name: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    season_name: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    index_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parent_index_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_created: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    premiere_date: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    production_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    overview: Mapped[str | None] = mapped_column(String(12000), nullable=True)
    provider_ids: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    image_tags: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    backdrop_image_tags: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    raw_limited_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class JellyfinSyncStageUserData(Base):
    __tablename__ = "jellyfin_sync_stage_user_data"
    __table_args__ = (Index("ix_jellyfin_sync_stage_user_data_run", "sync_run_id"),)

    sync_run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    jellyfin_item_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    jellyfin_user_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    play_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    played: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    playback_position_ticks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_played_date: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class JellyfinSyncStagePlaybackEvent(Base):
    __tablename__ = "jellyfin_sync_stage_playback_events"
    __table_args__ = (Index("ix_jellyfin_sync_stage_playback_events_run", "sync_run_id"),)

    sync_run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    jellyfin_activity_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    jellyfin_item_id: Mapped[str] = mapped_column(String(128), nullable=False)
    jellyfin_user_id: Mapped[str] = mapped_column(String(128), nullable=False)
    played_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)


class JellyfinUser(TimestampMixin, Base):
    __tablename__ = "jellyfin_users"

    jellyfin_user_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    enabled_for_sync: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class JellyfinPathMapping(TimestampMixin, Base):
    __tablename__ = "jellyfin_path_mappings"
    __table_args__ = (Index("ix_jellyfin_path_mappings_enabled", "enabled"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    jellyfin_path_prefix: Mapped[str] = mapped_column(String(2048), nullable=False)
    medialyze_path_prefix: Mapped[str] = mapped_column(String(2048), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class JellyfinLibrary(TimestampMixin, Base):
    __tablename__ = "jellyfin_libraries"
    __table_args__ = (
        Index("ix_jellyfin_libraries_remote_item_id", "remote_item_id", unique=True),
        Index("ix_jellyfin_libraries_name", "name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    remote_item_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    collection_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    locations: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    mapped_locations: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    mapped_status: Mapped[str] = mapped_column(String(32), default="path_unmapped", nullable=False)
    linked_library_id: Mapped[int | None] = mapped_column(
        ForeignKey("libraries.id", ondelete="SET NULL"), nullable=True
    )
    link_method: Mapped[str | None] = mapped_column(String(16), nullable=True)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)


class JellyfinItem(TimestampMixin, Base):
    __tablename__ = "jellyfin_items"
    __table_args__ = (
        Index("ix_jellyfin_items_jellyfin_item_id", "jellyfin_item_id", unique=True),
        Index("ix_jellyfin_items_path", "path"),
        Index("ix_jellyfin_items_library_id", "library_id"),
        Index("ix_jellyfin_items_library_name", "library_name"),
        Index("ix_jellyfin_items_match_status", "match_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    jellyfin_item_id: Mapped[str] = mapped_column(String(128), nullable=False)
    library_id: Mapped[int | None] = mapped_column(
        ForeignKey("jellyfin_libraries.id", ondelete="SET NULL"), nullable=True
    )
    library_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    item_type: Mapped[str] = mapped_column(String(64), nullable=False)
    path: Mapped[str | None] = mapped_column(String(4096), nullable=True)
    parent_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    series_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    season_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    title: Mapped[str] = mapped_column(String(1024), nullable=False)
    original_title: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    series_name: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    season_name: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    index_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parent_index_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_created: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    premiere_date: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    production_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    overview: Mapped[str | None] = mapped_column(String(12000), nullable=True)
    provider_ids: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    image_tags: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    backdrop_image_tags: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    raw_limited_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    match_status: Mapped[str] = mapped_column(String(32), default="unmatched", nullable=False)
    mismatch_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    suggested_media_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("media_files.id", ondelete="SET NULL"), nullable=True
    )
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)


class JellyfinMediaMatch(TimestampMixin, Base):
    __tablename__ = "jellyfin_media_matches"
    __table_args__ = (
        Index("ix_jellyfin_media_matches_media_file", "media_file_id", unique=True),
        Index("ix_jellyfin_media_matches_item", "jellyfin_item_id", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    media_file_id: Mapped[int] = mapped_column(
        ForeignKey("media_files.id", ondelete="CASCADE"), nullable=False
    )
    jellyfin_item_id: Mapped[int] = mapped_column(
        ForeignKey("jellyfin_items.id", ondelete="CASCADE"), nullable=False
    )
    match_method: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="matched", nullable=False)
    mismatch_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)


class JellyfinUserItemData(Base):
    __tablename__ = "jellyfin_user_item_data"
    __table_args__ = (
        UniqueConstraint("jellyfin_item_id", "jellyfin_user_id", name="uq_jellyfin_user_item_data"),
        Index("ix_jellyfin_user_item_data_user", "jellyfin_user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    jellyfin_item_id: Mapped[int] = mapped_column(
        ForeignKey("jellyfin_items.id", ondelete="CASCADE"), nullable=False
    )
    jellyfin_user_id: Mapped[str] = mapped_column(
        ForeignKey("jellyfin_users.jellyfin_user_id", ondelete="CASCADE"), nullable=False
    )
    play_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    played: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    playback_position_ticks: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_played_date: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)


class JellyfinPlaybackEvent(Base):
    __tablename__ = "jellyfin_playback_events"
    __table_args__ = (
        Index("ix_jellyfin_playback_events_item_played_at", "jellyfin_item_id", "played_at"),
        Index("ix_jellyfin_playback_events_user", "jellyfin_user_id"),
    )

    jellyfin_activity_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    jellyfin_item_id: Mapped[int] = mapped_column(
        ForeignKey("jellyfin_items.id", ondelete="CASCADE"), nullable=False
    )
    jellyfin_user_id: Mapped[str] = mapped_column(
        ForeignKey("jellyfin_users.jellyfin_user_id", ondelete="CASCADE"), nullable=False
    )
    played_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)


class QualityProfileDefinition(TimestampMixin, Base):
    __tablename__ = "quality_profiles"
    __table_args__ = (
        UniqueConstraint("media_type", "name", name="uq_quality_profiles_media_type_name"),
        Index("ix_quality_profiles_media_type_default", "media_type", "is_default"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[QualityProfileMediaType] = mapped_column(
        SqlEnum(QualityProfileMediaType, native_enum=False),
        nullable=False,
    )
    profile: Mapped[dict] = mapped_column(JSON, default=default_quality_profile, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    libraries: Mapped[list[Library]] = relationship(
        back_populates="assigned_quality_profile",
        foreign_keys=[Library.quality_profile_id],
    )


class DuplicateGroupSuppression(TimestampMixin, Base):
    __tablename__ = "duplicate_group_suppressions"
    __table_args__ = (
        Index(
            "ix_duplicate_group_suppressions_library_mode_signature",
            "library_id",
            "mode",
            "signature",
            unique=True,
        ),
        Index("ix_duplicate_group_suppressions_library_mode", "library_id", "mode"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False)
    mode: Mapped[DuplicateDetectionMode] = mapped_column(
        SqlEnum(DuplicateDetectionMode, native_enum=False),
        nullable=False,
    )
    signature: Mapped[str] = mapped_column(String(512), nullable=False)

    library: Mapped[Library] = relationship(back_populates="duplicate_group_suppressions")


class MediaSeries(TimestampMixin, Base):
    __tablename__ = "media_series"
    __table_args__ = (
        Index("ix_media_series_library_normalized_title", "library_id", "normalized_title"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    normalized_title: Mapped[str] = mapped_column(String(512), nullable=False)
    relative_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)

    library: Mapped[Library] = relationship(back_populates="series_entries")
    seasons: Mapped[list[MediaSeason]] = relationship(
        back_populates="series",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    media_files: Mapped[list[MediaFile]] = relationship(back_populates="series")


class MediaSeason(TimestampMixin, Base):
    __tablename__ = "media_seasons"
    __table_args__ = (
        Index("ix_media_seasons_series_number", "series_id", "season_number"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False)
    series_id: Mapped[int] = mapped_column(ForeignKey("media_series.id", ondelete="CASCADE"), nullable=False)
    season_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    relative_path: Mapped[str] = mapped_column(String(2048), nullable=False)

    series: Mapped[MediaSeries] = relationship(back_populates="seasons")
    media_files: Mapped[list[MediaFile]] = relationship(back_populates="season")


class MediaFile(Base):
    __tablename__ = "media_files"
    __table_args__ = (
        Index("ix_media_files_library_root_relative_path", "library_id", "library_root_id", "relative_path", unique=True),
        Index("ix_media_files_scan_status", "scan_status"),
        Index("ix_media_files_quality_score", "quality_score"),
        Index("ix_media_files_library_size_bytes", "library_id", "size_bytes"),
        Index("ix_media_files_library_mtime", "library_id", "mtime"),
        Index("ix_media_files_library_last_analyzed_at", "library_id", "last_analyzed_at"),
        Index("ix_media_files_library_quality_score", "library_id", "quality_score"),
        Index("ix_media_files_library_filename_signature", "library_id", "filename_signature"),
        Index("ix_media_files_library_filename_pattern_signature", "library_id", "filename_pattern_signature"),
        Index("ix_media_files_library_content_hash", "library_id", "content_hash_algorithm", "content_hash"),
        Index("ix_media_files_library_extension", "library_id", "extension"),
        Index("ix_media_files_library_quality_score_raw", "library_id", "quality_score_raw"),
        Index("ix_media_files_library_duration_seconds", "library_id", "duration_seconds"),
        Index("ix_media_files_library_bitrate", "library_id", "bitrate"),
        Index("ix_media_files_library_audio_bitrate", "library_id", "audio_bitrate"),
        Index("ix_media_files_library_max_audio_bit_depth", "library_id", "max_audio_bit_depth"),
        Index("ix_media_files_library_primary_video_codec", "library_id", "primary_video_codec"),
        Index("ix_media_files_library_resolution_pixels", "library_id", "primary_video_resolution_pixels"),
        Index("ix_media_files_library_primary_video_hdr_type", "library_id", "primary_video_hdr_type"),
        Index("ix_media_files_library_chapter_count", "library_id", "chapter_count"),
        Index("ix_media_files_library_audiobook_narrator", "library_id", "audiobook_narrator"),
        Index("ix_media_files_library_audiobook_series", "library_id", "audiobook_series"),
        Index("ix_media_files_library_audiobook_author", "library_id", "audiobook_author"),
        Index("ix_media_files_library_audiobook_publisher", "library_id", "audiobook_publisher"),
        Index("ix_media_files_library_audiobook_series_part", "library_id", "audiobook_series_part"),
        Index("ix_media_files_library_content_category", "library_id", "content_category"),
        Index("ix_media_files_series_id", "series_id"),
        Index("ix_media_files_season_id", "season_id"),
        Index("ix_media_files_library_transcode_variant", "library_id", "is_transcode_variant"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False)
    library_root_id: Mapped[int | None] = mapped_column(ForeignKey("library_roots.id", ondelete="CASCADE"), nullable=True)
    relative_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    extension: Mapped[str] = mapped_column(String(32), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    mtime: Mapped[float] = mapped_column(Float, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)
    last_analyzed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    scan_status: Mapped[ScanStatus] = mapped_column(
        SqlEnum(ScanStatus, native_enum=False),
        default=ScanStatus.pending,
        nullable=False,
    )
    quality_score: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    quality_score_raw: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    quality_score_breakdown: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    raw_ffprobe_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    filename_signature: Mapped[str | None] = mapped_column(String(512), nullable=True)
    filename_pattern_signature: Mapped[str | None] = mapped_column(String(512), nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    content_hash_algorithm: Mapped[str | None] = mapped_column(String(32), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    bitrate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    audio_bitrate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_audio_bit_depth: Mapped[int | None] = mapped_column(Integer, nullable=True)
    primary_video_codec: Mapped[str | None] = mapped_column(String(64), nullable=True)
    primary_video_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    primary_video_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    primary_video_resolution_pixels: Mapped[int | None] = mapped_column(Integer, nullable=True)
    primary_video_hdr_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    min_audio_codec: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    min_audio_spatial_profile: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    min_audio_language: Mapped[str] = mapped_column(String(16), default="", nullable=False)
    audio_title: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    audio_artist: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    audio_album: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    audio_album_artist: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    audio_genre: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    audio_date: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    audio_disc: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    audio_composer: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    audio_channels: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sample_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    track_number: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    bit_rate_mode: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    has_embedded_cover: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    chapter_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chapter_titles_search: Mapped[str] = mapped_column(String(4096), default="", nullable=False)
    audiobook_narrator: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    audiobook_author: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    audiobook_publisher: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    audiobook_series: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    audiobook_series_part: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    audiobook_description: Mapped[str] = mapped_column(String(4096), default="", nullable=False)
    audiobook_copyright: Mapped[str] = mapped_column(String(1024), default="", nullable=False)
    audiobook_asin: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    audiobook_isbn: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    audiobook_language: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    audiobook_abridged: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    embedded_cover_stream_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    embedded_cover_codec: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    embedded_cover_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    embedded_cover_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    analysis_failure_kind: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    analysis_failure_reason: Mapped[str] = mapped_column(String(1024), default="", nullable=False)
    analysis_failure_detail: Mapped[str] = mapped_column(String(12000), default="", nullable=False)
    analysis_schema_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    min_subtitle_language: Mapped[str] = mapped_column(String(16), default="", nullable=False)
    min_subtitle_codec: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    audio_codecs_search: Mapped[str] = mapped_column(String(2048), default="", nullable=False)
    audio_spatial_profiles_search: Mapped[str] = mapped_column(String(1024), default="", nullable=False)
    audio_languages_search: Mapped[str] = mapped_column(String(1024), default="", nullable=False)
    audio_metadata_search: Mapped[str] = mapped_column(String(4096), default="", nullable=False)
    subtitle_languages_search: Mapped[str] = mapped_column(String(1024), default="", nullable=False)
    subtitle_codecs_search: Mapped[str] = mapped_column(String(1024), default="", nullable=False)
    subtitle_sources_search: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    has_internal_subtitles: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_external_subtitles: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    search_fields_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    content_category: Mapped[MediaContentCategory] = mapped_column(
        SqlEnum(MediaContentCategory, native_enum=False),
        default=MediaContentCategory.main,
        nullable=False,
    )
    series_id: Mapped[int | None] = mapped_column(ForeignKey("media_series.id", ondelete="SET NULL"), nullable=True)
    season_id: Mapped[int | None] = mapped_column(ForeignKey("media_seasons.id", ondelete="SET NULL"), nullable=True)
    episode_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    episode_number_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    episode_title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    recognition_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_transcode_variant: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    library: Mapped[Library] = relationship(back_populates="media_files")
    library_root: Mapped[LibraryRoot | None] = relationship(back_populates="media_files")
    series: Mapped[MediaSeries | None] = relationship(back_populates="media_files")
    season: Mapped[MediaSeason | None] = relationship(back_populates="media_files")
    media_format: Mapped[MediaFormat | None] = relationship(
        back_populates="media_file",
        cascade="all, delete-orphan",
        uselist=False,
        passive_deletes=True,
    )
    video_streams: Mapped[list[VideoStream]] = relationship(
        back_populates="media_file",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    audio_streams: Mapped[list[AudioStream]] = relationship(
        back_populates="media_file",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    chapters: Mapped[list[MediaChapter]] = relationship(
        back_populates="media_file",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="MediaChapter.chapter_index",
    )
    subtitle_streams: Mapped[list[SubtitleStream]] = relationship(
        back_populates="media_file",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    external_subtitles: Mapped[list[ExternalSubtitle]] = relationship(
        back_populates="media_file",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    history_entries: Mapped[list[MediaFileHistory]] = relationship(
        primaryjoin="foreign(MediaFileHistory.media_file_id) == MediaFile.id",
        cascade="save-update, merge",
        passive_deletes=True,
    )


class MediaFormat(Base):
    __tablename__ = "media_formats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    media_file_id: Mapped[int] = mapped_column(
        ForeignKey("media_files.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    container_format: Mapped[str | None] = mapped_column(String(255), nullable=True)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    bit_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    probe_score: Mapped[int | None] = mapped_column(Integer, nullable=True)

    media_file: Mapped[MediaFile] = relationship(back_populates="media_format")


class VideoStream(Base):
    __tablename__ = "video_streams"
    __table_args__ = (
        Index("ix_video_streams_codec", "codec"),
        Index("ix_video_streams_bit_depth", "bit_depth"),
        Index("ix_video_streams_resolution", "width", "height"),
        Index("ix_video_streams_hdr_type", "hdr_type"),
        Index("ix_video_streams_media_file_stream_index", "media_file_id", "stream_index"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    media_file_id: Mapped[int] = mapped_column(ForeignKey("media_files.id", ondelete="CASCADE"), nullable=False)
    stream_index: Mapped[int] = mapped_column(Integer, nullable=False)
    codec: Mapped[str | None] = mapped_column(String(64), nullable=True)
    profile: Mapped[str | None] = mapped_column(String(128), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pix_fmt: Mapped[str | None] = mapped_column(String(64), nullable=True)
    color_space: Mapped[str | None] = mapped_column(String(64), nullable=True)
    color_transfer: Mapped[str | None] = mapped_column(String(64), nullable=True)
    color_primaries: Mapped[str | None] = mapped_column(String(64), nullable=True)
    frame_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    bit_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bit_depth: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hdr_type: Mapped[str | None] = mapped_column(String(64), nullable=True)

    media_file: Mapped[MediaFile] = relationship(back_populates="video_streams")


class AudioStream(Base):
    __tablename__ = "audio_streams"
    __table_args__ = (
        Index("ix_audio_streams_codec", "codec"),
        Index("ix_audio_streams_spatial_audio_profile", "spatial_audio_profile"),
        Index("ix_audio_streams_layout", "channel_layout"),
        Index("ix_audio_streams_language", "language"),
        Index("ix_audio_streams_media_file_id", "media_file_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    media_file_id: Mapped[int] = mapped_column(ForeignKey("media_files.id", ondelete="CASCADE"), nullable=False)
    stream_index: Mapped[int] = mapped_column(Integer, nullable=False)
    codec: Mapped[str | None] = mapped_column(String(64), nullable=True)
    profile: Mapped[str | None] = mapped_column(String(128), nullable=True)
    spatial_audio_profile: Mapped[str | None] = mapped_column(String(32), nullable=True)
    channels: Mapped[int | None] = mapped_column(Integer, nullable=True)
    channel_layout: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sample_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bit_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bit_depth: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bit_rate_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    compression_mode: Mapped[str | None] = mapped_column(String(64), nullable=True)
    replay_gain: Mapped[str | None] = mapped_column(String(64), nullable=True)
    replay_gain_peak: Mapped[str | None] = mapped_column(String(64), nullable=True)
    writing_library: Mapped[str | None] = mapped_column(String(512), nullable=True)
    md5_unencoded: Mapped[str | None] = mapped_column(String(64), nullable=True)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    default_flag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    forced_flag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Music-specific metadata
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    artist: Mapped[str | None] = mapped_column(String(512), nullable=True)
    album: Mapped[str | None] = mapped_column(String(512), nullable=True)
    album_artist: Mapped[str | None] = mapped_column(String(512), nullable=True)
    genre: Mapped[str | None] = mapped_column(String(256), nullable=True)
    date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    disc: Mapped[str | None] = mapped_column(String(32), nullable=True)
    composer: Mapped[str | None] = mapped_column(String(512), nullable=True)
    track: Mapped[str | None] = mapped_column(String(32), nullable=True)

    media_file: Mapped[MediaFile] = relationship(back_populates="audio_streams")


class MediaChapter(Base):
    __tablename__ = "media_chapters"
    __table_args__ = (
        Index("ix_media_chapters_media_file_id", "media_file_id"),
        Index("ix_media_chapters_media_file_index", "media_file_id", "chapter_index"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    media_file_id: Mapped[int] = mapped_column(ForeignKey("media_files.id", ondelete="CASCADE"), nullable=False)
    chapter_index: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_time: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    tags: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    media_file: Mapped[MediaFile] = relationship(back_populates="chapters")


class SubtitleStream(Base):
    __tablename__ = "subtitle_streams"
    __table_args__ = (
        Index("ix_subtitle_streams_codec", "codec"),
        Index("ix_subtitle_streams_language", "language"),
        Index("ix_subtitle_streams_media_file_id", "media_file_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    media_file_id: Mapped[int] = mapped_column(ForeignKey("media_files.id", ondelete="CASCADE"), nullable=False)
    stream_index: Mapped[int] = mapped_column(Integer, nullable=False)
    codec: Mapped[str | None] = mapped_column(String(64), nullable=True)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    default_flag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    forced_flag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    subtitle_type: Mapped[str | None] = mapped_column(String(32), nullable=True)

    media_file: Mapped[MediaFile] = relationship(back_populates="subtitle_streams")


class ExternalSubtitle(Base):
    __tablename__ = "external_subtitles"
    __table_args__ = (
        Index("ix_external_subtitles_language", "language"),
        Index("ix_external_subtitles_media_file_id", "media_file_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    media_file_id: Mapped[int] = mapped_column(ForeignKey("media_files.id", ondelete="CASCADE"), nullable=False)
    path: Mapped[str] = mapped_column(String(2048), nullable=False)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    format: Mapped[str | None] = mapped_column(String(32), nullable=True)

    media_file: Mapped[MediaFile] = relationship(back_populates="external_subtitles")


class ScanJob(Base):
    __tablename__ = "scan_jobs"
    __table_args__ = (
        Index("ix_scan_jobs_status", "status"),
        Index("ix_scan_jobs_library_id", "library_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[JobStatus] = mapped_column(
        SqlEnum(JobStatus, native_enum=False),
        default=JobStatus.queued,
        nullable=False,
    )
    job_type: Mapped[str] = mapped_column(String(32), nullable=False)
    discovered_files: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    unchanged_files: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    discovery_complete: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    new_files_live: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    deleted_files_live: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    modified_files_live: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    files_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    files_scanned: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    errors: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    trigger_source: Mapped[ScanTriggerSource] = mapped_column(
        SqlEnum(ScanTriggerSource, native_enum=False),
        default=ScanTriggerSource.manual,
        nullable=False,
    )
    trigger_details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    scan_summary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    library: Mapped[Library] = relationship(back_populates="scan_jobs")


class TranscodeVariantGroup(TimestampMixin, Base):
    __tablename__ = "transcode_variant_groups"
    __table_args__ = (
        Index("ix_transcode_variant_groups_library", "library_id"),
        Index("ix_transcode_variant_groups_original_file", "original_file_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False
    )
    original_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("media_files.id", ondelete="SET NULL"), nullable=True
    )
    original_library_root_id: Mapped[int | None] = mapped_column(
        ForeignKey("library_roots.id", ondelete="SET NULL"), nullable=True
    )
    original_relative_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)


class TranscodeJob(TimestampMixin, Base):
    __tablename__ = "transcode_jobs"
    __table_args__ = (
        Index("ix_transcode_jobs_status", "status"),
        Index("ix_transcode_jobs_library", "library_id"),
        Index("ix_transcode_jobs_source_file", "source_file_id"),
        Index("ix_transcode_jobs_finished_at", "finished_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("transcode_variant_groups.id", ondelete="CASCADE"), nullable=False
    )
    library_id: Mapped[int] = mapped_column(
        ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False
    )
    source_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("media_files.id", ondelete="SET NULL"), nullable=True
    )
    result_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("media_files.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[JobStatus] = mapped_column(
        SqlEnum(JobStatus, native_enum=False), default=JobStatus.queued, nullable=False
    )
    profile: Mapped[str] = mapped_column(String(64), nullable=False)
    plan_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    plan: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    ffmpeg_arguments: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    ffmpeg_command: Mapped[str] = mapped_column(String(32000), default="", nullable=False)
    warnings: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    source_path_snapshot: Mapped[str] = mapped_column(String(4096), nullable=False)
    source_size_snapshot: Mapped[int] = mapped_column(Integer, nullable=False)
    source_mtime_snapshot: Mapped[float] = mapped_column(Float, nullable=False)
    output_path_snapshot: Mapped[str] = mapped_column(String(4096), nullable=False)
    output_relative_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    output_mode: Mapped[str] = mapped_column(String(32), default="same_directory", nullable=False)
    output_storage_root: Mapped[str | None] = mapped_column(String(4096), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cpu_budget_percent: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cpu_thread_budget: Mapped[int | None] = mapped_column(Integer, nullable=True)
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    hardware_backend: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ffmpeg_version: Mapped[str | None] = mapped_column(String(512), nullable=True)
    remove_partial_output: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    on_error: Mapped[str] = mapped_column(String(16), default="continue", nullable=False)
    temporary_path: Mapped[str | None] = mapped_column(String(4096), nullable=True)
    progress_percent: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    processed_seconds: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    speed: Mapped[str | None] = mapped_column(String(64), nullable=True)
    eta_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    error: Mapped[str | None] = mapped_column(String(32000), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class TranscodeVariant(TimestampMixin, Base):
    __tablename__ = "transcode_variants"
    __table_args__ = (
        Index("ix_transcode_variants_group", "group_id"),
        Index("ix_transcode_variants_original_file", "original_file_id"),
        Index("ix_transcode_variants_output_file", "output_file_id"),
        Index("ix_transcode_variants_job", "job_id", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("transcode_variant_groups.id", ondelete="CASCADE"), nullable=False
    )
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("transcode_jobs.id", ondelete="SET NULL"), nullable=True
    )
    original_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("media_files.id", ondelete="SET NULL"), nullable=True
    )
    output_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("media_files.id", ondelete="SET NULL"), nullable=True
    )
    library_root_id: Mapped[int | None] = mapped_column(
        ForeignKey("library_roots.id", ondelete="SET NULL"), nullable=True
    )
    output_relative_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    output_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    output_mode: Mapped[str] = mapped_column(String(32), default="same_directory", nullable=False)
    source_path_snapshot: Mapped[str] = mapped_column(String(4096), nullable=False)
    output_path_snapshot: Mapped[str] = mapped_column(String(4096), nullable=False)
    analysis_status: Mapped[str] = mapped_column(
        String(32), default="awaiting_analysis", nullable=False
    )


class MediaFileHistory(Base):
    __tablename__ = "media_file_history"
    __table_args__ = (
        Index("ix_media_file_history_library_path_captured_at", "library_id", "relative_path", "captured_at"),
        Index("ix_media_file_history_captured_at", "captured_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False)
    library_root_id: Mapped[int | None] = mapped_column(
        ForeignKey("library_roots.id", ondelete="SET NULL"), nullable=True
    )
    root_alias: Mapped[str | None] = mapped_column(String(255), nullable=True)
    media_file_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    relative_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)
    capture_reason: Mapped[MediaFileHistoryCaptureReason] = mapped_column(
        SqlEnum(MediaFileHistoryCaptureReason, native_enum=False),
        nullable=False,
    )
    snapshot_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    library: Mapped[Library] = relationship(back_populates="media_file_history_entries")


class LibraryHistory(Base):
    __tablename__ = "library_history"
    __table_args__ = (
        Index("ix_library_history_library_snapshot_day", "library_id", "snapshot_day", unique=True),
        Index("ix_library_history_captured_at", "captured_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False)
    snapshot_day: Mapped[str] = mapped_column(String(10), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, nullable=False)
    source_scan_job_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    library: Mapped[Library] = relationship(back_populates="library_history_entries")
