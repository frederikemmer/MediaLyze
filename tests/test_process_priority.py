from types import SimpleNamespace
import psutil
import os
import pytest
from backend.app.utils.processes import lower_background_process_priority


@pytest.mark.skipif(os.name == "nt", reason="POSIX nice values")
def test_background_priority_does_not_raise_an_already_lower_priority(monkeypatch):
    calls = []
    class Process:
        def nice(self, value=None):
            if value is None:
                return 15
            calls.append(value)
    monkeypatch.setattr(psutil, "Process", lambda _pid: Process())
    lower_background_process_priority(SimpleNamespace(pid=123))
    assert calls == [15]


def test_priority_permission_failure_does_not_fail_a_transcode(monkeypatch):
    def denied(_pid):
        raise psutil.AccessDenied()
    monkeypatch.setattr(psutil, "Process", denied)
    lower_background_process_priority(SimpleNamespace(pid=123))


@pytest.mark.parametrize("current,expected", [(32, [16384]), (64, []), (16384, [])])
def test_windows_priority_preserves_existing_idle_or_below_normal(monkeypatch, current, expected):
    from backend.app.utils import processes
    calls = []
    class Process:
        def nice(self, value=None):
            if value is None:
                return current
            calls.append(value)
    monkeypatch.setattr(processes, "os", SimpleNamespace(name="nt"))
    monkeypatch.setattr(psutil, "IDLE_PRIORITY_CLASS", 64, raising=False)
    monkeypatch.setattr(psutil, "BELOW_NORMAL_PRIORITY_CLASS", 16384, raising=False)
    monkeypatch.setattr(psutil, "Process", lambda _pid: Process())
    lower_background_process_priority(SimpleNamespace(pid=123))
    assert calls == expected
