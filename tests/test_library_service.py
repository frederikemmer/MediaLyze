import os
import tempfile

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("CONFIG_PATH", tempfile.mkdtemp(prefix="medialyze-config-"))
os.environ.setdefault("MEDIA_ROOT", tempfile.mkdtemp(prefix="medialyze-media-"))

from backend.app.db.base import Base
from backend.app.models.entities import (
    AudioStream,
    ExternalSubtitle,
    Library,
    LibraryType,
    MediaFile,
    MediaFormat,
    ScanMode,
    ScanStatus,
    SubtitleStream,
    VideoStream,
)
from backend.app.schemas.library import LibraryUpdate
from backend.app.services.library_service import (
    delete_library,
    get_library_statistics,
    get_library_summary,
    library_exists,
    normalize_scan_config,
    update_library_settings,
)


def test_normalize_scan_config_for_manual_mode() -> None:
    assert normalize_scan_config(ScanMode.manual, {"interval_minutes": 1}) == {}


def test_normalize_scan_config_for_scheduled_mode_enforces_minimum() -> None:
    assert normalize_scan_config(ScanMode.scheduled, {"interval_minutes": 1}) == {
        "interval_minutes": 5
    }


def test_normalize_scan_config_for_watch_mode_enforces_minimum() -> None:
    assert normalize_scan_config(ScanMode.watch, {"debounce_seconds": 1}) == {
        "debounce_seconds": 3
    }


def test_delete_library_removes_related_media_rows() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.mixed,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="movie.mkv",
            filename="movie.mkv",
            extension="mkv",
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        db.add(media_file)
        db.flush()
        db.add(MediaFormat(media_file_id=media_file.id, container_format="matroska", duration=1.0, bit_rate=1, probe_score=1))
        db.add(VideoStream(media_file_id=media_file.id, stream_index=0, codec="h264", width=1920, height=1080))
        db.commit()

        deleted = delete_library(db, library.id)

        remaining_libraries = db.scalars(select(Library)).all()
        remaining_files = db.scalars(select(MediaFile)).all()

    assert deleted is True
    assert remaining_libraries == []
    assert remaining_files == []


def test_update_library_settings_can_rename_library() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.mixed,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        updated = update_library_settings(db, library.id, LibraryUpdate(name="Films"))

        assert updated is not None
        assert updated.name == "Films"


def test_library_exists_checks_library_presence() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Shows",
            path="/tmp/shows",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        assert library_exists(db, library.id) is True
        assert library_exists(db, library.id + 1) is False


def test_get_library_summary_includes_totals() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Shows",
            path="/tmp/shows",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="episode-01.mkv",
            filename="episode-01.mkv",
            extension="mkv",
            size_bytes=321,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=7,
        )
        db.add(media_file)
        db.flush()
        db.add(MediaFormat(media_file_id=media_file.id, container_format="matroska", duration=120.0, bit_rate=1, probe_score=1))
        db.commit()

        summary = get_library_summary(db, library.id)

    assert summary is not None
    assert summary.file_count == 1
    assert summary.total_size_bytes == 321
    assert summary.total_duration_seconds == 120.0
    assert summary.ready_files == 1
    assert summary.pending_files == 0


def test_get_library_statistics_includes_subtitle_languages_codecs_and_sources() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Shows",
            path="/tmp/shows",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="episode-01.mkv",
            filename="episode-01.mkv",
            extension="mkv",
            size_bytes=321,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=7,
        )
        db.add(media_file)
        db.flush()
        db.add(MediaFormat(media_file_id=media_file.id, container_format="matroska", duration=1.0, bit_rate=1, probe_score=1))
        db.add(VideoStream(media_file_id=media_file.id, stream_index=0, codec="h264", width=1920, height=1080))
        db.add(AudioStream(media_file_id=media_file.id, stream_index=1, codec="dts", language="eng"))
        db.add(SubtitleStream(media_file_id=media_file.id, stream_index=1, codec="subrip", language="ger"))
        db.add(ExternalSubtitle(media_file_id=media_file.id, path="episode-01.en.ass", language="eng", format="ass"))
        db.commit()

        statistics = get_library_statistics(db, library.id)

    assert statistics is not None
    assert [item.model_dump() for item in statistics.audio_codec_distribution] == [{"label": "dts", "value": 1}]
    assert [item.model_dump() for item in statistics.subtitle_language_distribution] == [
        {"label": "de", "value": 1},
        {"label": "en", "value": 1},
    ]
    assert [item.model_dump() for item in statistics.subtitle_codec_distribution] == [
        {"label": "ass", "value": 1},
        {"label": "subrip", "value": 1},
    ]
    assert [item.model_dump() for item in statistics.subtitle_source_distribution] == [
        {"label": "internal", "value": 1},
        {"label": "external", "value": 1},
    ]
