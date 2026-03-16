from pathlib import Path

from backend.app.core.config import Settings
from backend.app.schemas.browse import BrowseEntry, BrowseResponse
from backend.app.utils.pathing import ensure_relative_to_root, relative_display_path


def _is_visible_browse_entry(entry: Path, root: Path) -> bool:
    try:
        ensure_relative_to_root(entry, root)
    except (OSError, ValueError):
        return False

    # Docker can expose nested runtime mounts below MEDIA_ROOT. Hide those so the
    # browser reflects only the configured media tree.
    try:
        return not entry.is_mount()
    except OSError:
        return False


def browse_media_root(settings: Settings, relative_path: str = ".") -> BrowseResponse:
    candidate = settings.media_root / relative_path
    safe_path = ensure_relative_to_root(candidate, settings.media_root)

    entries = [
        BrowseEntry(
            name=entry.name,
            path=relative_display_path(entry, settings.media_root),
            is_dir=entry.is_dir(),
        )
        for entry in sorted(safe_path.iterdir(), key=lambda item: (not item.is_dir(), item.name.lower()))
        if _is_visible_browse_entry(entry, settings.media_root)
    ]

    parent_path = None
    if safe_path != settings.media_root.resolve():
        parent_path = relative_display_path(safe_path.parent, settings.media_root)

    return BrowseResponse(
        current_path=relative_display_path(safe_path, settings.media_root),
        parent_path=parent_path,
        entries=entries,
    )
