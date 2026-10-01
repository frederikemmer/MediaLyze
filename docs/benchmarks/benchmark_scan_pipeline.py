"""Benchmark discovery and incremental/full scans without invoking real ffprobe."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from time import perf_counter
from unittest.mock import patch

from _support import create_benchmark_database, environment_metadata, measure_memory
from sqlalchemy import func, select

from backend.app.core.config import Settings
from backend.app.models.entities import Library, LibraryType, MediaFile, ScanMode
from backend.app.services import scanner

PROBE_FIXTURE = {
    "format": {
        "format_name": "matroska",
        "duration": "60.0",
        "bit_rate": "1000000",
        "probe_score": 100,
    },
    "streams": [
        {
            "index": 0,
            "codec_type": "video",
            "codec_name": "h264",
            "width": 1280,
            "height": 720,
            "avg_frame_rate": "24/1",
        }
    ],
}


def _relative_path(index: int) -> Path:
    return Path(f"collection-{index // 250:04}") / f"Movie-{index:08}.mkv"


def _write_initial_media(root: Path, item_count: int) -> list[Path]:
    paths = []
    for index in range(item_count):
        path = root / _relative_path(index)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x" * (1_024 + index % 31))
        paths.append(path)
    return paths


def _scan(factory, settings: Settings, library_id: int, scan_type: str) -> dict:
    with factory() as db:
        resources, job = measure_memory(lambda: scanner.run_scan(db, settings, library_id, scan_type))
        if job.errors:
            raise RuntimeError(f"Synthetic {scan_type} scan reported {job.errors} errors")
        changes = (job.scan_summary or {}).get("changes", {})
        return {
            **resources,
            "discovered_files": job.discovered_files,
            "files_scanned": job.files_scanned,
            "unchanged_files": job.unchanged_files,
            "new_files": changes.get("new_files", {}).get("count", 0),
            "modified_files": changes.get("modified_files", {}).get("count", 0),
            "deleted_files": changes.get("deleted_files", {}).get("count", 0),
            "status": getattr(job.status, "value", job.status),
        }


def run_benchmark(item_count: int) -> dict:
    with tempfile.TemporaryDirectory(prefix="medialyze-scan-benchmark-") as directory:
        temp_root = Path(directory)
        media_root = temp_root / "media"
        media_root.mkdir()
        fixture_started = perf_counter()
        original_paths = _write_initial_media(media_root, item_count)
        fixture_creation_seconds = perf_counter() - fixture_started

        engine, factory = create_benchmark_database(temp_root / "benchmark.sqlite3")
        with factory() as db:
            library = Library(
                name="Scan benchmark",
                path=str(media_root),
                type=LibraryType.movies,
                scan_mode=ScanMode.manual,
                scan_config={},
            )
            db.add(library)
            db.commit()
            settings = Settings(
                config_path=temp_root / "config",
                media_root=media_root,
                ffprobe_path="benchmark-stub",
            )

            library_id = library.id

        with patch("backend.app.services.scanner.run_ffprobe", return_value=PROBE_FIXTURE):
            initial_scan = _scan(factory, settings, library_id, "incremental")
            unchanged_scan = _scan(factory, settings, library_id, "incremental")

            change_count = min(max(1, item_count // 100), max(1, item_count // 3))
            change_started = perf_counter()
            for index in range(change_count):
                path = original_paths[index]
                previous_mtime = path.stat().st_mtime
                path.write_bytes(b"modified" * (150 + index % 11))
                os.utime(path, (previous_mtime + 5, previous_mtime + 5))

            for index in range(change_count):
                path = media_root / "new-imports" / f"Imported-{index:08}.mkv"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"new-import" * (120 + index % 13))

            deleted_paths = original_paths[-change_count:]
            for path in deleted_paths:
                path.unlink()
            change_fixture_seconds = perf_counter() - change_started
            mixed_incremental_scan = _scan(factory, settings, library_id, "incremental")
            full_scan = _scan(factory, settings, library_id, "full")

        with factory() as db:
            final_media_count = int(
                db.scalar(
                    select(func.count())
                    .select_from(MediaFile)
                    .where(MediaFile.library_id == library_id)
                )
                or 0
            )
        engine.dispose()

    if initial_scan["new_files"] != item_count:
        raise RuntimeError("Initial scan did not discover the complete synthetic catalog")
    if mixed_incremental_scan["new_files"] != change_count:
        raise RuntimeError("Incremental scan did not detect the synthetic additions")
    if mixed_incremental_scan["modified_files"] != change_count:
        raise RuntimeError("Incremental scan did not detect the synthetic modifications")
    if mixed_incremental_scan["deleted_files"] != change_count:
        raise RuntimeError("Incremental scan did not detect the synthetic deletions")

    return {
        "benchmark": "scan_pipeline",
        "synthetic_items": item_count,
        "changed_items_per_kind": change_count,
        "fixture_creation_seconds": round(fixture_creation_seconds, 4),
        "change_fixture_seconds": round(change_fixture_seconds, 4),
        "initial_incremental_scan": initial_scan,
        "unchanged_incremental_scan": unchanged_scan,
        "mixed_incremental_scan": mixed_incremental_scan,
        "full_reanalysis_scan": full_scan,
        "final_media_files": final_media_count,
        "ffprobe": "stubbed with a fixed synthetic payload",
        "environment": environment_metadata(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--items", type=int, default=2_000)
    args = parser.parse_args()
    if args.items < 3:
        parser.error("--items must be at least 3")
    print(json.dumps(run_benchmark(args.items), indent=2))


if __name__ == "__main__":
    main()
