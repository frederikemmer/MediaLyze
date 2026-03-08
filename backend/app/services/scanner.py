from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import traceback

from sqlalchemy import delete, select
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
from backend.app.services.ffprobe_parser import normalize_ffprobe_payload, run_ffprobe
from backend.app.services.quality import calculate_quality_score
from backend.app.services.subtitles import detect_external_subtitles
from backend.app.utils.time import utc_now


def _library_root(library: Library) -> Path:
    return Path(library.path)


def _iter_media_files(root: Path, allowed_extensions: tuple[str, ...]) -> list[Path]:
    suffixes = {extension.lower() for extension in allowed_extensions}
    files: list[Path] = []
    for entry in sorted(root.rglob("*")):
        if entry.is_file() and entry.suffix.lower() in suffixes:
            files.append(entry)
    return files


def _replace_analysis(media_file: MediaFile, normalized, external_subtitles: list[dict[str, str | None]]) -> None:
    media_file.media_format = MediaFormat(
        container_format=normalized.media_format.container_format,
        duration=normalized.media_format.duration,
        bit_rate=normalized.media_format.bit_rate,
        probe_score=normalized.media_format.probe_score,
    )
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


def _analyze_path(file_path: Path, settings: Settings) -> tuple[dict, list[dict[str, str | None]]]:
    payload = run_ffprobe(file_path, settings.ffprobe_path)
    subtitles = detect_external_subtitles(file_path, settings.subtitle_extensions)
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


def execute_scan_job(job_id: int, settings: Settings) -> None:
    db = SessionLocal()
    try:
        _run_scan_job(db, settings, job_id)
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

    existing_by_path = {
        media_file.relative_path: media_file
        for media_file in db.scalars(select(MediaFile).where(MediaFile.library_id == library_id)).all()
    }

    discovered = _iter_media_files(root, settings.allowed_media_extensions)
    seen_relative_paths: set[str] = set()
    to_analyze: list[tuple[MediaFile, Path]] = []

    for file_path in discovered:
        relative_path = file_path.relative_to(root).as_posix()
        seen_relative_paths.add(relative_path)
        stat = file_path.stat()
        media_file = existing_by_path.get(relative_path)

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
            media_file.filename = file_path.name
            media_file.extension = file_path.suffix.lower().lstrip(".")
            media_file.size_bytes = stat.st_size
            media_file.mtime = stat.st_mtime
            media_file.last_seen_at = utc_now()
            if changed or scan_type == "full":
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

    def _safe_analyze(pair: tuple[MediaFile, Path]) -> tuple[MediaFile, dict | None, list[dict[str, str | None]], str | None]:
        media_file, path = pair
        try:
            payload, subtitles = _analyze_path(path, settings)
            return media_file, payload, subtitles, None
        except Exception:
            return media_file, None, [], traceback.format_exc()

    with ThreadPoolExecutor(max_workers=settings.ffprobe_worker_count) as executor:
        batch_counter = 0
        for media_file, payload, subtitles, error in executor.map(_safe_analyze, to_analyze):
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
                batch_counter = 0

        if batch_counter:
            db.commit()

    library.last_scan_at = utc_now()
    job.status = JobStatus.failed if job.errors else JobStatus.completed
    job.finished_at = utc_now()
    db.commit()
    db.refresh(job)
    return job
