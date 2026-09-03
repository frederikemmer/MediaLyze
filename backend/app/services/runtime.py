from __future__ import annotations

import logging
import os
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from threading import BoundedSemaphore, Lock, Timer
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from tzlocal import get_localzone
from watchdog.events import FileMovedEvent, FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from backend.app.core.config import Settings
from backend.app.db.session import SessionLocal
from backend.app.models.entities import (
    ConnectorConnection,
    ConnectorSyncJob,
    JellyfinConnection,
    JellyfinSyncTriggerSource,
    JobStatus,
    Library,
    MediaFile,
    ScanJob,
    ScanMode,
    ScanTriggerSource,
    TranscodeJob,
)
from backend.app.schemas.transcoding import TranscodePlan, TranscodeValidationRead
from backend.app.schemas.history import (
    HistoryReconstructionJobStatus,
    HistoryReconstructionPhase,
    HistoryReconstructionStatusRead,
)
from backend.app.services.app_settings import get_app_settings
from backend.app.services.connector_credentials import read_connector_secret
from backend.app.services.connector_matching import (
    compare_legacy_jellyfin_matches,
)
from backend.app.services.connector_security import redact_connector_error
from backend.app.services.connector_service import is_legacy_default_connection
from backend.app.services.connector_sync import (
    claim_connector_sync_job,
    create_or_get_connector_sync_job,
    mirror_legacy_jellyfin_snapshot,
    recover_orphaned_connector_sync_jobs,
    request_connector_sync_cancellation,
    run_connector_recompute,
    run_connector_sync,
)
from backend.app.services.history_reconstruction import reconstruct_history_from_media_files
from backend.app.services.history_retention import (
    HistoryRetentionResult,
    apply_history_retention,
    run_pending_history_compaction,
)
from backend.app.services.history_storage import get_history_storage
from backend.app.services.jellyfin_credentials import read_jellyfin_api_key
from backend.app.services.jellyfin_jobs import (
    cancel_queued_jellyfin_sync_job,
    create_or_get_jellyfin_sync_job,
    finish_jellyfin_sync_job,
    get_active_jellyfin_sync_job,
    mark_jellyfin_sync_cancellation_requested,
    mark_jellyfin_sync_job_running,
    recover_orphaned_jellyfin_sync_jobs,
    update_jellyfin_sync_job_progress,
)
from backend.app.services.jellyfin_matching import (
    recompute_jellyfin_matches,
    refresh_jellyfin_mapping_state,
)
from backend.app.services.jellyfin_progress import (
    jellyfin_cancellation_requested,
    request_jellyfin_cancellation,
    reset_jellyfin_cancellation,
)
from backend.app.services.jellyfin_sync import JellyfinSyncCancelled, run_jellyfin_sync
from backend.app.services.library_history_service import get_dashboard_history, get_library_history
from backend.app.services.library_service import get_library_summary
from backend.app.services.path_access import is_watch_supported_for_library
from backend.app.services.scanner import (
    execute_scan_job,
    queue_quality_recompute_job,
    queue_scan_job,
)
from backend.app.services.stats_cache import stats_cache
from backend.app.services.telemetry import (
    send_current_telemetry_snapshot,
    send_initial_telemetry_snapshot,
    send_update_telemetry_snapshot,
)
from backend.app.services.transcoding import (
    cancel_transcode_job,
    execute_transcode_job,
    queue_transcode_job,
    reconcile_transcode_variants,
    recover_orphaned_transcode_jobs,
    transcode_capacity,
)
from backend.app.services.update_status import check_for_updates
from backend.app.utils.time import utc_now

logger = logging.getLogger(__name__)


class ScanCancelPersistenceError(RuntimeError):
    def __init__(self, canceled_job_ids: list[int]) -> None:
        self.canceled_job_ids = canceled_job_ids
        super().__init__(
            "Scan cancellation was requested, but SQLite could not persist the canceled status because the database is busy."
        )


def _is_sqlite_database_locked(exc: OperationalError) -> bool:
    return "database is locked" in str(exc).lower()


def resolve_scheduler_timezone():
    configured_timezone = os.environ.get("TZ")
    if configured_timezone:
        try:
            return ZoneInfo(configured_timezone)
        except ZoneInfoNotFoundError:
            logger.warning("Ignoring invalid TZ value for scheduler timezone: %s", configured_timezone)

    try:
        return get_localzone()
    except Exception:
        logger.exception("Failed to resolve local scheduler timezone; falling back to UTC")
        return ZoneInfo("UTC")


class LibraryWatchHandler(FileSystemEventHandler):
    def __init__(self, runtime: "ScanRuntimeManager", library_id: int) -> None:
        self.runtime = runtime
        self.library_id = library_id

    def on_any_event(self, event: FileSystemEvent) -> None:
        self.runtime.handle_watch_event(self.library_id, event)


class ScanRuntimeManager:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.scheduler = BackgroundScheduler(timezone=resolve_scheduler_timezone())
        self.executor_max_workers = max(1, settings.scan_runtime_worker_count)
        self.executor = self._build_executor(self.executor_max_workers)
        self.connector_executor_max_workers = self.executor_max_workers
        self.connector_executor = self._build_connector_executor(
            self.connector_executor_max_workers
        )
        # Transcoding is deliberately isolated from scan/maintenance workers.
        # The executor is created lazily so installations that never transcode
        # do not pay for another worker pool.
        self.transcode_executor: ThreadPoolExecutor | None = None
        self.transcode_executor_max_workers = 0
        self.transcode_cpu_parallel_jobs = 1
        self.transcode_gpu_parallel_jobs_per_device = 1
        self.transcode_cpu_slots = BoundedSemaphore(1)
        self.transcode_gpu_slots: dict[str, BoundedSemaphore] = {}
        self.transcode_capacity_signature: tuple[object, ...] | None = None
        self.connector_futures: dict[int, Future] = {}
        self.maintenance_executor = self._build_maintenance_executor()
        self.lock = Lock()
        self.watch_observers: dict[int, tuple[tuple[str, ...], Observer]] = {}
        self.debounce_timers: dict[int, Timer] = {}
        self.watch_trigger_buffers: dict[int, dict] = {}
        self.active_library_ids: set[int] = set()
        self.submitted_job_ids: set[int] = set()
        self.cancel_requested_job_ids: set[int] = set()
        self.submitted_transcode_job_ids: set[int] = set()
        self.cancel_requested_transcode_job_ids: set[int] = set()
        self.history_compaction_pending = False
        self.history_storage_refresh_submitted = False
        self.stats_warmup_timer: Timer | None = None
        self.telemetry_send_timer: Timer | None = None
        self.history_reconstruction_status = HistoryReconstructionStatusRead()
        self.jellyfin_match_recompute_submitted = False
        self.jellyfin_match_recompute_rerun = False
        self.jellyfin_match_recompute_status = "idle"
        self.jellyfin_match_recompute_last_error: str | None = None
        self.started = False

    def start(self) -> None:
        self.refresh_worker_settings()
        with self.lock:
            if self.started:
                return
            self.scheduler.start()
            self.started = True
        self._ensure_history_maintenance_job()
        self._ensure_telemetry_job()
        self._ensure_update_check_jobs()
        self._recover_orphaned_jellyfin_sync_jobs()
        self._recover_orphaned_connector_sync_jobs()
        self.refresh_jellyfin_schedule()
        self.refresh_connector_schedules()
        self._recover_orphaned_jobs()
        self._recover_orphaned_transcode_jobs()
        self.request_update_check()
        self.sync_all_libraries()
        self.run_history_retention()
        self.request_initial_telemetry_send()
        self.request_telemetry_send()
        self.request_update_telemetry_send()
        self.request_stats_warmup()

    def stop(self) -> None:
        with self.lock:
            if not self.started:
                return
            self.started = False

        for timer in self.debounce_timers.values():
            timer.cancel()
        self.debounce_timers.clear()
        if self.stats_warmup_timer is not None:
            self.stats_warmup_timer.cancel()
            self.stats_warmup_timer = None
        if self.telemetry_send_timer is not None:
            self.telemetry_send_timer.cancel()
            self.telemetry_send_timer = None
        self.watch_trigger_buffers.clear()

        for _library_id, (_paths, observer) in list(self.watch_observers.items()):
            observer.stop()
            observer.join(timeout=2)
        self.watch_observers.clear()

        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
        self._shutdown_executor(self.executor, cancel_futures=True)
        self._shutdown_executor(self.connector_executor, cancel_futures=True)
        if self.transcode_executor is not None:
            self._shutdown_executor(self.transcode_executor, cancel_futures=True)
            self.transcode_executor = None
        self._shutdown_executor(self.maintenance_executor, cancel_futures=True)

    def refresh_worker_settings(self) -> bool:
        db = SessionLocal()
        try:
            persisted = get_app_settings(db, self.settings)
            next_workers = max(1, persisted.scan_performance.parallel_scan_jobs)
            capacity = transcode_capacity(self.settings, persisted)
            next_transcode_workers = max(
                1,
                int(capacity["cpu_parallel_jobs"])
                + (
                    len(persisted.transcoding.selected_devices)
                    if isinstance(persisted.transcoding.selected_devices, list)
                    else 1
                )
                * persisted.transcoding.gpu_parallel_jobs_per_device
                if persisted.transcoding.execution_mode != "cpu_only"
                else int(capacity["cpu_parallel_jobs"]),
            )
            selected_devices = (
                tuple(persisted.transcoding.selected_devices)
                if isinstance(persisted.transcoding.selected_devices, list)
                else ("auto",)
            )
            next_transcode_capacity_signature = (
                int(capacity["cpu_threads"]),
                int(capacity["cpu_threads_per_job"]),
                int(capacity["cpu_parallel_jobs"]),
                persisted.transcoding.gpu_parallel_jobs_per_device,
                persisted.transcoding.execution_mode,
                selected_devices,
            )
        finally:
            db.close()

        previous_executor: ThreadPoolExecutor | None = None
        previous_transcode_executor: ThreadPoolExecutor | None = None
        with self.lock:
            scan_workers_changed = (
                next_workers != self.executor_max_workers
                or next_workers != self.connector_executor_max_workers
            )
            transcode_workers_changed = next_transcode_workers != self.transcode_executor_max_workers
            transcode_capacity_changed = next_transcode_capacity_signature != self.transcode_capacity_signature
            if not scan_workers_changed and not transcode_workers_changed and not transcode_capacity_changed:
                return False
            if scan_workers_changed:
                previous_executor = self.executor
                self.executor = self._build_executor(next_workers)
                self.executor_max_workers = next_workers
                previous_connector_executor = self.connector_executor
                self.connector_executor = self._build_connector_executor(next_workers)
                self.connector_executor_max_workers = next_workers
            else:
                previous_connector_executor = None
            self.transcode_executor_max_workers = next_transcode_workers
            self.transcode_cpu_parallel_jobs = int(capacity["cpu_parallel_jobs"])
            self.transcode_gpu_parallel_jobs_per_device = persisted.transcoding.gpu_parallel_jobs_per_device
            self.transcode_capacity_signature = next_transcode_capacity_signature
            self.transcode_cpu_slots = BoundedSemaphore(self.transcode_cpu_parallel_jobs)
            selected_devices = (
                list(persisted.transcoding.selected_devices)
                if isinstance(persisted.transcoding.selected_devices, list)
                else ["cuda0"]
            )
            self.transcode_gpu_slots = {
                device_id: BoundedSemaphore(self.transcode_gpu_parallel_jobs_per_device)
                for device_id in selected_devices
            }
            if self.transcode_executor is not None and transcode_workers_changed:
                previous_transcode_executor = self.transcode_executor
                self.transcode_executor = self._build_transcode_executor(next_transcode_workers)

        if previous_executor is not None:
            self._shutdown_executor(previous_executor, cancel_futures=False)
        if previous_connector_executor is not None:
            self._shutdown_executor(previous_connector_executor, cancel_futures=False)
        if previous_transcode_executor is not None:
            self._shutdown_executor(previous_transcode_executor, cancel_futures=False)
        return True

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

            if active_library.scan_mode in (ScanMode.scheduled, ScanMode.scheduled_daily):
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
            self._cancel_stats_warmup_locked()
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
            self._cancel_stats_warmup_locked()
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

    def request_transcode(self, file_id: int, plan: TranscodePlan) -> tuple[TranscodeJob, TranscodeValidationRead]:
        db = SessionLocal()
        try:
            media_file = db.get(MediaFile, file_id)
            if media_file is None:
                raise ValueError("Media file not found")
            job, validation = queue_transcode_job(db, self.settings, media_file, plan)
        finally:
            db.close()
        with self.lock:
            self.submitted_transcode_job_ids.add(job.id)
            if self.transcode_executor is None:
                self.transcode_executor = self._build_transcode_executor(
                    max(1, self.transcode_executor_max_workers)
                )
            transcode_executor = self.transcode_executor
        try:
            transcode_executor.submit(self._run_transcode_job, job.id)
        except Exception:
            with self.lock:
                self.submitted_transcode_job_ids.discard(job.id)
            failed_db = SessionLocal()
            try:
                failed_job = failed_db.get(TranscodeJob, job.id)
                if failed_job is not None:
                    failed_job.status = JobStatus.failed
                    failed_job.error = "Unable to submit transcoding job to the runtime executor"
                    failed_job.finished_at = utc_now()
                    failed_db.commit()
            finally:
                failed_db.close()
            raise
        return job, validation

    def _run_transcode_job(self, job_id: int) -> None:
        library_id = 0
        completed = False
        slot = None
        try:
            db = SessionLocal()
            try:
                queued_job = db.get(TranscodeJob, job_id)
                if queued_job is None:
                    return
                library_id = queued_job.library_id
                plan_payload = queued_job.plan if isinstance(queued_job.plan, dict) else {}
                has_hardware_video = any(
                    str(item.get("encoder") or item.get("codec") or "").lower().endswith(
                        ("_nvenc", "_qsv", "_vaapi", "_amf", "_videotoolbox")
                    )
                    for item in plan_payload.get("video_streams", [])
                    if isinstance(item, dict) and item.get("action") == "encode"
                )
                if has_hardware_video:
                    device_id = queued_job.device_id or "cuda0"
                    slot = self.transcode_gpu_slots.get(device_id)
                    if slot is None and self.transcode_gpu_slots:
                        slot = next(iter(self.transcode_gpu_slots.values()))
                else:
                    slot = self.transcode_cpu_slots
            finally:
                db.close()
            if slot is not None:
                slot.acquire()
            while True:
                library_id = execute_transcode_job(
                    job_id,
                    is_cancel_requested=self.is_transcode_cancel_requested,
                )
                db = SessionLocal()
                try:
                    job = db.get(TranscodeJob, job_id)
                    if job is None:
                        break
                    if job.status == JobStatus.failed and job.attempt <= job.retry_count:
                        job.status = JobStatus.queued
                        job.error = f"Retrying after failed attempt {job.attempt}"
                        job.finished_at = None
                        db.commit()
                        continue
                    completed = job.status == JobStatus.completed
                    if job.status == JobStatus.failed and job.on_error == "stop_queue":
                        db.query(TranscodeJob).filter(
                            TranscodeJob.library_id == job.library_id,
                            TranscodeJob.status == JobStatus.queued,
                        ).update(
                            {
                                TranscodeJob.status: JobStatus.canceled,
                                TranscodeJob.error: "Canceled because the transcode queue is configured to stop on error",
                                TranscodeJob.finished_at: utc_now(),
                            },
                            synchronize_session=False,
                        )
                        db.commit()
                    break
                finally:
                    db.close()
            if completed and library_id:
                self.request_scan(
                    library_id,
                    "incremental",
                    trigger_source=ScanTriggerSource.transcode,
                    trigger_details={"reason": "transcode_completed", "transcode_job_id": job_id},
                )
        finally:
            if slot is not None:
                slot.release()
            with self.lock:
                self.submitted_transcode_job_ids.discard(job_id)
                self.cancel_requested_transcode_job_ids.discard(job_id)
            self.request_history_storage_refresh()

    def is_transcode_cancel_requested(self, job_id: int) -> bool:
        with self.lock:
            return job_id in self.cancel_requested_transcode_job_ids

    def cancel_transcode(self, job_id: int) -> TranscodeJob:
        db = SessionLocal()
        try:
            job = db.get(TranscodeJob, job_id)
            if job is None:
                raise ValueError("Transcoding job not found")
            if job.status == JobStatus.running:
                with self.lock:
                    self.cancel_requested_transcode_job_ids.add(job_id)
                return job
            return cancel_transcode_job(db, job_id)
        finally:
            db.close()

    def get_history_reconstruction_status(self) -> HistoryReconstructionStatusRead:
        with self.lock:
            return self.history_reconstruction_status.model_copy(deep=True)

    def request_history_reconstruction(self) -> HistoryReconstructionStatusRead:
        should_submit = False
        with self.lock:
            current = self.history_reconstruction_status
            if current.status in {
                HistoryReconstructionJobStatus.queued,
                HistoryReconstructionJobStatus.running,
            }:
                return current.model_copy(deep=True)
            self.history_reconstruction_status = HistoryReconstructionStatusRead(
                status=HistoryReconstructionJobStatus.queued,
                phase=HistoryReconstructionPhase.loading_libraries,
            )
            should_submit = True

        if should_submit:
            self.executor.submit(self._run_history_reconstruction)
        return self.get_history_reconstruction_status()

    def request_telemetry_send(self, *, force: bool = False) -> None:
        with self.lock:
            if not self.started:
                return
        self.maintenance_executor.submit(self._run_telemetry_send, force)

    def request_update_check(self) -> None:
        if not self.started:
            return
        self.maintenance_executor.submit(self._run_update_check)

    def request_jellyfin_sync(
        self,
        trigger_source: JellyfinSyncTriggerSource = JellyfinSyncTriggerSource.manual,
    ) -> dict[str, int | str | bool]:
        with self.lock:
            if not self.started:
                raise RuntimeError("Scan runtime is not started")

        db = SessionLocal()
        try:
            connection = db.get(JellyfinConnection, 1)
            if connection is None or not connection.enabled:
                raise ValueError("Jellyfin integration is disabled")
            if not connection.base_url or not read_jellyfin_api_key(
                connection,
                getattr(getattr(self, "settings", None), "jellyfin_api_key_file", None),
            ):
                raise ValueError("Jellyfin URL and API key are required before synchronization")
            standard_connector = next(
                (
                    candidate
                    for candidate in db.scalars(
                        select(ConnectorConnection).where(
                            ConnectorConnection.provider == "jellyfin"
                        )
                    )
                    if is_legacy_default_connection(candidate)
                ),
                None,
            )
            if standard_connector is not None and db.scalar(
                select(ConnectorSyncJob.id).where(
                    ConnectorSyncJob.connection_id == standard_connector.id,
                    ConnectorSyncJob.status.in_([JobStatus.queued, JobStatus.running]),
                )
            ) is not None:
                raise ValueError(
                    "The standard Jellyfin connector is already recomputing matches"
                )
            job, accepted = create_or_get_jellyfin_sync_job(db, trigger_source)
            result: dict[str, int | str | bool] = {
                "job_id": job.id,
                "status": job.status.value,
                "trigger_source": job.trigger_source.value,
                "accepted": accepted,
            }
        finally:
            db.close()

        if accepted:
            reset_jellyfin_cancellation()
            try:
                self.connector_executor.submit(self._run_jellyfin_sync, job.id)
            except Exception as exc:
                failed_db = SessionLocal()
                try:
                    finish_jellyfin_sync_job(
                        failed_db,
                        job.id,
                        JobStatus.failed,
                        error=str(exc),
                    )
                finally:
                    failed_db.close()
                raise
        return result

    def request_scheduled_jellyfin_sync(self) -> dict[str, int | str | bool]:
        return self.request_jellyfin_sync(JellyfinSyncTriggerSource.scheduled)

    def request_connector_sync(
        self,
        connection_id: int,
        trigger_source: str = "manual",
    ) -> dict[str, int | str | bool]:
        with self.lock:
            if not self.started:
                raise RuntimeError("Scan runtime is not started")
        db = SessionLocal()
        try:
            connection = db.get(ConnectorConnection, connection_id)
            if connection is None:
                raise ValueError("Connector connection not found")
            if is_legacy_default_connection(connection):
                return self.request_jellyfin_sync(
                    JellyfinSyncTriggerSource(trigger_source)
                )
            if not connection.enabled:
                raise ValueError("Connector connection is disabled")
            if not connection.base_url or not read_connector_secret(db, connection.id):
                raise ValueError("Connector URL and secret are required before synchronization")
            job, accepted = create_or_get_connector_sync_job(db, connection_id, trigger_source)
            result = {
                "job_id": job.id,
                "status": job.status.value,
                "trigger_source": job.trigger_source,
                "accepted": accepted,
            }
        finally:
            db.close()
        if accepted:
            future = self.connector_executor.submit(self._run_connector_job, job.id)
            with self.lock:
                self.connector_futures[job.id] = future
            future.add_done_callback(
                lambda _future, submitted_job_id=job.id: self._forget_connector_future(
                    submitted_job_id
                )
            )
        return result

    def request_connector_recompute(
        self,
        connection_id: int,
        trigger_source: str = "binding",
    ) -> dict[str, int | str | bool]:
        with self.lock:
            if not self.started:
                raise RuntimeError("Scan runtime is not started")
        db = SessionLocal()
        try:
            connection = db.get(ConnectorConnection, connection_id)
            if connection is None:
                raise ValueError("Connector connection not found")
            if is_legacy_default_connection(connection):
                legacy_job = get_active_jellyfin_sync_job(db)
                if legacy_job is not None:
                    return {
                        "job_id": legacy_job.id,
                        "status": legacy_job.status.value,
                        "trigger_source": legacy_job.trigger_source.value,
                        "accepted": False,
                    }
            job, accepted = create_or_get_connector_sync_job(
                db,
                connection_id,
                trigger_source,
                job_type="recompute",
            )
            result = {
                "job_id": job.id,
                "status": job.status.value,
                "trigger_source": job.trigger_source,
                "accepted": accepted,
            }
        finally:
            db.close()
        if accepted:
            future = self.connector_executor.submit(self._run_connector_job, job.id)
            with self.lock:
                self.connector_futures[job.id] = future
            future.add_done_callback(
                lambda _future, submitted_job_id=job.id: self._forget_connector_future(
                    submitted_job_id
                )
            )
        return result

    def _forget_connector_future(self, job_id: int) -> None:
        with self.lock:
            self.connector_futures.pop(job_id, None)

    def cancel_connector_sync(
        self,
        connection_id: int,
        job_id: int | None = None,
    ) -> dict[str, int | str | bool | None]:
        db = SessionLocal()
        try:
            connection = db.get(ConnectorConnection, connection_id)
            if connection is None:
                return {
                    "job_id": None,
                    "status": None,
                    "cancellation_requested": False,
                }
            legacy_default = is_legacy_default_connection(connection)
            if legacy_default:
                generic_active = db.scalar(
                    select(ConnectorSyncJob).where(
                        ConnectorSyncJob.connection_id == connection_id,
                        ConnectorSyncJob.status.in_([JobStatus.queued, JobStatus.running]),
                    )
                )
                if generic_active is None:
                    return self.cancel_jellyfin_sync(job_id)
            job = request_connector_sync_cancellation(db, connection_id, job_id)
            if job is not None and job.status == JobStatus.canceled:
                with self.lock:
                    future = self.connector_futures.get(job.id)
                if future is not None:
                    future.cancel()
            return {
                "job_id": job.id if job else None,
                "status": job.status.value if job else None,
                "cancellation_requested": bool(job),
            }
        finally:
            db.close()

    def _run_connector_job(self, job_id: int) -> None:
        db = SessionLocal()
        try:
            job = claim_connector_sync_job(db, job_id)
            if job is None:
                return
            if job.job_type == "recompute":
                run_connector_recompute(db, job_id)
            else:
                run_connector_sync(db, job_id)
        except Exception as exc:
            logger.error(
                "Connector synchronization failed for job %s: %s",
                job_id,
                redact_connector_error(exc),
            )
        finally:
            db.close()

    def refresh_connector_schedules(self) -> None:
        db = SessionLocal()
        try:
            connections = list(db.scalars(select(ConnectorConnection)))
            desired_ids: set[str] = set()
            for connection in connections:
                # The migrated singleton stays on the legacy Jellyfin schedule in
                # the compatibility release so users/playback continue to sync.
                if is_legacy_default_connection(connection):
                    continue
                job_id = f"connector-sync-{connection.id}"
                enabled = bool(
                    connection.enabled
                    and connection.base_url
                    and read_connector_secret(db, connection.id)
                    and connection.sync_interval_minutes > 0
                )
                if not enabled:
                    if self.scheduler.get_job(job_id):
                        self.scheduler.remove_job(job_id)
                    continue
                desired_ids.add(job_id)
                self.scheduler.add_job(
                    self.request_connector_sync,
                    trigger="interval",
                    minutes=max(5, int(connection.sync_interval_minutes)),
                    args=[connection.id, "scheduled"],
                    id=job_id,
                    replace_existing=True,
                    max_instances=1,
                    coalesce=True,
                )
            for scheduled in self.scheduler.get_jobs():
                if scheduled.id.startswith("connector-sync-") and scheduled.id not in desired_ids:
                    self.scheduler.remove_job(scheduled.id)
        finally:
            db.close()

    def cancel_jellyfin_sync(self, job_id: int | None = None) -> dict[str, int | str | bool | None]:
        db = SessionLocal()
        try:
            job = get_active_jellyfin_sync_job(db)
            if job is None or (job_id is not None and job.id != job_id):
                return {
                    "job_id": job.id if job else None,
                    "status": job.status.value if job else None,
                    "cancellation_requested": False,
                }
            if job.status == JobStatus.queued:
                canceled = cancel_queued_jellyfin_sync_job(db, job.id)
                return {
                    "job_id": job.id,
                    "status": JobStatus.canceled.value if canceled else job.status.value,
                    "cancellation_requested": canceled,
                }
            # Signal the in-process worker before attempting the SQLite write.
            # The compatibility mirror can hold a long write transaction, and
            # waiting for that transaction here used to make cancellation look
            # permanently stuck.
            requested = request_jellyfin_cancellation(job.id)
            if requested:
                mark_jellyfin_sync_cancellation_requested(db, job.id)
            return {
                "job_id": job.id,
                "status": job.status.value,
                "cancellation_requested": requested,
            }
        finally:
            db.close()

    def request_jellyfin_match_recompute(self) -> bool:
        with self.lock:
            if not self.started:
                return False
            if self.jellyfin_match_recompute_submitted:
                self.jellyfin_match_recompute_rerun = True
                return False
            self.jellyfin_match_recompute_submitted = True
            self.jellyfin_match_recompute_status = "queued"
            self.jellyfin_match_recompute_last_error = None
        self.maintenance_executor.submit(self._run_jellyfin_match_recompute)
        return True

    def get_jellyfin_match_recompute_status(self) -> dict[str, str | bool | None]:
        with self.lock:
            return {
                "status": self.jellyfin_match_recompute_status,
                "active": self.jellyfin_match_recompute_submitted,
                "rerun_pending": self.jellyfin_match_recompute_rerun,
                "last_error": self.jellyfin_match_recompute_last_error,
            }

    def _run_jellyfin_match_recompute(self) -> None:
        while True:
            with self.lock:
                self.jellyfin_match_recompute_status = "running"
                self.jellyfin_match_recompute_rerun = False
            db = SessionLocal()
            error: str | None = None
            try:
                refresh_jellyfin_mapping_state(db)
                recompute_jellyfin_matches(db, commit_batch_size=250)
                stats_cache.invalidate(str(id(db.get_bind())))
            except Exception as exc:
                db.rollback()
                error = str(exc)[:2048]
                logger.exception("Failed to recompute Jellyfin mapping state and matches")
            finally:
                db.close()

            with self.lock:
                if self.jellyfin_match_recompute_rerun:
                    self.jellyfin_match_recompute_status = "queued"
                    continue
                self.jellyfin_match_recompute_submitted = False
                self.jellyfin_match_recompute_status = "error" if error else "success"
                self.jellyfin_match_recompute_last_error = error
                return

    def refresh_jellyfin_schedule(self) -> None:
        job_id = "jellyfin-sync"
        db = SessionLocal()
        try:
            connection = db.get(JellyfinConnection, 1)
            enabled = bool(
                connection
                and connection.enabled
                and connection.base_url
                and read_jellyfin_api_key(
                    connection,
                    getattr(getattr(self, "settings", None), "jellyfin_api_key_file", None),
                )
                and connection.sync_interval_minutes > 0
            )
            interval = max(5, int(connection.sync_interval_minutes)) if connection else 60
        finally:
            db.close()
        if not enabled:
            if self.scheduler.get_job(job_id):
                self.scheduler.remove_job(job_id)
            return
        self.scheduler.add_job(
            self.request_scheduled_jellyfin_sync,
            trigger="interval",
            minutes=interval,
            id=job_id,
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

    def _run_jellyfin_sync(self, job_id: int) -> None:
        db = SessionLocal()
        try:
            job = mark_jellyfin_sync_job_running(db, job_id)
            if job is None:
                return
            try:
                summary = run_jellyfin_sync(db, job_id=job_id)
                if summary.get("status") == "canceled":
                    finish_jellyfin_sync_job(db, job_id, JobStatus.canceled, summary=summary)
                    return
                update_jellyfin_sync_job_progress(
                    db,
                    job_id,
                    phase="mapping",
                    detail=None,
                    current=0,
                    total=None,
                )

                def check_cancellation() -> None:
                    if jellyfin_cancellation_requested():
                        raise JellyfinSyncCancelled("Jellyfin synchronization was canceled")

                connector_id, connector_matching = mirror_legacy_jellyfin_snapshot(
                    db,
                    cancellation_check=check_cancellation,
                    progress_callback=lambda phase, current, total: (
                        update_jellyfin_sync_job_progress(
                            db,
                            job_id,
                            phase=phase,
                            detail=None,
                            current=current,
                            total=total,
                        )
                    ),
                )
                if connector_id is not None:
                    summary["connector_matching"] = connector_matching
                    summary["connector_shadow"] = compare_legacy_jellyfin_matches(
                        db, connector_id
                    )
            except JellyfinSyncCancelled:
                db.rollback()
                finish_jellyfin_sync_job(
                    db,
                    job_id,
                    JobStatus.canceled,
                    summary={"status": "canceled"},
                )
                return
            except Exception as exc:
                connection = db.get(JellyfinConnection, 1)
                secret = read_jellyfin_api_key(
                    connection,
                    getattr(getattr(self, "settings", None), "jellyfin_api_key_file", None),
                ) if connection is not None else ""
                safe_error = redact_connector_error(exc, secrets=(secret,))
                finish_jellyfin_sync_job(
                    db,
                    job_id,
                    JobStatus.failed,
                    error=safe_error,
                )
                logger.error("Jellyfin sync job %s failed: %s", job_id, safe_error)
                return
            status = (
                JobStatus.canceled
                if summary.get("status") == "canceled"
                else JobStatus.completed
            )
            finish_jellyfin_sync_job(db, job_id, status, summary=summary)
        finally:
            db.close()

    def _recover_orphaned_jellyfin_sync_jobs(self) -> None:
        db = SessionLocal()
        try:
            recovered = recover_orphaned_jellyfin_sync_jobs(db)
            if recovered:
                logger.warning("Canceled %s orphaned Jellyfin sync job(s)", recovered)
        finally:
            db.close()

    def _recover_orphaned_connector_sync_jobs(self) -> None:
        db = SessionLocal()
        try:
            recovered = recover_orphaned_connector_sync_jobs(db)
            if recovered:
                logger.info("Canceled %s orphaned connector sync job(s)", recovered)
        finally:
            db.close()

    def request_initial_telemetry_send(self) -> None:
        with self.lock:
            if not self.started:
                return
        self.maintenance_executor.submit(self._run_initial_telemetry_send)

    def request_update_telemetry_send(self) -> None:
        with self.lock:
            if not self.started:
                return
        self.maintenance_executor.submit(self._run_update_telemetry_send)

    def schedule_telemetry_send_after_settings_change(self) -> None:
        with self.lock:
            if not self.started:
                return
            if self.telemetry_send_timer is not None:
                self.telemetry_send_timer.cancel()
            timer = Timer(60, self._run_delayed_telemetry_send)
            timer.daemon = True
            self.telemetry_send_timer = timer
            timer.start()

    def cancel_pending_telemetry_send(self) -> None:
        with self.lock:
            if self.telemetry_send_timer is not None:
                self.telemetry_send_timer.cancel()
                self.telemetry_send_timer = None

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
        before_db = SessionLocal()
        try:
            before_files = {
                file_id: (root_id, relative_path)
                for file_id, root_id, relative_path in before_db.execute(
                    select(
                        MediaFile.id,
                        MediaFile.library_root_id,
                        MediaFile.relative_path,
                    ).where(MediaFile.library_id == library_id)
                )
                if root_id is not None
            }
        finally:
            before_db.close()
        try:
            execute_scan_job(job_id, self.settings, is_cancel_requested=self.is_job_cancel_requested)
        finally:
            connector_recompute_ids: list[int] = []
            match_db = SessionLocal()
            try:
                job = match_db.get(ScanJob, job_id)
                after_files = {
                    file_id: (root_id, relative_path)
                    for file_id, root_id, relative_path in match_db.execute(
                        select(
                            MediaFile.id,
                            MediaFile.library_root_id,
                            MediaFile.relative_path,
                        ).where(MediaFile.library_id == library_id)
                    )
                    if root_id is not None
                }
                changed_ids = set(
                    match_db.scalars(
                        select(MediaFile.id).where(
                            MediaFile.library_id == library_id,
                            MediaFile.last_analyzed_at.is_not(None),
                            MediaFile.last_analyzed_at >= job.started_at,
                        )
                    )
                ) if job and job.started_at else set()
                changed_locators = {
                    locator
                    for file_id in set(before_files) | set(after_files)
                    if before_files.get(file_id) != after_files.get(file_id)
                    for locator in (before_files.get(file_id), after_files.get(file_id))
                    if locator is not None
                }
                changed_locators.update(
                    after_files[file_id]
                    for file_id in changed_ids
                    if file_id in after_files
                )
                if changed_ids or changed_locators:
                    recompute_jellyfin_matches(match_db, media_file_ids=changed_ids)
                    connector_recompute_ids = list(
                        match_db.scalars(
                            select(ConnectorConnection.id).where(
                                ConnectorConnection.enabled.is_(True)
                            )
                        )
                    )
                reconcile_transcode_variants(match_db, library_id)
            except Exception:
                match_db.rollback()
                logger.exception("Failed to refresh Jellyfin matches after scan %s", job_id)
            finally:
                match_db.close()
            for connection_id in connector_recompute_ids:
                try:
                    self.request_connector_recompute(connection_id, trigger_source="scan")
                except Exception:
                    logger.exception(
                        "Failed to queue connector mapping refresh after scan %s for connection %s",
                        job_id,
                        connection_id,
                    )
            should_attempt_compaction = False
            with self.lock:
                self.submitted_job_ids.discard(job_id)
                self.active_library_ids.discard(library_id)
                self.cancel_requested_job_ids.discard(job_id)
                should_attempt_compaction = self.history_compaction_pending and not self.active_library_ids
            self._submit_next_active_job(library_id)
            self.request_history_storage_refresh()
            self.request_stats_warmup(library_id)
            if should_attempt_compaction:
                self.run_pending_history_compaction()

    def _run_history_reconstruction(self) -> None:
        started_at = utc_now()
        self._update_history_reconstruction_status(
            status=HistoryReconstructionJobStatus.running,
            phase=HistoryReconstructionPhase.loading_libraries,
            started_at=started_at,
            finished_at=None,
            progress_percent=0.0,
            error=None,
            result=None,
        )
        db = SessionLocal()
        try:
            result = reconstruct_history_from_media_files(
                db,
                progress_callback=self._update_history_reconstruction_status,
            )
        except Exception as exc:
            self._update_history_reconstruction_status(
                status=HistoryReconstructionJobStatus.failed,
                phase=HistoryReconstructionPhase.failed,
                finished_at=utc_now(),
                progress_percent=0.0,
                error=str(exc) or exc.__class__.__name__,
                result=None,
            )
        else:
            self._update_history_reconstruction_status(
                status=HistoryReconstructionJobStatus.completed,
                phase=HistoryReconstructionPhase.completed,
                finished_at=utc_now(),
                progress_percent=100.0,
                libraries_total=result.libraries_processed,
                libraries_processed=result.libraries_processed,
                libraries_with_media=result.libraries_with_media,
                current_library_name=None,
                phase_total=0,
                phase_completed=0,
                created_file_history_entries=result.created_file_history_entries,
                created_library_history_entries=result.created_library_history_entries,
                updated_library_history_entries=result.updated_library_history_entries,
                error=None,
                result=result,
            )
        finally:
            db.close()
            self.request_history_storage_refresh()

    def is_job_cancel_requested(self, job_id: int | None) -> bool:
        if job_id is None:
            return False
        with self.lock:
            return job_id in self.cancel_requested_job_ids

    def cancel_active_jobs(self) -> list[int]:
        db = SessionLocal()
        jobs: list[ScanJob] = []
        canceled_ids: list[int] = []
        canceled_library_ids: set[int] = set()
        persistence_error: ScanCancelPersistenceError | None = None
        persistence_cause: OperationalError | None = None
        try:
            jobs = db.scalars(
                select(ScanJob)
                .where(ScanJob.status.in_([JobStatus.queued, JobStatus.running]))
                .order_by(ScanJob.id.asc())
            ).all()

            for job in jobs:
                job.status = JobStatus.canceled
                job.finished_at = utc_now()
                canceled_ids.append(job.id)
                canceled_library_ids.add(job.library_id)

            if canceled_ids:
                with self.lock:
                    self.cancel_requested_job_ids.update(canceled_ids)

            if canceled_ids:
                try:
                    db.commit()
                except OperationalError as exc:
                    db.rollback()
                    if _is_sqlite_database_locked(exc):
                        persistence_error = ScanCancelPersistenceError(canceled_ids)
                        persistence_cause = exc
                    else:
                        raise
        finally:
            db.close()

        with self.lock:
            for library_id in canceled_library_ids:
                pending_timer = self.debounce_timers.pop(library_id, None)
                if pending_timer is not None:
                    pending_timer.cancel()
                self.watch_trigger_buffers.pop(library_id, None)

        if persistence_error is not None:
            raise persistence_error from persistence_cause

        if canceled_ids:
            with self.lock:
                self.cancel_requested_job_ids.difference_update(canceled_ids)

        if canceled_ids:
            self.request_history_storage_refresh()
        return canceled_ids

    def cancel_library_jobs(self, library_id: int) -> list[int]:
        db = SessionLocal()
        canceled_ids: list[int] = []
        persistence_error: ScanCancelPersistenceError | None = None
        persistence_cause: OperationalError | None = None
        try:
            jobs = db.scalars(
                select(ScanJob)
                .where(
                    ScanJob.library_id == library_id,
                    ScanJob.status.in_([JobStatus.queued, JobStatus.running]),
                )
                .order_by(ScanJob.id.asc())
            ).all()

            for job in jobs:
                job.status = JobStatus.canceled
                job.finished_at = utc_now()
                canceled_ids.append(job.id)

            if canceled_ids:
                with self.lock:
                    self.cancel_requested_job_ids.update(canceled_ids)

            if canceled_ids:
                try:
                    db.commit()
                except OperationalError as exc:
                    db.rollback()
                    if _is_sqlite_database_locked(exc):
                        persistence_error = ScanCancelPersistenceError(canceled_ids)
                        persistence_cause = exc
                    else:
                        raise
        finally:
            db.close()

        with self.lock:
            pending_timer = self.debounce_timers.pop(library_id, None)
            if pending_timer is not None:
                pending_timer.cancel()
            self.watch_trigger_buffers.pop(library_id, None)

        if persistence_error is not None:
            raise persistence_error from persistence_cause

        if canceled_ids:
            with self.lock:
                self.cancel_requested_job_ids.difference_update(canceled_ids)

        if canceled_ids:
            self.request_history_storage_refresh()
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
            root_rows = list(library.roots or []) if library else []
            watch_roots = (
                [(root.id, str(root.path), root.display_name) for root in root_rows]
                if root_rows
                else [(None, str(library.path), "") for library in [library] if library]
            )
        finally:
            db.close()

        event_paths: list[str] = []
        root_ids: set[int] = set()
        for path in paths:
            for root_id, root_path, root_name in watch_roots:
                relative_path = self._relative_watch_path(path, root_path)
                if relative_path is None:
                    continue
                event_paths.append(f"{root_name}/{relative_path}" if root_name else relative_path)
                if root_id is not None:
                    root_ids.add(root_id)
                break
        self._record_watch_trigger(
            library_id,
            event.event_type,
            [path for path in event_paths if path],
            debounce_seconds,
            root_ids=sorted(root_ids),
        )

        existing = self.debounce_timers.pop(library_id, None)
        if existing:
            existing.cancel()

        timer = Timer(debounce_seconds, lambda: self._request_watch_scan(library_id))
        timer.daemon = True
        self.debounce_timers[library_id] = timer
        timer.start()

    def _ensure_scheduled_job(self, library: Library) -> None:
        if library.scan_mode == ScanMode.scheduled_daily:
            scheduled_time = str((library.scan_config or {}).get("scheduled_time", "02:00"))
            try:
                hour_str, minute_str = scheduled_time.split(":", 1)
                hour = max(0, min(23, int(hour_str)))
                minute = max(0, min(59, int(minute_str)))
            except (ValueError, AttributeError):
                hour, minute = 2, 0
            normalized_time = f"{hour:02d}:{minute:02d}"
            self.scheduler.add_job(
                self.request_scan,
                trigger="cron",
                hour=hour,
                minute=minute,
                kwargs={
                    "library_id": library.id,
                    "scan_type": "incremental",
                    "trigger_source": ScanTriggerSource.scheduled,
                    "trigger_details": {"scheduled_time": normalized_time},
                },
                id=self._scheduled_job_id(library.id),
                replace_existing=True,
                max_instances=1,
                coalesce=True,
            )
        else:
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

    def _ensure_history_maintenance_job(self) -> None:
        self.scheduler.add_job(
            self.run_history_retention,
            trigger="interval",
            hours=24,
            id="history-retention-maintenance",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.add_job(
            self.request_history_storage_refresh,
            trigger="interval",
            hours=1,
            id="history-storage-refresh",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )

    def _ensure_telemetry_job(self) -> None:
        self.scheduler.add_job(
            self.request_telemetry_send,
            trigger="cron",
            hour=0,
            minute=0,
            jitter=600,
            kwargs={"force": False},
            id="telemetry-daily-snapshot",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            misfire_grace_time=3600,
        )

    def _ensure_update_check_jobs(self) -> None:
        for hour, job_id in ((0, "update-check-primary"), (12, "update-check-secondary")):
            self.scheduler.add_job(
                self.request_update_check,
                trigger="cron",
                hour=hour,
                minute=0,
                jitter=600,
                id=job_id,
                replace_existing=True,
                max_instances=1,
                coalesce=True,
                misfire_grace_time=3600,
            )

    def _ensure_watch_observer(self, library: Library) -> None:
        root_paths = [str(root.path) for root in (library.roots or [])] or [str(library.path)]
        root_paths = [path for path in root_paths if path.strip()]
        if not root_paths:
            return
        if any(not Path(path).exists() for path in root_paths):
            return
        if any(not is_watch_supported_for_library(self.settings, path) for path in root_paths):
            self._remove_watch_observer(library.id)
            return

        current = self.watch_observers.get(library.id)
        path_signature = tuple(sorted(root_paths))
        if current and current[0] == path_signature:
            return

        self._remove_watch_observer(library.id)
        observer = Observer()
        handler = LibraryWatchHandler(self, library.id)
        for root_path in root_paths:
            observer.schedule(handler, root_path, recursive=True)
        observer.daemon = True
        observer.start()
        self.watch_observers[library.id] = (path_signature, observer)

    def _recover_orphaned_jobs(self) -> None:
        db = SessionLocal()
        try:
            orphaned_jobs = db.scalars(
                select(ScanJob)
                .where(ScanJob.status.in_([JobStatus.queued, JobStatus.running]))
                .order_by(ScanJob.id.asc())
            ).all()

            if not orphaned_jobs:
                return

            finished_at = utc_now()
            for job in orphaned_jobs:
                job.status = JobStatus.canceled
                job.finished_at = finished_at

            db.commit()
        finally:
            db.close()

    def _recover_orphaned_transcode_jobs(self) -> None:
        db = SessionLocal()
        try:
            recovered = recover_orphaned_transcode_jobs(db)
            if recovered:
                logger.info("Canceled %s orphaned transcoding job(s)", recovered)
        finally:
            db.close()

    def _run_telemetry_send(self, force: bool = False) -> None:
        db = SessionLocal()
        try:
            send_current_telemetry_snapshot(db, self.settings, force=force)
        finally:
            db.close()

    def _run_initial_telemetry_send(self) -> None:
        db = SessionLocal()
        try:
            send_initial_telemetry_snapshot(db, self.settings)
        finally:
            db.close()

    def _run_update_telemetry_send(self) -> None:
        db = SessionLocal()
        try:
            send_update_telemetry_snapshot(db, self.settings)
        finally:
            db.close()

    def _run_update_check(self) -> None:
        db = SessionLocal()
        try:
            check_for_updates(db, self.settings)
        finally:
            db.close()

    def _run_delayed_telemetry_send(self) -> None:
        with self.lock:
            self.telemetry_send_timer = None
        self.request_telemetry_send(force=True)

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

    def _remove_scheduled_job(self, library_id: int) -> None:
        job_id = self._scheduled_job_id(library_id)
        if self.scheduler.get_job(job_id):
            self.scheduler.remove_job(job_id)

    def _remove_watch_observer(self, library_id: int) -> None:
        existing = self.watch_observers.pop(library_id, None)
        if not existing:
            return
        self.watch_trigger_buffers.pop(library_id, None)
        _paths, observer = existing
        observer.stop()
        observer.join(timeout=2)

    @staticmethod
    def _scheduled_job_id(library_id: int) -> str:
        return f"library-schedule-{library_id}"

    def run_history_retention(self) -> HistoryRetentionResult:
        db = SessionLocal()
        try:
            result = apply_history_retention(db, self.settings)
        finally:
            db.close()

        with self.lock:
            self.history_compaction_pending = result.compaction_deferred
        self.request_history_storage_refresh()
        return result

    def request_history_storage_refresh(self) -> bool:
        with self.lock:
            if not self.started or self.history_storage_refresh_submitted:
                return False
            self.history_storage_refresh_submitted = True

        try:
            self.maintenance_executor.submit(self._run_history_storage_refresh)
        except RuntimeError:
            with self.lock:
                self.history_storage_refresh_submitted = False
            return False
        return True

    def request_stats_warmup(self, library_id: int | None = None) -> bool:
        with self.lock:
            if not self.started:
                return False
            self._cancel_stats_warmup_locked()
            timer = Timer(0, lambda: self._submit_stats_warmup(library_id))
            timer.daemon = True
            self.stats_warmup_timer = timer
            timer.start()
            return True

    def _cancel_stats_warmup_locked(self) -> None:
        if self.stats_warmup_timer is not None:
            self.stats_warmup_timer.cancel()
            self.stats_warmup_timer = None

    def _submit_stats_warmup(self, library_id: int | None) -> None:
        with self.lock:
            self.stats_warmup_timer = None
            if self.active_library_ids:
                return
        try:
            self.maintenance_executor.submit(self._run_stats_warmup, library_id)
        except RuntimeError:
            return

    def _run_stats_warmup(self, library_id: int | None = None) -> None:
        with self.lock:
            if self.active_library_ids:
                return
        db = SessionLocal()
        try:
            # Favor the just-mutated library first, then use idle time to warm the rest.
            library_ids = [library_id] if library_id is not None else []
            library_ids.extend(
                candidate_library_id
                for candidate_library_id in db.scalars(select(Library.id).order_by(Library.id.asc()))
                if candidate_library_id != library_id
            )
            for candidate_library_id in library_ids:
                with self.lock:
                    if self.active_library_ids:
                        return
                get_library_summary(db, candidate_library_id)
                get_library_history(db, candidate_library_id)
            get_dashboard_history(db)
        except Exception:
            logger.exception("Failed to warm statistics caches")
        finally:
            db.close()

    def _run_history_storage_refresh(self) -> None:
        db = SessionLocal()
        try:
            get_history_storage(db, self.settings)
        except Exception:
            logger.exception("Failed to refresh history storage cache")
        finally:
            db.close()
            with self.lock:
                self.history_storage_refresh_submitted = False

    def _update_history_reconstruction_status(self, **updates) -> None:
        with self.lock:
            current = self.history_reconstruction_status
            next_status = current.model_copy(update=updates)
            if next_status.status == HistoryReconstructionJobStatus.queued:
                next_status.status = HistoryReconstructionJobStatus.running
            self.history_reconstruction_status = next_status

    def run_pending_history_compaction(self) -> bool:
        db = SessionLocal()
        try:
            completed = run_pending_history_compaction(db)
        finally:
            db.close()

        if completed:
            with self.lock:
                self.history_compaction_pending = False
            self.request_history_storage_refresh()
        return completed

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
        *,
        root_ids: list[int] | None = None,
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
            if root_ids:
                current_root_ids = {int(root_id) for root_id in buffer.get("root_ids") or []}
                current_root_ids.update(root_ids)
                buffer["root_ids"] = sorted(current_root_ids)

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

    @staticmethod
    def _shutdown_executor(executor: ThreadPoolExecutor, *, cancel_futures: bool) -> None:
        try:
            executor.shutdown(wait=False, cancel_futures=cancel_futures)
        except TypeError:
            executor.shutdown(wait=False)

    @staticmethod
    def _build_executor(max_workers: int) -> ThreadPoolExecutor:
        return ThreadPoolExecutor(
            max_workers=max(1, max_workers),
            thread_name_prefix="medialyze-runtime",
        )

    @staticmethod
    def _build_maintenance_executor() -> ThreadPoolExecutor:
        return ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="medialyze-maintenance",
        )

    @staticmethod
    def _build_connector_executor(max_workers: int) -> ThreadPoolExecutor:
        return ThreadPoolExecutor(
            max_workers=max(1, max_workers),
            thread_name_prefix="medialyze-connector",
        )

    @staticmethod
    def _build_transcode_executor(max_workers: int) -> ThreadPoolExecutor:
        return ThreadPoolExecutor(
            max_workers=max(1, max_workers),
            thread_name_prefix="medialyze-transcode",
        )
