import os
import tempfile

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("CONFIG_PATH", tempfile.mkdtemp(prefix="medialyze-config-"))
os.environ.setdefault("MEDIA_ROOT", tempfile.mkdtemp(prefix="medialyze-media-"))

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.models.entities import (
    AudioStream,
    DuplicateDetectionMode,
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
from backend.app.schemas.library import LibraryCreate, LibraryUpdate
from backend.app.services.library_service import (
    create_library,
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

        updated, quality_profile_changed = update_library_settings(
            db,
            Settings(),
            library.id,
            LibraryUpdate(name="Films"),
        )

        assert updated is not None
        assert updated.name == "Films"
        assert quality_profile_changed is False


def test_create_library_defaults_duplicate_detection_mode_to_off(tmp_path) -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    settings = Settings(
        runtime_mode="desktop",
        config_path=tmp_path / "config",
        media_root=tmp_path / "media-root",
    )
    library_dir = tmp_path / "movies"
    library_dir.mkdir()

    with session_factory() as db:
        library = create_library(
            db,
            settings,
            LibraryCreate(
                name="Movies",
                path=str(library_dir),
                type=LibraryType.movies,
                scan_mode=ScanMode.manual,
            ),
        )

    assert library.duplicate_detection_mode == DuplicateDetectionMode.off


def test_update_library_settings_can_change_duplicate_detection_mode() -> None:
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
            duplicate_detection_mode=DuplicateDetectionMode.filename,
            scan_config={},
        )
        db.add(library)
        db.commit()

        updated, quality_profile_changed = update_library_settings(
            db,
            Settings(),
            library.id,
            LibraryUpdate(duplicate_detection_mode=DuplicateDetectionMode.filehash),
        )

    assert updated is not None
    assert updated.duplicate_detection_mode == DuplicateDetectionMode.filehash
    assert quality_profile_changed is False


def test_update_library_settings_can_change_duplicate_detection_mode_to_both() -> None:
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
            duplicate_detection_mode=DuplicateDetectionMode.filename,
            scan_config={},
        )
        db.add(library)
        db.commit()

        updated, quality_profile_changed = update_library_settings(
            db,
            Settings(),
            library.id,
            LibraryUpdate(duplicate_detection_mode=DuplicateDetectionMode.both),
        )

    assert updated is not None
    assert updated.duplicate_detection_mode == DuplicateDetectionMode.both
    assert quality_profile_changed is False


def test_update_library_settings_backfills_visual_density_maximum_for_legacy_profiles() -> None:
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
            quality_profile={
                "version": 1,
                "resolution": {"weight": 8, "minimum": "1080p", "ideal": "4k"},
                "visual_density": {"weight": 10, "minimum": 0.02, "ideal": 0.04},
                "video_codec": {"weight": 5, "minimum": "h264", "ideal": "hevc"},
                "audio_channels": {"weight": 4, "minimum": "stereo", "ideal": "5.1"},
                "audio_codec": {"weight": 3, "minimum": "aac", "ideal": "eac3"},
                "dynamic_range": {"weight": 4, "minimum": "sdr", "ideal": "hdr10"},
                "language_preferences": {"weight": 6, "mode": "partial", "audio_languages": [], "subtitle_languages": []},
            },
        )
        db.add(library)
        db.commit()

        updated, quality_profile_changed = update_library_settings(
            db,
            Settings(),
            library.id,
            LibraryUpdate(quality_profile=library.quality_profile),
        )

    assert updated is not None
    assert updated.quality_profile["visual_density"]["maximum"] == 0.08
    assert quality_profile_changed is True


def test_create_library_accepts_absolute_paths_in_desktop_mode(tmp_path) -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    library_dir = tmp_path / "desktop-library"
    library_dir.mkdir()
    settings = Settings(
        runtime_mode="desktop",
        config_path=tmp_path / "config",
        media_root=tmp_path / "media-root",
    )

    with session_factory() as db:
        library = create_library(
            db,
            settings,
            LibraryCreate(
                name="Desktop Movies",
                path=str(library_dir),
                type=LibraryType.movies,
                scan_mode=ScanMode.manual,
            ),
        )

    assert library.path == str(library_dir.resolve())


def test_update_library_settings_falls_back_to_scheduled_for_desktop_network_paths(tmp_path, monkeypatch) -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    settings = Settings(
        runtime_mode="desktop",
        config_path=tmp_path / "config",
        media_root=tmp_path / "media-root",
    )

    with session_factory() as db:
        library = Library(
            name="Network Movies",
            path=str(tmp_path / "network-movies"),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        monkeypatch.setattr(
            "backend.app.services.library_service.is_watch_supported_for_library",
            lambda active_settings, path_value: False,
        )

        updated, quality_profile_changed = update_library_settings(
            db,
            settings,
            library.id,
            LibraryUpdate(scan_mode=ScanMode.watch, scan_config={"debounce_seconds": 8}),
        )

    assert updated is not None
    assert updated.scan_mode == ScanMode.scheduled
    assert updated.scan_config == {"interval_minutes": 60}
    assert quality_profile_changed is False


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
    assert summary.duplicate_detection_mode == DuplicateDetectionMode.off


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
    assert [item.model_dump(exclude_none=True) for item in statistics.audio_codec_distribution] == [{"label": "dts", "value": 1}]
    assert [item.model_dump(exclude_none=True) for item in statistics.subtitle_language_distribution] == [
        {"label": "de", "value": 1},
        {"label": "en", "value": 1},
    ]
    assert [item.model_dump(exclude_none=True) for item in statistics.subtitle_codec_distribution] == [
        {"label": "ass", "value": 1},
        {"label": "subrip", "value": 1},
    ]
    assert [item.model_dump(exclude_none=True) for item in statistics.subtitle_source_distribution] == [
        {"label": "internal", "value": 1},
        {"label": "external", "value": 1},
    ]


def test_get_library_statistics_groups_similar_resolutions_into_categories() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies-grouped",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        first = MediaFile(
            library_id=library.id,
            relative_path="scope-a.mkv",
            filename="scope-a.mkv",
            extension="mkv",
            size_bytes=100,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=7,
        )
        second = MediaFile(
            library_id=library.id,
            relative_path="scope-b.mkv",
            filename="scope-b.mkv",
            extension="mkv",
            size_bytes=100,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
        )
        db.add_all([first, second])
        db.flush()
        db.add_all(
            [
                VideoStream(media_file_id=first.id, stream_index=0, codec="hevc", width=3840, height=1606),
                VideoStream(media_file_id=second.id, stream_index=0, codec="hevc", width=3840, height=2160),
            ]
        )
        db.commit()

        statistics = get_library_statistics(db, library.id)

    assert statistics is not None
    assert [item.model_dump(exclude_none=True) for item in statistics.resolution_distribution] == [{"label": "4k", "value": 2}]


def test_get_library_statistics_keeps_hdr10_plus_separate_from_hdr10() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        hdr10_file = MediaFile(
            library_id=library.id,
            relative_path="hdr10.mkv",
            filename="hdr10.mkv",
            extension="mkv",
            size_bytes=100,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=7,
        )
        hdr10_plus_file = MediaFile(
            library_id=library.id,
            relative_path="hdr10-plus.mkv",
            filename="hdr10-plus.mkv",
            extension="mkv",
            size_bytes=100,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
        )
        db.add_all([hdr10_file, hdr10_plus_file])
        db.flush()
        db.add_all(
            [
                VideoStream(
                    media_file_id=hdr10_file.id,
                    stream_index=0,
                    codec="hevc",
                    width=3840,
                    height=2160,
                    hdr_type="HDR10",
                ),
                VideoStream(
                    media_file_id=hdr10_plus_file.id,
                    stream_index=0,
                    codec="hevc",
                    width=3840,
                    height=2160,
                    hdr_type="HDR10+",
                ),
            ]
        )
        db.commit()

        statistics = get_library_statistics(db, library.id)

    assert statistics is not None
    hdr_distribution = {item.label: item.value for item in statistics.hdr_distribution}
    assert hdr_distribution["HDR10"] == 1
    assert hdr_distribution["HDR10+"] == 1


def test_get_library_statistics_counts_undefined_languages_per_file() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Undefined Languages",
            path="/tmp/undefined-languages",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for index in range(119):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=f"episode-{index:03d}.mkv",
                filename=f"episode-{index:03d}.mkv",
                extension="mkv",
                size_bytes=100 + index,
                mtime=float(index + 1),
                scan_status=ScanStatus.ready,
                quality_score=5,
            )
            db.add(media_file)
            db.flush()
            db.add(AudioStream(media_file_id=media_file.id, stream_index=1, codec="aac", language=None))
            db.add(AudioStream(media_file_id=media_file.id, stream_index=2, codec="aac", language=""))

        subtitle_undefined = MediaFile(
            library_id=library.id,
            relative_path="subtitle-und.mkv",
            filename="subtitle-und.mkv",
            extension="mkv",
            size_bytes=999,
            mtime=200.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        subtitle_german = MediaFile(
            library_id=library.id,
            relative_path="subtitle-de.mkv",
            filename="subtitle-de.mkv",
            extension="mkv",
            size_bytes=1000,
            mtime=201.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        db.add_all([subtitle_undefined, subtitle_german])
        db.flush()
        db.add_all(
            [
                SubtitleStream(
                    media_file_id=subtitle_undefined.id,
                    stream_index=2,
                    codec="subrip",
                    language=None,
                    default_flag=False,
                    forced_flag=False,
                ),
                ExternalSubtitle(
                    media_file_id=subtitle_undefined.id,
                    path="subtitle-und.und.srt",
                    language="",
                    format="srt",
                ),
                SubtitleStream(
                    media_file_id=subtitle_german.id,
                    stream_index=2,
                    codec="subrip",
                    language="ger",
                    default_flag=False,
                    forced_flag=False,
                ),
            ]
        )
        db.commit()

        statistics = get_library_statistics(db, library.id)

    assert statistics is not None
    audio_languages = {item.label: item.value for item in statistics.audio_language_distribution}
    subtitle_languages = {item.label: item.value for item in statistics.subtitle_language_distribution}
    assert audio_languages["und"] == 119
    assert subtitle_languages["und"] == 1
    assert subtitle_languages["de"] == 1


def test_get_library_statistics_deduplicates_multi_value_panels_per_file() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON;")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Deduplicated Stats",
            path="/tmp/deduplicated-stats",
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
        db.add_all(
            [
                AudioStream(media_file_id=media_file.id, stream_index=1, codec="aac", language=None),
                AudioStream(media_file_id=media_file.id, stream_index=2, codec="aac", language=""),
                AudioStream(media_file_id=media_file.id, stream_index=3, codec="aac", language="ger"),
                AudioStream(media_file_id=media_file.id, stream_index=4, codec="aac", language="deu"),
                SubtitleStream(
                    media_file_id=media_file.id,
                    stream_index=5,
                    codec="subrip",
                    language=None,
                    default_flag=False,
                    forced_flag=False,
                ),
                SubtitleStream(
                    media_file_id=media_file.id,
                    stream_index=6,
                    codec="subrip",
                    language="",
                    default_flag=False,
                    forced_flag=False,
                ),
                ExternalSubtitle(media_file_id=media_file.id, path="episode-01.und.srt", language=None, format="subrip"),
                ExternalSubtitle(media_file_id=media_file.id, path="episode-01.ger.srt", language="ger", format="subrip"),
            ]
        )
        db.commit()

        statistics = get_library_statistics(db, library.id)

    assert statistics is not None
    audio_languages = {item.label: item.value for item in statistics.audio_language_distribution}
    audio_codecs = {item.label: item.value for item in statistics.audio_codec_distribution}
    subtitle_languages = {item.label: item.value for item in statistics.subtitle_language_distribution}
    subtitle_codecs = {item.label: item.value for item in statistics.subtitle_codec_distribution}
    subtitle_sources = {item.label: item.value for item in statistics.subtitle_source_distribution}
    assert audio_languages == {"de": 1, "und": 1}
    assert audio_codecs == {"aac": 1}
    assert subtitle_languages == {"de": 1, "und": 1}
    assert subtitle_codecs == {"subrip": 1}
    assert subtitle_sources == {"external": 1, "internal": 1}
