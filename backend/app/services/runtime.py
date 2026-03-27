from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
from threading import Lock, Timer

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select
from watchdog.events import FileSystemEvent, FileSystemEventHandler, FileMovedEvent
from watchdog.observers import Observer

from backend.app.core.config import Settings
from backend.app.db.session import SessionLocal
from backend.app.models.entities import JobStatus, Library, ScanJob, ScanMode, ScanTriggerSource
from backend.app.services.path_access import is_watch_supported_for_library
from backend.app.utils.time import utc_now
from backend.app.services.scanner import (
    _empty_scan_summary,
    execute_scan_job,
    libraries_needing_quality_backfill,
    queue_duplicate_refresh_job,
    queue_quality_recompute_job,
    queue_scan_job,
)


class LibraryWatchHandler(FileSystemEventHandler):
    def __init__(self, runtime: "ScanRuntimeManager", library_id: int) -> None:
        self.runtime = runtime
        self.library_id = library_id

    def on_any_event(self, event: FileSystemEvent) -> None:
        self.runtime.handle_watch_event(self.library_id, event)


class ScanRuntimeManager:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.scheduler = BackgroundScheduler(timezone="UTC")
        self.executor = ThreadPoolExecutor(
            max_workers=max(1, settings.scan_runtime_worker_count),
            thread_name_prefix="medialyze-runtime",
        )
        self.lock = Lock()
        self.watch_observers: dict[int, tuple[str, Observer]] = {}
        self.debounce_timers: dict[int, Timer] = {}
        self.watch_trigger_buffers: dict[int, dict] = {}
        self.active_library_ids: set[int] = set()
        self.submitted_job_ids: set[int] = set()
        self.started = False

    def start(self) -> None:
        with self.lock:
            if self.started:
                return
            self.scheduler.start()
            self.started = True
        self._recover_orphaned_jobs()
        self._queue_quality_backfill_jobs()
        self.sync_all_libraries()
        self._resume_active_jobs()

    def stop(self) -> None:
        with self.lock:
            if not self.started:
                return
            self.started = False

        for timer in self.debounce_timers.values():
            timer.cancel()
        self.debounce_timers.clear()
        self.watch_trigger_buffers.clear()

        for _library_id, (_path, observer) in list(self.watch_observers.items()):
            observer.stop()
            observer.join(timeout=2)
        self.watch_observers.clear()

        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
        self.executor.shutdown(wait=False, cancel_futures=True)

    def sync_all_libraries(self) -> None:
        db = SessionLocal()
        try:
            libraries = db.query(Library).all()
            active_ids = {library.id for library in libraries}
            for library in libraries:
                self.sync_library(library.id, library=library)

            for library_id in list(self.watch_observers):
                if library_id not in active_ids:
                    self._remove_watch_observer(library_id)

            for job in list(self.scheduler.get_jobs()):
                if job.id.startswith("library-schedule-"):
                    library_id = int(job.id.split("-")[-1])
                    if library_id not in active_ids:
                        self.scheduler.remove_job(job.id)
        finally:
            db.close()

    def sync_library(self, library_id: int, library: Library | None = None) -> None:
        db = SessionLocal()
        try:
            active_library = library or db.get(Library, library_id)
            if active_library is None:
                self._remove_scheduled_job(library_id)
                self._remove_watch_observer(library_id)
                return

            if active_library.scan_mode == ScanMode.scheduled:
                self._ensure_scheduled_job(active_library)
            else:
                self._remove_scheduled_job(library_id)

            if active_library.scan_mode == ScanMode.watch:
                self._ensure_watch_observer(active_library)
            else:
                self._remove_watch_observer(library_id)
        finally:
            db.close()

    def request_scan(
        self,
        library_id: int,
        scan_type: str = "incremental",
        *,
        trigger_source: ScanTriggerSource = ScanTriggerSource.manual,
        trigger_details: dict | None = None,
    ) -> tuple[int, bool]:
        created = False
        should_submit = False
        job_id: int | None = None

        with self.lock:
            db = SessionLocal()
            try:
                job, created = queue_scan_job(
                    db,
                    library_id,
                    scan_type,
                    trigger_source=trigger_source,
                    trigger_details=trigger_details,
                )
                job_id = job.id
                if created and library_id not in self.active_library_ids and job.id not in self.submitted_job_ids:
                    self.active_library_ids.add(library_id)
                    self.submitted_job_ids.add(job.id)
                    should_submit = True
            finally:
                db.close()

        if should_submit and job_id is not None:
            self.executor.submit(self._run_job, job_id, library_id)

        if job_id is None:
            raise ValueError(f"Failed to request scan for library {library_id}")
        return job_id, created

    def request_quality_recompute(self, library_id: int) -> tuple[int, bool]:
        created = False
        should_submit = False
        job_id: int | None = None

        with self.lock:
            db = SessionLocal()
            try:
                job, created = queue_quality_recompute_job(db, library_id)
                job_id = job.id
                if created and library_id not in self.active_library_ids and job.id not in self.submitted_job_ids:
                    self.active_library_ids.add(library_id)
                    self.submitted_job_ids.add(job.id)
                    should_submit = True
            finally:
                db.close()

        if should_submit and job_id is not None:
            self.executor.submit(self._run_job, job_id, library_id)

        if job_id is None:
            raise ValueError(f"Failed to request quality recompute for library {library_id}")
        return job_id, created

    def request_duplicate_refresh(self, library_id: int) -> tuple[int, bool]:
        created = False
        should_submit = False
        job_id: int | None = None

        with self.lock:
            db = SessionLocal()
            try:
                job, created = queue_duplicate_refresh_job(db, library_id)
                job_id = job.id
                if created and library_id not in self.active_library_ids and job.id not in self.submitted_job_ids:
                    self.active_library_ids.add(library_id)
                    self.submitted_job_ids.add(job.id)
                    should_submit = True
            finally:
                db.close()

        if should_submit and job_id is not None:
            self.executor.submit(self._run_job, job_id, library_id)

        if job_id is None:
            raise ValueError(f"Failed to request duplicate refresh for library {library_id}")
        return job_id, created

    def submit_scan_job(self, job_id: int) -> None:
        db = SessionLocal()
        try:
            job = db.get(ScanJob, job_id)
            if job is None or job.status not in {JobStatus.queued, JobStatus.running}:
                return
            library_id = job.library_id
        finally:
            db.close()

        with self.lock:
            if library_id in self.active_library_ids or job_id in self.submitted_job_ids:
                return
            self.active_library_ids.add(library_id)
            self.submitted_job_ids.add(job_id)

        self.executor.submit(self._run_job, job_id, library_id)

    def _run_job(self, job_id: int, library_id: int) -> None:
        try:
            execute_scan_job(job_id, self.settings)
        finally:
            with self.lock:
                self.submitted_job_ids.discard(job_id)
                self.active_library_ids.discard(library_id)
            self._submit_next_active_job(library_id)

    def cancel_active_jobs(self) -> list[int]:
        db = SessionLocal()
        try:
            jobs = db.scalars(
                select(ScanJob)
                .where(ScanJob.status.in_([JobStatus.queued, JobStatus.running]))
                .order_by(ScanJob.id.asc())
            ).all()

            canceled_ids: list[int] = []
            for job in jobs:
                job.status = JobStatus.canceled
                job.finished_at = utc_now()
                canceled_ids.append(job.id)

            if canceled_ids:
                db.commit()
        finally:
            db.close()

        return canceled_ids

    def cancel_library_jobs(self, library_id: int) -> list[int]:
        db = SessionLocal()
        try:
            jobs = db.scalars(
                select(ScanJob)
                .where(
                    ScanJob.library_id == library_id,
                    ScanJob.status.in_([JobStatus.queued, JobStatus.running]),
                )
                .order_by(ScanJob.id.asc())
            ).all()

            canceled_ids: list[int] = []
            for job in jobs:
                job.status = JobStatus.canceled
                job.finished_at = utc_now()
                canceled_ids.append(job.id)

            if canceled_ids:
                db.commit()
        finally:
            db.close()

        return canceled_ids

    def handle_watch_event(self, library_id: int, event: FileSystemEvent) -> None:
        if event.is_directory:
            return

        paths = [event.src_path]
        if isinstance(event, FileMovedEvent):
            paths.append(event.dest_path)

        watched_suffixes = {suffix.lower() for suffix in (*self.settings.allowed_media_extensions, *self.settings.subtitle_extensions)}
        if not any(path.lower().endswith(tuple(watched_suffixes)) for path in paths):
            return

        db = SessionLocal()
        try:
            library = db.get(Library, library_id)
            debounce_seconds = int((library.scan_config or {}).get("debounce_seconds", 15)) if library else 15
            library_path = str(library.path) if library else ""
        finally:
            db.close()

        event_paths = [
            self._relative_watch_path(path, library_path)
            for path in paths
        ]
        self._record_watch_trigger(library_id, event.event_type, [path for path in event_paths if path], debounce_seconds)

        existing = self.debounce_timers.pop(library_id, None)
        if existing:
            existing.cancel()

        timer = Timer(debounce_seconds, lambda: self._request_watch_scan(library_id))
        timer.daemon = True
        self.debounce_timers[library_id] = timer
        timer.start()

    def _ensure_scheduled_job(self, library: Library) -> None:
        interval_minutes = int((library.scan_config or {}).get("interval_minutes", 60))
        self.scheduler.add_job(
            self.request_scan,
            trigger="interval",
            minutes=interval_minutes,
            kwargs={
                "library_id": library.id,
                "scan_type": "incremental",
                "trigger_source": ScanTriggerSource.scheduled,
                "trigger_details": {"interval_minutes": interval_minutes},
            },
            id=self._scheduled_job_id(library.id),
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

    def _ensure_watch_observer(self, library: Library) -> None:
        library_path = str(library.path)
        if not library.path or not library.path.strip():
            return
        if not Path(library_path).exists():
            return
        if not is_watch_supported_for_library(self.settings, library_path):
            self._remove_watch_observer(library.id)
            return

        current = self.watch_observers.get(library.id)
        if current and current[0] == library_path:
            return

        self._remove_watch_observer(library.id)
        observer = Observer()
        observer.schedule(LibraryWatchHandler(self, library.id), library_path, recursive=True)
        observer.daemon = True
        observer.start()
        self.watch_observers[library.id] = (library_path, observer)

    def _resume_active_jobs(self) -> None:
        db = SessionLocal()
        try:
            active_jobs = db.scalars(
                select(ScanJob)
                .where(ScanJob.status.in_([JobStatus.queued, JobStatus.running]))
                .order_by(ScanJob.id.asc())
            ).all()

            chosen_job_ids: list[int] = []
            seen_libraries: set[int] = set()

            for job in active_jobs:
                if job.library_id in seen_libraries:
                    continue
                seen_libraries.add(job.library_id)
                chosen_job_ids.append(job.id)

            db.commit()
        finally:
            db.close()

        for job_id in chosen_job_ids:
            self.submit_scan_job(job_id)

    def _recover_orphaned_jobs(self) -> None:
        db = SessionLocal()
        try:
            active_jobs = db.scalars(
                select(ScanJob)
                .where(ScanJob.status.in_([JobStatus.queued, JobStatus.running]))
                .order_by(ScanJob.id.asc())
            ).all()

            if not active_jobs:
                return

            for job in active_jobs:
                if job.job_type in {"quality_recompute", "duplicate_refresh"}:
                    job.status = JobStatus.canceled
                    job.finished_at = utc_now()
                    continue
                if job.status == JobStatus.running:
                    job.status = JobStatus.queued
                    job.started_at = None
                    job.finished_at = None
                    job.files_total = 0
                    job.files_scanned = 0
                    job.errors = 0
                    job.scan_summary = _empty_scan_summary()

            db.commit()
        finally:
            db.close()

    def _submit_next_active_job(self, library_id: int) -> None:
        db = SessionLocal()
        try:
            next_job = db.scalar(
                select(ScanJob)
                .where(
                    ScanJob.library_id == library_id,
                    ScanJob.status.in_([JobStatus.queued, JobStatus.running]),
                )
                .order_by(ScanJob.id.asc())
            )
        finally:
            db.close()

        if next_job is not None:
            self.submit_scan_job(next_job.id)

    def _queue_quality_backfill_jobs(self) -> None:
        db = SessionLocal()
        try:
            for library_id in libraries_needing_quality_backfill(db):
                queue_quality_recompute_job(db, library_id)
        finally:
            db.close()

    def _remove_scheduled_job(self, library_id: int) -> None:
        job_id = self._scheduled_job_id(library_id)
        if self.scheduler.get_job(job_id):
            self.scheduler.remove_job(job_id)

    def _remove_watch_observer(self, library_id: int) -> None:
        existing = self.watch_observers.pop(library_id, None)
        if not existing:
            return
        self.watch_trigger_buffers.pop(library_id, None)
        _path, observer = existing
        observer.stop()
        observer.join(timeout=2)

    @staticmethod
    def _scheduled_job_id(library_id: int) -> str:
        return f"library-schedule-{library_id}"

    def _request_watch_scan(self, library_id: int) -> None:
        with self.lock:
            details = self.watch_trigger_buffers.pop(
                library_id,
                {"debounce_seconds": 15, "event_count": 0, "event_types": [], "paths": []},
            )
            self.debounce_timers.pop(library_id, None)
        self.request_scan(
            library_id,
            "incremental",
            trigger_source=ScanTriggerSource.watchdog,
            trigger_details=details,
        )

    def _record_watch_trigger(
        self,
        library_id: int,
        event_type: str,
        relative_paths: list[str],
        debounce_seconds: int,
    ) -> None:
        with self.lock:
            buffer = self.watch_trigger_buffers.setdefault(
                library_id,
                {
                    "debounce_seconds": debounce_seconds,
                    "event_count": 0,
                    "event_types": [],
                    "paths": [],
                    "paths_truncated_count": 0,
                },
            )
            buffer["debounce_seconds"] = debounce_seconds
            buffer["event_count"] = int(buffer.get("event_count", 0)) + 1
            event_types = list(buffer.get("event_types") or [])
            if event_type not in event_types:
                event_types.append(event_type)
            buffer["event_types"] = event_types

            current_paths = list(buffer.get("paths") or [])
            known_paths = set(current_paths)
            truncated_count = int(buffer.get("paths_truncated_count") or 0)
            for path in relative_paths:
                if path in known_paths:
                    continue
                known_paths.add(path)
                if len(current_paths) < 20:
                    current_paths.append(path)
                else:
                    truncated_count += 1
            buffer["paths"] = current_paths
            buffer["paths_truncated_count"] = truncated_count

    @staticmethod
    def _relative_watch_path(path: str, library_path: str) -> str | None:
        if not library_path:
            return None
        try:
            relative_path = os.path.relpath(path, library_path)
        except ValueError:
            return None
        if relative_path.startswith(".."):
            return None
        return Path(relative_path).as_posix()
