from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.db.base import Base
from backend.app.models.entities import DuplicateDetectionMode, Library, LibraryType, MediaFile, ScanMode
<<<<<<< HEAD
from backend.app.services.duplicates.service import (
    FileHashDuplicateDetectionStrategy,
    FilenameDuplicateDetectionStrategy,
    get_duplicate_detection_strategy,
    list_duplicate_groups,
    normalize_filename_signature,
)


def test_get_duplicate_detection_strategy_returns_expected_strategy() -> None:
=======
from backend.app.services.duplicates import (
    FileHashDuplicateDetectionStrategy,
    FilenameDuplicateDetectionStrategy,
    get_duplicate_detection_strategy,
    list_library_duplicate_groups,
)


def test_duplicate_strategy_factory_returns_expected_strategy() -> None:
>>>>>>> e346af6e232e30a40b6c1803e7df43a77d8cf6c6
    assert isinstance(get_duplicate_detection_strategy(DuplicateDetectionMode.filename), FilenameDuplicateDetectionStrategy)
    assert isinstance(get_duplicate_detection_strategy(DuplicateDetectionMode.filehash), FileHashDuplicateDetectionStrategy)


<<<<<<< HEAD
def test_normalize_filename_signature_collapses_common_separators() -> None:
    assert normalize_filename_signature(Path("Movie.2024-Remux_final.mkv")) == "movie 2024 remux final"


def test_list_duplicate_groups_uses_hash_mode() -> None:
=======
def test_filename_duplicate_detection_groups_normalized_stems(tmp_path: Path) -> None:
>>>>>>> e346af6e232e30a40b6c1803e7df43a77d8cf6c6
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

<<<<<<< HEAD
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
=======
    library_dir = tmp_path / "library"
    library_dir.mkdir()
    files = [
        library_dir / "Movie.Name_2024 - Final.mkv",
        library_dir / "movie name 2024 final.mp4",
        library_dir / "movie-name.2024__final.avi",
        library_dir / "different-title.mkv",
    ]
    for file_path in files:
        file_path.write_text(file_path.name)

    strategy = get_duplicate_detection_strategy(DuplicateDetectionMode.filename)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(library_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.filename,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for file_path in files:
            media_file = MediaFile(
                library_id=library.id,
                relative_path=file_path.name,
                filename=file_path.name,
                extension=file_path.suffix.lstrip("."),
                size_bytes=file_path.stat().st_size,
                mtime=file_path.stat().st_mtime,
            )
            strategy.apply_payload(media_file, strategy.build_payload(file_path))
            db.add(media_file)

        db.commit()
        groups = list_library_duplicate_groups(db, library.id)

    assert groups.mode == DuplicateDetectionMode.filename
    assert groups.total_groups == 1
    assert groups.duplicate_file_count == 3
    assert groups.items[0].signature == "movie name 2024 final"
    assert groups.items[0].file_count == 3
    assert [item.filename for item in groups.items[0].items] == [
        "Movie.Name_2024 - Final.mkv",
        "movie name 2024 final.mp4",
        "movie-name.2024__final.avi",
    ]


def test_filehash_duplicate_detection_groups_only_exact_content_duplicates(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    library_dir = tmp_path / "library"
    library_dir.mkdir()
    exact_a = library_dir / "exact-a.mkv"
    exact_b = library_dir / "exact-b.mp4"
    similar_name = library_dir / "exact-a-copy.mkv"
    exact_a.write_text("same-content")
    exact_b.write_text("same-content")
    similar_name.write_text("different-content")

    strategy = get_duplicate_detection_strategy(DuplicateDetectionMode.filehash)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(library_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.filehash,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for file_path in (exact_a, exact_b, similar_name):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=file_path.name,
                filename=file_path.name,
                extension=file_path.suffix.lstrip("."),
                size_bytes=file_path.stat().st_size,
                mtime=file_path.stat().st_mtime,
            )
            strategy.apply_payload(media_file, strategy.build_payload(file_path))
            db.add(media_file)

        db.commit()
        groups = list_library_duplicate_groups(db, library.id)

    assert groups.mode == DuplicateDetectionMode.filehash
    assert groups.total_groups == 1
    assert groups.duplicate_file_count == 2
    assert groups.items[0].file_count == 2
    assert {item.filename for item in groups.items[0].items} == {"exact-a.mkv", "exact-b.mp4"}
>>>>>>> e346af6e232e30a40b6c1803e7df43a77d8cf6c6
