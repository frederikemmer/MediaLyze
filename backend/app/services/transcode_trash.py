from __future__ import annotations

import logging
import os
import re
import shutil
from pathlib import Path
from threading import Lock
from uuid import uuid4

from backend.app.schemas.app_settings import TranscodingSettingsRead

logger = logging.getLogger(__name__)
trash_lock = Lock()
_ENTRY = re.compile(r"original-[0-9a-f]{32}")


def _storage(config_path: Path) -> Path:
    storage = config_path.resolve() / "transcode-trash"
    if storage.is_symlink():
        raise ValueError("The replacement trash directory must not be a symbolic link")
    return storage


def archive_original(config_path: Path, policy: TranscodingSettingsRead, source: Path) -> Path:
    folder = _storage(config_path) / policy.replacement_trash_directory
    if folder.is_symlink():
        raise ValueError("The configured replacement trash folder must not be a symbolic link")
    folder.mkdir(parents=True, exist_ok=True)
    entry = folder / f".pending-{uuid4().hex}"
    entry.mkdir()
    try:
        try:
            os.link(source, entry / source.name)
        except OSError:
            shutil.copy2(source, entry / source.name)
    except BaseException:
        discard_archive(entry, source.name)
        raise
    return entry


def discard_archive(entry: Path, filename: str) -> None:
    (entry / filename).unlink(missing_ok=True)
    entry.rmdir()


def complete_archive(entry: Path) -> None:
    entry.rename(entry.with_name(entry.name.replace(".pending-", "original-", 1)))


def prune_replacement_trash(config_path: Path, policy: TranscodingSettingsRead) -> None:
    if not policy.replacement_trash_enabled:
        return
    max_files = policy.replacement_trash_max_files
    max_bytes = max(1, int(policy.replacement_trash_max_gib * 1024**3)) if policy.replacement_trash_max_gib else 0
    if not max_files and not max_bytes:
        return
    try:
        with trash_lock:
            storage = _storage(config_path)
            if not storage.is_dir():
                return
            entries = []
            for folder in storage.iterdir():
                if folder.is_symlink() or not folder.is_dir():
                    continue
                for entry in folder.iterdir():
                    if not _ENTRY.fullmatch(entry.name) or entry.is_symlink() or not entry.is_dir():
                        continue
                    files = list(entry.iterdir())
                    if len(files) == 1 and not files[0].is_symlink() and files[0].is_file():
                        entries.append((entry.stat().st_mtime_ns, entry, files[0], files[0].stat().st_size))
            total_remaining = sum(size for _, _, _, size in entries)
            count_remaining = len(entries)
            for _, entry, file, size in sorted(entries):
                if (not max_files or count_remaining <= max_files) and (not max_bytes or total_remaining <= max_bytes):
                    break
                file.unlink()
                entry.rmdir()
                total_remaining -= size
                count_remaining -= 1
    except (OSError, ValueError):
        logger.exception("Unable to prune the transcoding replacement trash")
