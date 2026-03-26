from pathlib import Path

from backend.app.core.config import Settings
from backend.app.services.browse import browse_media_root


def test_browse_media_root_hides_container_placeholder_dirs(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "movies").mkdir()
    (tmp_path / "usb").mkdir()

    original_is_mount = Path.is_mount

    def fake_is_mount(self: Path) -> bool:
        if self == tmp_path:
            return False
        return original_is_mount(self)

    monkeypatch.setattr(Path, "is_mount", fake_is_mount)

    response = browse_media_root(Settings(config_path=tmp_path / "config", media_root=tmp_path))

    assert [entry.name for entry in response.entries] == ["movies"]


def test_browse_media_root_keeps_explicit_mounts_visible(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "movies").mkdir()
    (tmp_path / "disk1").mkdir()

    original_is_mount = Path.is_mount

    def fake_is_mount(self: Path) -> bool:
        if self == tmp_path / "disk1":
            return True
        if self == tmp_path:
            return False
        return original_is_mount(self)

    monkeypatch.setattr(Path, "is_mount", fake_is_mount)

    response = browse_media_root(Settings(config_path=tmp_path / "config", media_root=tmp_path))

    assert [entry.name for entry in response.entries] == ["disk1", "movies"]


def test_browse_media_root_skips_symlinks_outside_media_root(tmp_path: Path) -> None:
    outside = tmp_path.parent / "external-library"
    outside.mkdir(exist_ok=True)
    (tmp_path / "movies").mkdir()
    (tmp_path / "external").symlink_to(outside, target_is_directory=True)

    response = browse_media_root(Settings(config_path=tmp_path / "config", media_root=tmp_path))

    assert [entry.name for entry in response.entries] == ["movies"]


def test_browse_media_root_skips_snapshot_symlink_loops(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "movies").mkdir()
    snapshot = tmp_path / "#snapshot"
    snapshot.mkdir()
    original_resolve = Path.resolve

    def fake_resolve(self: Path, *args, **kwargs) -> Path:
        if self == snapshot:
            raise RuntimeError(f"Symlink loop from {self!r}")
        return original_resolve(self, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", fake_resolve)

    response = browse_media_root(Settings(config_path=tmp_path / "config", media_root=tmp_path))

    assert [entry.name for entry in response.entries] == ["movies"]
