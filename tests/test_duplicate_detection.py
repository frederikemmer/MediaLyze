from pathlib import Path

from backend.app.models.entities import DuplicateDetectionMode
from backend.app.services.duplicates.base import DuplicateRecord
from backend.app.services.duplicates.content_hash import FileHashDuplicateStrategy
from backend.app.services.duplicates.filename import FilenameDuplicateStrategy, normalize_duplicate_filename
from backend.app.services.duplicates.service import get_duplicate_strategy


def _record(
    media_file_id: int,
    filename: str,
    *,
    duplicate_filename_key: str | None = None,
    content_hash: str | None = None,
) -> DuplicateRecord:
    return DuplicateRecord(
        media_file_id=media_file_id,
        filename=filename,
        relative_path=filename,
        size_bytes=1,
        duration=None,
        duplicate_filename_key=duplicate_filename_key,
        content_hash=content_hash,
    )


def test_normalize_duplicate_filename_uses_exact_filename_only() -> None:
    assert normalize_duplicate_filename("Movie.Name.1080p.mkv") == "movie.name.1080p.mkv"
    assert normalize_duplicate_filename(Path("/tmp/Movie.Name.1080p.mkv").name) == "movie.name.1080p.mkv"


def test_filename_duplicate_strategy_requires_the_same_filename() -> None:
    strategy = FilenameDuplicateStrategy()
    records = [
        _record(1, "Movie.mkv", duplicate_filename_key=normalize_duplicate_filename("Movie.mkv")),
        _record(2, "movie.mkv", duplicate_filename_key=normalize_duplicate_filename("movie.mkv")),
        _record(3, "Movie Extended.mkv", duplicate_filename_key=normalize_duplicate_filename("Movie Extended.mkv")),
    ]

    groups = strategy.build_groups(records)

    assert len(groups) == 1
    assert groups[0].file_ids == (1, 2)
    assert groups[0].label == "Movie.mkv"


def test_filehash_duplicate_strategy_groups_exact_hash_matches() -> None:
    strategy = FileHashDuplicateStrategy()
    records = [
        _record(1, "alpha.mkv", content_hash="hash-a"),
        _record(2, "beta.mkv", content_hash="hash-a"),
        _record(3, "gamma.mkv", content_hash="hash-b"),
    ]

    groups = strategy.build_groups(records)

    assert len(groups) == 1
    assert groups[0].file_ids == (1, 2)
    assert groups[0].label == "alpha.mkv"


def test_get_duplicate_strategy_uses_filehash_mode() -> None:
    strategy = get_duplicate_strategy(DuplicateDetectionMode.filehash)

    assert strategy.mode == DuplicateDetectionMode.filehash
