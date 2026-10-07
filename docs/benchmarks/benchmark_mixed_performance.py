"""API latency during a real FFmpeg encode, plus optional diagnostics overhead.

Run sequentially in matched Linux containers with --cpuset-cpus=0,1 --cpus=2.
The bounded fixture contains 5,000 synthetic files; every comparison request is
an application-cache miss. Encoding is synthetic CPU work, not a media corpus.
"""
from __future__ import annotations
import argparse
import json
import math
import os
import statistics
import subprocess
import tempfile
import time
from pathlib import Path
from _support import create_benchmark_database, environment_metadata
from benchmark_library_statistics import _seed_catalog
from sqlalchemy import event
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.app.api.routes import router
from backend.app.api.deps import get_db_session
from backend.app.db.session import SQLITE_INDEX_STATEMENTS
from backend.app.models.entities import Library, LibraryType
from backend.app.services.stats_cache import stats_cache
from backend.app.utils import processes


def measure(client, endpoint, invalidate, count=40):
    samples = []
    for _ in range(count):
        invalidate()
        start = time.perf_counter()
        response = client.get(endpoint)
        assert response.status_code == 200, response.text
        samples.append((time.perf_counter() - start) * 1000)
    return {"samples_ms": samples, "median_ms": statistics.median(samples), "p95_ms": sorted(samples)[math.ceil(len(samples) * .95) - 1]}


def run(observed, foreground=False):
    with tempfile.TemporaryDirectory(prefix="medialyze-mixed-") as folder:
        engine, factory = create_benchmark_database(Path(folder) / "catalog.sqlite3")
        with engine.begin() as connection:
            for statement in SQLITE_INDEX_STATEMENTS:
                connection.exec_driver_sql(statement)
        with factory() as db:
            library = Library(name="mixed", path="/synthetic", type=LibraryType.movies)
            db.add(library)
            db.commit()
            _seed_catalog(db, library.id, 5000, 1000)
        app = FastAPI()
        app.include_router(router, prefix="/api")
        def session():
            with factory() as db:
                yield db
        app.dependency_overrides[get_db_session] = session
        metrics = None
        if observed:
            from backend.app.services.performance import PerformanceMiddleware, performance_metrics, install_sql_observations
            performance_metrics.enabled = True
            metrics = performance_metrics
            install_sql_observations(engine)
            app.add_middleware(PerformanceMiddleware)
        client = TestClient(app)
        key = str(id(engine))
        invalidate = lambda: stats_cache.invalidate(key, library.id)
        endpoint = f"/api/libraries/{library.id}/statistics/comparison?x_field=size&y_field=duration&renderer=heatmap"
        # Warm imports, route machinery and SQLite pages before collecting.
        measure(client, endpoint, invalidate, 3)
        no_load = measure(client, endpoint, invalidate)
        process = subprocess.Popen(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-c:v", "libx264", "-preset", "slow", "-threads", "2", "-f", "null", "-"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        priority = getattr(processes, "lower_background_process_priority", None)
        if priority and not foreground:
            priority(process)
        try:
            import psutil
            actual_nice = psutil.Process(process.pid).nice()
            time.sleep(.5)
            assert process.poll() is None, "FFmpeg did not stay running"
            loaded = measure(client, endpoint, invalidate)
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        result = {"environment": environment_metadata(), "observed": observed, "ffmpeg_nice": actual_nice, "idle": no_load, "ffmpeg_load": loaded}
        if metrics:
            result["observations"] = metrics.snapshot()
        client.close()
        engine.dispose()
        return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--observed", action="store_true")
    parser.add_argument("--foreground", action="store_true", help="Isolate the priority change on the current implementation")
    args = parser.parse_args()
    print(json.dumps(run(args.observed, args.foreground), indent=2))
