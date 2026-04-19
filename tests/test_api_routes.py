from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.api.deps import get_app_settings, get_db_session
from backend.app.api.routes import router
from backend.app.db.base import Base
from backend.app.models.entities import (
    AudioStream,
    DuplicateDetectionMode,
    ExternalSubtitle,
    JobStatus,
    Library,
    LibraryHistory,
    LibraryType,
    MediaFile,
    MediaFormat,
    ScanJob,
    ScanMode,
    ScanStatus,
    SubtitleStream,
    VideoStream,
)
from backend.app.core.config import Settings
from pathlib import Path
from backend.app.schemas.app_settings import AppSettingsUpdate
from backend.app.services.app_settings import update_app_settings


def _build_test_app(db: Session) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_db_session] = lambda: db
    app.state.scan_runtime = type(
        "TestScanRuntime",
        (),
        {
            "sync_library": lambda self, library_id: None,
            "refresh_worker_settings": lambda self: None,
            "request_quality_recompute": lambda self, library_id: None,
            "run_history_retention": lambda self: None,
            "cancel_active_jobs": lambda self: [],
        },
    )()
    return TestClient(app)


def test_library_files_export_csv_returns_404_for_unknown_library() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        client = _build_test_app(db)
        response = client.get("/api/libraries/999/files/export.csv")

    assert response.status_code == 404
    assert response.json() == {"detail": "Library not found"}


def test_library_files_export_csv_returns_422_for_invalid_search_expression() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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
        db.commit()

        client = _build_test_app(db)
        response = client.get(f"/api/libraries/{library.id}/files/export.csv?search_duration=oops")

    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid search expression for duration"}


def test_library_statistics_route_includes_numeric_distributions() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Numeric",
            path="/tmp/numeric-routes",
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
            size_bytes=6_000_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
        )
        db.add(media_file)
        db.flush()
        db.add(MediaFormat(media_file_id=media_file.id, duration=5400.0, bit_rate=None))
        db.add(AudioStream(media_file_id=media_file.id, stream_index=1, codec="aac", bit_rate=256_000))
        db.add(AudioStream(media_file_id=media_file.id, stream_index=2, codec="ac3", bit_rate=512_000))
        db.commit()

        client = _build_test_app(db)
        response = client.get(f"/api/libraries/{library.id}/statistics")

    assert response.status_code == 200
    payload = response.json()
    assert payload["numeric_distributions"]["quality_score"]["bins"][7]["count"] == 1
    assert payload["numeric_distributions"]["bitrate"]["bins"][3]["count"] == 1
    assert payload["numeric_distributions"]["audio_bitrate"]["bins"][3]["count"] == 1


def test_dashboard_comparison_route_returns_comparison_payload() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Comparison",
            path="/tmp/comparison-route",
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
            size_bytes=6_000_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
        )
        db.add(media_file)
        db.flush()
        media_file_id = media_file.id
        db.add(MediaFormat(media_file_id=media_file.id, duration=5400.0))
        db.add(AudioStream(media_file_id=media_file.id, stream_index=1, codec="aac", bit_rate=512_000))
        db.commit()

        client = _build_test_app(db)
        response = client.get("/api/dashboard/comparison?x_field=duration&y_field=size")

    assert response.status_code == 200
    payload = response.json()
    assert payload["available_renderers"] == ["heatmap", "scatter", "bar"]
    assert payload["included_files"] == 1
    assert payload["scatter_points"][0]["media_file_id"] == media_file_id
    assert payload["scatter_points"][0]["x_value"] == 5400.0


def test_dashboard_history_route_returns_visible_library_aggregation() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        visible_library = Library(
            name="Visible history",
            path="/tmp/dashboard-history-visible",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            show_on_dashboard=True,
        )
        hidden_library = Library(
            name="Hidden history",
            path="/tmp/dashboard-history-hidden",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            show_on_dashboard=False,
        )
        db.add_all([visible_library, hidden_library])
        db.flush()
        visible_library_id = visible_library.id
        db.add_all(
            [
                LibraryHistory(
                    library_id=visible_library.id,
                    snapshot_day="2026-04-10",
                    snapshot={
                        "trend_metrics": {
                            "total_files": 2,
                            "resolution_counts": {"4k": 2},
                            "average_bitrate": 8_000_000,
                            "average_audio_bitrate": 512_000,
                            "average_duration_seconds": 5_400,
                            "average_quality_score": 7.5,
                        }
                    },
                ),
                LibraryHistory(
                    library_id=hidden_library.id,
                    snapshot_day="2026-04-10",
                    snapshot={
                        "trend_metrics": {
                            "total_files": 5,
                            "resolution_counts": {"sd": 5},
                            "average_bitrate": 2_000_000,
                            "average_audio_bitrate": 128_000,
                            "average_duration_seconds": 1_800,
                            "average_quality_score": 4.0,
                        }
                    },
                ),
            ]
        )
        db.commit()

        client = _build_test_app(db)
        response = client.get("/api/dashboard/history")

    assert response.status_code == 200
    payload = response.json()
    assert payload["visible_library_ids"] == [visible_library_id]
    assert payload["oldest_snapshot_day"] == "2026-04-10"
    assert payload["newest_snapshot_day"] == "2026-04-10"
    assert payload["points"][0]["trend_metrics"]["total_files"] == 2
    assert payload["points"][0]["trend_metrics"]["resolution_counts"] == {"4k": 2}


def test_library_statistics_comparison_route_rejects_identical_axes() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Comparison",
            path="/tmp/comparison-route-library",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        client = _build_test_app(db)
        response = client.get(f"/api/libraries/{library.id}/statistics/comparison?x_field=size&y_field=size")

    assert response.status_code == 400
    assert response.json() == {"detail": "Comparison axes must use different fields"}


def test_library_history_route_returns_enriched_points_and_resolved_labels() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        update_app_settings(
            db,
            AppSettingsUpdate(
                resolution_categories=[
                    {"id": "4k", "label": "Ultra HD", "min_width": 3648, "min_height": 1520},
                    {"id": "1080p", "label": "Full HD", "min_width": 1824, "min_height": 760},
                    {"id": "sd", "label": "SD", "min_width": 0, "min_height": 0},
                ]
            ),
            Settings(),
        )
        library = Library(
            name="History",
            path="/tmp/library-history-route",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        db.add_all(
            [
                LibraryHistory(
                    library_id=library.id,
                    snapshot_day="2026-04-10",
                    snapshot={"file_count": 3},
                ),
                LibraryHistory(
                    library_id=library.id,
                    snapshot_day="2026-04-11",
                    snapshot={
                        "trend_metrics": {
                            "total_files": 3,
                            "resolution_counts": {"4k": 1, "legacy_hd": 2},
                            "average_bitrate": 8000000,
                            "average_audio_bitrate": 512000,
                            "average_duration_seconds": 5400,
                            "average_quality_score": 7.3,
                        }
                    },
                ),
                LibraryHistory(
                    library_id=library.id,
                    snapshot_day="2026-04-12",
                    snapshot={
                        "trend_metrics": {
                            "total_files": 4,
                            "resolution_counts": {"1080p": 4},
                            "average_bitrate": 9000000,
                            "average_audio_bitrate": 640000,
                            "average_duration_seconds": 5600,
                            "average_quality_score": 7.8,
                        }
                    },
                ),
            ]
        )
        db.commit()

        client = _build_test_app(db)
        response = client.get(f"/api/libraries/{library.id}/history")

    assert response.status_code == 200
    payload = response.json()
    assert payload["oldest_snapshot_day"] == "2026-04-11"
    assert payload["newest_snapshot_day"] == "2026-04-12"
    assert [point["snapshot_day"] for point in payload["points"]] == ["2026-04-11", "2026-04-12"]
    assert payload["resolution_categories"] == [
        {"id": "4k", "label": "Ultra HD"},
        {"id": "1080p", "label": "Full HD"},
        {"id": "sd", "label": "SD"},
        {"id": "legacy_hd", "label": "legacy_hd"},
    ]
    assert payload["points"][0]["trend_metrics"]["resolution_counts"]["legacy_hd"] == 2


def test_library_history_route_returns_404_for_unknown_library() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        client = _build_test_app(db)
        response = client.get("/api/libraries/999/history")

    assert response.status_code == 404
    assert response.json() == {"detail": "Library not found"}


def test_paths_inspect_returns_404_outside_desktop_mode() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        client = _build_test_app(db)
        client.app.dependency_overrides[get_app_settings] = lambda: Settings(runtime_mode="server")
        response = client.post("/api/paths/inspect", json={"path": "/tmp"})

    assert response.status_code == 404
    assert response.json() == {"detail": "Path inspection is only available in desktop mode"}


def test_browse_returns_400_for_snapshot_symlink_loops(tmp_path, monkeypatch) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    snapshot = tmp_path / "#snapshot"
    snapshot.mkdir()
    original_resolve = Path.resolve

    def fake_resolve(self: Path, *args, **kwargs):
        if self == snapshot:
            raise RuntimeError(f"Symlink loop from {self!r}")
        return original_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", fake_resolve)

    with session_factory() as db:
        client = _build_test_app(db)
        client.app.dependency_overrides[get_app_settings] = lambda: Settings(runtime_mode="server", media_root=tmp_path)
        response = client.get("/api/browse", params={"path": "#snapshot"})

    assert response.status_code == 400
    assert response.json() == {"detail": f"Invalid path under MEDIA_ROOT: {snapshot}"}


def test_library_create_returns_400_for_snapshot_symlink_loops(tmp_path, monkeypatch) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    snapshot = tmp_path / "#snapshot"
    snapshot.mkdir()
    original_resolve = Path.resolve

    def fake_resolve(self: Path, *args, **kwargs):
        if self == snapshot:
            raise RuntimeError(f"Symlink loop from {self!r}")
        return original_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", fake_resolve)

    with session_factory() as db:
        client = _build_test_app(db)
        client.app.dependency_overrides[get_app_settings] = lambda: Settings(runtime_mode="server", media_root=tmp_path)
        response = client.post(
            "/api/libraries",
            json={
                "name": "Snapshot",
                "path": "#snapshot",
                "type": "movies",
                "scan_mode": "manual",
                "scan_config": {},
                "quality_profile": {},
            },
        )

    assert response.status_code == 400
    assert response.json() == {"detail": f"Invalid path under MEDIA_ROOT: {snapshot}"}


def test_libraries_route_serializes_timestamps_as_utc_z_strings() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            created_at=datetime(2026, 3, 24, 4, 6, tzinfo=UTC),
            updated_at=datetime(2026, 3, 24, 4, 7, tzinfo=UTC),
            last_scan_at=datetime(2026, 3, 24, 4, 8, tzinfo=UTC),
        )
        db.add(library)
        db.commit()

        client = _build_test_app(db)
        response = client.get("/api/libraries")

    assert response.status_code == 200
    payload = response.json()[0]
    assert payload["created_at"].endswith("Z")
    assert payload["updated_at"].endswith("Z")
    assert payload["last_scan_at"].endswith("Z")
    assert payload["show_on_dashboard"] is True
    assert payload["created_at"] == "2026-03-24T04:06:00Z"
    assert payload["updated_at"] == "2026-03-24T04:07:00Z"
    assert payload["last_scan_at"] == "2026-03-24T04:08:00Z"


def test_active_scan_jobs_route_serializes_timestamps_as_utc_z_strings() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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
        db.add(
            ScanJob(
                library_id=library.id,
                status=JobStatus.running,
                job_type="incremental",
                started_at=datetime(2026, 3, 24, 4, 6, tzinfo=UTC),
                finished_at=datetime(2026, 3, 24, 4, 10, tzinfo=UTC),
            )
        )
        db.commit()

        client = _build_test_app(db)
        response = client.get("/api/scan-jobs/active")

    assert response.status_code == 200
    payload = response.json()[0]
    assert payload["started_at"] == "2026-03-24T04:06:00Z"
    assert payload["finished_at"] == "2026-03-24T04:10:00Z"


def test_history_storage_route_returns_storage_payload() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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
        db.add(
            ScanJob(
                library_id=library.id,
                status=JobStatus.completed,
                job_type="incremental",
                finished_at=datetime(2026, 3, 24, 4, 10, tzinfo=UTC),
                trigger_details={"reason": "user_requested"},
                scan_summary={"changes": {"new_files": {"count": 1}}},
            )
        )
        db.commit()

        client = _build_test_app(db)
        response = client.get("/api/history-storage")

    assert response.status_code == 200
    payload = response.json()
    assert payload["generated_at"].endswith("Z")
    assert payload["database_file_bytes"] >= 0
    assert payload["reclaimable_file_bytes"] >= 0
    assert payload["categories"]["scan_history"]["entry_count"] == 1
    assert payload["categories"]["scan_history"]["current_estimated_bytes"] > 0


def test_history_reconstruct_route_returns_summary_payload() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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
        db.add(
            MediaFile(
                library_id=library.id,
                relative_path="movie.mkv",
                filename="movie.mkv",
                extension="mkv",
                size_bytes=1024,
                mtime=(datetime.now(UTC) - timedelta(days=2)).timestamp(),
                scan_status=ScanStatus.ready,
                quality_score=7,
                quality_score_raw=7.0,
            )
        )
        db.commit()

        client = _build_test_app(db)
        response = client.post("/api/history/reconstruct")

    assert response.status_code == 200
    payload = response.json()
    assert payload["generated_at"].endswith("Z")
    assert payload["libraries_processed"] == 1
    assert payload["libraries_with_media"] == 1
    assert payload["created_file_history_entries"] == 1
    assert payload["created_library_history_entries"] >= 1


def test_library_duplicates_route_returns_404_for_unknown_library() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        client = _build_test_app(db)
        response = client.get("/api/libraries/999/duplicates")

    assert response.status_code == 404
    assert response.json() == {"detail": "Library not found"}


def test_file_stream_details_route_returns_lightweight_stream_payload() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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

        media_file = MediaFile(
            library_id=library.id,
            relative_path="movie.mkv",
            filename="movie.mkv",
            extension="mkv",
            size_bytes=1024,
            mtime=1,
        )
        db.add(media_file)
        db.flush()
        db.add_all(
            [
                VideoStream(
                    media_file_id=media_file.id,
                    stream_index=0,
                    codec="hevc",
                    width=3840,
                    height=2160,
                    hdr_type="HDR10",
                ),
                AudioStream(
                    media_file_id=media_file.id,
                    stream_index=2,
                    codec="truehd",
                    channels=8,
                    channel_layout="7.1",
                    language="en",
                    default_flag=True,
                ),
                AudioStream(
                    media_file_id=media_file.id,
                    stream_index=1,
                    codec="aac",
                    channels=2,
                    channel_layout="stereo",
                    language="ja",
                ),
                SubtitleStream(
                    media_file_id=media_file.id,
                    stream_index=4,
                    codec="subrip",
                    language="de",
                    subtitle_type="text",
                    forced_flag=True,
                ),
                ExternalSubtitle(
                    media_file_id=media_file.id,
                    path="movie.en.srt",
                    language="en",
                    format="srt",
                ),
            ]
        )
        db.commit()

        client = _build_test_app(db)
        response = client.get(f"/api/files/{media_file.id}/streams")

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == media_file.id
    assert payload["audio_streams"][0]["stream_index"] == 1
    assert payload["audio_streams"][1]["stream_index"] == 2
    assert payload["video_streams"][0]["codec"] == "hevc"
    assert payload["subtitle_streams"][0]["subtitle_type"] == "text"
    assert payload["external_subtitles"][0]["path"] == "movie.en.srt"
    assert "raw_ffprobe_json" not in payload


def test_library_duplicates_route_returns_grouped_duplicates_for_active_mode() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        filename_library = Library(
            name="Filename Movies",
            path="/tmp/filename-movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.filename,
            scan_config={},
        )
        filehash_library = Library(
            name="Filehash Movies",
            path="/tmp/filehash-movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.filehash,
            scan_config={},
        )
        db.add_all([filename_library, filehash_library])
        db.flush()

        db.add_all(
            [
                MediaFile(
                    library_id=filename_library.id,
                    relative_path="Movie.Name.2024.mkv",
                    filename="Movie.Name.2024.mkv",
                    extension="mkv",
                    size_bytes=10,
                    mtime=1.0,
                    filename_signature="movie name 2024",
                ),
                MediaFile(
                    library_id=filename_library.id,
                    relative_path="movie_name_2024.mp4",
                    filename="movie_name_2024.mp4",
                    extension="mp4",
                    size_bytes=12,
                    mtime=1.0,
                    filename_signature="movie name 2024",
                ),
                MediaFile(
                    library_id=filehash_library.id,
                    relative_path="dup-a.mkv",
                    filename="dup-a.mkv",
                    extension="mkv",
                    size_bytes=20,
                    mtime=1.0,
                    content_hash="deadbeef",
                    content_hash_algorithm="sha256",
                ),
                MediaFile(
                    library_id=filehash_library.id,
                    relative_path="dup-b.mp4",
                    filename="dup-b.mp4",
                    extension="mp4",
                    size_bytes=20,
                    mtime=1.0,
                    content_hash="deadbeef",
                    content_hash_algorithm="sha256",
                ),
            ]
        )
        db.commit()

        client = _build_test_app(db)
        filename_response = client.get(f"/api/libraries/{filename_library.id}/duplicates")
        filehash_response = client.get(f"/api/libraries/{filehash_library.id}/duplicates")

    assert filename_response.status_code == 200
    filename_payload = filename_response.json()
    assert filename_payload["mode"] == "filename"
    assert filename_payload["total_groups"] == 1
    assert filename_payload["duplicate_file_count"] == 2
    assert filename_payload["items"][0]["signature"] == "movie name 2024"
    assert [item["relative_path"] for item in filename_payload["items"][0]["items"]] == [
        "Movie.Name.2024.mkv",
        "movie_name_2024.mp4",
    ]

    assert filehash_response.status_code == 200
    filehash_payload = filehash_response.json()
    assert filehash_payload["mode"] == "filehash"
    assert filehash_payload["total_groups"] == 1
    assert filehash_payload["duplicate_file_count"] == 2
    assert filehash_payload["items"][0]["signature"] == "deadbeef"
    assert filehash_payload["items"][0]["mode"] == "filehash"


def test_library_duplicates_route_returns_empty_page_when_detection_is_off() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Disabled Movies",
            path="/tmp/disabled-movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.off,
            scan_config={},
        )
        db.add(library)
        db.flush()
        db.add_all(
            [
                MediaFile(
                    library_id=library.id,
                    relative_path="Movie.Name.2024.mkv",
                    filename="Movie.Name.2024.mkv",
                    extension="mkv",
                    size_bytes=10,
                    mtime=1.0,
                    filename_signature="movie name 2024",
                    content_hash="deadbeef",
                    content_hash_algorithm="sha256",
                ),
                MediaFile(
                    library_id=library.id,
                    relative_path="movie_name_2024.mp4",
                    filename="movie_name_2024.mp4",
                    extension="mp4",
                    size_bytes=12,
                    mtime=1.0,
                    filename_signature="movie name 2024",
                    content_hash="deadbeef",
                    content_hash_algorithm="sha256",
                ),
            ]
        )
        db.commit()

        client = _build_test_app(db)
        response = client.get(f"/api/libraries/{library.id}/duplicates")

    assert response.status_code == 200
    assert response.json() == {
        "mode": "off",
        "total_groups": 0,
        "duplicate_file_count": 0,
        "offset": 0,
        "limit": 25,
        "items": [],
    }


def test_library_duplicates_route_returns_both_group_types_for_combined_mode() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Combined Movies",
            path="/tmp/combined-movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.both,
            scan_config={},
        )
        db.add(library)
        db.flush()

        db.add_all(
            [
                MediaFile(
                    library_id=library.id,
                    relative_path="Movie.Name.2024.mkv",
                    filename="Movie.Name.2024.mkv",
                    extension="mkv",
                    size_bytes=10,
                    mtime=1.0,
                    filename_signature="movie name 2024",
                    content_hash="hash-a",
                    content_hash_algorithm="sha256",
                ),
                MediaFile(
                    library_id=library.id,
                    relative_path="movie_name_2024.mp4",
                    filename="movie_name_2024.mp4",
                    extension="mp4",
                    size_bytes=12,
                    mtime=1.0,
                    filename_signature="movie name 2024",
                    content_hash="hash-b",
                    content_hash_algorithm="sha256",
                ),
                MediaFile(
                    library_id=library.id,
                    relative_path="hash-a.mkv",
                    filename="hash-a.mkv",
                    extension="mkv",
                    size_bytes=20,
                    mtime=1.0,
                    filename_signature="hash a",
                    content_hash="deadbeef",
                    content_hash_algorithm="sha256",
                ),
                MediaFile(
                    library_id=library.id,
                    relative_path="different-name.mp4",
                    filename="different-name.mp4",
                    extension="mp4",
                    size_bytes=20,
                    mtime=1.0,
                    filename_signature="different name",
                    content_hash="deadbeef",
                    content_hash_algorithm="sha256",
                ),
            ]
        )
        db.commit()

        client = _build_test_app(db)
        response = client.get(f"/api/libraries/{library.id}/duplicates")

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "both"
    assert payload["total_groups"] == 2
    assert payload["duplicate_file_count"] == 4
    assert [item["mode"] for item in payload["items"]] == ["filehash", "filename"]
    assert payload["items"][0]["signature"] == "deadbeef"
    assert payload["items"][1]["signature"] == "movie name 2024"
