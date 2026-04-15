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
    engine = create_engine(
        _sqlite_url(settings.database_path),
        connect_args={"check_same_thread": False},
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
        cursor.close()

    return engine


SETTINGS = get_settings()
ENGINE = create_engine_for_settings(SETTINGS)
SessionLocal = sessionmaker(bind=ENGINE, autoflush=False, autocommit=False, expire_on_commit=False)


SQLITE_ADDITIVE_COLUMNS: dict[str, dict[str, str]] = {
    "libraries": {
        "last_scan_at": "ALTER TABLE libraries ADD COLUMN last_scan_at DATETIME",
        "scan_mode": "ALTER TABLE libraries ADD COLUMN scan_mode VARCHAR(16) NOT NULL DEFAULT 'manual'",
        "duplicate_detection_mode": (
            "ALTER TABLE libraries ADD COLUMN duplicate_detection_mode "
            "VARCHAR(16) NOT NULL DEFAULT 'off'"
        ),
        "scan_config": "ALTER TABLE libraries ADD COLUMN scan_config JSON NOT NULL DEFAULT '{}'",
        "quality_profile": "ALTER TABLE libraries ADD COLUMN quality_profile JSON NOT NULL DEFAULT '{}'",
        "show_on_dashboard": "ALTER TABLE libraries ADD COLUMN show_on_dashboard BOOLEAN NOT NULL DEFAULT 1",
    },
    "media_files": {
        "last_seen_at": "ALTER TABLE media_files ADD COLUMN last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
        "last_analyzed_at": "ALTER TABLE media_files ADD COLUMN last_analyzed_at DATETIME",
        "scan_status": "ALTER TABLE media_files ADD COLUMN scan_status VARCHAR(16) NOT NULL DEFAULT 'pending'",
        "quality_score": "ALTER TABLE media_files ADD COLUMN quality_score INTEGER NOT NULL DEFAULT 1",
        "quality_score_raw": "ALTER TABLE media_files ADD COLUMN quality_score_raw FLOAT NOT NULL DEFAULT 0",
        "quality_score_breakdown": "ALTER TABLE media_files ADD COLUMN quality_score_breakdown JSON",
        "raw_ffprobe_json": "ALTER TABLE media_files ADD COLUMN raw_ffprobe_json JSON",
        "filename_signature": "ALTER TABLE media_files ADD COLUMN filename_signature VARCHAR(512)",
        "content_hash": "ALTER TABLE media_files ADD COLUMN content_hash VARCHAR(128)",
        "content_hash_algorithm": "ALTER TABLE media_files ADD COLUMN content_hash_algorithm VARCHAR(32)",
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
        "language": "ALTER TABLE audio_streams ADD COLUMN language VARCHAR(16)",
        "default_flag": "ALTER TABLE audio_streams ADD COLUMN default_flag BOOLEAN NOT NULL DEFAULT 0",
        "forced_flag": "ALTER TABLE audio_streams ADD COLUMN forced_flag BOOLEAN NOT NULL DEFAULT 0",
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
        "trigger_source": "ALTER TABLE scan_jobs ADD COLUMN trigger_source VARCHAR(16) NOT NULL DEFAULT 'manual'",
        "trigger_details": "ALTER TABLE scan_jobs ADD COLUMN trigger_details JSON NOT NULL DEFAULT '{}'",
        "scan_summary": "ALTER TABLE scan_jobs ADD COLUMN scan_summary JSON NOT NULL DEFAULT '{}'",
    },
}

SQLITE_INDEX_STATEMENTS: tuple[str, ...] = (
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_media_files_library_relative_path ON media_files (library_id, relative_path)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_scan_status ON media_files (scan_status)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_quality_score ON media_files (quality_score)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_size_bytes ON media_files (library_id, size_bytes)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_mtime ON media_files (library_id, mtime)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_last_analyzed_at ON media_files (library_id, last_analyzed_at)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_quality_score ON media_files (library_id, quality_score)",
    "CREATE INDEX IF NOT EXISTS ix_media_files_library_filename_signature ON media_files (library_id, filename_signature)",
    (
        "CREATE INDEX IF NOT EXISTS ix_media_files_library_content_hash "
        "ON media_files (library_id, content_hash_algorithm, content_hash)"
    ),
    "CREATE INDEX IF NOT EXISTS ix_video_streams_codec ON video_streams (codec)",
    "CREATE INDEX IF NOT EXISTS ix_video_streams_resolution ON video_streams (width, height)",
    "CREATE INDEX IF NOT EXISTS ix_video_streams_hdr_type ON video_streams (hdr_type)",
    "CREATE INDEX IF NOT EXISTS ix_video_streams_media_file_stream_index ON video_streams (media_file_id, stream_index)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_codec ON audio_streams (codec)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_spatial_audio_profile ON audio_streams (spatial_audio_profile)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_layout ON audio_streams (channel_layout)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_language ON audio_streams (language)",
    "CREATE INDEX IF NOT EXISTS ix_audio_streams_media_file_id ON audio_streams (media_file_id)",
    "CREATE INDEX IF NOT EXISTS ix_subtitle_streams_codec ON subtitle_streams (codec)",
    "CREATE INDEX IF NOT EXISTS ix_subtitle_streams_language ON subtitle_streams (language)",
    "CREATE INDEX IF NOT EXISTS ix_subtitle_streams_media_file_id ON subtitle_streams (media_file_id)",
    "CREATE INDEX IF NOT EXISTS ix_external_subtitles_language ON external_subtitles (language)",
    "CREATE INDEX IF NOT EXISTS ix_external_subtitles_media_file_id ON external_subtitles (media_file_id)",
    "CREATE INDEX IF NOT EXISTS ix_scan_jobs_status ON scan_jobs (status)",
    "CREATE INDEX IF NOT EXISTS ix_scan_jobs_library_id ON scan_jobs (library_id)",
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

        for statement in SQLITE_INDEX_STATEMENTS:
            connection.execute(text(statement))

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


def init_db(engine: Engine | None = None) -> None:
    from backend.app.db.base import Base
    from backend.app.models import entities  # noqa: F401

    active_engine = engine or ENGINE
    Base.metadata.create_all(active_engine)
    _apply_sqlite_additive_migrations(active_engine)
    with active_engine.begin() as connection:
        connection.execute(text("PRAGMA optimize;"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
