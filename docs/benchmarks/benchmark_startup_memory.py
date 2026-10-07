"""Measure startup backfill, storage retention and quality recomputation with large JSON.

Fixtures are temporary; tracemalloc measures Python allocations, not total container
RSS or ffprobe memory. No actual ffprobe or media decoding runs in this benchmark.
"""
from __future__ import annotations

import argparse
from datetime import timedelta
import json
from pathlib import Path
import tempfile

from _support import create_benchmark_database, environment_metadata, measure_memory
from sqlalchemy import func, insert, select, update

from backend.app.db.session import init_db
from backend.app.models.entities import (
    Library, LibraryType, MediaFile, MediaFileHistory, MediaFileHistoryCaptureReason,
    MediaFormat, ScanStatus, VideoStream,
)
from backend.app.services.duplicates import backfill_filename_pattern_signatures
from backend.app.services.history_retention import _prune_media_file_history
from backend.app.services.history_reconstruction import reconstruct_history_from_media_files
from backend.app.services.scanner import run_quality_recompute
from backend.app.utils.time import utc_now


def run_benchmark(items: int, payload_bytes: int, *, reconstruct_only: bool = False) -> dict:
    with tempfile.TemporaryDirectory(prefix="medialyze-startup-benchmark-") as directory:
        engine, factory = create_benchmark_database(Path(directory) / "benchmark.sqlite3")
        now = utc_now()
        payload = {"padding": "x" * payload_bytes}
        with factory() as db:
            library = Library(name="Memory benchmark", path="/synthetic", type=LibraryType.movies)
            db.add(library)
            db.commit()
            library_id = library.id
            for start in range(0, items, 100):
                indices = range(start, min(items, start + 100))
                db.execute(insert(MediaFile), [{
                    "id": i + 1, "library_id": library_id, "relative_path": f"Movie-{i}.mkv",
                    "filename": f"Movie-{i}.mkv", "extension": "mkv", "size_bytes": 1000,
                    "mtime": (now - timedelta(days=2)).timestamp(), "raw_ffprobe_json": payload, "last_analyzed_at": now,
                    "scan_status": ScanStatus.ready,
                } for i in indices])
                db.execute(insert(MediaFormat), [{"media_file_id": i + 1, "duration": 60.0} for i in indices])
                db.execute(insert(VideoStream), [{
                    "media_file_id": i + 1, "stream_index": 0, "codec": "h264", "width": 1280, "height": 720,
                } for i in indices])
                db.execute(insert(MediaFileHistory), [{
                    "library_id": library_id, "media_file_id": i + 1, "relative_path": f"Movie-{i}.mkv",
                    "filename": f"Movie-{i}.mkv", "snapshot_hash": "synthetic",
                    "snapshot": payload, "captured_at": now - timedelta(seconds=items - i),
                    "capture_reason": MediaFileHistoryCaptureReason.scan_analysis,
                } for i in indices])
                db.commit()
        if reconstruct_only:
            with factory() as db:
                resources, result = measure_memory(lambda: reconstruct_history_from_media_files(db))
                assert result.created_file_history_entries == items
                resources["created_file_history_entries"] = result.created_file_history_entries
                assert db.scalar(select(func.count()).select_from(MediaFile)) == items
            engine.dispose()
            return {
                "benchmark": "history_reconstruction_memory", "items": items,
                "payload_bytes_per_row": payload_bytes, "history_reconstruction": resources,
                "environment": environment_metadata(),
            }
        with factory() as db:
            backfill, count = measure_memory(lambda: backfill_filename_pattern_signatures(db))
            db.commit()
            backfill["updated"] = count
            assert count == items
            # Measure the actual upgrade startup separately on pending rows,
            # then a second startup on the already migrated database.
            db.execute(update(MediaFile).values(filename_pattern_signature=None))
            db.commit()
        startup, _ = measure_memory(lambda: init_db(engine))
        repeated_startup, _ = measure_memory(lambda: init_db(engine))
        with factory() as db:
            retention, deleted = measure_memory(lambda: _prune_media_file_history(
                db, days=0, storage_limit_bytes=items * payload_bytes // 2,
            ))
            retention["deleted"] = deleted
            remaining = db.scalars(select(MediaFileHistory.media_file_id).order_by(MediaFileHistory.id)).all()
            assert remaining == list(range(deleted + 1, items + 1))
        with factory() as db:
            quality, job = measure_memory(lambda: run_quality_recompute(db, library_id))
            quality["files_scanned"] = job.files_scanned
            quality["errors"] = job.errors
            assert job.files_scanned == items and job.errors == 0
        with factory() as db:
            history_before = db.scalar(select(func.count()).select_from(MediaFileHistory))
            repeated_quality, job = measure_memory(lambda: run_quality_recompute(db, library_id))
            assert job.files_scanned == items and job.errors == 0
            assert db.scalar(select(func.count()).select_from(MediaFileHistory)) == history_before, "Repeated quality recomputation created duplicate history"
        with factory() as db:
            assert db.scalar(select(func.count()).select_from(MediaFile)) == items
            signatures = db.scalar(select(func.count()).select_from(MediaFile).where(MediaFile.filename_pattern_signature.is_not(None)))
        engine.dispose()
    return {
        "benchmark": "startup_memory", "items": items, "payload_bytes_per_row": payload_bytes,
        "signature_backfill": backfill, "startup": startup, "repeated_startup": repeated_startup,
        "file_history_retention": retention, "quality_recompute": quality,
        "repeated_quality_recompute": repeated_quality,
        "final_signatures": signatures, "remaining_original_history": len(remaining),
        "environment": environment_metadata(),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--items", type=int, default=2000)
    parser.add_argument("--payload-bytes", type=int, default=65536)
    parser.add_argument("--reconstruct-only", action="store_true")
    args = parser.parse_args()
    if args.items < 2 or args.payload_bytes < 1:
        parser.error("--items must be >= 2 and --payload-bytes >= 1")
    print(json.dumps(run_benchmark(args.items, args.payload_bytes, reconstruct_only=args.reconstruct_only), indent=2))
