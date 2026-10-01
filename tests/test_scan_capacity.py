from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest

from backend.app.services import scan_capacity
from backend.app.utils.cancellation import WorkCanceled


def test_capacity_respects_host_and_nested_cgroup_limits(monkeypatch):
    monkeypatch.setattr(scan_capacity.sys, 'platform', 'linux')
    monkeypatch.setattr(scan_capacity.psutil, 'virtual_memory', lambda: SimpleNamespace(available=4 * 1024**3))
    files = {
        '/proc/self/cgroup': '0::/service\n',
        '/sys/fs/cgroup/memory.max': str(512 * 1024**2),
        '/sys/fs/cgroup/memory.current': str(64 * 1024**2),
        '/sys/fs/cgroup/service/memory.max': str(256 * 1024**2),
        '/sys/fs/cgroup/service/memory.current': str(64 * 1024**2),
    }

    def read(path):
        if str(path) not in files:
            raise FileNotFoundError(str(path))
        return files[str(path)]

    monkeypatch.setattr(scan_capacity.Path, 'read_text', read)
    assert scan_capacity.available_memory_bytes() == 192 * 1024**2
    assert scan_capacity.memory_worker_limit() == 1
    files['/sys/fs/cgroup/service/memory.max'] = 'max'
    assert scan_capacity.available_memory_bytes() == 448 * 1024**2
    assert scan_capacity.memory_worker_limit() == 3


def test_waiting_workers_share_capacity_and_can_cancel(monkeypatch):
    monkeypatch.setattr(scan_capacity, 'memory_worker_limit', lambda: 1)
    monkeypatch.setattr(scan_capacity, '_capacity_checked_at', float('-inf'))
    entered = Event()
    canceled = Event()

    def waiting():
        entered.set()
        with scan_capacity.analysis_slot(canceled):
            pytest.fail('A second scan exceeded process-wide capacity')

    with ThreadPoolExecutor(max_workers=1) as executor:
        with scan_capacity.analysis_slot(Event()):
            future = executor.submit(waiting)
            assert entered.wait(2)
            canceled.set()
            with pytest.raises(WorkCanceled):
                future.result(timeout=2)
        # Cancellation released no unowned slot and the original slot was freed.
        with scan_capacity.analysis_slot(Event()):
            pass
    assert scan_capacity._active == 0
