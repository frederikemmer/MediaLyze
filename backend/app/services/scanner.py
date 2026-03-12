from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
import os
from pathlib import Path
import traceback

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from backend.app.core.config import Settings
from backend.app.db.session import SessionLocal
from backend.app.models.entities import (
    AudioStream,
    ExternalSubtitle,
    JobStatus,
    Library,
    MediaFile,
    MediaFormat,
    ScanJob,
    ScanStatus,
    SubtitleStream,
    VideoStream,
)
from backend.app.services.app_settings import get_ignore_patterns
from backend.app.services.ffprobe_parser import normalize_ffprobe_payload, run_ffprobe
from backend.app.services.quality import calculate_quality_score
from backend.app.services.stats_cache import stats_cache
from backend.app.services.subtitles import detect_external_subtitles
from backend.app.utils.glob_patterns import matches_ignore_pattern
from backend.app.utils.time import utc_now


class ScanCanceled(Exception):
    pass


def _library_root(library: Library) -> Path:
    return Path(library.path)


def _iter_media_files(
    root: Path,
    allowed_extensions: tuple[str, ...],
    *,
    ignore_patterns: tuple[str, ...] = (),
    should_cancel: Callable[[], bool] | None = None,
) -> list[Path]:
    suffixes = {extension.lower() for extension in allowed_extensions}
    files: list[Path] = []

    def _is_ignored(relative_path: str, *, is_dir: bool = False) -> bool:
        return matches_ignore_pattern(relative_path, ignore_patterns, is_dir=is_dir)

    for current_root, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        if should_cancel and should_cancel():
            raise ScanCanceled()

        current_root_path = Path(current_root)
        dirnames[:] = sorted(
            [
                dirname
                for dirname in dirnames
                if not (current_root_path / dirname).is_symlink()
                and not _is_ignored((current_root_path / dirname).relative_to(root).as_posix(), is_dir=True)
            ],
            key=str.lower,
        )

        for filename in sorted(filenames, key=str.lower):
            file_path = current_root_path / filename
            if file_path.is_symlink():
                continue
            relative_path = file_path.relative_to(root).as_posix()
            if _is_ignored(relative_path):
                continue
            if file_path.suffix.lower() in suffixes:
                files.append(file_path)
    return files


def _replace_analysis(media_file: MediaFile, normalized, external_subtitles: list[dict[str, str | None]]) -> None:
    if media_file.media_format is None:
        media_file.media_format = MediaFormat()

    media_file.media_format.container_format = normalized.media_format.container_format
    media_file.media_format.duration = normalized.media_format.duration
    media_file.media_format.bit_rate = normalized.media_format.bit_rate
    media_file.media_format.probe_score = normalized.media_format.probe_score
    media_file.video_streams = [
        VideoStream(
            stream_index=stream.stream_index,
            codec=stream.codec,
            profile=stream.profile,
            width=stream.width,
            height=stream.height,
            pix_fmt=stream.pix_fmt,
            color_space=stream.color_space,
            color_transfer=stream.color_transfer,
            color_primaries=stream.color_primaries,
            frame_rate=stream.frame_rate,
            bit_rate=stream.bit_rate,
            hdr_type=stream.hdr_type,
        )
        for stream in normalized.video_streams
    ]
    media_file.audio_streams = [
        AudioStream(
            stream_index=stream.stream_index,
            codec=stream.codec,
            channels=stream.channels,
            channel_layout=stream.channel_layout,
            sample_rate=stream.sample_rate,
            bit_rate=stream.bit_rate,
            language=stream.language,
            default_flag=stream.default_flag,
            forced_flag=stream.forced_flag,
        )
        for stream in normalized.audio_streams
    ]
    media_file.subtitle_streams = [
        SubtitleStream(
            stream_index=stream.stream_index,
            codec=stream.codec,
            language=stream.language,
            default_flag=stream.default_flag,
            forced_flag=stream.forced_flag,
            subtitle_type=stream.subtitle_type,
        )
        for stream in normalized.subtitle_streams
    ]
    media_file.external_subtitles = [
        ExternalSubtitle(path=item["path"], language=item["language"], format=item["format"])
        for item in external_subtitles
    ]


def _analyze_path(
    file_path: Path,
    library_root: Path,
    settings: Settings,
    ignore_patterns: tuple[str, ...],
) -> tuple[dict, list[dict[str, str | None]]]:
    payload = run_ffprobe(file_path, settings.ffprobe_path)
    subtitles = [
        subtitle
        for subtitle in detect_external_subtitles(file_path, settings.subtitle_extensions)
        if not matches_ignore_pattern(
            (file_path.parent / str(subtitle["path"])).relative_to(library_root).as_posix(),
            ignore_patterns,
        )
    ]
    return payload, subtitles


def queue_scan_job(db: Session, library_id: int, scan_type: str = "incremental") -> tuple[ScanJob, bool]:
    existing_job = db.scalar(
        select(ScanJob)
        .where(
            ScanJob.library_id == library_id,
            ScanJob.status.in_([JobStatus.queued, JobStatus.running]),
        )
        .order_by(ScanJob.id.desc())
    )
    if existing_job is not None:
        return existing_job, False

    job = ScanJob(
        library_id=library_id,
        status=JobStatus.queued,
        job_type=scan_type,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job, True


def _incomplete_analysis_file_ids(db: Session, library_id: int) -> set[int]:
    incomplete_ids = set(
        db.scalars(
            select(MediaFile.id).where(
                MediaFile.library_id == library_id,
                or_(
                    MediaFile.last_analyzed_at.is_(None),
                    MediaFile.raw_ffprobe_json.is_(None),
                    MediaFile.scan_status != ScanStatus.ready,
                ),
            )
        ).all()
    )
    incomplete_ids.update(
        db.scalars(
            select(AudioStream.media_file_id)
            .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
            .where(MediaFile.library_id == library_id, AudioStream.codec.is_(None))
        ).all()
    )
    incomplete_ids.update(
        db.scalars(
            select(SubtitleStream.media_file_id)
            .join(MediaFile, MediaFile.id == SubtitleStream.media_file_id)
            .where(
                MediaFile.library_id == library_id,
                or_(SubtitleStream.codec.is_(None), SubtitleStream.subtitle_type.is_(None)),
            )
        ).all()
    )
    incomplete_ids.update(
        db.scalars(
            select(ExternalSubtitle.media_file_id)
            .join(MediaFile, MediaFile.id == ExternalSubtitle.media_file_id)
            .where(MediaFile.library_id == library_id, ExternalSubtitle.format.is_(None))
        ).all()
    )
    return incomplete_ids


def execute_scan_job(job_id: int, settings: Settings) -> None:
    db = SessionLocal()
    try:
        _run_scan_job(db, settings, job_id)
    except ScanCanceled:
        job = db.get(ScanJob, job_id)
        if job:
            job.status = JobStatus.canceled
            job.finished_at = utc_now()
            db.commit()
    except Exception:
        job = db.get(ScanJob, job_id)
        if job:
            job.status = JobStatus.failed
            job.finished_at = utc_now()
            job.errors += 1
            db.commit()
    finally:
        db.close()


def _run_scan_job(db: Session, settings: Settings, job_id: int) -> ScanJob:
    job = db.get(ScanJob, job_id)
    if not job:
        raise ValueError(f"Scan job {job_id} not found")
    if job.status == JobStatus.canceled:
        job.finished_at = job.finished_at or utc_now()
        db.commit()
        return job
    job.status = JobStatus.running
    job.started_at = utc_now()
    db.commit()
    db.refresh(job)
    return run_scan(db, settings, job.library_id, job.job_type, job)


def run_scan(
    db: Session,
    settings: Settings,
    library_id: int,
    scan_type: str = "incremental",
    existing_job: ScanJob | None = None,
) -> ScanJob:
    cache_key = str(id(db.get_bind()))
    library = db.get(Library, library_id)
    if not library:
        raise ValueError(f"Library {library_id} not found")

    root = _library_root(library)
    job = existing_job or ScanJob(
        library_id=library_id,
        status=JobStatus.running,
        job_type=scan_type,
        started_at=utc_now(),
    )
    if existing_job is None:
        db.add(job)
        db.commit()
        db.refresh(job)

    def _should_cancel() -> bool:
        db.refresh(job)
        return job.status == JobStatus.canceled

    existing_by_path = {
        media_file.relative_path: media_file
        for media_file in db.scalars(select(MediaFile).where(MediaFile.library_id == library_id)).all()
    }
    incomplete_analysis_ids = _incomplete_analysis_file_ids(db, library_id)
    ignore_patterns = get_ignore_patterns(db)

    discovered = _iter_media_files(
        root,
        settings.allowed_media_extensions,
        ignore_patterns=ignore_patterns,
        should_cancel=_should_cancel,
    )
    seen_relative_paths: set[str] = set()
    to_analyze: list[tuple[MediaFile, Path]] = []
    discovery_counter = 0

    for file_path in discovered:
        relative_path = file_path.relative_to(root).as_posix()
        seen_relative_paths.add(relative_path)
        discovery_counter += 1
        stat = file_path.stat()
        media_file = existing_by_path.get(relative_path)

        if discovery_counter >= settings.scan_discovery_batch_size:
            job.files_total = len(seen_relative_paths)
            db.commit()
            stats_cache.invalidate(cache_key, job.library_id)
            discovery_counter = 0
            if _should_cancel():
                raise ScanCanceled()

        if media_file is None:
            media_file = MediaFile(
                library_id=library.id,
                relative_path=relative_path,
                filename=file_path.name,
                extension=file_path.suffix.lower().lstrip("."),
                size_bytes=stat.st_size,
                mtime=stat.st_mtime,
                last_seen_at=utc_now(),
                scan_status=ScanStatus.pending,
            )
            db.add(media_file)
            db.flush()
            to_analyze.append((media_file, file_path))
        else:
            changed = media_file.size_bytes != stat.st_size or media_file.mtime != stat.st_mtime
            analysis_incomplete = media_file.id in incomplete_analysis_ids
            media_file.filename = file_path.name
            media_file.extension = file_path.suffix.lower().lstrip(".")
            media_file.size_bytes = stat.st_size
            media_file.mtime = stat.st_mtime
            media_file.last_seen_at = utc_now()
            if changed or scan_type == "full" or analysis_incomplete:
                media_file.scan_status = ScanStatus.pending
                to_analyze.append((media_file, file_path))

    stale_ids = [
        media_file.id
        for relative_path, media_file in existing_by_path.items()
        if relative_path not in seen_relative_paths
    ]
    if stale_ids:
        db.execute(delete(MediaFile).where(MediaFile.id.in_(stale_ids)))

    job.files_total = len(discovered)
    db.commit()
    stats_cache.invalidate(cache_key, job.library_id)
    if _should_cancel():
        raise ScanCanceled()

    def _safe_analyze(pair: tuple[MediaFile, Path]) -> tuple[MediaFile, dict | None, list[dict[str, str | None]], str | None]:
        media_file, path = pair
        try:
            payload, subtitles = _analyze_path(path, root, settings, ignore_patterns)
            return media_file, payload, subtitles, None
        except Exception:
            return media_file, None, [], traceback.format_exc()

    with ThreadPoolExecutor(max_workers=settings.ffprobe_worker_count) as executor:
        batch_counter = 0
        next_index = 0
        pending: dict[Future, tuple[MediaFile, Path]] = {}
        max_in_flight = max(1, settings.ffprobe_worker_count * 2)

        while next_index < len(to_analyze) and len(pending) < max_in_flight:
            pair = to_analyze[next_index]
            pending[executor.submit(_safe_analyze, pair)] = pair
            next_index += 1

        while pending:
            if _should_cancel():
                for future in pending:
                    future.cancel()
                raise ScanCanceled()

            done, _ = wait(pending.keys(), return_when=FIRST_COMPLETED)
            for future in done:
                pending.pop(future)
                media_file, payload, subtitles, error = future.result()
                if error is None and payload is not None:
                    media_file.scan_status = ScanStatus.analyzing
                    normalized = normalize_ffprobe_payload(payload)
                    media_file.raw_ffprobe_json = payload
                    _replace_analysis(media_file, normalized, subtitles)
                    media_file.quality_score = calculate_quality_score(normalized)
                    media_file.last_analyzed_at = utc_now()
                    media_file.scan_status = ScanStatus.ready
                else:
                    media_file.scan_status = ScanStatus.failed
                    job.errors += 1
                job.files_scanned += 1
                batch_counter += 1
                if batch_counter >= settings.scan_commit_batch_size:
                    db.commit()
                    stats_cache.invalidate(cache_key, job.library_id)
                    batch_counter = 0

                if next_index < len(to_analyze):
                    pair = to_analyze[next_index]
                    pending[executor.submit(_safe_analyze, pair)] = pair
                    next_index += 1

        if batch_counter:
            db.commit()
            stats_cache.invalidate(cache_key, job.library_id)

    if _should_cancel():
        raise ScanCanceled()
    library.last_scan_at = utc_now()
    job.status = JobStatus.failed if job.errors else JobStatus.completed
    job.finished_at = utc_now()
    db.commit()
    stats_cache.invalidate(cache_key, job.library_id)
    db.refresh(job)
    return job
