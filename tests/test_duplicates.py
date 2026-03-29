from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.db.base import Base
from backend.app.models.entities import DuplicateDetectionMode, Library, LibraryType, MediaFile, ScanMode
from backend.app.services.duplicates.service import (
    FileHashDuplicateDetectionStrategy,
    FilenameDuplicateDetectionStrategy,
    get_duplicate_detection_strategy,
    list_duplicate_groups,
    normalize_filename_signature,
)


def test_get_duplicate_detection_strategy_returns_expected_strategy() -> None:
    assert isinstance(get_duplicate_detection_strategy(DuplicateDetectionMode.filename), FilenameDuplicateDetectionStrategy)
    assert isinstance(get_duplicate_detection_strategy(DuplicateDetectionMode.filehash), FileHashDuplicateDetectionStrategy)


def test_normalize_filename_signature_collapses_common_separators() -> None:
    assert normalize_filename_signature(Path("Movie.2024-Remux_final.mkv")) == "movie 2024 remux final"


def test_list_duplicate_groups_uses_hash_mode() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            duplicate_detection_mode=DuplicateDetectionMode.filehash,
        )
        db.add(library)
        db.flush()
        db.add_all(
            [
                MediaFile(
                    library_id=library.id,
                    relative_path="movie-a.mkv",
                    filename="movie-a.mkv",
                    extension="mkv",
                    size_bytes=100,
                    mtime=1.0,
                    content_hash="samehash",
                    content_hash_algorithm="sha256",
                    filename_signature="movie a",
                ),
                MediaFile(
                    library_id=library.id,
                    relative_path="movie-b.mkv",
                    filename="movie-b.mkv",
                    extension="mkv",
                    size_bytes=100,
                    mtime=2.0,
                    content_hash="samehash",
                    content_hash_algorithm="sha256",
                    filename_signature="movie b",
                ),
                MediaFile(
                    library_id=library.id,
                    relative_path="movie-c.mkv",
                    filename="movie-c.mkv",
                    extension="mkv",
                    size_bytes=100,
                    mtime=3.0,
                    content_hash="otherhash",
                    content_hash_algorithm="sha256",
                    filename_signature="movie c",
                ),
            ]
        )
        db.commit()

        payload = list_duplicate_groups(db, library, offset=0, limit=25)

    assert payload.mode == DuplicateDetectionMode.filehash
    assert payload.total_groups == 1
    assert payload.duplicate_file_count == 2
    assert payload.items[0].signature == "samehash"
    assert [item.relative_path for item in payload.items[0].items] == ["movie-a.mkv", "movie-b.mkv"]
