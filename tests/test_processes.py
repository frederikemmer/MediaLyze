import os
import subprocess

from backend.app.utils.processes import get_hidden_subprocess_kwargs


def test_hidden_subprocess_kwargs_are_empty_off_windows(monkeypatch) -> None:
    monkeypatch.setattr(os, "name", "posix")

    assert get_hidden_subprocess_kwargs() == {}


def test_hidden_subprocess_kwargs_hide_console_processes_on_windows() -> None:
    if os.name != "nt":
        return

    kwargs = get_hidden_subprocess_kwargs()
    startupinfo = kwargs["startupinfo"]

    assert kwargs["creationflags"] == subprocess.CREATE_NO_WINDOW
    assert startupinfo.dwFlags & subprocess.STARTF_USESHOWWINDOW
    assert startupinfo.wShowWindow == subprocess.SW_HIDE
