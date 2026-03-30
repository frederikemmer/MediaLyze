from datetime import UTC, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.db.base import Base
from backend.app.models.entities import JobStatus, Library, LibraryType, ScanJob, ScanMode, ScanTriggerSource
from backend.app.services.scan_jobs import get_scan_job_detail, list_active_scan_jobs, list_recent_scan_jobs, serialize_scan_job


def test_serialize_scan_job_for_discovery_phase() -> None:
    job = ScanJob(
        id=1,
        library_id=2,
        status=JobStatus.running,
        job_type="incremental",
        files_total=0,
        files_scanned=0,
        errors=0,
        started_at=datetime.now(UTC),
        finished_at=None,
    )

    payload = serialize_scan_job(job)

    assert payload.phase_label == "Discovering files"
    assert payload.progress_percent == 0.0


def test_serialize_scan_job_for_analysis_phase() -> None:
    job = ScanJob(
        id=1,
        library_id=2,
        status=JobStatus.running,
        job_type="incremental",
        files_total=20,
        files_scanned=5,
        errors=0,
        started_at=datetime.now(UTC),
        finished_at=None,
    )

    payload = serialize_scan_job(job)

    assert payload.phase_label == "Analyzing media"
    assert payload.progress_percent == 25.0


def test_list_active_scan_jobs_deduplicates_per_library() -> None:
    engine = create_engine("sqlite:///:memory:")
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
        db.add_all(
            [
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.running,
                    job_type="incremental",
                    files_total=100,
                    files_scanned=10,
                    errors=0,
                    started_at=datetime.now(UTC),
                ),
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.queued,
                    job_type="full",
                    files_total=0,
                    files_scanned=0,
                    errors=0,
                ),
            ]
        )
        db.commit()

        jobs = list_active_scan_jobs(db)

    assert len(jobs) == 1
    assert jobs[0].library_name == "Movies"


def test_list_active_scan_jobs_prefers_running_scan_over_queued_quality_recompute() -> None:
    engine = create_engine("sqlite:///:memory:")
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
        db.add_all(
            [
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.queued,
                    job_type="quality_recompute",
                ),
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.running,
                    job_type="incremental",
                    files_total=100,
                    files_scanned=10,
                    errors=0,
                    started_at=datetime.now(UTC),
                ),
            ]
        )
        db.commit()

        jobs = list_active_scan_jobs(db)

    assert len(jobs) == 1
    assert jobs[0].job_type == "incremental"
    assert jobs[0].phase_label == "Analyzing media"


def test_list_recent_scan_jobs_filters_quality_recompute_and_serializes_summary() -> None:
    engine = create_engine("sqlite:///:memory:")
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
        db.add_all(
            [
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.completed,
                    job_type="incremental",
                    trigger_source=ScanTriggerSource.watchdog,
                    trigger_details={"event_count": 2},
                    started_at=datetime(2026, 3, 16, 10, 0, tzinfo=UTC),
                    finished_at=datetime(2026, 3, 16, 10, 2, tzinfo=UTC),
                    scan_summary={
                        "discovery": {"discovered_files": 12, "ignored_total": 3},
                        "changes": {
                            "new_files": {"count": 2, "paths": [], "truncated_count": 0},
                            "modified_files": {"count": 1, "paths": [], "truncated_count": 0},
                            "deleted_files": {"count": 1, "paths": [], "truncated_count": 0},
                        },
                        "analysis": {"analysis_failed": 0},
                    },
                ),
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.completed,
                    job_type="quality_recompute",
                    started_at=datetime.now(UTC),
                    finished_at=datetime.now(UTC),
                ),
            ]
        )
        db.commit()

        page = list_recent_scan_jobs(db)

    assert len(page.items) == 1
    assert page.has_more is False
    assert page.items[0].trigger_source == ScanTriggerSource.watchdog
    assert page.items[0].duration_seconds == 120.0
    assert page.items[0].discovered_files == 12
    assert page.items[0].new_files == 2
    assert page.items[0].modified_files == 1
    assert page.items[0].deleted_files == 1


def test_list_recent_scan_jobs_supports_since_hours_and_cursor_pagination() -> None:
    engine = create_engine("sqlite:///:memory:")
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
        db.add_all(
            [
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.completed,
                    job_type="incremental",
                    finished_at=datetime.now(UTC),
                ),
                ScanJob(
                    library_id=library.id,
                    status=JobStatus.completed,
                    job_type="incremental",
                    finished_at=datetime.now(UTC).replace(year=2025),
                ),
            ]
        )
        db.commit()

        recent_page = list_recent_scan_jobs(db, since_hours=24, limit=20)
        older_page = list_recent_scan_jobs(
            db,
            limit=20,
            before_finished_at=recent_page.items[-1].finished_at,
            before_id=recent_page.items[-1].id,
        )

    assert len(recent_page.items) == 1
    assert older_page.items[0].finished_at.year == 2025


def test_get_scan_job_detail_returns_trigger_and_summary() -> None:
    engine = create_engine("sqlite:///:memory:")
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
        scan_job = ScanJob(
            library_id=library.id,
            status=JobStatus.failed,
            job_type="incremental",
            trigger_source=ScanTriggerSource.manual,
            trigger_details={"reason": "user_requested"},
            started_at=datetime.now(UTC),
            finished_at=datetime.now(UTC),
            scan_summary={
                "ignore_patterns": ["sample.*"],
                "analysis": {
                    "analysis_failed": 1,
                    "failed_files": [{"path": "broken.mkv", "reason": "ffprobe exploded", "detail": "traceback"}],
                },
            },
        )
        db.add(scan_job)
        db.commit()

        payload = get_scan_job_detail(db, scan_job.id)

    assert payload is not None
    assert payload.trigger_details == {"reason": "user_requested"}
    assert payload.scan_summary.ignore_patterns == ["sample.*"]
    assert payload.scan_summary.analysis.failed_files[0].path == "broken.mkv"
    assert payload.scan_summary.analysis.failed_files[0].detail == "traceback"
