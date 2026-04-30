from __future__ import annotations

import ctypes
import os
from collections.abc import Sequence
from pathlib import Path, PureWindowsPath
import re

import psutil

from backend.app.core.config import Settings, RuntimeMode
from backend.app.schemas.path_access import PathInspectResponse
from backend.app.utils.pathing import ensure_relative_to_root

_REMOTE_FS_TYPES = frozenset(
    {
        "9p",
        "afpfs",
        "cifs",
        "davfs",
        "davfs2",
        "fuse.sshfs",
        "nfs",
        "nfs4",
        "smbfs",
        "sshfs",
        "webdav",
    }
)
_URI_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*://")
_WINDOWS_DRIVE_RE = re.compile(r"^[a-zA-Z]:[\\/]")


def _looks_like_uri(path_value: str) -> bool:
    return bool(_URI_SCHEME_RE.match(path_value.strip()))


def _looks_like_windows_unc_path(path_value: str) -> bool:
    normalized = path_value.strip()
    return normalized.startswith("\\\\") or normalized.startswith("//")


def _looks_like_windows_drive_path(path_value: str) -> bool:
    return bool(_WINDOWS_DRIVE_RE.match(path_value.strip()))


def _is_absolute_desktop_path(path_value: str) -> bool:
    normalized = path_value.strip()
    if _looks_like_windows_unc_path(normalized) or _looks_like_windows_drive_path(normalized):
        return True
    return Path(normalized).expanduser().is_absolute()


def _normalize_existing_path(path_value: str) -> str:
    return str(Path(path_value).expanduser().resolve(strict=False))


def _normalize_compare_path(path_value: str) -> str:
    normalized = path_value.replace("\\", "/").rstrip("/")
    return normalized or "/"


def _best_partition_for_path(path: Path):
    target = _normalize_compare_path(str(path.resolve(strict=False)))
    best_partition = None
    best_length = -1
    for partition in psutil.disk_partitions(all=True):
        mountpoint = _normalize_compare_path(partition.mountpoint)
        if target == mountpoint or target.startswith(f"{mountpoint}/"):
            if len(mountpoint) > best_length:
                best_partition = partition
                best_length = len(mountpoint)
    return best_partition


def _windows_drive_type(root_path: str) -> int | None:
    if os.name != "nt":
        return None
    try:
        return int(ctypes.windll.kernel32.GetDriveTypeW(root_path))
    except (AttributeError, OSError, ValueError):
        return None


def classify_desktop_path_kind(path_value: str) -> str:
    normalized = path_value.strip()
    if not normalized:
        return "unknown"

    if _looks_like_windows_unc_path(normalized):
        return "network"

    if os.name == "nt":
        drive = PureWindowsPath(normalized).drive
        if drive:
            drive_type = _windows_drive_type(f"{drive}\\")
            if drive_type == 4:
                return "network"
            if drive_type in {2, 3, 5, 6}:
                return "local"
        return "unknown"

    path = Path(normalized).expanduser()
    partition = _best_partition_for_path(path)
    if partition is None:
        return "unknown"

    fstype = (partition.fstype or "").lower()
    opts = (partition.opts or "").lower()
    if fstype in _REMOTE_FS_TYPES or "remote" in opts or "network" in opts:
        return "network"
    return "local"


def inspect_desktop_path(path_value: str) -> PathInspectResponse:
    candidate = path_value.strip()
    if not candidate:
        raise ValueError("Path must not be empty")
    if _looks_like_uri(candidate):
        raise ValueError("Only filesystem paths are supported")
    if not _is_absolute_desktop_path(candidate):
        raise ValueError("Desktop library paths must be absolute")

    normalized_path = candidate if _looks_like_windows_unc_path(candidate) else _normalize_existing_path(candidate)
    path_kind = classify_desktop_path_kind(normalized_path)
    current_path = Path(normalized_path)

    exists = current_path.exists()
    is_directory = current_path.is_dir()
    watch_supported = path_kind == "local"

    return PathInspectResponse(
        normalized_path=normalized_path,
        exists=exists,
        is_directory=is_directory,
        path_kind=path_kind,
        watch_supported=watch_supported,
    )


def resolve_library_path(settings: Settings, path_value: str) -> Path:
    if settings.runtime_mode == RuntimeMode.desktop:
        inspection = inspect_desktop_path(path_value)
        if not inspection.exists or not inspection.is_directory:
            raise ValueError("Library path must exist as a directory")
        return Path(inspection.normalized_path)

    safe_path = ensure_relative_to_root(settings.media_root / path_value, settings.media_root)
    if not safe_path.exists() or not safe_path.is_dir():
        raise ValueError("Library path must exist as a directory under MEDIA_ROOT")
    return safe_path


def resolve_library_paths(settings: Settings, path_values: Sequence[str]) -> tuple[Path, list[str]]:
    resolved_paths: list[Path] = []
    seen_paths: set[str] = set()

    for raw_value in path_values:
        candidate = str(raw_value or "").strip()
        if not candidate:
            continue
        resolved = resolve_library_path(settings, candidate)
        normalized = str(resolved)
        if normalized in seen_paths:
            continue
        resolved_paths.append(resolved)
        seen_paths.add(normalized)

    if not resolved_paths:
        raise ValueError("At least one library path must be selected")

    for index, path in enumerate(resolved_paths):
        for other in resolved_paths[index + 1 :]:
            if path == other or path in other.parents or other in path.parents:
                raise ValueError("Selected library paths must not overlap")

    if len(resolved_paths) == 1:
        return resolved_paths[0], []

    try:
        root_path = Path(os.path.commonpath([str(path) for path in resolved_paths]))
    except ValueError as exc:
        raise ValueError("Selected library paths must share a common parent directory") from exc

    selected_paths = [path.relative_to(root_path).as_posix() for path in resolved_paths]
    return root_path, selected_paths


def is_watch_supported_for_library(settings: Settings, path_value: str) -> bool:
    if settings.runtime_mode != RuntimeMode.desktop:
        return True

    try:
        return inspect_desktop_path(path_value).watch_supported
    except ValueError:
        return False
