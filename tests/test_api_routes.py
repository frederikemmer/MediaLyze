from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.api.deps import get_app_settings, get_db_session
from backend.app.api.routes import router
from backend.app.db.base import Base
from backend.app.models.entities import JobStatus, Library, LibraryType, ScanJob, ScanMode
from backend.app.core.config import Settings
from pathlib import Path


def _build_test_app(db: Session) -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_db_session] = lambda: db
    app.state.scan_runtime = type(
        "TestScanRuntime",
        (),
        {
            "sync_library": lambda self, library_id: None,
            "request_quality_recompute": lambda self, library_id: None,
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
