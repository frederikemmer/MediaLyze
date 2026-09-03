import json
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from backend.app.core.config import Settings, get_settings
from backend.app.services.quality import default_quality_profile


def _sqlite_url(database_path: Path) -> str:
    return f"sqlite:///{database_path}"


def create_engine_for_settings(settings: Settings) -> Engine:
    busy_timeout_ms = int(settings.sqlite_busy_timeout_seconds * 1000)
    engine = create_engine(
        _sqlite_url(settings.database_path),
        connect_args={"check_same_thread": False, "timeout": settings.sqlite_busy_timeout_seconds},
        poolclass=NullPool,
        future=True,
    )

    @event.listens_for(engine, "connect")
    def _configure_sqlite(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON;")
        cursor.execute("PRAGMA journal_mode = WAL;")
        cursor.execute("PRAGMA synchronous = NORMAL;")
        cursor.execute("PRAGMA temp_store = MEMORY;")
        cursor.execute(f"PRAGMA busy_timeout = {busy_timeout_ms};")
        cursor.close()

    return engine


SETTINGS = get_settings()
ENGINE = create_engine_for_settings(SETTINGS)
SessionLocal = sessionmaker(bind=ENGINE, autoflush=False, autocommit=False, expire_on_commit=False)


SQLITE_ADDITIVE_COLUMNS: dict[str, dict[str, str]] = {
    "connector_connections": {
        "path_mapping_mode": (
            "ALTER TABLE connector_connections ADD COLUMN path_mapping_mode "
            "VARCHAR(16) NOT NULL DEFAULT 'automatic'"
        ),
        "library_mapping_mode": (
            "ALTER TABLE connector_connections ADD COLUMN library_mapping_mode "
            "VARCHAR(16) NOT NULL DEFAULT 'automatic'"
        ),
    },
    "connector_root_bindings": {
        "origin": (
            "ALTER TABLE connector_root_bindings ADD COLUMN origin "
            "VARCHAR(16) NOT NULL DEFAULT 'imported'"
        ),
        "confidence": (
            "ALTER TABLE connector_root_bindings ADD COLUMN confidence FLOAT NOT NULL DEFAULT 1"
        ),
        "evidence_count": (
            "ALTER TABLE connector_root_bindings ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0"
        ),
        "verification_status": (
            "ALTER TABLE connector_root_bindings ADD COLUMN verification_status "
            "VARCHAR(16) NOT NULL DEFAULT 'imported'"
        ),
        "last_verified_at": (
            "ALTER TABLE connector_root_bindings ADD COLUMN last_verified_at DATETIME"
        ),
    },
    "libraries": {
        "last_scan_at": "ALTER TABLE libraries ADD COLUMN last_scan_at DATETIME",
        "scan_mode": "ALTER TABLE libraries ADD COLUMN scan_mode VARCHAR(16) NOT NULL DEFAULT 'manual'",
        "duplicate_detection_mode": (
            "ALTER TABLE libraries ADD COLUMN duplicate_detection_mode "
            "VARCHAR(16) NOT NULL DEFAULT 'off'"
        ),
        "scan_config": "ALTER TABLE libraries ADD COLUMN scan_config JSON NOT NULL DEFAULT '{}'",
        "quality_profile": "ALTER TABLE libraries ADD COLUMN quality_profile JSON NOT NULL DEFAULT '{}'",
        "quality_profile_id": "ALTER TABLE libraries ADD COLUMN quality_profile_id INTEGER",
        "show_on_dashboard": "ALTER TABLE libraries ADD COLUMN show_on_dashboard BOOLEAN NOT NULL DEFAULT 1",
        "history_added_date_source": (
            "ALTER TABLE libraries ADD COLUMN history_added_date_source "
            "VARCHAR(16) NOT NULL DEFAULT 'medialyze'"
        ),
        "preferred_connector_connection_id": (
            "ALTER TABLE libraries ADD COLUMN preferred_connector_connection_id INTEGER "
            "REFERENCES connector_connections(id) ON DELETE SET NULL"
        ),
        "created_at": "ALTER TABLE libraries ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
        "updated_at": "ALTER TABLE libraries ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
    },
    "quality_profiles": {
        "is_builtin": "ALTER TABLE quality_profiles ADD COLUMN is_builtin BOOLEAN NOT NULL DEFAULT 0",
    },
    "jellyfin_libraries": {
        "link_method": "ALTER TABLE jellyfin_libraries ADD COLUMN link_method VARCHAR(16)",
        "remote_item_id": "ALTER TABLE jellyfin_libraries ADD COLUMN remote_item_id VARCHAR(128)",
    },
    "jellyfin_items": {
        "library_id": "ALTER TABLE jellyfin_items ADD COLUMN library_id INTEGER REFERENCES jellyfin_libraries(id) ON DELETE SET NULL",
        "size_bytes": "ALTER TABLE jellyfin_items ADD COLUMN size_bytes INTEGER",
        "duration_seconds": "ALTER TABLE jellyfin_items ADD COLUMN duration_seconds FLOAT",
    },
    "jellyfin_sync_jobs": {
        "trigger_source": (
            "ALTER TABLE jellyfin_sync_jobs ADD COLUMN trigger_source "
            "VARCHAR(9) NOT NULL DEFAULT 'manual'"
        ),
        "active_lock": "ALTER TABLE jellyfin_sync_jobs ADD COLUMN active_lock INTEGER",
        "cancellation_requested": (
            "ALTER TABLE jellyfin_sync_jobs ADD COLUMN cancellation_requested "
            "BOOLEAN NOT NULL DEFAULT 0"
        ),
        "heartbeat_at": "ALTER TABLE jellyfin_sync_jobs ADD COLUMN heartbeat_at DATETIME",
        "progress_phase": "ALTER TABLE jellyfin_sync_jobs ADD COLUMN progress_phase VARCHAR(64)",
        "progress_detail": "ALTER TABLE jellyfin_sync_jobs ADD COLUMN progress_detail VARCHAR(512)",
        "progress_current": (
            "ALTER TABLE jellyfin_sync_jobs ADD COLUMN progress_current INTEGER NOT NULL DEFAULT 0"
        ),
        "progress_total": "ALTER TABLE jellyfin_sync_jobs ADD COLUMN progress_total INTEGER",
        "started_at": "ALTER TABLE jellyfin_sync_jobs ADD COLUMN started_at DATETIME",
        "finished_at": "ALTER TABLE jellyfin_sync_jobs ADD COLUMN finished_at DATETIME",
        "error": "ALTER TABLE jellyfin_sync_jobs ADD COLUMN error VARCHAR(2048)",
        "sync_summary": (
            "ALTER TABLE jellyfin_sync_jobs ADD COLUMN sync_summary JSON NOT NULL DEFAULT '{}'"
        ),
    },
    "media_file_history": {
        "library_root_id": (
            "ALTER TABLE media_file_history ADD COLUMN library_root_id INTEGER "
            "REFERENCES library_roots(id) ON DELETE SET NULL"
        ),
        "root_alias": "ALTER TABLE media_file_history ADD COLUMN root_alias VARCHAR(255)",
    },
    "connector_sync_stage_items": {
        "original_title": "ALTER TABLE connector_sync_stage_items ADD COLUMN original_title VARCHAR(1024)",
        "series_name": "ALTER TABLE connector_sync_stage_items ADD COLUMN series_name VARCHAR(1024)",
        "season_name": "ALTER TABLE connector_sync_stage_items ADD COLUMN season_name VARCHAR(1024)",
        "index_number": "ALTER TABLE connector_sync_stage_items ADD COLUMN index_number INTEGER",
        "parent_index_number": "ALTER TABLE connector_sync_stage_items ADD COLUMN parent_index_number INTEGER",
        "date_created": "ALTER TABLE connector_sync_stage_items ADD COLUMN date_created DATETIME",
        "premiere_date": "ALTER TABLE connector_sync_stage_items ADD COLUMN premiere_date DATETIME",
        "production_year": "ALTER TABLE connector_sync_stage_items ADD COLUMN production_year INTEGER",
        "overview": "ALTER TABLE connector_sync_stage_items ADD COLUMN overview VARCHAR(12000)",
        "provider_ids": "ALTER TABLE connector_sync_stage_items ADD COLUMN provider_ids JSON NOT NULL DEFAULT '{}'",
        "size_bytes": "ALTER TABLE connector_sync_stage_items ADD COLUMN size_bytes INTEGER",
        "duration_seconds": "ALTER TABLE connector_sync_stage_items ADD COLUMN duration_seconds FLOAT",
    },
    "connector_items": {
        "resolved_library_root_id": (
            "ALTER TABLE connector_items ADD COLUMN resolved_library_root_id INTEGER "
            "REFERENCES library_roots(id) ON DELETE SET NULL"
        ),
        "resolved_relative_path": "ALTER TABLE connector_items ADD COLUMN resolved_relative_path VARCHAR(2048)",
        "resolved_relative_path_key": "ALTER TABLE connector_items ADD COLUMN resolved_relative_path_key VARCHAR(2048)",
        "resolved_binding_id": (
            "ALTER TABLE connector_items ADD COLUMN resolved_binding_id INTEGER "
            "REFERENCES connector_root_bindings(id) ON DELETE SET NULL"
        ),
    },
    "connector_sync_jobs": {
        "job_type": "ALTER TABLE connector_sync_jobs ADD COLUMN job_type VARCHAR(24) NOT NULL DEFAULT 'sync'",
        "sync_run_id": "ALTER TABLE connector_sync_jobs ADD COLUMN sync_run_id VARCHAR(64)",
    },
    "media_files": {
        "library_root_id": "ALTER TABLE media_files ADD COLUMN library_root_id INTEGER",
        "last_seen_at": "ALTER TABLE media_files ADD COLUMN last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
        "last_analyzed_at": "ALTER TABLE media_files ADD COLUMN last_analyzed_at DATETIME",
        "scan_status": "ALTER TABLE media_files ADD COLUMN scan_status VARCHAR(16) NOT NULL DEFAULT 'pending'",
        "quality_score": "ALTER TABLE media_files ADD COLUMN quality_score INTEGER NOT NULL DEFAULT 1",
        "quality_score_raw": "ALTER TABLE media_files ADD COLUMN quality_score_raw FLOAT NOT NULL DEFAULT 0",
        "quality_score_breakdown": "ALTER TABLE media_files ADD COLUMN quality_score_breakdown JSON",
        "raw_ffprobe_json": "ALTER TABLE media_files ADD COLUMN raw_ffprobe_json JSON",
        "filename_signature": "ALTER TABLE media_files ADD COLUMN filename_signature VARCHAR(512)",
        "filename_pattern_signature": "ALTER TABLE media_files ADD COLUMN filename_pattern_signature VARCHAR(512)",
        "content_hash": "ALTER TABLE media_files ADD COLUMN content_hash VARCHAR(128)",
        "content_hash_algorithm": "ALTER TABLE media_files ADD COLUMN content_hash_algorithm VARCHAR(32)",
        "duration_seconds": "ALTER TABLE media_files ADD COLUMN duration_seconds FLOAT",
        "bitrate": "ALTER TABLE media_files ADD COLUMN bitrate INTEGER",
        "audio_bitrate": "ALTER TABLE media_files ADD COLUMN audio_bitrate INTEGER",
        "max_audio_bit_depth": "ALTER TABLE media_files ADD COLUMN max_audio_bit_depth INTEGER",
        "primary_video_codec": "ALTER TABLE media_files ADD COLUMN primary_video_codec VARCHAR(64)",
        "primary_video_width": "ALTER TABLE media_files ADD COLUMN primary_video_width INTEGER",
        "primary_video_height": "ALTER TABLE media_files ADD COLUMN primary_video_height INTEGER",
        "primary_video_resolution_pixels": "ALTER TABLE media_files ADD COLUMN primary_video_resolution_pixels INTEGER",
        "primary_video_hdr_type": "ALTER TABLE media_files ADD COLUMN primary_video_hdr_type VARCHAR(64)",
        "min_audio_codec": "ALTER TABLE media_files ADD COLUMN min_audio_codec VARCHAR(64) NOT NULL DEFAULT ''",
        "min_audio_spatial_profile": "ALTER TABLE media_files ADD COLUMN min_audio_spatial_profile VARCHAR(64) NOT NULL DEFAULT ''",
        "min_audio_language": "ALTER TABLE media_files ADD COLUMN min_audio_language VARCHAR(16) NOT NULL DEFAULT ''",
        "audio_title": "ALTER TABLE media_files ADD COLUMN audio_title VARCHAR(512) NOT NULL DEFAULT ''",
        "audio_artist": "ALTER TABLE media_files ADD COLUMN audio_artist VARCHAR(512) NOT NULL DEFAULT ''",
        "audio_album": "ALTER TABLE media_files ADD COLUMN audio_album VARCHAR(512) NOT NULL DEFAULT ''",
        "audio_album_artist": "ALTER TABLE media_files ADD COLUMN audio_album_artist VARCHAR(512) NOT NULL DEFAULT ''",
        "audio_genre": "ALTER TABLE media_files ADD COLUMN audio_genre VARCHAR(256) NOT NULL DEFAULT ''",
        "audio_date": "ALTER TABLE media_files ADD COLUMN audio_date VARCHAR(32) NOT NULL DEFAULT ''",
        "audio_disc": "ALTER TABLE media_files ADD COLUMN audio_disc VARCHAR(32) NOT NULL DEFAULT ''",
        "audio_composer": "ALTER TABLE media_files ADD COLUMN audio_composer VARCHAR(512) NOT NULL DEFAULT ''",
        "audio_channels": "ALTER TABLE media_files ADD COLUMN audio_channels INTEGER",
        "sample_rate": "ALTER TABLE media_files ADD COLUMN sample_rate INTEGER",
        "track_number": "ALTER TABLE media_files ADD COLUMN track_number VARCHAR(32) NOT NULL DEFAULT ''",
        "bit_rate_mode": "ALTER TABLE media_files ADD COLUMN bit_rate_mode VARCHAR(32) NOT NULL DEFAULT ''",
        "has_embedded_cover": "ALTER TABLE media_files ADD COLUMN has_embedded_cover BOOLEAN NOT NULL DEFAULT 0",
        "chapter_count": "ALTER TABLE media_files ADD COLUMN chapter_count INTEGER",
        "chapter_titles_search": "ALTER TABLE media_files ADD COLUMN chapter_titles_search VARCHAR(4096) NOT NULL DEFAULT ''",
        "audiobook_narrator": "ALTER TABLE media_files ADD COLUMN audiobook_narrator VARCHAR(512) NOT NULL DEFAULT ''",
        "audiobook_author": "ALTER TABLE media_files ADD COLUMN audiobook_author VARCHAR(512) NOT NULL DEFAULT ''",
        "audiobook_publisher": "ALTER TABLE media_files ADD COLUMN audiobook_publisher VARCHAR(512) NOT NULL DEFAULT ''",
        "audiobook_series": "ALTER TABLE media_files ADD COLUMN audiobook_series VARCHAR(512) NOT NULL DEFAULT ''",
        "audiobook_series_part": "ALTER TABLE media_files ADD COLUMN audiobook_series_part VARCHAR(64) NOT NULL DEFAULT ''",
        "audiobook_description": "ALTER TABLE media_files ADD COLUMN audiobook_description VARCHAR(4096) NOT NULL DEFAULT ''",
        "audiobook_copyright": "ALTER TABLE media_files ADD COLUMN audiobook_copyright VARCHAR(1024) NOT NULL DEFAULT ''",
        "audiobook_asin": "ALTER TABLE media_files ADD COLUMN audiobook_asin VARCHAR(64) NOT NULL DEFAULT ''",
        "audiobook_isbn": "ALTER TABLE media_files ADD COLUMN audiobook_isbn VARCHAR(64) NOT NULL DEFAULT ''",
        "audiobook_language": "ALTER TABLE media_files ADD COLUMN audiobook_language VARCHAR(64) NOT NULL DEFAULT ''",
        "audiobook_abridged": "ALTER TABLE media_files ADD COLUMN audiobook_abridged VARCHAR(32) NOT NULL DEFAULT ''",
        "embedded_cover_stream_index": "ALTER TABLE media_files ADD COLUMN embedded_cover_stream_index INTEGER",
        "embedded_cover_codec": "ALTER TABLE media_files ADD COLUMN embedded_cover_codec VARCHAR(64) NOT NULL DEFAULT ''",
        "embedded_cover_width": "ALTER TABLE media_files ADD COLUMN embedded_cover_width INTEGER",
        "embedded_cover_height": "ALTER TABLE media_files ADD COLUMN embedded_cover_height INTEGER",
        "analysis_failure_kind": "ALTER TABLE media_files ADD COLUMN analysis_failure_kind VARCHAR(64) NOT NULL DEFAULT ''",
        "analysis_failure_reason": "ALTER TABLE media_files ADD COLUMN analysis_failure_reason VARCHAR(1024) NOT NULL DEFAULT ''",
        "analysis_failure_detail": "ALTER TABLE media_files ADD COLUMN analysis_failure_detail VARCHAR(12000) NOT NULL DEFAULT ''",
        "analysis_schema_version": "ALTER TABLE media_files ADD COLUMN analysis_schema_version INTEGER NOT NULL DEFAULT 0",
        "min_subtitle_language": "ALTER TABLE media_files ADD COLUMN min_subtitle_language VARCHAR(16) NOT NULL DEFAULT ''",
        "min_subtitle_codec": "ALTER TABLE media_files ADD COLUMN min_subtitle_codec VARCHAR(64) NOT NULL DEFAULT ''",
        "audio_codecs_search": "ALTER TABLE media_files ADD COLUMN audio_codecs_search VARCHAR(2048) NOT NULL DEFAULT ''",
        "audio_spatial_profiles_search": "ALTER TABLE media_files ADD COLUMN audio_spatial_profiles_search VARCHAR(1024) NOT NULL DEFAULT ''",
        "audio_languages_search": "ALTER TABLE media_files ADD COLUMN audio_languages_search VARCHAR(1024) NOT NULL DEFAULT ''",
        "audio_metadata_search": "ALTER TABLE media_files ADD COLUMN audio_metadata_search VARCHAR(4096) NOT NULL DEFAULT ''",
        "subtitle_languages_search": "ALTER TABLE media_files ADD COLUMN subtitle_languages_search VARCHAR(1024) NOT NULL DEFAULT ''",
        "subtitle_codecs_search": "ALTER TABLE media_files ADD COLUMN subtitle_codecs_search VARCHAR(1024) NOT NULL DEFAULT ''",
        "subtitle_sources_search": "ALTER TABLE media_files ADD COLUMN subtitle_sources_search VARCHAR(64) NOT NULL DEFAULT ''",
        "has_internal_subtitles": "ALTER TABLE media_files ADD COLUMN has_internal_subtitles BOOLEAN NOT NULL DEFAULT 0",
        "has_external_subtitles": "ALTER TABLE media_files ADD COLUMN has_external_subtitles BOOLEAN NOT NULL DEFAULT 0",
        "search_fields_version": "ALTER TABLE media_files ADD COLUMN search_fields_version INTEGER NOT NULL DEFAULT 0",
        "content_category": "ALTER TABLE media_files ADD COLUMN content_category VARCHAR(16) NOT NULL DEFAULT 'main'",
        "series_id": "ALTER TABLE media_files ADD COLUMN series_id INTEGER",
        "season_id": "ALTER TABLE media_files ADD COLUMN season_id INTEGER",
        "episode_number": "ALTER TABLE media_files ADD COLUMN episode_number INTEGER",
        "episode_number_end": "ALTER TABLE media_files ADD COLUMN episode_number_end INTEGER",
        "episode_title": "ALTER TABLE media_files ADD COLUMN episode_title VARCHAR(512)",
        "recognition_details": "ALTER TABLE media_files ADD COLUMN recognition_details JSON",
        "is_transcode_variant": "ALTER TABLE media_files ADD COLUMN is_transcode_variant BOOLEAN NOT NULL DEFAULT 0",
    },
    "media_formats": {
        "bit_rate": "ALTER TABLE media_formats ADD COLUMN bit_rate INTEGER",
        "probe_score": "ALTER TABLE media_formats ADD COLUMN probe_score INTEGER",
    },
    "video_streams": {
        "profile": "ALTER TABLE video_streams ADD COLUMN profile VARCHAR(128)",
        "pix_fmt": "ALTER TABLE video_streams ADD COLUMN pix_fmt VARCHAR(64)",
        "color_space": "ALTER TABLE video_streams ADD COLUMN color_space VARCHAR(64)",
        "color_transfer": "ALTER TABLE video_streams ADD COLUMN color_transfer VARCHAR(64)",
        "color_primaries": "ALTER TABLE video_streams ADD COLUMN color_primaries VARCHAR(64)",
        "frame_rate": "ALTER TABLE video_streams ADD COLUMN frame_rate FLOAT",
        "bit_rate": "ALTER TABLE video_streams ADD COLUMN bit_rate INTEGER",
        "bit_depth": "ALTER TABLE video_streams ADD COLUMN bit_depth INTEGER",
        "hdr_type": "ALTER TABLE video_streams ADD COLUMN hdr_type VARCHAR(64)",
    },
    "audio_streams": {
        "codec": "ALTER TABLE audio_streams ADD COLUMN codec VARCHAR(64)",
        "profile": "ALTER TABLE audio_streams ADD COLUMN profile VARCHAR(128)",
        "spatial_audio_profile": "ALTER TABLE audio_streams ADD COLUMN spatial_audio_profile VARCHAR(32)",
        "channels": "ALTER TABLE audio_streams ADD COLUMN channels INTEGER",
        "channel_layout": "ALTER TABLE audio_streams ADD COLUMN channel_layout VARCHAR(64)",
        "sample_rate": "ALTER TABLE audio_streams ADD COLUMN sample_rate INTEGER",
        "bit_rate": "ALTER TABLE audio_streams ADD COLUMN bit_rate INTEGER",
        "bit_depth": "ALTER TABLE audio_streams ADD COLUMN bit_depth INTEGER",
        "bit_rate_mode": "ALTER TABLE audio_streams ADD COLUMN bit_rate_mode VARCHAR(32)",
        "compression_mode": "ALTER TABLE audio_streams ADD COLUMN compression_mode VARCHAR(64)",
        "replay_gain": "ALTER TABLE audio_streams ADD COLUMN replay_gain VARCHAR(64)",
        "replay_gain_peak": "ALTER TABLE audio_streams ADD COLUMN replay_gain_peak VARCHAR(64)",
        "writing_library": "ALTER TABLE audio_streams ADD COLUMN writing_library VARCHAR(512)",
        "md5_unencoded": "ALTER TABLE audio_streams ADD COLUMN md5_unencoded VARCHAR(64)",
        "language": "ALTER TABLE audio_streams ADD COLUMN language VARCHAR(16)",
        "default_flag": "ALTER TABLE audio_streams ADD COLUMN default_flag BOOLEAN NOT NULL DEFAULT 0",
        "forced_flag": "ALTER TABLE audio_streams ADD COLUMN forced_flag BOOLEAN NOT NULL DEFAULT 0",
        # Music-specific metadata
        "title": "ALTER TABLE audio_streams ADD COLUMN title VARCHAR(512)",
        "artist": "ALTER TABLE audio_streams ADD COLUMN artist VARCHAR(512)",
        "album": "ALTER TABLE audio_streams ADD COLUMN album VARCHAR(512)",
        "album_artist": "ALTER TABLE audio_streams ADD COLUMN album_artist VARCHAR(512)",
        "genre": "ALTER TABLE audio_streams ADD COLUMN genre VARCHAR(256)",
        "date": "ALTER TABLE audio_streams ADD COLUMN date VARCHAR(32)",
        "disc": "ALTER TABLE audio_streams ADD COLUMN disc VARCHAR(32)",
        "composer": "ALTER TABLE audio_streams ADD COLUMN composer VARCHAR(512)",
        "track": "ALTER TABLE audio_streams ADD COLUMN track VARCHAR(32)",
    },
    "subtitle_streams": {
        "codec": "ALTER TABLE subtitle_streams ADD COLUMN codec VARCHAR(64)",
        "language": "ALTER TABLE subtitle_streams ADD COLUMN language VARCHAR(16)",
        "default_flag": "ALTER TABLE subtitle_streams ADD COLUMN default_flag BOOLEAN NOT NULL DEFAULT 0",
        "forced_flag": "ALTER TABLE subtitle_streams ADD COLUMN forced_flag BOOLEAN NOT NULL DEFAULT 0",
        "subtitle_type": "ALTER TABLE subtitle_streams ADD COLUMN subtitle_type VARCHAR(32)",
    },
    "external_subtitles": {
        "language": "ALTER TABLE external_subtitles ADD COLUMN language VARCHAR(16)",
        "format": "ALTER TABLE external_subtitles ADD COLUMN format VARCHAR(32)",
    },
    "scan_jobs": {
        "discovered_files": "ALTER TABLE scan_jobs ADD COLUMN discovered_files INTEGER NOT NULL DEFAULT 0",
        "unchanged_files": "ALTER TABLE scan_jobs ADD COLUMN unchanged_files INTEGER NOT NULL DEFAULT 0",
        "discovery_complete": "ALTER TABLE scan_jobs ADD COLUMN discovery_complete BOOLEAN NOT NULL DEFAULT 0",
        "new_files_live": "ALTER TABLE scan_jobs ADD COLUMN new_files_live INTEGER NOT NULL DEFAULT 0",
        "deleted_files_live": "ALTER TABLE scan_jobs ADD COLUMN deleted_files_live INTEGER NOT NULL DEFAULT 0",
        "modified_files_live": "ALTER TABLE scan_jobs ADD COLUMN modified_files_live INTEGER NOT NULL DEFAULT 0",
        "trigger_source": "ALTER TABLE scan_jobs ADD COLUMN trigger_source VARCHAR(16) NOT NULL DEFAULT 'manual'",
        "trigger_details": "ALTER TABLE scan_jobs ADD COLUMN trigger_details JSON NOT NULL DEFAULT '{}'",
        "scan_summary": "ALTER TABLE scan_jobs ADD COLUMN scan_summary JSON NOT NULL DEFAULT '{}'",
    },
    "transcode_jobs": {
        "output_mode": "ALTER TABLE transcode_jobs ADD COLUMN output_mode VARCHAR(32) NOT NULL DEFAULT 'same_directory'",
        "output_storage_root": "ALTER TABLE transcode_jobs ADD COLUMN output_storage_root VARCHAR(4096)",
        "retry_count": "ALTER TABLE transcode_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0",
        "attempt": "ALTER TABLE transcode_jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0",
        "cpu_budget_percent": "ALTER TABLE transcode_jobs ADD COLUMN cpu_budget_percent INTEGER",
        "cpu_thread_budget": "ALTER TABLE transcode_jobs ADD COLUMN cpu_thread_budget INTEGER",
        "device_id": "ALTER TABLE transcode_jobs ADD COLUMN device_id VARCHAR(128)",
        "hardware_backend": "ALTER TABLE transcode_jobs ADD COLUMN hardware_backend VARCHAR(32)",
        "ffmpeg_version": "ALTER TABLE transcode_jobs ADD COLUMN ffmpeg_version VARCHAR(512)",
        "remove_partial_output": "ALTER TABLE transcode_jobs ADD COLUMN remove_partial_output BOOLEAN NOT NULL DEFAULT 1",
        "on_error": "ALTER TABLE transcode_jobs ADD COLUMN on_error VARCHAR(16) NOT NULL DEFAULT 'continue'",
    },
    "transcode_variants": {
        "output_mode": "ALTER TABLE transcode_variants ADD COLUMN output_mode VARCHAR(32) NOT NULL DEFAULT 'same_directory'",
    },
}

SQLITE_INDEX_STATEMENTS: tuple[str, ...] = (
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_media_files_library_root_relative_path "
    "ON media_files (library_id, library_root_id, relative_path)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_relative_path ON media_files (library_id, relative_path)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_root_id ON media_files (library_root_id)",
    "CREATE INDEX IF NOT EXISTS ix_library_roots_library_id ON library_roots (library_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_library_roots_library_path_key ON library_roots (library_id, path_key)",
    (
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_library_roots_library_display_name_nocase "
        "ON library_roots (library_id, display_name COLLATE NOCASE)"
    ),
    "CREATE INDEX IF NOT EXISTS ix_media_files_scan_status ON media_files (scan_status)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_quality_score ON media_files (quality_score)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_size_bytes ON media_files (library_id, size_bytes)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_mtime ON media_files (library_id, mtime)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_last_analyzed_at ON media_files (library_id, last_analyzed_at)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_quality_score ON media_files (library_id, quality_score)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_quality_score_raw ON media_files (library_id, quality_score_raw)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_extension ON media_files (library_id, extension)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_duration_seconds ON media_files (library_id, duration_seconds)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_bitrate ON media_files (library_id, bitrate)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_audio_bitrate ON media_files (library_id, audio_bitrate)",
    (
        "CREATE INDEX IF NOT EXISTS ix_media_files_library_max_audio_bit_depth "
        "ON media_files (library_id, max_audio_bit_depth)"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_media_files_library_relative_path_nocase "
        "ON media_files (library_id, relative_path COLLATE NOCASE)"
    ),
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_primary_video_codec ON media_files (library_id, primary_video_codec)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_audio_artist ON media_files (library_id, audio_artist)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_audio_album ON media_files (library_id, audio_album)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_audio_genre ON media_files (library_id, audio_genre)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_audio_date ON media_files (library_id, audio_date)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_audio_channels ON media_files (library_id, audio_channels)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_sample_rate ON media_files (library_id, sample_rate)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_track_number ON media_files (library_id, track_number)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_bit_rate_mode ON media_files (library_id, bit_rate_mode)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_has_embedded_cover ON media_files (library_id, has_embedded_cover)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_chapter_count ON media_files (library_id, chapter_count)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_audiobook_narrator ON media_files (library_id, audiobook_narrator)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_audiobook_series ON media_files (library_id, audiobook_series)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_audiobook_author ON media_files (library_id, audiobook_author)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_audiobook_publisher ON media_files (library_id, audiobook_publisher)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_audiobook_series_part ON media_files (library_id, audiobook_series_part)",
    (
        "CREATE INDEX IF NOT EXISTS ix_media_files_library_resolution_pixels "
        "ON media_files (library_id, primary_video_resolution_pixels)"
    ),
    (
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_primary_video_hdr_type "
    "ON media_files (library_id, primary_video_hdr_type)"
    ),
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_content_category ON media_files (library_id, content_category)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_series_id ON media_files (series_id)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_season_id ON media_files (season_id)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_transcode_variant ON media_files (library_id, is_transcode_variant)",
    "CREATE INDEX IF NOT EXISTS ix_media_series_library_normalized_title ON media_series (library_id, normalized_title)",
    "CREATE INDEX IF NOT EXISTS ix_media_seasons_series_number ON media_seasons (series_id, season_number)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_filename_signature ON media_files (library_id, filename_signature)",
    (
        "CREATE INDEX IF NOT EXISTS ix_media_files_library_filename_pattern_signature "
        "ON media_files (library_id, filename_pattern_signature)"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_media_files_library_content_hash "
        "ON media_files (library_id, content_hash_algorithm, content_hash)"
    ),
    "CREATE INDEX IF NOT EXISTS ix_video_streams_codec ON video_streams (codec)",
    "CREATE INDEX IF NOT EXISTS ix_video_streams_bit_depth ON video_streams (bit_depth)",
    "CREATE INDEX IF NOT EXISTS ix_video_streams_resolution ON video_streams (width, height)",
    "CREATE INDEX IF NOT EXISTS ix_video_streams_hdr_type ON video_streams (hdr_type)",
    "CREATE INDEX IF NOT EXISTS ix_video_streams_media_file_stream_index ON video_streams (media_file_id, stream_index)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_codec ON audio_streams (codec)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_spatial_audio_profile ON audio_streams (spatial_audio_profile)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_layout ON audio_streams (channel_layout)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_channels ON audio_streams (channels)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_sample_rate ON audio_streams (sample_rate)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_bit_rate_mode ON audio_streams (bit_rate_mode)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_artist ON audio_streams (artist)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_album ON audio_streams (album)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_genre ON audio_streams (genre)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_date ON audio_streams (date)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_track ON audio_streams (track)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_language ON audio_streams (language)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_media_file_id ON audio_streams (media_file_id)",
    "CREATE INDEX IF NOT EXISTS ix_media_chapters_media_file_id ON media_chapters (media_file_id)",
    "CREATE INDEX IF NOT EXISTS ix_media_chapters_media_file_index ON media_chapters (media_file_id, chapter_index)",
    "CREATE INDEX IF NOT EXISTS ix_subtitle_streams_codec ON subtitle_streams (codec)",
    "CREATE INDEX IF NOT EXISTS ix_subtitle_streams_language ON subtitle_streams (language)",
    "CREATE INDEX IF NOT EXISTS ix_subtitle_streams_media_file_id ON subtitle_streams (media_file_id)",
    "CREATE INDEX IF NOT EXISTS ix_external_subtitles_language ON external_subtitles (language)",
    "CREATE INDEX IF NOT EXISTS ix_external_subtitles_media_file_id ON external_subtitles (media_file_id)",
    "CREATE INDEX IF NOT EXISTS ix_scan_jobs_status ON scan_jobs (status)",
    "CREATE INDEX IF NOT EXISTS ix_scan_jobs_library_id ON scan_jobs (library_id)",
    "CREATE INDEX IF NOT EXISTS ix_libraries_quality_profile_id ON libraries (quality_profile_id)",
    "CREATE INDEX IF NOT EXISTS ix_jellyfin_items_library_name ON jellyfin_items (library_name)",
    "CREATE INDEX IF NOT EXISTS ix_jellyfin_items_library_id ON jellyfin_items (library_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_jellyfin_libraries_remote_item_id ON jellyfin_libraries (remote_item_id)",
    (
        "CREATE INDEX IF NOT EXISTS ix_media_file_history_library_path_captured_at "
        "ON media_file_history (library_id, relative_path, captured_at)"
    ),
    "CREATE INDEX IF NOT EXISTS ix_media_file_history_captured_at ON media_file_history (captured_at)",
    (
        "CREATE INDEX IF NOT EXISTS ix_connector_items_resolved_locator "
        "ON connector_items (resolved_library_root_id, resolved_relative_path_key)"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_media_file_history_root_path_captured_at "
        "ON media_file_history (library_root_id, relative_path, captured_at)"
    ),
    (
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_library_history_library_snapshot_day "
        "ON library_history (library_id, snapshot_day)"
    ),
    "CREATE INDEX IF NOT EXISTS ix_library_history_captured_at ON library_history (captured_at)",
    (
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_duplicate_group_suppressions_library_mode_signature "
        "ON duplicate_group_suppressions (library_id, mode, signature)"
    ),
    (
        "CREATE INDEX IF NOT EXISTS ix_duplicate_group_suppressions_library_mode "
        "ON duplicate_group_suppressions (library_id, mode)"
    ),
)


def _backfill_media_file_search_fields(connection) -> None:
    if not _sqlite_has_table(connection, "media_files"):
        return
    existing_columns = _sqlite_column_names(connection, "media_files")
    if "search_fields_version" not in existing_columns:
        return

    connection.execute(
        text(
            """
            UPDATE media_files
            SET
              duration_seconds = (SELECT duration FROM media_formats WHERE media_file_id = media_files.id LIMIT 1),
              bitrate = (SELECT bit_rate FROM media_formats WHERE media_file_id = media_files.id LIMIT 1),
              audio_bitrate = (
                COALESCE(
                  (
                    SELECT NULLIF(SUM(COALESCE(bit_rate, 0)), 0)
                    FROM audio_streams
                    WHERE media_file_id = media_files.id
                  ),
                  CASE
                    WHEN EXISTS (
                      SELECT 1 FROM audio_streams
                      WHERE media_file_id = media_files.id
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM video_streams
                      WHERE media_file_id = media_files.id
                    )
                    THEN (
                      SELECT bit_rate FROM media_formats
                      WHERE media_file_id = media_files.id
                      LIMIT 1
                    )
                    ELSE NULL
                  END
                )
              ),
              max_audio_bit_depth = (
                SELECT MAX(bit_depth)
                FROM audio_streams
                WHERE media_file_id = media_files.id
                  AND bit_depth > 0
              ),
              primary_video_codec = (
                SELECT codec FROM video_streams
                WHERE media_file_id = media_files.id
                ORDER BY stream_index ASC LIMIT 1
              ),
              primary_video_width = (
                SELECT width FROM video_streams
                WHERE media_file_id = media_files.id
                ORDER BY stream_index ASC LIMIT 1
              ),
              primary_video_height = (
                SELECT height FROM video_streams
                WHERE media_file_id = media_files.id
                ORDER BY stream_index ASC LIMIT 1
              ),
              primary_video_resolution_pixels = (
                SELECT CASE
                  WHEN width IS NOT NULL AND height IS NOT NULL THEN width * height
                  ELSE NULL
                END
                FROM video_streams
                WHERE media_file_id = media_files.id
                ORDER BY stream_index ASC LIMIT 1
              ),
              primary_video_hdr_type = (
                SELECT hdr_type FROM video_streams
                WHERE media_file_id = media_files.id
                ORDER BY stream_index ASC LIMIT 1
              ),
              min_audio_codec = COALESCE((
                SELECT MIN(value)
                FROM (
                  SELECT DISTINCT CASE
                    WHEN LENGTH(LOWER(TRIM(COALESCE(codec, '')))) = 0 THEN 'unknown'
                    ELSE LOWER(TRIM(COALESCE(codec, '')))
                  END AS value
                  FROM audio_streams
                  WHERE media_file_id = media_files.id
                )
              ), ''),
              min_audio_spatial_profile = COALESCE((
                SELECT MIN(value)
                FROM (
                  SELECT DISTINCT LOWER(TRIM(COALESCE(spatial_audio_profile, ''))) AS value
                  FROM audio_streams
                  WHERE media_file_id = media_files.id
                )
                WHERE value != ''
              ), ''),
              min_audio_language = COALESCE((
                SELECT MIN(value)
                FROM (
                  SELECT DISTINCT CASE
                    WHEN LENGTH(LOWER(TRIM(COALESCE(language, '')))) = 0 THEN 'und'
                    ELSE LOWER(TRIM(COALESCE(language, '')))
                  END AS value
                  FROM audio_streams
                  WHERE media_file_id = media_files.id
                )
              ), ''),
              audio_codecs_search = COALESCE((
                SELECT GROUP_CONCAT(value, ' ')
                FROM (
                  SELECT DISTINCT CASE
                    WHEN LENGTH(LOWER(TRIM(COALESCE(codec, '')))) = 0 THEN 'unknown'
                    ELSE LOWER(TRIM(COALESCE(codec, '')))
                  END AS value
                  FROM audio_streams
                  WHERE media_file_id = media_files.id
                  ORDER BY value
                )
              ), ''),
              audio_spatial_profiles_search = COALESCE((
                SELECT GROUP_CONCAT(value, ' ')
                FROM (
                  SELECT DISTINCT LOWER(TRIM(COALESCE(spatial_audio_profile, ''))) AS value
                  FROM audio_streams
                  WHERE media_file_id = media_files.id
                    AND LENGTH(LOWER(TRIM(COALESCE(spatial_audio_profile, '')))) > 0
                  ORDER BY value
                )
              ), ''),
              audio_languages_search = COALESCE((
                SELECT GROUP_CONCAT(value, ' ')
                FROM (
                  SELECT DISTINCT CASE
                    WHEN LENGTH(LOWER(TRIM(COALESCE(language, '')))) = 0 THEN 'und'
                    ELSE LOWER(TRIM(COALESCE(language, '')))
                  END AS value
                  FROM audio_streams
                  WHERE media_file_id = media_files.id
                  ORDER BY value
                )
              ), ''),
              min_subtitle_language = COALESCE((
                SELECT MIN(value)
                FROM (
                  SELECT DISTINCT CASE
                    WHEN LENGTH(LOWER(TRIM(COALESCE(language, '')))) = 0 THEN 'und'
                    ELSE LOWER(TRIM(COALESCE(language, '')))
                  END AS value
                  FROM subtitle_streams
                  WHERE media_file_id = media_files.id
                  UNION
                  SELECT DISTINCT CASE
                    WHEN LENGTH(LOWER(TRIM(COALESCE(language, '')))) = 0 THEN 'und'
                    ELSE LOWER(TRIM(COALESCE(language, '')))
                  END AS value
                  FROM external_subtitles
                  WHERE media_file_id = media_files.id
                )
              ), ''),
              min_subtitle_codec = COALESCE((
                SELECT MIN(value)
                FROM (
                  SELECT DISTINCT CASE
                    WHEN LENGTH(LOWER(TRIM(COALESCE(codec, '')))) = 0 THEN 'unknown'
                    ELSE LOWER(TRIM(COALESCE(codec, '')))
                  END AS value
                  FROM subtitle_streams
                  WHERE media_file_id = media_files.id
                  UNION
                  SELECT DISTINCT CASE
                    WHEN LENGTH(LOWER(TRIM(COALESCE(format, '')))) = 0 THEN 'unknown'
                    ELSE LOWER(TRIM(COALESCE(format, '')))
                  END AS value
                  FROM external_subtitles
                  WHERE media_file_id = media_files.id
                )
              ), ''),
              subtitle_languages_search = COALESCE((
                SELECT GROUP_CONCAT(value, ' ')
                FROM (
                  SELECT DISTINCT CASE
                    WHEN LENGTH(LOWER(TRIM(COALESCE(language, '')))) = 0 THEN 'und'
                    ELSE LOWER(TRIM(COALESCE(language, '')))
                  END AS value
                  FROM subtitle_streams
                  WHERE media_file_id = media_files.id
                  UNION
                  SELECT DISTINCT CASE
                    WHEN LENGTH(LOWER(TRIM(COALESCE(language, '')))) = 0 THEN 'und'
                    ELSE LOWER(TRIM(COALESCE(language, '')))
                  END AS value
                  FROM external_subtitles
                  WHERE media_file_id = media_files.id
                  ORDER BY value
                )
              ), ''),
              subtitle_codecs_search = COALESCE((
                SELECT GROUP_CONCAT(value, ' ')
                FROM (
                  SELECT DISTINCT CASE
                    WHEN LENGTH(LOWER(TRIM(COALESCE(codec, '')))) = 0 THEN 'unknown'
                    ELSE LOWER(TRIM(COALESCE(codec, '')))
                  END AS value
                  FROM subtitle_streams
                  WHERE media_file_id = media_files.id
                  UNION
                  SELECT DISTINCT CASE
                    WHEN LENGTH(LOWER(TRIM(COALESCE(format, '')))) = 0 THEN 'unknown'
                    ELSE LOWER(TRIM(COALESCE(format, '')))
                  END AS value
                  FROM external_subtitles
                  WHERE media_file_id = media_files.id
                  ORDER BY value
                )
              ), ''),
              has_internal_subtitles = EXISTS (
                SELECT 1 FROM subtitle_streams WHERE media_file_id = media_files.id
              ),
              has_external_subtitles = EXISTS (
                SELECT 1 FROM external_subtitles WHERE media_file_id = media_files.id
              ),
              subtitle_sources_search = TRIM(
                CASE WHEN EXISTS (SELECT 1 FROM subtitle_streams WHERE media_file_id = media_files.id)
                  THEN 'internal ' ELSE '' END
                ||
                CASE WHEN EXISTS (SELECT 1 FROM external_subtitles WHERE media_file_id = media_files.id)
                  THEN 'external' ELSE '' END
              ),
              chapter_count = (
                SELECT NULLIF(COUNT(*), 0)
                FROM media_chapters
                WHERE media_file_id = media_files.id
              ),
              chapter_titles_search = COALESCE((
                SELECT GROUP_CONCAT(value, ' ')
                FROM (
                  SELECT DISTINCT LOWER(TRIM(COALESCE(title, ''))) AS value
                  FROM media_chapters
                  WHERE media_file_id = media_files.id
                    AND LENGTH(LOWER(TRIM(COALESCE(title, '')))) > 0
                  ORDER BY value
                )
              ), ''),
              audio_metadata_search = TRIM(COALESCE(audio_metadata_search, '') || ' ' ||
                COALESCE((
                  SELECT GROUP_CONCAT(value, ' ')
                  FROM (
                    SELECT DISTINCT LOWER(TRIM(COALESCE(title, ''))) AS value
                    FROM media_chapters
                    WHERE media_file_id = media_files.id
                      AND LENGTH(LOWER(TRIM(COALESCE(title, '')))) > 0
                    ORDER BY value
                  )
                ), '') || ' ' ||
                LOWER(TRIM(COALESCE(audiobook_narrator, ''))) || ' ' ||
                LOWER(TRIM(COALESCE(audiobook_author, ''))) || ' ' ||
                LOWER(TRIM(COALESCE(audiobook_publisher, ''))) || ' ' ||
                LOWER(TRIM(COALESCE(audiobook_series, ''))) || ' ' ||
                LOWER(TRIM(COALESCE(audiobook_series_part, ''))) || ' ' ||
                LOWER(TRIM(COALESCE(audiobook_description, ''))) || ' ' ||
                LOWER(TRIM(COALESCE(audiobook_copyright, ''))) || ' ' ||
                LOWER(TRIM(COALESCE(audiobook_asin, ''))) || ' ' ||
                LOWER(TRIM(COALESCE(audiobook_isbn, ''))) || ' ' ||
                LOWER(TRIM(COALESCE(audiobook_language, ''))) || ' ' ||
                LOWER(TRIM(COALESCE(audiobook_abridged, '')))
              ),
              search_fields_version = 4
            WHERE search_fields_version < 4
            """
        )
    )


def _sqlite_has_table(connection, table_name: str) -> bool:
    return (
        connection.execute(
            text("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :table_name"),
            {"table_name": table_name},
        ).scalar()
        is not None
    )


def _sqlite_column_names(connection, table_name: str) -> set[str]:
    rows = connection.exec_driver_sql(f"PRAGMA table_info('{table_name}')").mappings().all()
    return {str(row["name"]) for row in rows}


def _sqlite_has_unique_index_for_columns(connection, table_name: str, columns: tuple[str, ...]) -> bool:
    index_rows = connection.exec_driver_sql(f"PRAGMA index_list('{table_name}')").mappings().all()
    for row in index_rows:
        if int(row.get("unique") or 0) != 1:
            continue
        index_name = str(row.get("name") or "")
        if not index_name:
            continue
        index_columns = tuple(
            str(item.get("name") or "")
            for item in connection.exec_driver_sql(f"PRAGMA index_info('{index_name}')").mappings().all()
        )
        if index_columns == columns:
            return True
    return False


def _drop_sqlite_index_if_exists(connection, index_name: str) -> None:
    connection.execute(text(f'DROP INDEX IF EXISTS "{index_name}"'))


def _normalize_path_key(path_value: str) -> str:
    normalized = str(path_value or "").replace("\\", "/").rstrip("/")
    return (normalized or "/").lower()


def _display_name_for_path(path_value: str) -> str:
    normalized = str(path_value or "").replace("\\", "/").rstrip("/")
    parts = [part for part in normalized.split("/") if part]
    return parts[-1] if parts else (normalized or "/")


def _legacy_selected_paths(scan_config: str | dict | None) -> list[str]:
    if isinstance(scan_config, str):
        try:
            payload = json.loads(scan_config or "{}")
        except json.JSONDecodeError:
            payload = {}
    elif isinstance(scan_config, dict):
        payload = scan_config
    else:
        payload = {}
    selected_paths = payload.get("selected_paths") if isinstance(payload, dict) else None
    if not isinstance(selected_paths, list):
        return []
    result: list[str] = []
    for raw_path in selected_paths:
        candidate = str(raw_path or "").strip().replace("\\", "/").strip("/")
        if candidate:
            result.append(candidate)
    return result


def _join_posix_path(root: str, relative_path: str) -> str:
    normalized_root = str(root or "").replace("\\", "/").rstrip("/")
    normalized_relative = str(relative_path or "").replace("\\", "/").strip("/")
    if not normalized_relative:
        return normalized_root or "/"
    return f"{normalized_root}/{normalized_relative}" if normalized_root else normalized_relative


def _ensure_library_roots_backfill(connection) -> None:
    if not _sqlite_has_table(connection, "libraries") or not _sqlite_has_table(connection, "library_roots"):
        return

    library_rows = connection.execute(
        text("SELECT id, path, scan_config FROM libraries ORDER BY id ASC")
    ).mappings().all()
    for library in library_rows:
        library_id = int(library["id"])
        existing_root_count = connection.execute(
            text("SELECT COUNT(*) FROM library_roots WHERE library_id = :library_id"),
            {"library_id": library_id},
        ).scalar_one()
        if existing_root_count:
            continue

        library_path = str(library["path"] or "")
        selected_paths = _legacy_selected_paths(library["scan_config"])
        root_specs = [
            (selected_path, _join_posix_path(library_path, selected_path))
            for selected_path in selected_paths
        ] or [("", library_path)]

        inserted_roots: list[tuple[int, str]] = []
        for selected_path, root_path in root_specs:
            result = connection.execute(
                text(
                    """
                    INSERT INTO library_roots (library_id, path, display_name, path_key, created_at, updated_at)
                    VALUES (:library_id, :path, :display_name, :path_key, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """
                ),
                {
                    "library_id": library_id,
                    "path": root_path,
                    "display_name": _display_name_for_path(root_path),
                    "path_key": _normalize_path_key(root_path),
                },
            )
            inserted_roots.append((int(result.lastrowid), selected_path))

        if not _sqlite_has_table(connection, "media_files") or "library_root_id" not in _sqlite_column_names(connection, "media_files"):
            continue

        if selected_paths:
            for root_id, selected_path in inserted_roots:
                prefix = f"{selected_path}/"
                connection.execute(
                    text(
                        """
                        UPDATE media_files
                        SET library_root_id = :root_id,
                            relative_path = SUBSTR(relative_path, :prefix_length)
                        WHERE library_id = :library_id
                          AND library_root_id IS NULL
                          AND (relative_path = :selected_path OR relative_path LIKE :prefix_like)
                        """
                    ),
                    {
                        "root_id": root_id,
                        "library_id": library_id,
                        "selected_path": selected_path,
                        "prefix_like": f"{prefix}%",
                        "prefix_length": len(prefix) + 1,
                    },
                )

        fallback_root_id = inserted_roots[0][0]
        connection.execute(
            text(
                """
                UPDATE media_files
                SET library_root_id = :root_id
                WHERE library_id = :library_id AND library_root_id IS NULL
                """
            ),
            {"root_id": fallback_root_id, "library_id": library_id},
        )


def _ensure_unique_library_root_aliases(connection) -> None:
    if not _sqlite_has_table(connection, "library_roots"):
        return
    rows = connection.execute(
        text("SELECT id, library_id, display_name FROM library_roots ORDER BY library_id, id")
    ).mappings().all()
    used_by_library: dict[int, set[str]] = {}
    for row in rows:
        library_id = int(row["library_id"])
        used = used_by_library.setdefault(library_id, set())
        base = str(row["display_name"] or "Root").strip() or "Root"
        alias = base
        suffix = 2
        while alias.casefold() in used:
            alias = f"{base} ({suffix})"
            suffix += 1
        used.add(alias.casefold())
        if alias != row["display_name"]:
            connection.execute(
                text("UPDATE library_roots SET display_name = :alias WHERE id = :root_id"),
                {"alias": alias, "root_id": int(row["id"])},
            )


def _backfill_media_file_history_roots(connection) -> None:
    if not _sqlite_has_table(connection, "media_file_history"):
        return
    columns = _sqlite_column_names(connection, "media_file_history")
    if "library_root_id" not in columns:
        return
    if _sqlite_has_table(connection, "media_files"):
        connection.execute(
            text(
                """
                UPDATE media_file_history
                SET library_root_id = (
                    SELECT media_files.library_root_id
                    FROM media_files
                    WHERE media_files.id = media_file_history.media_file_id
                      AND media_files.library_id = media_file_history.library_id
                )
                WHERE library_root_id IS NULL AND media_file_id IS NOT NULL
                """
            )
        )
    connection.execute(
        text(
            """
            UPDATE media_file_history
            SET library_root_id = (
                SELECT MIN(library_roots.id)
                FROM library_roots
                WHERE library_roots.library_id = media_file_history.library_id
            )
            WHERE library_root_id IS NULL
              AND 1 = (
                SELECT COUNT(*) FROM library_roots
                WHERE library_roots.library_id = media_file_history.library_id
              )
            """
        )
    )
    if "root_alias" in columns:
        connection.execute(
            text(
                """
                UPDATE media_file_history
                SET root_alias = (
                    SELECT display_name FROM library_roots
                    WHERE library_roots.id = media_file_history.library_root_id
                )
                WHERE root_alias IS NULL AND library_root_id IS NOT NULL
                """
            )
        )


def _legacy_connector_binding_specs(connection) -> list[dict]:
    if not all(
        _sqlite_has_table(connection, table)
        for table in (
            "jellyfin_path_mappings",
            "connector_library_locations",
            "library_roots",
        )
    ):
        return []
    mappings = connection.execute(
        text(
            "SELECT id, jellyfin_path_prefix, medialyze_path_prefix "
            "FROM jellyfin_path_mappings WHERE enabled = 1 ORDER BY id"
        )
    ).mappings().all()
    locations = connection.execute(
        text("SELECT id, remote_path FROM connector_library_locations ORDER BY id")
    ).mappings().all()
    roots = connection.execute(
        text("SELECT id, path FROM library_roots ORDER BY id")
    ).mappings().all()
    specs: list[dict] = []
    for mapping in mappings:
        source_display = str(mapping["jellyfin_path_prefix"] or "").replace("\\", "/").rstrip("/")
        target_display = str(mapping["medialyze_path_prefix"] or "").replace("\\", "/").rstrip("/")
        source_key = _normalize_path_key(source_display)
        target_key = _normalize_path_key(target_display)
        target_candidates: list[tuple[int, int, str]] = []
        for root in roots:
            root_display = str(root["path"] or "").replace("\\", "/").rstrip("/")
            root_key = _normalize_path_key(root_display)
            if target_key == root_key:
                target_candidates.append((len(root_key), int(root["id"]), ""))
            elif target_key.startswith(f"{root_key}/"):
                target_candidates.append(
                    (len(root_key), int(root["id"]), target_display[len(root_display) :].strip("/"))
                )
        if not target_candidates:
            continue
        longest = max(length for length, _root_id, _subpath in target_candidates)
        best_targets = [candidate for candidate in target_candidates if candidate[0] == longest]
        if len(best_targets) != 1:
            continue
        _length, root_id, target_subpath = best_targets[0]
        for location in locations:
            location_key = _normalize_path_key(str(location["remote_path"] or ""))
            if not (
                source_key == location_key
                or source_key.startswith(f"{location_key}/")
                or location_key.startswith(f"{source_key}/")
            ):
                continue
            specs.append(
                {
                    "location_id": int(location["id"]),
                    "library_root_id": root_id,
                    "source_prefix": source_display,
                    "normalized_source_prefix": source_key,
                    "target_subpath": target_subpath,
                }
            )
    return specs


def _migrate_legacy_jellyfin_to_connectors(connection) -> None:
    required = (
        "connector_connections",
        "connector_libraries",
        "connector_library_locations",
        "connector_items",
    )
    if not all(_sqlite_has_table(connection, table) for table in required):
        return
    if not _sqlite_has_table(connection, "jellyfin_connection"):
        return

    connection.execute(
        text(
            """
            INSERT OR IGNORE INTO connector_connections (
                provider, name, base_url, config, capabilities, enabled,
                sync_interval_minutes, path_mapping_mode, library_mapping_mode,
                server_name, server_version, last_status,
                last_error, last_sync_started_at, last_sync_finished_at,
                last_successful_sync_at, created_at, updated_at
            )
            SELECT 'jellyfin', 'Jellyfin', base_url, :config,
                   :capabilities,
                   enabled, sync_interval_minutes, 'automatic', 'automatic',
                   server_name, server_version, last_status,
                   last_error, last_sync_started_at, last_sync_finished_at,
                   last_successful_sync_at, created_at, updated_at
            FROM jellyfin_connection
            WHERE id = 1
              AND (COALESCE(base_url, '') != '' OR COALESCE(api_key, '') != '' OR enabled = 1)
            """
        ),
        {
            "config": json.dumps({"legacy_default": True}),
            "capabilities": json.dumps(
                {
                    "users": True,
                    "user_states": True,
                    "playback_events": True,
                    "images": True,
                }
            )
        },
    )
    connector_id = connection.execute(
        text(
            "SELECT connector_connections.id FROM connector_connections "
            "WHERE provider = 'jellyfin' AND name = 'Jellyfin' "
            "AND (json_extract(COALESCE(config, '{}'), '$.legacy_default') = 1 "
            "OR EXISTS (SELECT 1 FROM jellyfin_connection "
            "WHERE jellyfin_connection.id = 1 "
            "AND (COALESCE(jellyfin_connection.base_url, '') != '' "
            "OR COALESCE(jellyfin_connection.api_key, '') != '' "
            "OR jellyfin_connection.enabled = 1))) "
            "ORDER BY connector_connections.id LIMIT 1"
        )
    ).scalar_one_or_none()
    if connector_id is None:
        return

    connection.execute(
        text(
            "UPDATE connector_connections "
            "SET config = json_set(COALESCE(config, '{}'), '$.legacy_default', json('true')) "
            "WHERE id = :connection_id"
        ),
        {"connection_id": connector_id},
    )

    if _sqlite_has_table(connection, "connector_credentials"):
        connection.execute(
            text(
                """
                INSERT OR IGNORE INTO connector_credentials (
                    connection_id, secret_payload, created_at, updated_at
                )
                SELECT :connection_id, api_key, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM jellyfin_connection
                WHERE id = 1 AND api_key IS NOT NULL AND api_key != ''
                """
            ),
            {"connection_id": connector_id},
        )

    if _sqlite_has_table(connection, "jellyfin_libraries"):
        connection.execute(
            text(
                """
                INSERT OR IGNORE INTO connector_libraries (
                    connection_id, remote_id, name, media_type, provider_payload,
                    last_synced_at, created_at, updated_at
                )
                SELECT :connection_id, COALESCE(NULLIF(remote_item_id, ''), 'legacy:' || id),
                       name, collection_type, '{}', last_synced_at, created_at, updated_at
                FROM jellyfin_libraries
                """
            ),
            {"connection_id": connector_id},
        )
        connection.execute(
            text(
                """
                INSERT OR IGNORE INTO connector_library_locations (
                    connector_library_id, remote_path, normalized_path, created_at, updated_at
                )
                SELECT connector_libraries.id, CAST(json_each.value AS TEXT),
                       lower(rtrim(replace(CAST(json_each.value AS TEXT), '\\', '/'), '/')),
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM jellyfin_libraries
                JOIN connector_libraries
                  ON connector_libraries.connection_id = :connection_id
                 AND connector_libraries.remote_id = COALESCE(
                       NULLIF(jellyfin_libraries.remote_item_id, ''), 'legacy:' || jellyfin_libraries.id
                 )
                JOIN json_each(jellyfin_libraries.locations)
                WHERE json_each.value IS NOT NULL AND CAST(json_each.value AS TEXT) != ''
                """
            ),
            {"connection_id": connector_id},
        )
        if _sqlite_has_table(connection, "connector_library_links"):
            connection.execute(
                text(
                    """
                    INSERT OR IGNORE INTO connector_library_links (
                        connector_library_id, library_id, link_method, created_at, updated_at
                    )
                    SELECT connector_libraries.id, jellyfin_libraries.linked_library_id,
                           CASE WHEN jellyfin_libraries.link_method = 'manual' THEN 'manual' ELSE 'imported' END,
                           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    FROM jellyfin_libraries
                    JOIN connector_libraries
                      ON connector_libraries.connection_id = :connection_id
                     AND connector_libraries.remote_id = COALESCE(
                           NULLIF(jellyfin_libraries.remote_item_id, ''), 'legacy:' || jellyfin_libraries.id
                     )
                    WHERE jellyfin_libraries.linked_library_id IS NOT NULL
                    """
                ),
                {"connection_id": connector_id},
            )

    if _sqlite_has_table(connection, "jellyfin_items"):
        connection.execute(
            text(
                """
                INSERT OR IGNORE INTO connector_items (
                    connection_id, connector_library_id, remote_id, item_type,
                    remote_path, normalized_remote_path, title, original_title,
                    series_name, season_name, index_number, parent_index_number,
                    date_created, premiere_date, production_year, overview,
                    provider_ids, provider_payload, size_bytes, duration_seconds,
                    match_status, mismatch_reason, suggested_media_file_id,
                    last_synced_at, created_at, updated_at
                )
                SELECT :connection_id, connector_libraries.id, jellyfin_items.jellyfin_item_id,
                       jellyfin_items.item_type, jellyfin_items.path,
                       lower(rtrim(replace(jellyfin_items.path, '\\', '/'), '/')),
                       jellyfin_items.title, jellyfin_items.original_title,
                       jellyfin_items.series_name, jellyfin_items.season_name,
                       jellyfin_items.index_number, jellyfin_items.parent_index_number,
                       jellyfin_items.date_created, jellyfin_items.premiere_date,
                       jellyfin_items.production_year, jellyfin_items.overview,
                       jellyfin_items.provider_ids, jellyfin_items.raw_limited_payload,
                       jellyfin_items.size_bytes, jellyfin_items.duration_seconds,
                       CASE
                         WHEN jellyfin_items.match_status = 'matched' THEN 'matched'
                         WHEN jellyfin_items.match_status = 'ignored' THEN 'ignored'
                         WHEN jellyfin_items.match_status = 'ambiguous' THEN 'ambiguous_file'
                         ELSE COALESCE(jellyfin_items.mismatch_reason, 'unmapped')
                       END,
                       jellyfin_items.mismatch_reason, NULL,
                       jellyfin_items.last_synced_at, jellyfin_items.created_at, jellyfin_items.updated_at
                FROM jellyfin_items
                LEFT JOIN jellyfin_libraries ON jellyfin_libraries.id = jellyfin_items.library_id
                LEFT JOIN connector_libraries
                  ON connector_libraries.connection_id = :connection_id
                 AND connector_libraries.remote_id = COALESCE(
                       NULLIF(jellyfin_libraries.remote_item_id, ''), 'legacy:' || jellyfin_libraries.id
                 )
                """
            ),
            {"connection_id": connector_id},
        )
    if _sqlite_has_table(connection, "jellyfin_media_matches") and _sqlite_has_table(
        connection, "connector_media_matches"
    ):
        connection.execute(
            text(
                """
                INSERT OR IGNORE INTO connector_media_matches (
                    connector_item_id, media_file_id, binding_id, match_method,
                    confidence, status, created_at, updated_at
                )
                SELECT connector_items.id, jellyfin_media_matches.media_file_id, NULL,
                       jellyfin_media_matches.match_method, jellyfin_media_matches.confidence,
                       jellyfin_media_matches.status, jellyfin_media_matches.created_at,
                       jellyfin_media_matches.updated_at
                FROM jellyfin_media_matches
                JOIN jellyfin_items ON jellyfin_items.id = jellyfin_media_matches.jellyfin_item_id
                JOIN connector_items
                  ON connector_items.connection_id = :connection_id
                 AND connector_items.remote_id = jellyfin_items.jellyfin_item_id
                """
            ),
            {"connection_id": connector_id},
        )

    if _sqlite_has_table(connection, "jellyfin_users") and _sqlite_has_table(
        connection, "connector_users"
    ):
        connection.execute(
            text(
                """
                INSERT OR IGNORE INTO connector_users (
                    connection_id, remote_id, name, enabled_for_sync,
                    last_synced_at, created_at, updated_at
                )
                SELECT :connection_id, jellyfin_user_id, name, enabled_for_sync,
                       last_synced_at, created_at, updated_at
                FROM jellyfin_users
                """
            ),
            {"connection_id": connector_id},
        )
    if _sqlite_has_table(connection, "jellyfin_user_item_data") and _sqlite_has_table(
        connection, "connector_user_item_data"
    ):
        connection.execute(
            text(
                """
                INSERT OR IGNORE INTO connector_user_item_data (
                    connector_item_id, connector_user_id, play_count, played,
                    playback_position_ticks, last_played_date, is_favorite,
                    last_synced_at
                )
                SELECT connector_items.id, connector_users.id,
                       jellyfin_user_item_data.play_count,
                       jellyfin_user_item_data.played,
                       jellyfin_user_item_data.playback_position_ticks,
                       jellyfin_user_item_data.last_played_date,
                       jellyfin_user_item_data.is_favorite,
                       jellyfin_user_item_data.last_synced_at
                FROM jellyfin_user_item_data
                JOIN jellyfin_items
                  ON jellyfin_items.id = jellyfin_user_item_data.jellyfin_item_id
                JOIN connector_items
                  ON connector_items.connection_id = :connection_id
                 AND connector_items.remote_id = jellyfin_items.jellyfin_item_id
                JOIN connector_users
                  ON connector_users.connection_id = :connection_id
                 AND connector_users.remote_id = jellyfin_user_item_data.jellyfin_user_id
                """
            ),
            {"connection_id": connector_id},
        )
    if _sqlite_has_table(connection, "jellyfin_playback_events") and _sqlite_has_table(
        connection, "connector_playback_events"
    ):
        connection.execute(
            text(
                """
                INSERT OR IGNORE INTO connector_playback_events (
                    connection_id, remote_event_id, connector_item_id,
                    connector_user_id, played_at, last_synced_at
                )
                SELECT :connection_id, CAST(jellyfin_playback_events.jellyfin_activity_id AS TEXT),
                       connector_items.id, connector_users.id,
                       jellyfin_playback_events.played_at,
                       jellyfin_playback_events.last_synced_at
                FROM jellyfin_playback_events
                JOIN jellyfin_items
                  ON jellyfin_items.id = jellyfin_playback_events.jellyfin_item_id
                JOIN connector_items
                  ON connector_items.connection_id = :connection_id
                 AND connector_items.remote_id = jellyfin_items.jellyfin_item_id
                JOIN connector_users
                  ON connector_users.connection_id = :connection_id
                 AND connector_users.remote_id = jellyfin_playback_events.jellyfin_user_id
                """
            ),
            {"connection_id": connector_id},
        )

    if _sqlite_has_table(connection, "connector_root_bindings"):
        for spec in _legacy_connector_binding_specs(connection):
            connection.execute(
                text(
                    """
                    INSERT INTO connector_root_bindings (
                        location_id, library_root_id, source_prefix,
                        normalized_source_prefix, target_subpath, case_mode,
                        priority, active, origin, confidence, evidence_count,
                        verification_status, last_verified_at, created_at, updated_at
                    )
                    SELECT :location_id, :library_root_id, :source_prefix,
                           :normalized_source_prefix, :target_subpath, 'insensitive',
                           0, 1, 'automatic', 1, 0,
                           'imported', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    WHERE NOT EXISTS (
                        SELECT 1 FROM connector_root_bindings
                        WHERE location_id = :location_id
                          AND normalized_source_prefix = :normalized_source_prefix
                          AND library_root_id = :library_root_id
                    )
                    """
                ),
                spec,
            )

    connection.execute(
        text(
            "UPDATE libraries SET history_added_date_source = 'connector', "
            "preferred_connector_connection_id = :connection_id "
            "WHERE history_added_date_source = 'jellyfin'"
        ),
        {"connection_id": connector_id},
    )
    connection.execute(
        text(
            """
            UPDATE libraries
            SET preferred_connector_connection_id = (
                SELECT MIN(connector_libraries.connection_id)
                FROM connector_library_links
                JOIN connector_libraries
                  ON connector_libraries.id = connector_library_links.connector_library_id
                WHERE connector_library_links.library_id = libraries.id
            )
            WHERE preferred_connector_connection_id IS NULL
              AND 1 = (
                SELECT COUNT(DISTINCT connector_libraries.connection_id)
                FROM connector_library_links
                JOIN connector_libraries
                  ON connector_libraries.id = connector_library_links.connector_library_id
                WHERE connector_library_links.library_id = libraries.id
              )
            """
        )
    )
    if _sqlite_has_table(connection, "app_settings"):
        connection.execute(
            text(
                "INSERT INTO app_settings (key, value) VALUES ('connector_migration', :value) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
            ),
            {
                "value": json.dumps(
                    {
                        "version": 1,
                        "legacy_jellyfin_connection_id": int(connector_id),
                        "status": "completed",
                    }
                )
            },
        )


def _remove_manual_item_matching_state(connection) -> None:
    if _sqlite_has_table(connection, "connector_items"):
        if _sqlite_has_table(connection, "connector_media_matches"):
            connection.execute(
                text(
                    "UPDATE connector_items SET match_status = 'unmapped', mismatch_reason = NULL, "
                    "suggested_media_file_id = NULL WHERE match_status = 'ignored' OR id IN ("
                    "SELECT connector_item_id FROM connector_media_matches "
                    "WHERE match_method = 'manual')"
                )
            )
            connection.execute(
                text("DELETE FROM connector_media_matches WHERE match_method = 'manual'")
            )
        connection.execute(
            text("UPDATE connector_items SET suggested_media_file_id = NULL")
        )
    if _sqlite_has_table(connection, "jellyfin_items"):
        if _sqlite_has_table(connection, "jellyfin_media_matches"):
            connection.execute(
                text(
                    "UPDATE jellyfin_items SET match_status = 'unmatched', mismatch_reason = NULL, "
                    "suggested_media_file_id = NULL WHERE match_status = 'ignored' OR id IN ("
                    "SELECT jellyfin_item_id FROM jellyfin_media_matches "
                    "WHERE match_method = 'manual')"
                )
            )
            connection.execute(
                text("DELETE FROM jellyfin_media_matches WHERE match_method = 'manual'")
            )
        connection.execute(text("UPDATE jellyfin_items SET suggested_media_file_id = NULL"))
    if _sqlite_has_table(connection, "app_settings"):
        connection.execute(
            text(
                "INSERT INTO app_settings (key, value) VALUES ('connector_mapping_migration', :value) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
            ),
            {"value": json.dumps({"version": 1, "status": "completed"})},
        )


def _rebuild_libraries_table_without_unique_path(connection) -> None:
    if not _sqlite_has_table(connection, "libraries"):
        return
    if not _sqlite_has_unique_index_for_columns(connection, "libraries", ("path",)):
        return

    columns = connection.exec_driver_sql("PRAGMA table_info('libraries')").mappings().all()
    if not columns:
        return

    table_name = "libraries"
    temp_table_name = "libraries__tmp_drop_path_unique"

    # Rebuild the table to remove the inline UNIQUE constraint from libraries.path.
    # SQLite cannot drop inline column constraints directly.
    column_defs: list[str] = []
    column_refs: list[str] = []
    for row in columns:
        column_name = str(row["name"])
        column_type = str(row.get("type") or "").strip()
        definition = f'"{column_name}"'
        if column_type:
            definition += f" {column_type}"
        if int(row.get("pk") or 0) > 0:
            definition += " PRIMARY KEY"
        if int(row.get("notnull") or 0) == 1:
            definition += " NOT NULL"
        default_value = row.get("dflt_value")
        if default_value is not None:
            definition += f" DEFAULT {default_value}"
        column_defs.append(definition)
        column_refs.append(f'"{column_name}"')

    column_list_sql = ", ".join(column_refs)
    create_table_sql = f'CREATE TABLE "{temp_table_name}" ({", ".join(column_defs)})'

    connection.exec_driver_sql("PRAGMA foreign_keys = OFF;")
    try:
        connection.execute(text(create_table_sql))
        connection.execute(
            text(
                f'INSERT INTO "{temp_table_name}" ({column_list_sql}) '
                f'SELECT {column_list_sql} FROM "{table_name}"'
            )
        )
        connection.execute(text(f'DROP TABLE "{table_name}"'))
        connection.execute(text(f'ALTER TABLE "{temp_table_name}" RENAME TO "{table_name}"'))
    finally:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")

    if "name" in _sqlite_column_names(connection, "libraries"):
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_libraries_name_unique ON libraries (name)"))


def _apply_sqlite_additive_migrations(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return

    with engine.begin() as connection:
        for table_name, column_migrations in SQLITE_ADDITIVE_COLUMNS.items():
            if not _sqlite_has_table(connection, table_name):
                continue
            existing_columns = _sqlite_column_names(connection, table_name)
            for column_name, statement in column_migrations.items():
                if column_name in existing_columns:
                    continue
                connection.execute(text(statement))
                existing_columns.add(column_name)

        _rebuild_libraries_table_without_unique_path(connection)
        _ensure_library_roots_backfill(connection)
        _ensure_unique_library_root_aliases(connection)
        _backfill_media_file_history_roots(connection)
        _drop_sqlite_index_if_exists(connection, "ix_media_files_library_relative_path")
        # Library names are display data in Jellyfin and can change or collide.
        # Identity is carried by remote_item_id instead.
        _drop_sqlite_index_if_exists(connection, "ix_jellyfin_libraries_name")

        for statement in SQLITE_INDEX_STATEMENTS:
            connection.execute(text(statement))

        if _sqlite_has_table(connection, "jellyfin_libraries"):
            connection.execute(
                text(
                    "UPDATE jellyfin_libraries "
                    "SET remote_item_id = 'legacy:' || id "
                    "WHERE remote_item_id IS NULL OR remote_item_id = ''"
                )
            )
            connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_jellyfin_libraries_name ON jellyfin_libraries (name)")
            )
        if _sqlite_has_table(connection, "jellyfin_items"):
            connection.execute(
                text(
                    "UPDATE jellyfin_items SET library_id = ("
                    "SELECT jellyfin_libraries.id FROM jellyfin_libraries "
                    "WHERE jellyfin_libraries.name = jellyfin_items.library_name "
                    "ORDER BY jellyfin_libraries.id LIMIT 1"
                    ") WHERE library_id IS NULL AND library_name IS NOT NULL"
                )
            )

            connection.execute(
                text(
                    "UPDATE jellyfin_items SET "
                    "size_bytes = CAST(json_extract(raw_limited_payload, '$.Size') AS INTEGER), "
                    "duration_seconds = CAST(json_extract(raw_limited_payload, '$.RunTimeTicks') AS FLOAT) / 10000000.0 "
                    "WHERE size_bytes IS NULL OR duration_seconds IS NULL"
                )
            )

        _migrate_legacy_jellyfin_to_connectors(connection)
        _remove_manual_item_matching_state(connection)

        if _sqlite_has_table(connection, "libraries"):
            connection.execute(
                text(
                    "UPDATE libraries SET quality_profile = :quality_profile "
                    "WHERE quality_profile IS NULL OR quality_profile = '{}' OR quality_profile = 'null'"
                ),
                {"quality_profile": json.dumps(default_quality_profile())},
            )
            connection.execute(
                text(
                    "UPDATE libraries SET duplicate_detection_mode = 'off' "
                    "WHERE duplicate_detection_mode IS NULL OR duplicate_detection_mode = ''"
                )
            )
            connection.execute(
                text("UPDATE libraries SET show_on_dashboard = 1 WHERE show_on_dashboard IS NULL")
            )
        _backfill_media_file_search_fields(connection)
        if _sqlite_has_table(connection, "media_files"):
            connection.execute(
                text(
                    """
                    UPDATE media_files
                    SET max_audio_bit_depth = (
                      SELECT MAX(bit_depth)
                      FROM audio_streams
                      WHERE media_file_id = media_files.id
                        AND bit_depth > 0
                    )
                    WHERE max_audio_bit_depth IS NULL
                      AND EXISTS (
                        SELECT 1
                        FROM audio_streams
                        WHERE media_file_id = media_files.id
                          AND bit_depth > 0
                      )
                    """
                )
            )
        from backend.app.services.media_search_index import ensure_media_file_search_index

        ensure_media_file_search_index(connection)


def init_db(engine: Engine | None = None) -> None:
    from backend.app.db.base import Base
    from backend.app.models import entities  # noqa: F401
    from backend.app.services.duplicates import backfill_filename_pattern_signatures
    from backend.app.services.app_settings import get_app_settings
    from backend.app.services.quality_profiles import migrate_legacy_library_quality_profiles

    active_engine = engine or ENGINE
    Base.metadata.create_all(active_engine)
    _apply_sqlite_additive_migrations(active_engine)
    session_factory = sessionmaker(bind=active_engine, autoflush=False, autocommit=False, expire_on_commit=False)
    with session_factory() as db:
        app_settings = get_app_settings(db)
        backfill_filename_pattern_signatures(db, app_settings.pattern_recognition.duplicate_matching)
        migrate_legacy_library_quality_profiles(db, app_settings.resolution_categories)
        db.commit()
    with active_engine.begin() as connection:
        connection.execute(text("PRAGMA optimize;"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
