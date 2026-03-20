from pathlib import Path

from backend.app.core.config import Settings
from backend.app.services.path_access import (
    classify_desktop_path_kind,
    inspect_desktop_path,
    resolve_library_path,
)


def test_resolve_library_path_accepts_relative_paths_under_media_root_in_server_mode(tmp_path: Path) -> None:
    media_root = tmp_path / "media"
    library_dir = media_root / "movies"
    library_dir.mkdir(parents=True)
    settings = Settings(config_path=tmp_path / "config", media_root=media_root)

    resolved = resolve_library_path(settings, "movies")

    assert resolved == library_dir.resolve()


def test_resolve_library_path_accepts_absolute_paths_in_desktop_mode(tmp_path: Path) -> None:
    library_dir = tmp_path / "desktop-library"
    library_dir.mkdir()
    settings = Settings(runtime_mode="desktop", config_path=tmp_path / "config")

    resolved = resolve_library_path(settings, str(library_dir))

    assert resolved == library_dir.resolve()


def test_inspect_desktop_path_marks_local_directories_as_watch_supported(tmp_path: Path, monkeypatch) -> None:
    library_dir = tmp_path / "local-library"
    library_dir.mkdir()
    monkeypatch.setattr(
        "backend.app.services.path_access.classify_desktop_path_kind",
        lambda path_value: "local",
    )

    inspection = inspect_desktop_path(str(library_dir))

    assert inspection.exists is True
    assert inspection.is_directory is True
    assert inspection.path_kind == "local"
    assert inspection.watch_supported is True


def test_inspect_desktop_path_marks_network_paths_as_not_watch_supported(tmp_path: Path, monkeypatch) -> None:
    library_dir = tmp_path / "network-library"
    library_dir.mkdir()
    monkeypatch.setattr(
        "backend.app.services.path_access.classify_desktop_path_kind",
        lambda path_value: "network",
    )

    inspection = inspect_desktop_path(str(library_dir))

    assert inspection.path_kind == "network"
    assert inspection.watch_supported is False


def test_classify_desktop_path_kind_recognizes_unc_paths_as_network() -> None:
    assert classify_desktop_path_kind(r"\\server\share\videos") == "network"
