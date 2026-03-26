from pathlib import Path

import pytest

from backend.app.utils.pathing import ensure_relative_to_root, relative_display_path


def test_relative_display_path_uses_dot_for_root(tmp_path: Path) -> None:
    assert relative_display_path(tmp_path, tmp_path) == "."


def test_ensure_relative_to_root_rejects_parent_escape(tmp_path: Path) -> None:
    outsider = tmp_path.parent
    with pytest.raises(ValueError):
        ensure_relative_to_root(outsider, tmp_path)


def test_ensure_relative_to_root_converts_symlink_loops_to_value_error(tmp_path: Path, monkeypatch) -> None:
    snapshot = tmp_path / "#snapshot"
    original_resolve = Path.resolve

    def fake_resolve(self: Path, *args, **kwargs) -> Path:
        if self == snapshot:
            raise RuntimeError(f"Symlink loop from {self!r}")
        return original_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", fake_resolve)

    with pytest.raises(ValueError, match="Invalid path under MEDIA_ROOT"):
        ensure_relative_to_root(snapshot, tmp_path)


def test_relative_display_path_converts_symlink_loops_to_value_error(tmp_path: Path, monkeypatch) -> None:
    snapshot = tmp_path / "#snapshot"
    original_resolve = Path.resolve

    def fake_resolve(self: Path, *args, **kwargs) -> Path:
        if self == snapshot:
            raise RuntimeError(f"Symlink loop from {self!r}")
        return original_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", fake_resolve)

    with pytest.raises(ValueError, match="Invalid path under MEDIA_ROOT"):
        relative_display_path(snapshot, tmp_path)
