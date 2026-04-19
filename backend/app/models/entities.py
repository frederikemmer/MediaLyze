from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, Boolean, Enum as SqlEnum, Float, ForeignKey, Index, Integer, String
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
    mixed = "mixed"
    other = "other"


class ScanMode(str, Enum):
    manual = "manual"
    scheduled = "scheduled"
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


class ScanTriggerSource(str, Enum):
    manual = "manual"
    scheduled = "scheduled"
    watchdog = "watchdog"


class MediaFileHistoryCaptureReason(str, Enum):
    scan_analysis = "scan_analysis"
    quality_recompute = "quality_recompute"


class Library(TimestampMixin, Base):
    __tablename__ = "libraries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    path: Mapped[str] = mapped_column(String(2048), nullable=False, unique=True)
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
    show_on_dashboard: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    media_files: Mapped[list[MediaFile]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        passive_deletes=True,
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
    library_history_entries: Mapped[list[LibraryHistory]] = relationship(
        back_populates="library",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class MediaFile(Base):
    __tablename__ = "media_files"
    __table_args__ = (
        Index("ix_media_files_library_relative_path", "library_id", "relative_path", unique=True),
        Index("ix_media_files_scan_status", "scan_status"),
        Index("ix_media_files_quality_score", "quality_score"),
        Index("ix_media_files_library_size_bytes", "library_id", "size_bytes"),
        Index("ix_media_files_library_mtime", "library_id", "mtime"),
        Index("ix_media_files_library_last_analyzed_at", "library_id", "last_analyzed_at"),
        Index("ix_media_files_library_quality_score", "library_id", "quality_score"),
        Index("ix_media_files_library_filename_signature", "library_id", "filename_signature"),
        Index("ix_media_files_library_content_hash", "library_id", "content_hash_algorithm", "content_hash"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False)
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
    content_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    content_hash_algorithm: Mapped[str | None] = mapped_column(String(32), nullable=True)

    library: Mapped[Library] = relationship(back_populates="media_files")
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
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    default_flag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    forced_flag: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    media_file: Mapped[MediaFile] = relationship(back_populates="audio_streams")


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


class MediaFileHistory(Base):
    __tablename__ = "media_file_history"
    __table_args__ = (
        Index("ix_media_file_history_library_path_captured_at", "library_id", "relative_path", "captured_at"),
        Index("ix_media_file_history_captured_at", "captured_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    library_id: Mapped[int] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False)
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
