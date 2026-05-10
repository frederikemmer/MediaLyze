import os
import tempfile

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("CONFIG_PATH", tempfile.mkdtemp(prefix="medialyze-config-"))
os.environ.setdefault("MEDIA_ROOT", tempfile.mkdtemp(prefix="medialyze-media-"))

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.models.entities import (
    DuplicateDetectionMode,
    Library,
    LibraryType,
    MediaFile,
    ScanMode,
    ScanStatus,
)
from backend.app.schemas.app_settings import AppSettingsUpdate
from backend.app.services.app_settings import get_app_settings, update_app_settings
from backend.app.services.telemetry import (
    build_media_kind_counts_for_telemetry,
    build_telemetry_payload,
    round_count_for_telemetry,
    round_storage_gb_for_telemetry,
)


def build_session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def build_settings(tmp_path) -> Settings:
    return Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path / "media",
    )


def add_media_file(db, library_id: int, filename: str, size_bytes: int, status=ScanStatus.ready) -> None:
    db.add(
        MediaFile(
            library_id=library_id,
            relative_path=filename,
            filename=filename,
            extension=filename.rsplit(".", 1)[-1],
            size_bytes=size_bytes,
            mtime=1.0,
            scan_status=status,
            quality_score=5,
        )
    )


def test_round_count_for_telemetry() -> None:
    assert round_count_for_telemetry(-1) == 0
    assert round_count_for_telemetry(0) == 0
    assert round_count_for_telemetry(7) == 7
    assert round_count_for_telemetry(99) == 99
    assert round_count_for_telemetry(127) == 120
    assert round_count_for_telemetry(999) == 990
    assert round_count_for_telemetry(23793) == 23000


def test_round_storage_gb_for_telemetry() -> None:
    assert round_storage_gb_for_telemetry(-1) == 0
    assert round_storage_gb_for_telemetry(0) == 0
    assert round_storage_gb_for_telemetry(534_000_000) == 1
    assert round_storage_gb_for_telemetry(24_000_000_000) == 24
    assert round_storage_gb_for_telemetry(496_000_000_000) == 490
    assert round_storage_gb_for_telemetry(12_000_000_000_000) == 12000


def test_build_media_kind_counts_for_telemetry_classifies_ready_files_by_extension(tmp_path) -> None:
    session_factory = build_session_factory()

    with session_factory() as db:
        library = Library(
            name="Mixed",
            path="/tmp/mixed",
            type=LibraryType.mixed,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.off,
            scan_config={},
        )
        db.add(library)
        db.flush()

        add_media_file(db, library.id, "song.flac", 100)
        add_media_file(db, library.id, "movie.mkv", 100)
        add_media_file(db, library.id, "metadata.bin", 100)
        add_media_file(db, library.id, "pending.mp3", 100, status=ScanStatus.pending)
        db.commit()

        counts = build_media_kind_counts_for_telemetry(db)

    assert counts == {"audio": 1, "video": 1, "other": 1}


def test_build_media_kind_counts_for_telemetry_rounds_each_kind(tmp_path) -> None:
    session_factory = build_session_factory()

    with session_factory() as db:
        library = Library(
            name="Music",
            path="/tmp/music",
            type=LibraryType.music,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.off,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for index in range(127):
            add_media_file(db, library.id, f"song-{index}.mp3", 100)
        db.commit()

        counts = build_media_kind_counts_for_telemetry(db)

    assert counts["audio"] == 120


def test_enabled_payload_includes_app_settings_and_media_kind_counts(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        app_settings = update_app_settings(
            db,
            AppSettingsUpdate(
                ui_preferences={"interface_language": "de", "color_theme": "dark"},
                scan_performance={
                    "scan_worker_count": 6,
                    "parallel_scan_jobs": 3,
                    "comparison_scatter_point_limit": 10000,
                },
            ),
            settings,
        )
        library = Library(
            name="Mixed",
            path="/tmp/mixed",
            type=LibraryType.mixed,
            scan_mode=ScanMode.scheduled_daily,
            duplicate_detection_mode=DuplicateDetectionMode.both,
            scan_config={},
        )
        db.add(library)
        db.flush()
        add_media_file(db, library.id, "song.mp3", 534_000_000)
        add_media_file(db, library.id, "movie.mp4", 24_000_000_000)
        db.commit()

        payload = build_telemetry_payload(db, settings, app_settings, mode="enabled")

    assert payload["usage"]["media_kind_counts"] == {"audio": 1, "video": 1, "other": 0}
    assert payload["usage"]["analyzed_file_count_rounded"] == 2
    assert payload["usage"]["storage_size_gb_rounded"] == 24
    assert payload["usage"]["scan_mode_counts"]["scheduled_daily"] == 1
    assert payload["usage"]["duplicate_detection_mode_counts"]["both"] == 1
    assert payload["app_settings"] == {
        "interface_language": "de",
        "color_theme": "dark",
        "scan_worker_count": 6,
        "parallel_scan_jobs": 3,
        "comparison_scatter_point_limit": 10000,
    }


def test_minimal_payload_excludes_usage_and_app_settings(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        app_settings = get_app_settings(db, settings)
        payload = build_telemetry_payload(db, settings, app_settings, mode="minimal")

    assert "usage" not in payload
    assert "media_kind_counts" not in payload
    assert "app_settings" not in payload


def test_none_payload_excludes_usage_and_app_settings(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        app_settings = get_app_settings(db, settings)
        payload = build_telemetry_payload(db, settings, app_settings, mode="none")

    assert "usage" not in payload
    assert "media_kind_counts" not in payload
    assert "app_settings" not in payload
