"""Reproducible service benchmarks; run this same script in both source trees.

Synthetic catalog, production indexes, WAL/NORMAL, same-host sequential runs.
Cache misses invalidate application caches, not the OS page cache. Python peak
allocations exclude fixture creation and are measured separately from timings.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
import sys
from pathlib import Path

from _support import create_benchmark_database, environment_metadata, measure_memory, measure_repeated
from benchmark_library_statistics import DEFAULT_PANELS, _seed_catalog
from sqlalchemy import insert
from backend.app.db.session import SQLITE_INDEX_STATEMENTS
from backend.app.models.entities import Library, LibraryType, MediaFile, TranscodeVariantGroup, TranscodeJob, JobStatus
from backend.app.services.library_service import get_library_statistics
from backend.app.services.storage_map import get_library_storage_map
from backend.app.services.stat_comparisons import get_library_comparison
from backend.app.services.stats_cache import stats_cache
from backend.app.services.transcoding import list_transcode_jobs


def digest(payload):
    return hashlib.sha256(payload.encode()).hexdigest()


def run(items, repeats):
    result = {"items": items, "repeats": repeats, "environment": environment_metadata(), "cases": {}}
    with tempfile.TemporaryDirectory(prefix="medialyze-performance-") as folder:
        engine, factory = create_benchmark_database(Path(folder) / "catalog.sqlite3")
        with engine.begin() as connection:
            for statement in SQLITE_INDEX_STATEMENTS:
                connection.exec_driver_sql(statement)
        with factory() as db:
            library = Library(name="benchmark", path="/synthetic", type=LibraryType.movies)
            db.add(library)
            db.commit()
            _seed_catalog(db, library.id, items, 1000)
            key = str(id(engine))
            statistics_query = lambda: get_library_statistics(db, library.id, requested_panels=DEFAULT_PANELS.split(","))
            cases = {
                "statistics": statistics_query,
                "storage_map_root": lambda: get_library_storage_map(db, library.id),
                "size_duration_heatmap": lambda: get_library_comparison(db, library_id=library.id, x_field="size", y_field="duration", renderer="heatmap"),
                "size_duration_scatter": lambda: get_library_comparison(db, library_id=library.id, x_field="size", y_field="duration", renderer="scatter"),
            }
            for name, query in cases.items():
                print(name, file=sys.stderr, flush=True)
                def cold_query():
                    stats_cache.invalidate(key, library.id)
                    return query().model_dump_json()
                timing, payload = measure_repeated(cold_query, repeats)
                memory, memory_payload = measure_memory(cold_query)
                warm, warm_payload = measure_repeated(lambda: query().model_dump_json(), repeats)
                assert payload == memory_payload == warm_payload
                result["cases"][name] = {"miss": timing, "hit": warm, "memory": memory, "response_bytes": len(payload.encode()), "response_sha256": digest(payload)}
            statistics_query()
            invalidate = getattr(stats_cache, "invalidate_connectors", stats_cache.invalidate)
            def connector_refresh():
                invalidate(key)
                return statistics_query().model_dump_json()
            timing, payload = measure_repeated(connector_refresh, repeats)
            result["cases"]["statistics_after_connector_change"] = {"timing": timing, "response_sha256": digest(payload)}
        engine.dispose()
        engine, factory = create_benchmark_database(Path(folder) / "jobs.sqlite3")
        with factory() as db:
            db.add(Library(id=1, name="benchmark", path="/tmp/media", type=LibraryType.movies))
            db.commit()
            db.execute(insert(MediaFile), [dict(id=i, library_id=1, filename=f"{i}.mkv", relative_path=f"{i}.mkv", extension="mkv", size_bytes=1000, mtime=1, raw_ffprobe_json={"padding": "x" * 65536}, primary_video_codec="h264", primary_video_hdr_type="SDR") for i in range(1, 201)])
            db.add(TranscodeVariantGroup(id=1, library_id=1, original_relative_path="1.mkv", original_filename="1.mkv"))
            db.commit()
            db.execute(insert(TranscodeJob), [dict(group_id=1, library_id=1, source_file_id=i, status=JobStatus.completed, profile="test", source_path_snapshot=f"/tmp/media/{i}.mkv", source_size_snapshot=1000, source_mtime_snapshot=1, output_path_snapshot=f"/tmp/output/{i}.mp4", output_relative_path=f"{i}.mp4") for i in range(1, 201)])
            db.commit()
        def history():
            with factory() as db:
                payload = list_transcode_jobs(db, limit=200).model_dump(mode="json")
                # Database defaults use current timestamps; exclude only those
                # fixture-dependent values from the parity digest.
                for job in payload["items"]:
                    job.pop("created_at", None)
                    job.pop("updated_at", None)
                return json.dumps(payload, sort_keys=True, separators=(",", ":"))
        timing, payload = measure_repeated(history, repeats)
        memory, _ = measure_memory(history)
        result["cases"]["transcode_history_200"] = {"timing": timing, "memory": memory, "response_sha256": digest(payload)}
        engine.dispose()
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--items", type=int, default=100000)
    parser.add_argument("--repeats", type=int, default=3)
    args = parser.parse_args()
    print(json.dumps(run(args.items, args.repeats), indent=2))
