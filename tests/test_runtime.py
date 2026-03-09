import os
import tempfile
from datetime import UTC, datetime

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("CONFIG_PATH", tempfile.mkdtemp(prefix="medialyze-config-"))
os.environ.setdefault("MEDIA_ROOT", tempfile.mkdtemp(prefix="medialyze-media-"))

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.models.entities import JobStatus, Library, LibraryType, ScanJob, ScanMode
from backend.app.services import runtime as runtime_module


def _session_factory():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def test_recover_orphaned_jobs_requeues_single_running_job_and_fails_duplicates(monkeypatch) -> None:
    session_factory = _session_factory()
    monkeypatch.setattr(runtime_module, "SessionLocal", session_factory)

    with session_factory() as db:
        first_library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        second_library = Library(
            name="Series",
            path="/tmp/series",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add_all([first_library, second_library])
        db.flush()
        db.add_all(
            [
                ScanJob(
                    library_id=first_library.id,
                    status=JobStatus.running,
                    job_type="incremental",
                    started_at=datetime.now(UTC),
                    files_total=120,
                    files_scanned=40,
                ),
                ScanJob(
                    library_id=first_library.id,
                    status=JobStatus.running,
                    job_type="incremental",
                    started_at=datetime.now(UTC),
                    files_total=10,
                    files_scanned=2,
                ),
                ScanJob(
                    library_id=second_library.id,
                    status=JobStatus.running,
                    job_type="full",
                    started_at=datetime.now(UTC),
                    files_total=12,
                    files_scanned=1,
                ),
            ]
        )
        db.commit()

    runtime = runtime_module.ScanRuntimeManager(Settings())
    runtime._recover_orphaned_jobs()

    with session_factory() as db:
        jobs = db.scalars(select(ScanJob).order_by(ScanJob.id.asc())).all()

    assert jobs[0].status == JobStatus.queued
    assert jobs[0].started_at is None
    assert jobs[0].files_total == 0
    assert jobs[0].files_scanned == 0
    assert jobs[1].status == JobStatus.failed
    assert jobs[1].finished_at is not None
    assert jobs[1].errors == 1
    assert jobs[2].status == JobStatus.queued


def test_request_scan_returns_existing_active_job_without_duplicate_submit(monkeypatch) -> None:
    session_factory = _session_factory()
    monkeypatch.setattr(runtime_module, "SessionLocal", session_factory)

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
        library_id = library.id

    submitted: list[tuple[int, int]] = []

    class ExecutorStub:
        def submit(self, fn, job_id: int, active_library_id: int) -> None:
            submitted.append((job_id, active_library_id))

    runtime = runtime_module.ScanRuntimeManager(Settings())
    runtime.executor = ExecutorStub()

    first_job_id, first_created = runtime.request_scan(library_id, "incremental")
    second_job_id, second_created = runtime.request_scan(library_id, "incremental")

    with session_factory() as db:
        jobs = db.scalars(select(ScanJob).where(ScanJob.library_id == library_id)).all()

    assert first_created is True
    assert second_created is False
    assert first_job_id == second_job_id
    assert len(jobs) == 1
    assert len(submitted) == 1
    assert submitted[0] == (first_job_id, library_id)


def test_request_scan_submits_multiple_libraries_in_parallel(monkeypatch) -> None:
    session_factory = _session_factory()
    monkeypatch.setattr(runtime_module, "SessionLocal", session_factory)

    with session_factory() as db:
        first_library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        second_library = Library(
            name="Series",
            path="/tmp/series",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add_all([first_library, second_library])
        db.commit()
        first_library_id = first_library.id
        second_library_id = second_library.id

    submitted: list[tuple[int, int]] = []

    class ExecutorStub:
        def submit(self, fn, job_id: int, active_library_id: int) -> None:
            submitted.append((job_id, active_library_id))

    runtime = runtime_module.ScanRuntimeManager(Settings())
    runtime.executor = ExecutorStub()

    first_job_id, first_created = runtime.request_scan(first_library_id, "incremental")
    second_job_id, second_created = runtime.request_scan(second_library_id, "incremental")

    assert first_created is True
    assert second_created is True
    assert len(submitted) == 2
    assert (first_job_id, first_library_id) in submitted
    assert (second_job_id, second_library_id) in submitted


def test_cancel_active_jobs_marks_running_and_queued_jobs_canceled(monkeypatch) -> None:
    session_factory = _session_factory()
    monkeypatch.setattr(runtime_module, "SessionLocal", session_factory)

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
        db.add_all(
            [
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.running,
                    job_type="incremental",
                    started_at=datetime.now(UTC),
                ),
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.queued,
                    job_type="full",
                ),
            ]
        )
        db.commit()

    runtime = runtime_module.ScanRuntimeManager(Settings())
    canceled_ids = runtime.cancel_active_jobs()

    with session_factory() as db:
        jobs = db.scalars(select(ScanJob).order_by(ScanJob.id.asc())).all()

    assert len(canceled_ids) == 2
    assert all(job.status == JobStatus.canceled for job in jobs)
    assert all(job.finished_at is not None for job in jobs)
