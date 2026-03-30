from datetime import UTC, datetime

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from backend.app.db.session import init_db
from backend.app.db.base import Base
from backend.app.models.entities import Library, LibraryType, ScanMode


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
    subtitle_columns = {column["name"] for column in inspector.get_columns("subtitle_streams")}
    external_subtitle_columns = {column["name"] for column in inspector.get_columns("external_subtitles")}
    scan_job_columns = {column["name"] for column in inspector.get_columns("scan_jobs")}

    assert "app_settings" in inspector.get_table_names()
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
    assert {"codec", "language", "default_flag", "forced_flag", "subtitle_type"}.issubset(subtitle_columns)
    assert {"language", "format"}.issubset(external_subtitle_columns)
    assert {"trigger_source", "trigger_details", "scan_summary"}.issubset(scan_job_columns)


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

    init_db(engine)

    index_names = {index["name"] for index in inspect(engine).get_indexes("media_files")}
    subtitle_index_names = {index["name"] for index in inspect(engine).get_indexes("subtitle_streams")}
    external_subtitle_index_names = {index["name"] for index in inspect(engine).get_indexes("external_subtitles")}
    scan_job_index_names = {index["name"] for index in inspect(engine).get_indexes("scan_jobs")}

    assert "ix_media_files_library_relative_path" in index_names
    assert "ix_media_files_scan_status" in index_names
    assert "ix_media_files_quality_score" in index_names
    assert "ix_media_files_library_size_bytes" in index_names
    assert "ix_media_files_library_mtime" in index_names
    assert "ix_media_files_library_last_analyzed_at" in index_names
    assert "ix_media_files_library_quality_score" in index_names
    assert "ix_media_files_library_filename_signature" in index_names
    assert "ix_media_files_library_content_hash" in index_names
    assert "ix_subtitle_streams_codec" in subtitle_index_names
    assert "ix_subtitle_streams_language" in subtitle_index_names
    assert "ix_subtitle_streams_media_file_id" in subtitle_index_names
    assert "ix_external_subtitles_language" in external_subtitle_index_names
    assert "ix_external_subtitles_media_file_id" in external_subtitle_index_names
    assert "ix_scan_jobs_status" in scan_job_index_names
    assert "ix_scan_jobs_library_id" in scan_job_index_names


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
