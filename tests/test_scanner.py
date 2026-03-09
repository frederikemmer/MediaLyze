import os
import tempfile
from pathlib import Path

os.environ.setdefault("CONFIG_PATH", tempfile.mkdtemp(prefix="medialyze-config-"))
os.environ.setdefault("MEDIA_ROOT", tempfile.mkdtemp(prefix="medialyze-media-"))

from backend.app.services.scanner import _iter_media_files


def test_iter_media_files_skips_symlink_directories(tmp_path: Path) -> None:
    media_dir = tmp_path / "mixed-root"
    media_dir.mkdir()
    nested_dir = media_dir / "movies"
    nested_dir.mkdir()
    (nested_dir / "movie.mkv").write_text("video")
    (media_dir / "ignore.txt").write_text("text")

    loop_link = media_dir / "loop"
    try:
        loop_link.symlink_to(media_dir, target_is_directory=True)
    except OSError:
        # Symlink creation may be unavailable on some environments.
        pass

    files = _iter_media_files(media_dir, (".mkv", ".mp4"))

    assert files == [nested_dir / "movie.mkv"]
