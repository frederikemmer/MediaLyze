"""Shared helpers for standalone MediaLyze performance benchmarks."""

from __future__ import annotations

import platform
import gc
import os
import sqlite3
import statistics
import sys
import tracemalloc
import tempfile
from collections.abc import Callable
from pathlib import Path
from time import perf_counter

from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL, Engine
from sqlalchemy.orm import sessionmaker

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

# Service imports construct default settings. Keep benchmark runtime paths
# temporary instead of depending on container-only /config and /media paths.
_runtime_directory = tempfile.TemporaryDirectory(prefix="medialyze-benchmark-runtime-")
os.environ.setdefault("CONFIG_PATH", str(Path(_runtime_directory.name) / "config"))
os.environ.setdefault("MEDIA_ROOT", str(Path(_runtime_directory.name) / "media"))

from backend.app.db.base import Base


def create_benchmark_database(database_path: Path) -> tuple[Engine, sessionmaker]:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(URL.create("sqlite", database=str(database_path)))

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(connection, _record) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    return engine, factory


def batch_ranges(item_count: int, batch_size: int):
    for start in range(0, item_count, batch_size):
        yield start, min(start + batch_size, item_count)


def measure_repeated[ResultT](action: Callable[[], ResultT], repeats: int) -> tuple[dict, ResultT]:
    samples: list[float] = []
    result: ResultT | None = None
    for _ in range(repeats):
        started = perf_counter()
        result = action()
        samples.append(perf_counter() - started)

    summary = {
        "samples_seconds": [round(sample, 6) for sample in samples],
        "median_seconds": round(statistics.median(samples), 6),
        "min_seconds": round(min(samples), 6),
        "max_seconds": round(max(samples), 6),
    }
    return summary, result  # type: ignore[return-value]


def environment_metadata() -> dict[str, str]:
    return {
        "python": platform.python_version(),
        "sqlite": sqlite3.sqlite_version,
        "platform": platform.platform(),
    }


def measure_memory(action: Callable) -> tuple[dict, object]:
    """Measure Python allocations during work, excluding fixture construction."""
    gc.collect()
    tracemalloc.start()
    started = perf_counter()
    try:
        result = action()
        elapsed = perf_counter() - started
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    return {"elapsed_seconds": round(elapsed, 4), "peak_python_mib": round(peak / 1024**2, 3)}, result
