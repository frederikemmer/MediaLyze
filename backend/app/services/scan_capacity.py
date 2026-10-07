"""Conservative, process-wide admission for media analysis workers."""
from contextlib import contextmanager
from pathlib import Path
from threading import Condition, Event
import sys
from time import monotonic

import psutil

from backend.app.utils.cancellation import WorkCanceled

# Leave headroom for SQLite/API work; reserve room for decoded metadata and a probe.
RESERVE_BYTES = 64 * 1024**2
WORKER_BYTES = 128 * 1024**2
_condition = Condition()
_active = 0
_capacity_checked_at = float("-inf")
_capacity_limit = 1


def available_memory_bytes() -> int:
    available = psutil.virtual_memory().available
    if sys.platform != 'linux':
        return available
    groups = {"v2": "/", "v1": "/"}
    try:
        for line in Path('/proc/self/cgroup').read_text().splitlines():
            hierarchy, controllers, group = line.split(':', 2)
            if hierarchy == '0' and not controllers:
                groups['v2'] = group
            elif 'memory' in controllers.split(','):
                groups['v1'] = group
    except (OSError, ValueError):
        pass
    for root, group, limit_name, usage_name in (
        (Path('/sys/fs/cgroup'), groups['v2'], 'memory.max', 'memory.current'),
        (Path('/sys/fs/cgroup/memory'), groups['v1'], 'memory.limit_in_bytes', 'memory.usage_in_bytes'),
    ):
        directory = root / group.lstrip('/')
        # Check enclosing limits too; cgroup namespaces may expose only the root.
        while directory.is_relative_to(root):
            try:
                limit = int((directory / limit_name).read_text().strip())
                usage = int((directory / usage_name).read_text().strip())
            except (OSError, ValueError):
                pass
            else:
                available = min(available, max(0, limit - usage))
            if directory == root:
                break
            directory = directory.parent
    return available


def memory_worker_limit() -> int:
    # Always permit one worker so a low-memory scan can still make progress.
    return max(1, (available_memory_bytes() - RESERVE_BYTES) // WORKER_BYTES)


@contextmanager
def analysis_slot(cancel_event: Event):
    global _active, _capacity_checked_at, _capacity_limit
    with _condition:
        while True:
            if cancel_event.is_set():
                raise WorkCanceled()
            # Sampling on every short task introduces needless native calls
            # and GIL handoffs; a shared 100 ms sample also bounds poll overhead.
            now = monotonic()
            if now - _capacity_checked_at >= 0.1:
                _capacity_limit = memory_worker_limit()
                _capacity_checked_at = now
            if _active < _capacity_limit:
                _active += 1
                break
            _condition.wait(timeout=0.1)
    try:
        yield
    finally:
        with _condition:
            _active -= 1
            _condition.notify_all()
