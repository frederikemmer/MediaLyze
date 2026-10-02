from __future__ import annotations

import os
import subprocess
from typing import Any


def get_hidden_subprocess_kwargs() -> dict[str, Any]:
    """Keep console-based helper processes invisible on Windows."""

    if os.name != "nt":
        return {}

    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = subprocess.SW_HIDE
    return {
        "creationflags": subprocess.CREATE_NO_WINDOW,
        "startupinfo": startupinfo,
    }


def lower_background_process_priority(process) -> None:
    """Lower only the executing FFmpeg process, without unsafe fork hooks."""
    import psutil

    try:
        target = psutil.Process(process.pid)
        if os.name == "nt":
            if target.nice() not in {psutil.IDLE_PRIORITY_CLASS, psutil.BELOW_NORMAL_PRIORITY_CLASS}:
                target.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
        else:
            target.nice(max(10, target.nice()))
    except (AttributeError, OSError, psutil.Error):
        # Restricted containers and short-lived processes may not permit it.
        # Priority is best effort; it must never fail an otherwise valid job.
        pass
