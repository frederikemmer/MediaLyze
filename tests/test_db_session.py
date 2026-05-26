import os
import tempfile
from datetime import UTC, datetime

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("CONFIG_PATH", tempfile.mkdtemp(prefix="medialyze-config-"))
os.environ.setdefault("MEDIA_ROOT", tempfile.mkdtemp(prefix="medialyze-media-"))

from backend.app.core.config import Settings
from backend.app.db.session import create_engine_for_settings, init_db
from backend.app.db.base import Base
from backend.app.models.entities import Library, LibraryType, ScanMode


def test_sqlite_engine_configures_busy_timeout(tmp_path) -> None:
    settings = Settings(
        config_path=tmp_path,
        media_root=tmp_path / "media",
        sqlite_busy_timeout_seconds=30,
    )
    engine = create_engine_for_settings(settings)

    try:
        with engine.connect() as connection:
            busy_timeout_ms = connection.execute(text("PRAGMA busy_timeout")).scalar_one()
    finally:
        engine.dispose()

    assert busy_timeout_ms == 30_000


def test_init_db_adds_missing_columns_for_existing_sqlite_schema() -> None:
    engine = create_engine("sqlite:///:memory:")

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE libraries (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR(255) NOT NULL UNIQUE,
                    path VARCHAR(2048) NOT NULL UNIQUE,
                    type VARCHAR(16) NOT NULL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE media_files (
                    id INTEGER PRIMARY KEY,
                    library_id INTEGER NOT NULL,
                    relative_path VARCHAR(2048) NOT NULL,
                    filename VARCHAR(512) NOT NULL,
                    extension VARCHAR(32) NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    mtime FLOAT NOT NULL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE subtitle_streams (
                    id INTEGER PRIMARY KEY,
                    media_file_id INTEGER NOT NULL,
                    stream_index INTEGER NOT NULL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE video_streams (
                    id INTEGER PRIMARY KEY,
                    media_file_id INTEGER NOT NULL,
                    stream_index INTEGER NOT NULL,
                    codec VARCHAR(64),
                    width INTEGER,
                    height INTEGER
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE external_subtitles (
                    id INTEGER PRIMARY KEY,
                    media_file_id INTEGER NOT NULL,
                    path VARCHAR(2048) NOT NULL
                )
                """
            )
        )

    init_db(engine)

    inspector = inspect(engine)
    library_columns = {column["name"] for column in inspector.get_columns("libraries")}
    media_file_columns = {column["name"] for column in inspector.get_columns("media_files")}
    video_stream_columns = {column["name"] for column in inspector.get_columns("video_streams")}
    subtitle_columns = {column["name"] for column in inspector.get_columns("subtitle_streams")}
    external_subtitle_columns = {column["name"] for column in inspector.get_columns("external_subtitles")}
    scan_job_columns = {column["name"] for column in inspector.get_columns("scan_jobs")}
    media_file_history_columns = {column["name"] for column in inspector.get_columns("media_file_history")}
    library_history_columns = {column["name"] for column in inspector.get_columns("library_history")}

    assert "app_settings" in inspector.get_table_names()
    assert "media_file_history" in inspector.get_table_names()
    assert "library_history" in inspector.get_table_names()
    assert {"last_scan_at", "scan_mode", "duplicate_detection_mode", "scan_config"}.issubset(library_columns)
    assert {
        "last_seen_at",
        "last_analyzed_at",
        "scan_status",
        "quality_score",
        "raw_ffprobe_json",
        "filename_signature",
        "content_hash",
        "content_hash_algorithm",
    }.issubset(
        media_file_columns
    )
    assert {"bit_depth", "hdr_type", "pix_fmt"}.issubset(video_stream_columns)
    assert {"codec", "language", "default_flag", "forced_flag", "subtitle_type"}.issubset(subtitle_columns)
    assert {"language", "format"}.issubset(external_subtitle_columns)
    assert {"trigger_source", "trigger_details", "scan_summary"}.issubset(scan_job_columns)
    assert {
        "library_id",
        "media_file_id",
        "relative_path",
        "filename",
        "captured_at",
        "capture_reason",
        "snapshot_hash",
        "snapshot",
    }.issubset(media_file_history_columns)
    assert {"library_id", "snapshot_day", "captured_at", "source_scan_job_id", "snapshot"}.issubset(
        library_history_columns
    )


def test_init_db_adds_missing_indexes_for_existing_sqlite_schema() -> None:
    engine = create_engine("sqlite:///:memory:")

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE media_files (
                    id INTEGER PRIMARY KEY,
                    library_id INTEGER NOT NULL,
                    relative_path VARCHAR(2048) NOT NULL,
                    filename VARCHAR(512) NOT NULL,
                    extension VARCHAR(32) NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    mtime FLOAT NOT NULL,
                    scan_status VARCHAR(16) NOT NULL DEFAULT 'pending',
                    quality_score INTEGER NOT NULL DEFAULT 1
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE subtitle_streams (
                    id INTEGER PRIMARY KEY,
                    media_file_id INTEGER NOT NULL,
                    stream_index INTEGER NOT NULL,
                    codec VARCHAR(64),
                    language VARCHAR(16)
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE video_streams (
                    id INTEGER PRIMARY KEY,
                    media_file_id INTEGER NOT NULL,
                    stream_index INTEGER NOT NULL,
                    codec VARCHAR(64),
                    width INTEGER,
                    height INTEGER
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE external_subtitles (
                    id INTEGER PRIMARY KEY,
                    media_file_id INTEGER NOT NULL,
                    path VARCHAR(2048) NOT NULL,
                    language VARCHAR(16)
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE scan_jobs (
                    id INTEGER PRIMARY KEY,
                    library_id INTEGER NOT NULL,
                    status VARCHAR(32) NOT NULL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE media_file_history (
                    id INTEGER PRIMARY KEY,
                    library_id INTEGER NOT NULL,
                    media_file_id INTEGER,
                    relative_path VARCHAR(2048) NOT NULL,
                    filename VARCHAR(512) NOT NULL,
                    captured_at DATETIME NOT NULL,
                    capture_reason VARCHAR(32) NOT NULL,
                    snapshot_hash VARCHAR(128) NOT NULL,
                    snapshot JSON NOT NULL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE library_history (
                    id INTEGER PRIMARY KEY,
                    library_id INTEGER NOT NULL,
                    snapshot_day VARCHAR(10) NOT NULL,
                    captured_at DATETIME NOT NULL,
                    source_scan_job_id INTEGER,
                    snapshot JSON NOT NULL
                )
                """
            )
        )

    init_db(engine)

    index_names = {index["name"] for index in inspect(engine).get_indexes("media_files")}
    video_stream_index_names = {index["name"] for index in inspect(engine).get_indexes("video_streams")}
    subtitle_index_names = {index["name"] for index in inspect(engine).get_indexes("subtitle_streams")}
    external_subtitle_index_names = {index["name"] for index in inspect(engine).get_indexes("external_subtitles")}
    scan_job_index_names = {index["name"] for index in inspect(engine).get_indexes("scan_jobs")}
    media_file_history_index_names = {index["name"] for index in inspect(engine).get_indexes("media_file_history")}
    library_history_index_names = {index["name"] for index in inspect(engine).get_indexes("library_history")}

    assert "ix_media_files_library_relative_path" in index_names
    assert "ix_media_files_scan_status" in index_names
    assert "ix_media_files_quality_score" in index_names
    assert "ix_media_files_library_size_bytes" in index_names
    assert "ix_media_files_library_mtime" in index_names
    assert "ix_media_files_library_last_analyzed_at" in index_names
    assert "ix_media_files_library_quality_score" in index_names
    assert "ix_media_files_library_filename_signature" in index_names
    assert "ix_media_files_library_content_hash" in index_names
    assert "ix_video_streams_bit_depth" in video_stream_index_names
    assert "ix_subtitle_streams_codec" in subtitle_index_names
    assert "ix_subtitle_streams_language" in subtitle_index_names
    assert "ix_subtitle_streams_media_file_id" in subtitle_index_names
    assert "ix_external_subtitles_language" in external_subtitle_index_names
    assert "ix_external_subtitles_media_file_id" in external_subtitle_index_names
    assert "ix_scan_jobs_status" in scan_job_index_names
    assert "ix_scan_jobs_library_id" in scan_job_index_names
    assert "ix_media_file_history_library_path_captured_at" in media_file_history_index_names
    assert "ix_media_file_history_captured_at" in media_file_history_index_names
    assert "ix_library_history_library_snapshot_day" in library_history_index_names
    assert "ix_library_history_captured_at" in library_history_index_names


def test_sqlite_utc_datetime_roundtrip_restores_utc_tzinfo() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            last_scan_at=datetime(2026, 3, 24, 9, 36, tzinfo=UTC),
        )
        db.add(library)
        db.commit()
        db.refresh(library)

        assert library.created_at.tzinfo == UTC
        assert library.updated_at.tzinfo == UTC
        assert library.last_scan_at is not None
        assert library.last_scan_at.tzinfo == UTC

        stored = db.execute(text("SELECT last_scan_at FROM libraries WHERE id = :library_id"), {"library_id": library.id}).scalar()

    assert stored == "2026-03-24 09:36:00.000000"


def test_init_db_drops_legacy_unique_constraint_for_libraries_path() -> None:
    engine = create_engine("sqlite:///:memory:")

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE libraries (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR(255) NOT NULL UNIQUE,
                    path VARCHAR(2048) NOT NULL UNIQUE,
                    type VARCHAR(16) NOT NULL
                )
                """
            )
        )

    init_db(engine)

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO libraries (name, path, type) "
                "VALUES ('Movies', '/media/mnt', 'movies')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO libraries (name, path, type) "
                "VALUES ('TVSeries', '/media/mnt', 'series')"
            )
        )

        same_path_count = connection.execute(
            text("SELECT COUNT(*) FROM libraries WHERE path = '/media/mnt'")
        ).scalar_one()

        index_rows = connection.exec_driver_sql("PRAGMA index_list('libraries')").mappings().all()
        has_unique_path_index = False
        for row in index_rows:
            if int(row.get("unique") or 0) != 1:
                continue
            index_name = str(row.get("name") or "")
            index_columns = [
                str(item.get("name") or "")
                for item in connection.exec_driver_sql(f"PRAGMA index_info('{index_name}')").mappings().all()
            ]
            if index_columns == ["path"]:
                has_unique_path_index = True
                break

    assert same_path_count == 2
    assert has_unique_path_index is False


def test_init_db_adds_video_bit_depth_column_for_legacy_video_stream_schema_and_is_idempotent() -> None:
    engine = create_engine("sqlite:///:memory:")

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE video_streams (
                    id INTEGER PRIMARY KEY,
                    media_file_id INTEGER NOT NULL,
                    stream_index INTEGER NOT NULL,
                    codec VARCHAR(64),
                    width INTEGER,
                    height INTEGER
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO video_streams (id, media_file_id, stream_index, codec)
                VALUES (1, 101, 0, 'hevc')
                """
            )
        )

    init_db(engine)
    init_db(engine)

    with engine.begin() as connection:
        video_stream_columns = {
            str(column["name"])
            for column in connection.exec_driver_sql("PRAGMA table_info('video_streams')").mappings().all()
        }
        row_count = connection.execute(text("SELECT COUNT(*) FROM video_streams")).scalar_one()
        value_row = connection.execute(
            text("SELECT codec, bit_depth FROM video_streams WHERE id = 1")
        ).first()

    assert "bit_depth" in video_stream_columns
    assert row_count == 1
    assert value_row is not None
    assert value_row[0] == "hevc"
    assert value_row[1] is None
