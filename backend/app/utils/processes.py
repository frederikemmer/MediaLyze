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
