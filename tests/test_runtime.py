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
from watchdog.events import FileModifiedEvent

from backend.app.models.entities import JobStatus, Library, LibraryType, MediaFile, ScanJob, ScanMode, ScanStatus, ScanTriggerSource
from backend.app.services import runtime as runtime_module
from backend.app.schemas.app_settings import AppSettingsUpdate
from backend.app.services.app_settings import update_app_settings


def _session_factory():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def test_recover_orphaned_jobs_cancels_queued_and_running_jobs_without_resubmitting(monkeypatch) -> None:
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

    assert jobs[0].status == JobStatus.canceled
    assert jobs[0].finished_at is not None
    assert jobs[0].files_total == 120
    assert jobs[0].files_scanned == 40
    assert jobs[1].status == JobStatus.canceled
    assert jobs[1].finished_at is not None
    assert jobs[1].files_total == 10
    assert jobs[1].files_scanned == 2
    assert jobs[2].status == JobStatus.canceled
    assert jobs[2].finished_at is not None


def test_start_does_not_resume_preexisting_active_jobs(monkeypatch) -> None:
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
                ScanJob(library_id=library.id, status=JobStatus.queued, job_type="incremental"),
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.running,
                    job_type="full",
                    started_at=datetime.now(UTC),
                ),
            ]
        )
        db.commit()

    submitted: list[tuple[int, int]] = []

    class SchedulerStub:
        running = False

        def start(self) -> None:
            self.running = True

        def get_jobs(self):
            return []

        def get_job(self, job_id):
            return None

        def shutdown(self, wait=False) -> None:
            self.running = False

    class ExecutorStub:
        def submit(self, fn, job_id: int, library_id: int) -> None:
            submitted.append((job_id, library_id))

        def shutdown(self, wait=False, cancel_futures=True) -> None:
            return None

    runtime = runtime_module.ScanRuntimeManager(Settings())
    runtime.scheduler = SchedulerStub()
    runtime.executor = ExecutorStub()

    runtime.start()

    with session_factory() as db:
        jobs = db.scalars(select(ScanJob).order_by(ScanJob.id.asc())).all()

    assert submitted == []
    assert all(job.status == JobStatus.canceled for job in jobs)
    assert all(job.finished_at is not None for job in jobs)


def test_start_does_not_queue_quality_backfill_jobs(monkeypatch) -> None:
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
        db.add(
            MediaFile(
                library_id=library.id,
                relative_path="movie.mkv",
                filename="movie.mkv",
                extension="mkv",
                size_bytes=1024,
                mtime=1.0,
                scan_status=ScanStatus.ready,
                quality_score=8,
                quality_score_raw=0.0,
                raw_ffprobe_json={"format": {}},
            )
        )
        db.commit()

    class SchedulerStub:
        running = False

        def start(self) -> None:
            self.running = True

        def get_jobs(self):
            return []

        def get_job(self, job_id):
            return None

        def shutdown(self, wait=False) -> None:
            self.running = False

    class ExecutorStub:
        def submit(self, fn, job_id: int, library_id: int) -> None:
            return None

        def shutdown(self, wait=False, cancel_futures=True) -> None:
            return None

    runtime = runtime_module.ScanRuntimeManager(Settings())
    runtime.scheduler = SchedulerStub()
    runtime.executor = ExecutorStub()

    runtime.start()

    with session_factory() as db:
        jobs = db.scalars(select(ScanJob).order_by(ScanJob.id.asc())).all()

    assert jobs == []


def test_refresh_worker_settings_uses_persisted_parallel_scan_limit(monkeypatch, tmp_path) -> None:
    session_factory = _session_factory()
    monkeypatch.setattr(runtime_module, "SessionLocal", session_factory)

    created_worker_counts: list[int] = []
    shutdown_calls: list[tuple[int, bool, bool]] = []

    class ExecutorStub:
        def __init__(self, *, max_workers: int, thread_name_prefix: str) -> None:
            self.max_workers = max_workers
            created_worker_counts.append(max_workers)

        def submit(self, fn, job_id: int, library_id: int) -> None:
            return None

        def shutdown(self, wait=False, cancel_futures=False) -> None:
            shutdown_calls.append((self.max_workers, wait, cancel_futures))

    monkeypatch.setattr(runtime_module, "ThreadPoolExecutor", ExecutorStub)

    settings = Settings(config_path=tmp_path / "config", media_root=tmp_path / "media")
    runtime = runtime_module.ScanRuntimeManager(settings)

    with session_factory() as db:
        update_app_settings(
            db,
            AppSettingsUpdate(scan_performance={"parallel_scan_jobs": 6}),
            settings,
        )

    refreshed = runtime.refresh_worker_settings()

    assert refreshed is True
    assert runtime.executor_max_workers == 6
    assert created_worker_counts == [2, 6]
    assert shutdown_calls == [(2, False, False)]


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


def test_cancel_active_jobs_clears_pending_watch_timers_and_buffers(monkeypatch) -> None:
    runtime = runtime_module.ScanRuntimeManager(Settings())

    class TimerStub:
        def __init__(self) -> None:
            self.canceled = False

        def cancel(self) -> None:
            self.canceled = True

    timer = TimerStub()

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
        db.add(
            ScanJob(
                library_id=library.id,
                status=JobStatus.running,
                job_type="incremental",
                started_at=datetime.now(UTC),
            )
        )
        db.commit()

    runtime.watch_observers = {}
    runtime.debounce_timers[library.id] = timer  # type: ignore[assignment]
    runtime.watch_trigger_buffers[library.id] = {"event_count": 2}

    runtime.cancel_active_jobs()

    assert timer.canceled is True
    assert runtime.debounce_timers == {}
    assert runtime.watch_trigger_buffers == {}


def test_request_scan_merges_trigger_details_into_existing_active_job(monkeypatch) -> None:
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

    runtime = runtime_module.ScanRuntimeManager(Settings())
    runtime.executor = type(
        "ExecutorStub",
        (),
        {"submit": staticmethod(lambda fn, job_id, active_library_id: None)},
    )()

    first_job_id, _ = runtime.request_scan(
        library_id,
        "incremental",
        trigger_source=ScanTriggerSource.manual,
        trigger_details={"reason": "user_requested"},
    )
    second_job_id, created = runtime.request_scan(
        library_id,
        "incremental",
        trigger_source=ScanTriggerSource.watchdog,
        trigger_details={"event_count": 2},
    )

    with session_factory() as db:
        job = db.get(ScanJob, first_job_id)

    assert created is False
    assert second_job_id == first_job_id
    assert job is not None
    assert job.trigger_source == ScanTriggerSource.manual
    assert job.trigger_details["coalesced_trigger_count"] == 1
    assert job.trigger_details["coalesced_triggers"] == [
        {"trigger_source": "watchdog", "event_count": 2}
    ]


def test_handle_watch_event_aggregates_paths_and_requests_watchdog_scan(monkeypatch, tmp_path) -> None:
    session_factory = _session_factory()
    monkeypatch.setattr(runtime_module, "SessionLocal", session_factory)

    library_root = tmp_path / "movies"
    library_root.mkdir()

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(library_root),
            type=LibraryType.movies,
            scan_mode=ScanMode.watch,
            scan_config={"debounce_seconds": 9},
        )
        db.add(library)
        db.commit()
        library_id = library.id

    class TimerStub:
        def __init__(self, interval, callback):
            self.interval = interval
            self.callback = callback
            self.daemon = False

        def cancel(self) -> None:
            return None

        def start(self) -> None:
            return None

    recorded_requests: list[tuple[int, str, ScanTriggerSource, dict | None]] = []

    monkeypatch.setattr(runtime_module, "Timer", TimerStub)

    runtime = runtime_module.ScanRuntimeManager(Settings())

    def request_scan(library_id: int, scan_type: str = "incremental", *, trigger_source, trigger_details=None):
        recorded_requests.append((library_id, scan_type, trigger_source, trigger_details))
        return 1, True

    runtime.request_scan = request_scan  # type: ignore[method-assign]

    runtime.handle_watch_event(library_id, FileModifiedEvent(str(library_root / "movie.mkv")))
    runtime.handle_watch_event(library_id, FileModifiedEvent(str(library_root / "series" / "episode.mkv")))
    runtime._request_watch_scan(library_id)

    assert recorded_requests == [
        (
            library_id,
            "incremental",
            ScanTriggerSource.watchdog,
            {
                "debounce_seconds": 9,
                "event_count": 2,
                "event_types": ["modified"],
                "paths": ["movie.mkv", "series/episode.mkv"],
                "paths_truncated_count": 0,
            },
        )
    ]


def test_ensure_scheduled_job_uses_scheduled_trigger_details(monkeypatch) -> None:
    runtime = runtime_module.ScanRuntimeManager(Settings())

    captured: dict = {}

    class SchedulerStub:
        running = False

        def add_job(self, func, **kwargs):
            captured["func"] = func
            captured["kwargs"] = kwargs

        def get_job(self, job_id):
            return None

        def remove_job(self, job_id):
            return None

    runtime.scheduler = SchedulerStub()

    library = Library(
        id=12,
        name="Movies",
        path="/tmp/movies",
        type=LibraryType.movies,
        scan_mode=ScanMode.scheduled,
        scan_config={"interval_minutes": 30},
    )

    runtime._ensure_scheduled_job(library)

    assert captured["func"] == runtime.request_scan
    assert captured["kwargs"]["kwargs"] == {
        "library_id": 12,
        "scan_type": "incremental",
        "trigger_source": ScanTriggerSource.scheduled,
        "trigger_details": {"interval_minutes": 30},
    }


def test_sync_library_skips_watch_observer_for_desktop_network_paths(monkeypatch, tmp_path) -> None:
    session_factory = _session_factory()
    monkeypatch.setattr(runtime_module, "SessionLocal", session_factory)

    library_dir = tmp_path / "network-library"
    library_dir.mkdir()

    with session_factory() as db:
        library = Library(
            name="Network Movies",
            path=str(library_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.watch,
            scan_config={"debounce_seconds": 15},
        )
        db.add(library)
        db.commit()
        library_id = library.id

    runtime = runtime_module.ScanRuntimeManager(
        Settings(runtime_mode="desktop", config_path=tmp_path / "config")
    )
    monkeypatch.setattr(
        runtime_module,
        "is_watch_supported_for_library",
        lambda settings, path_value: False,
    )

    runtime.sync_library(library_id)

    assert runtime.watch_observers == {}
