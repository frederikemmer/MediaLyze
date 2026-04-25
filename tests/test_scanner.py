import os
import tempfile
from concurrent.futures import Future
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("CONFIG_PATH", tempfile.mkdtemp(prefix="medialyze-config-"))
os.environ.setdefault("MEDIA_ROOT", tempfile.mkdtemp(prefix="medialyze-media-"))

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.models.entities import (
    AppSetting,
    AudioStream,
    DuplicateDetectionMode,
    ExternalSubtitle,
    Library,
    LibraryHistory,
    LibraryType,
    MediaFile,
    MediaFileHistory,
    MediaSeason,
    MediaSeries,
    ScanMode,
    ScanStatus,
    SubtitleStream,
)
from backend.app.services import scanner as scanner_service
from backend.app.services.library_service import get_library_statistics
from backend.app.services.duplicates import list_library_duplicate_groups
from backend.app.services.pattern_recognition import default_pattern_recognition_settings, recognize_media_path
from backend.app.services.scanner import _iter_media_files
from backend.app.services.scanner import run_scan
from backend.app.utils.time import utc_now


def test_iter_media_files_skips_symlink_directories(tmp_path: Path) -> None:
    media_dir = tmp_path / "mixed-root"
    media_dir.mkdir()
    nested_dir = media_dir / "movies"
    nested_dir.mkdir()
    (nested_dir / "movie.mkv").write_text("video")
    (media_dir / "ignore.txt").write_text("text")

    loop_link = media_dir / "loop"
    try:
        loop_link.symlink_to(media_dir, target_is_directory=True)
    except OSError:
        # Symlink creation may be unavailable on some environments.
        pass

    discovery = _iter_media_files(media_dir, (".mkv", ".mp4"))

    assert discovery.files == [nested_dir / "movie.mkv"]
    assert discovery.ignored_total == 0


def test_run_scan_uses_app_setting_scan_worker_count(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    (media_dir / "movie.mkv").write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            }
        ],
    }

    created_executor_sizes: list[int] = []

    class ExecutorStub:
        def __init__(self, *, max_workers: int) -> None:
            self.max_workers = max_workers
            created_executor_sizes.append(max_workers)

        def __enter__(self) -> "ExecutorStub":
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def submit(self, fn, work):
            future: Future = Future()
            future.set_result(fn(work))
            return future

    monkeypatch.setattr(scanner_service, "ThreadPoolExecutor", ExecutorStub)
    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        db.add(
            AppSetting(
                key="global",
                value={
                    "scan_performance": {
                        "scan_worker_count": 5,
                        "parallel_scan_jobs": 2,
                    }
                },
            )
        )
        db.commit()

        run_scan(db, settings, library.id, "incremental")

    assert created_executor_sizes == [5]


def test_incremental_scan_reanalyzes_files_with_incomplete_metadata(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    video_path = media_dir / "movie.mkv"
    video_path.write_text("video")
    stat = video_path.stat()

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            },
            {
                "index": 1,
                "codec_type": "audio",
                "codec_name": "aac",
                "channels": 2,
                "sample_rate": "48000",
                "bit_rate": "128000",
                "tags": {"language": "eng"},
                "disposition": {"default": 1, "forced": 0},
            },
            {
                "index": 2,
                "codec_type": "subtitle",
                "codec_name": "subrip",
                "tags": {"language": "eng"},
                "disposition": {"default": 0, "forced": 0},
            },
        ],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
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
            size_bytes=stat.st_size,
            mtime=stat.st_mtime,
            last_seen_at=utc_now(),
            last_analyzed_at=utc_now(),
            scan_status=ScanStatus.ready,
            quality_score=1,
            raw_ffprobe_json={"streams": []},
        )
        db.add(media_file)
        db.flush()
        db.add(AudioStream(media_file_id=media_file.id, stream_index=1, codec=None, language="en"))
        db.add(SubtitleStream(media_file_id=media_file.id, stream_index=2, codec=None, language="en", subtitle_type=None))
        db.commit()

        job = run_scan(db, settings, library.id, "incremental")

        refreshed = db.get(MediaFile, media_file.id)
        audio_streams = db.scalars(select(AudioStream).where(AudioStream.media_file_id == media_file.id)).all()
        subtitle_streams = db.scalars(select(SubtitleStream).where(SubtitleStream.media_file_id == media_file.id)).all()

    assert job.files_scanned == 1
    assert refreshed is not None
    assert refreshed.scan_status == ScanStatus.ready
    assert refreshed.last_analyzed_at is not None
    assert len(audio_streams) == 1
    assert audio_streams[0].codec == "aac"
    assert len(subtitle_streams) == 1
    assert subtitle_streams[0].codec == "subrip"
    assert subtitle_streams[0].subtitle_type == "text"


def test_incremental_scan_reanalyzes_unchanged_files_when_external_subtitles_change(
    tmp_path: Path,
    monkeypatch,
) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    video_path = media_dir / "movie.mkv"
    video_path.write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            }
        ],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            quality_profile={
                "language_preferences": {
                    "weight": 10,
                    "mode": "partial",
                    "audio_languages": [],
                    "subtitle_languages": ["en"],
                }
            },
        )
        db.add(library)
        db.commit()

        first_job = run_scan(db, settings, library.id, "incremental")
        first_files_scanned = first_job.files_scanned
        first_media_file = db.scalar(
            select(MediaFile).where(MediaFile.library_id == library.id)
        )
        assert first_media_file is not None
        first_last_analyzed_at = first_media_file.last_analyzed_at
        first_quality_score = first_media_file.quality_score

        (media_dir / "movie.en.srt").write_text("subtitle")

        second_job = run_scan(db, settings, library.id, "incremental")
        second_files_scanned = second_job.files_scanned
        second_modified_files = second_job.scan_summary["changes"]["modified_files"]["count"]

        refreshed = db.get(MediaFile, first_media_file.id)
        external_subtitles = db.scalars(
            select(ExternalSubtitle).where(
                ExternalSubtitle.media_file_id == first_media_file.id
            )
        ).all()
        statistics = get_library_statistics(db, library.id)

    assert first_files_scanned == 1
    assert second_files_scanned == 1
    assert second_modified_files == 1
    assert refreshed is not None
    assert refreshed.last_analyzed_at is not None
    assert refreshed.last_analyzed_at != first_last_analyzed_at
    assert refreshed.quality_score > first_quality_score
    assert [(subtitle.path, subtitle.language, subtitle.format) for subtitle in external_subtitles] == [
        ("movie.en.srt", "en", "srt")
    ]
    assert statistics is not None
    assert {item.label: item.value for item in statistics.subtitle_language_distribution} == {"en": 1}
    assert {item.label: item.value for item in statistics.subtitle_source_distribution} == {"external": 1}


def test_run_scan_persists_audio_profile_and_spatial_audio_profile(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    (media_dir / "movie.mkv").write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            },
            {
                "index": 1,
                "codec_type": "audio",
                "codec_name": "eac3",
                "profile": "Dolby Digital Plus + Dolby Atmos",
                "channels": 6,
                "channel_layout": "5.1(side)",
            },
        ],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        run_scan(db, settings, library.id, "full")
        audio_stream = db.scalar(select(AudioStream))

    assert audio_stream is not None
    assert audio_stream.profile == "Dolby Digital Plus + Dolby Atmos"
    assert audio_stream.spatial_audio_profile == "dolby_atmos"


def test_run_scan_persists_spatial_audio_profile_from_ffprobe_metadata_fallback(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    (media_dir / "movie.mkv").write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            },
            {
                "index": 1,
                "codec_type": "audio",
                "codec_name": "truehd",
                "profile": "TrueHD",
                "tags": {"title": "English Dolby Atmos"},
                "channels": 8,
                "channel_layout": "7.1",
            },
        ],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        run_scan(db, settings, library.id, "full")
        audio_stream = db.scalar(select(AudioStream))

    assert audio_stream is not None
    assert audio_stream.profile == "TrueHD"
    assert audio_stream.spatial_audio_profile == "dolby_atmos"


def test_scan_ignores_matching_relative_paths_and_external_subtitles(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    (media_dir / "movie.mkv").write_text("video")
    (media_dir / "movie.en.srt").write_text("subtitle")
    (media_dir / "movie.skip.srt").write_text("subtitle")
    skipped_dir = media_dir / "extras"
    skipped_dir.mkdir()
    (skipped_dir / "bonus.mkv").write_text("video")
    (media_dir / "sample.mkv").write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            }
        ],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        db.add(
            AppSetting(
                key="global",
                value={
                    "user_ignore_patterns": [
                        "*/extras/*",
                        "sample.*",
                    ],
                    "default_ignore_patterns": [
                        "*.skip.srt",
                    ]
                },
            )
        )
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        job = run_scan(db, settings, library.id, "incremental")

        indexed_files = db.scalars(select(MediaFile).order_by(MediaFile.relative_path)).all()
        subtitles = db.scalars(select(ExternalSubtitle).order_by(ExternalSubtitle.path)).all()

    assert job.files_total == 1
    assert job.files_scanned == 1
    assert [media_file.relative_path for media_file in indexed_files] == ["movie.mkv"]
    assert [subtitle.path for subtitle in subtitles] == ["movie.en.srt"]
    assert job.scan_summary["ignore_patterns"] == ["*/extras/*", "sample.*", "*.skip.srt"]
    assert job.scan_summary["discovery"]["ignored_total"] == 3
    assert job.scan_summary["changes"]["new_files"]["count"] == 1


def test_incremental_scan_removes_existing_files_that_become_ignored(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    video_path = media_dir / "movie.mkv"
    video_path.write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            }
        ],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        first_job = run_scan(db, settings, library.id, "incremental")
        first_files_total = first_job.files_total
        indexed_before = db.scalars(select(MediaFile).order_by(MediaFile.relative_path)).all()

        setting = db.get(AppSetting, "global")
        if setting is None:
            setting = AppSetting(key="global", value={})
            db.add(setting)
        setting.value = {"user_ignore_patterns": ["*.mkv"], "default_ignore_patterns": []}
        db.commit()

        second_job = run_scan(db, settings, library.id, "incremental")
        second_files_total = second_job.files_total
        second_files_scanned = second_job.files_scanned
        indexed_after = db.scalars(select(MediaFile).order_by(MediaFile.relative_path)).all()

    assert first_files_total == 1
    assert [media_file.relative_path for media_file in indexed_before] == ["movie.mkv"]
    assert second_files_total == 0
    assert second_files_scanned == 0
    assert indexed_after == []
    assert second_job.scan_summary["changes"]["deleted_files"]["count"] == 1


def test_incremental_scan_preserves_file_history_when_file_is_renamed(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    original_path = media_dir / "movie.mkv"
    renamed_path = media_dir / "renamed.mkv"
    original_path.write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [{"index": 0, "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080}],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        run_scan(db, settings, library.id, "incremental")
        first_file = db.scalar(select(MediaFile))
        assert first_file is not None
        first_file_id = first_file.id

        original_path.rename(renamed_path)
        second_job = run_scan(db, settings, library.id, "incremental")

        indexed_files = db.scalars(select(MediaFile).order_by(MediaFile.relative_path)).all()
        history_rows = db.scalars(select(MediaFileHistory).order_by(MediaFileHistory.captured_at.asc())).all()

    assert [(media_file.id, media_file.relative_path) for media_file in indexed_files] == [
        (first_file_id, "renamed.mkv")
    ]
    assert second_job.scan_summary["changes"]["new_files"]["count"] == 0
    assert second_job.scan_summary["changes"]["deleted_files"]["count"] == 0
    assert second_job.scan_summary["changes"]["modified_files"]["count"] == 1
    assert [row.relative_path for row in history_rows] == ["movie.mkv", "renamed.mkv"]
    assert {row.media_file_id for row in history_rows} == {first_file_id}


def test_incremental_scan_preserves_file_identity_when_renamed_file_metadata_changes(
    tmp_path: Path,
    monkeypatch,
) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    original_path = media_dir / "Movie.Name.2024.mkv"
    renamed_path = media_dir / "Movie Name 2024 Remux.mkv"
    original_path.write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [{"index": 0, "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080}],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        run_scan(db, settings, library.id, "incremental")
        first_file = db.scalar(select(MediaFile))
        assert first_file is not None
        first_file_id = first_file.id

        original_path.rename(renamed_path)
        renamed_path.write_text("video with updated container metadata")
        second_job = run_scan(db, settings, library.id, "incremental")

        indexed_files = db.scalars(select(MediaFile).order_by(MediaFile.relative_path)).all()
        history_rows = db.scalars(select(MediaFileHistory).order_by(MediaFileHistory.captured_at.asc())).all()

    assert [(media_file.id, media_file.relative_path) for media_file in indexed_files] == [
        (first_file_id, "Movie Name 2024 Remux.mkv")
    ]
    assert second_job.scan_summary["changes"]["new_files"]["count"] == 0
    assert second_job.scan_summary["changes"]["deleted_files"]["count"] == 0
    assert second_job.scan_summary["changes"]["modified_files"]["count"] == 1
    assert [row.relative_path for row in history_rows] == ["Movie.Name.2024.mkv", "Movie Name 2024 Remux.mkv"]
    assert {row.media_file_id for row in history_rows} == {first_file_id}


def test_incremental_scan_does_not_merge_similar_names_with_conflicting_numbers(
    tmp_path: Path,
    monkeypatch,
) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    original_path = media_dir / "Episode 01.mkv"
    replacement_path = media_dir / "Episode 02.mkv"
    original_path.write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [{"index": 0, "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080}],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Series",
            path=str(media_dir),
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        run_scan(db, settings, library.id, "incremental")
        first_file = db.scalar(select(MediaFile))
        assert first_file is not None
        first_file_id = first_file.id

        original_path.unlink()
        replacement_path.write_text("different video content")
        second_job = run_scan(db, settings, library.id, "incremental")

        indexed_files = db.scalars(select(MediaFile).order_by(MediaFile.relative_path)).all()

    assert [media_file.relative_path for media_file in indexed_files] == ["Episode 02.mkv"]
    assert indexed_files[0].id != first_file_id
    assert second_job.scan_summary["changes"]["new_files"]["count"] == 1
    assert second_job.scan_summary["changes"]["deleted_files"]["count"] == 1
    assert second_job.scan_summary["changes"]["modified_files"]["count"] == 0


def test_scan_merges_user_and_default_ignore_patterns(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    (media_dir / "movie.mkv").write_text("video")
    (media_dir / "movie.en.srt").write_text("subtitle")
    (media_dir / "movie.mkv.part").write_text("partial")
    ea_dir = media_dir / "@eaDir"
    ea_dir.mkdir()
    (ea_dir / "movie.mkv").write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            }
        ],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        db.add(
            AppSetting(
                key="global",
                value={
                    "user_ignore_patterns": ["movie.mkv.part"],
                    "default_ignore_patterns": ["*/@eaDir/*", "movie.mkv.part"],
                },
            )
        )
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        job = run_scan(db, settings, library.id, "incremental")
        indexed_files = db.scalars(select(MediaFile).order_by(MediaFile.relative_path)).all()
        subtitles = db.scalars(select(ExternalSubtitle).order_by(ExternalSubtitle.path)).all()

    assert job.files_total == 1
    assert [media_file.relative_path for media_file in indexed_files] == ["movie.mkv"]
    assert [subtitle.path for subtitle in subtitles] == ["movie.en.srt"]


def test_incremental_scan_updates_existing_files_when_size_or_mtime_changes(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    video_path = media_dir / "movie.mkv"
    video_path.write_text("v1")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            }
        ],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        first_job = run_scan(db, settings, library.id, "incremental")
        first_files_scanned = first_job.files_scanned
        media_before = db.scalar(select(MediaFile).where(MediaFile.library_id == library.id))
        assert media_before is not None
        first_size = media_before.size_bytes
        first_mtime = media_before.mtime

        video_path.write_text("version-2-with-more-bytes")
        stat = video_path.stat()

        second_job = run_scan(db, settings, library.id, "incremental")
        second_files_scanned = second_job.files_scanned
        media_after = db.scalar(select(MediaFile).where(MediaFile.library_id == library.id))

    assert first_files_scanned == 1
    assert second_files_scanned == 1
    assert media_after is not None
    assert media_after.size_bytes == stat.st_size
    assert media_after.mtime == stat.st_mtime
    assert media_after.size_bytes != first_size or media_after.mtime != first_mtime
    assert second_job.scan_summary["changes"]["modified_files"]["count"] == 1


def test_scan_summary_records_failed_files_with_short_reason(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    (media_dir / "broken.mkv").write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def fail_ffprobe(_file_path, _ffprobe_path):
        raise RuntimeError("ffprobe exploded\nwith internal details")

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", fail_ffprobe)
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        job = run_scan(db, settings, library.id, "incremental")

    assert job.status.value == "completed"
    assert job.scan_summary["analysis"]["analysis_failed"] == 1
    assert job.scan_summary["analysis"]["failed_files"][0]["path"] == "broken.mkv"
    assert job.scan_summary["analysis"]["failed_files"][0]["reason"] == "ffprobe exploded"
    assert "RuntimeError: ffprobe exploded" in job.scan_summary["analysis"]["failed_files"][0]["detail"]


def test_scan_continues_when_normalization_of_one_file_raises(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    (media_dir / "broken.mkv").write_text("video")
    (media_dir / "good.mkv").write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            }
        ],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    original_normalize = scanner_service.normalize_ffprobe_payload

    def normalize_with_failure(raw_payload):
        format_name = ((raw_payload or {}).get("format") or {}).get("format_name")
        if format_name == "broken-target":
            raise ValueError("bad payload")
        return original_normalize(raw_payload)

    def run_ffprobe_with_one_bad_file(file_path, ffprobe_path):
        if Path(file_path).name == "broken.mkv":
            return {
                **payload,
                "format": {
                    **payload["format"],
                    "format_name": "broken-target",
                },
            }
        return payload

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", run_ffprobe_with_one_bad_file)
    monkeypatch.setattr("backend.app.services.scanner.normalize_ffprobe_payload", normalize_with_failure)

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        job = run_scan(db, settings, library.id, "incremental")
        indexed_files = db.scalars(select(MediaFile).order_by(MediaFile.relative_path)).all()
        history_rows = db.scalars(
            select(LibraryHistory)
            .where(LibraryHistory.library_id == library.id)
            .order_by(LibraryHistory.snapshot_day.asc())
        ).all()

    assert job.files_total == 2
    assert job.files_scanned == 2
    assert job.status.value == "completed"
    assert [(media_file.relative_path, media_file.scan_status.value) for media_file in indexed_files] == [
        ("broken.mkv", "failed"),
        ("good.mkv", "ready"),
    ]
    assert len(history_rows) == 1
    assert history_rows[0].snapshot["trend_metrics"]["total_files"] == 1
    assert history_rows[0].snapshot["scan_delta"]["new_files"] == 2
    assert job.scan_summary["analysis"]["failed_files"][0]["path"] == "broken.mkv"
    assert job.scan_summary["analysis"]["failed_files"][0]["reason"] == "bad payload"
    assert "ValueError: bad payload" in job.scan_summary["analysis"]["failed_files"][0]["detail"]


def test_incremental_scan_backfills_missing_filehash_without_reanalyzing_unchanged_files(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    video_path = media_dir / "movie.mkv"
    video_path.write_text("video")
    stat = video_path.stat()

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    ffprobe_calls: list[str] = []
    monkeypatch.setattr(
        "backend.app.services.scanner.run_ffprobe",
        lambda file_path, ffprobe_path: ffprobe_calls.append(str(file_path)) or {},
    )
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.filehash,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="movie.mkv",
            filename="movie.mkv",
            extension="mkv",
            size_bytes=stat.st_size,
            mtime=stat.st_mtime,
            last_seen_at=utc_now(),
            last_analyzed_at=utc_now(),
            scan_status=ScanStatus.ready,
            quality_score=8,
            raw_ffprobe_json={"format": {}},
        )
        db.add(media_file)
        db.commit()

        job = run_scan(db, settings, library.id, "incremental")
        refreshed = db.get(MediaFile, media_file.id)

    assert ffprobe_calls == []
    assert refreshed is not None
    assert refreshed.content_hash is not None
    assert refreshed.content_hash_algorithm == "sha256"
    assert job.files_scanned == 1
    assert job.scan_summary["changes"]["queued_for_analysis"] == 0
    assert job.scan_summary["changes"]["unchanged_files"] == 1
    assert job.scan_summary["analysis"]["analyzed_successfully"] == 0
    assert job.scan_summary["duplicates"]["mode"] == "filehash"
    assert job.scan_summary["duplicates"]["queued_for_processing"] == 1
    assert job.scan_summary["duplicates"]["processed_successfully"] == 1
    assert job.scan_summary["duplicates"]["processing_failed"] == 0


def test_incremental_scan_does_not_rehash_unchanged_files_with_existing_hash(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    video_path = media_dir / "movie.mkv"
    video_path.write_text("video")
    stat = video_path.stat()

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def fail_if_called(file_path: Path) -> dict[str, str | None]:
        raise AssertionError(f"Unexpected duplicate processing for {file_path}")

    monkeypatch.setattr(
        "backend.app.services.duplicates.FileHashDuplicateDetectionStrategy.build_payload",
        lambda self, file_path: fail_if_called(file_path),
    )
    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: {})
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.filehash,
            scan_config={},
        )
        db.add(library)
        db.flush()

        db.add(
            MediaFile(
                library_id=library.id,
                relative_path="movie.mkv",
                filename="movie.mkv",
                extension="mkv",
                size_bytes=stat.st_size,
                mtime=stat.st_mtime,
                last_seen_at=utc_now(),
                last_analyzed_at=utc_now(),
                scan_status=ScanStatus.ready,
                quality_score=8,
                raw_ffprobe_json={"format": {}},
                content_hash="abc123",
                content_hash_algorithm="sha256",
            )
        )
        db.commit()

        job = run_scan(db, settings, library.id, "incremental")

    assert job.files_scanned == 0
    assert job.scan_summary["changes"]["unchanged_files"] == 1
    assert job.scan_summary["duplicates"]["queued_for_processing"] == 0
    assert job.scan_summary["duplicates"]["processed_successfully"] == 0


def test_incremental_scan_updates_content_hash_for_modified_files(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    video_path = media_dir / "movie.mkv"
    video_path.write_text("version-1")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            }
        ],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.filehash,
            scan_config={},
        )
        db.add(library)
        db.commit()

        first_job = run_scan(db, settings, library.id, "incremental")
        media_before = db.scalar(select(MediaFile).where(MediaFile.library_id == library.id))
        assert media_before is not None
        first_hash = media_before.content_hash
        first_summary = first_job.scan_summary

        video_path.write_text("version-2-with-more-bytes")

        second_job = run_scan(db, settings, library.id, "incremental")
        media_after = db.scalar(select(MediaFile).where(MediaFile.library_id == library.id))
        second_summary = second_job.scan_summary

    assert first_summary["duplicates"]["processed_successfully"] == 1
    assert second_summary["changes"]["modified_files"]["count"] == 1
    assert second_summary["duplicates"]["queued_for_processing"] == 1
    assert second_summary["duplicates"]["processed_successfully"] == 1
    assert media_after is not None
    assert media_after.content_hash is not None
    assert media_after.content_hash != first_hash


def test_incremental_scan_backfills_missing_signatures_for_combined_duplicate_mode(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    video_path = media_dir / "movie.name.mkv"
    video_path.write_text("video")
    stat = video_path.stat()

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    ffprobe_calls: list[str] = []
    monkeypatch.setattr(
        "backend.app.services.scanner.run_ffprobe",
        lambda file_path, ffprobe_path: ffprobe_calls.append(str(file_path)) or {},
    )
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.both,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="movie.name.mkv",
            filename="movie.name.mkv",
            extension="mkv",
            size_bytes=stat.st_size,
            mtime=stat.st_mtime,
            last_seen_at=utc_now(),
            last_analyzed_at=utc_now(),
            scan_status=ScanStatus.ready,
            quality_score=8,
            raw_ffprobe_json={"format": {}},
        )
        db.add(media_file)
        db.commit()

        job = run_scan(db, settings, library.id, "incremental")
        refreshed = db.get(MediaFile, media_file.id)

    assert ffprobe_calls == []
    assert refreshed is not None
    assert refreshed.filename_signature == "movie name"
    assert refreshed.content_hash is not None
    assert refreshed.content_hash_algorithm == "sha256"
    assert job.files_scanned == 1
    assert job.scan_summary["changes"]["queued_for_analysis"] == 0
    assert job.scan_summary["changes"]["unchanged_files"] == 1
    assert job.scan_summary["duplicates"]["mode"] == "both"
    assert job.scan_summary["duplicates"]["queued_for_processing"] == 1
    assert job.scan_summary["duplicates"]["processed_successfully"] == 1


def test_deleted_files_disappear_from_duplicate_groups_on_rescan(tmp_path: Path, monkeypatch) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    first_path = media_dir / "dup-a.mkv"
    second_path = media_dir / "dup-b.mkv"
    first_path.write_text("same-content")
    second_path.write_text("same-content")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            }
        ],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.filehash,
            scan_config={},
        )
        db.add(library)
        db.commit()

        first_job = run_scan(db, settings, library.id, "incremental")
        first_summary = first_job.scan_summary
        first_groups = list_library_duplicate_groups(db, library.id)
        second_path.unlink()
        second_job = run_scan(db, settings, library.id, "incremental")
        second_summary = second_job.scan_summary
        second_groups = list_library_duplicate_groups(db, library.id)

    assert first_summary["duplicates"]["duplicate_groups"] == 1
    assert first_summary["duplicates"]["duplicate_files"] == 2
    assert first_groups.total_groups == 1
    assert second_summary["changes"]["deleted_files"]["count"] == 1
    assert second_summary["duplicates"]["duplicate_groups"] == 0
    assert second_summary["duplicates"]["duplicate_files"] == 0
    assert second_groups.total_groups == 0


def test_incremental_scan_removes_deleted_files_from_active_index_but_keeps_history(
    tmp_path: Path,
    monkeypatch,
) -> None:
    media_dir = tmp_path / "library"
    media_dir.mkdir()
    video_path = media_dir / "movie.mkv"
    video_path.write_text("video")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    payload = {
        "format": {
            "format_name": "matroska",
            "duration": "60.0",
            "bit_rate": "1000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
            }
        ],
    }

    monkeypatch.setattr("backend.app.services.scanner.run_ffprobe", lambda file_path, ffprobe_path: payload)
    monkeypatch.setattr("backend.app.services.scanner.detect_external_subtitles", lambda file_path, extensions: [])

    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path,
        ffprobe_worker_count=1,
        scan_commit_batch_size=1,
    )

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(media_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        run_scan(db, settings, library.id, "incremental")
        video_path.unlink()
        second_job = run_scan(db, settings, library.id, "incremental")

        indexed_files = db.scalars(select(MediaFile).order_by(MediaFile.relative_path)).all()
        history_rows = db.scalars(select(MediaFileHistory).order_by(MediaFileHistory.captured_at.asc())).all()

    assert indexed_files == []
    assert second_job.scan_summary["changes"]["deleted_files"]["count"] == 1
    assert [row.relative_path for row in history_rows] == ["movie.mkv"]
