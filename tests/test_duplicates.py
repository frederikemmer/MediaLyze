from pathlib import Path
import pytest

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from backend.app.db.base import Base
from backend.app.models.entities import DuplicateDetectionMode, Library, LibraryType, MediaFile, ScanMode
from backend.app.services.duplicates import (
    CombinedDuplicateDetectionStrategy,
    DisabledDuplicateDetectionStrategy,
    FileHashDuplicateDetectionStrategy,
    FilenameDuplicateDetectionStrategy,
    backfill_filename_pattern_signatures,
    get_duplicate_detection_strategy,
    list_library_duplicate_groups,
    normalize_filename_pattern_signature,
    suppress_duplicate_group,
    unsuppress_duplicate_group,
)
from backend.app.services import duplicates as duplicate_service


def test_signature_backfill_does_not_decode_raw_probe_and_resumes_committed_batches(monkeypatch) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(duplicate_service, "SIGNATURE_BACKFILL_BATCH_SIZE", 2)
    with factory() as db:
        library = Library(name="Movies", path="/synthetic", type=LibraryType.movies)
        db.add(library)
        db.flush()
        for filename in ("---.mkv", "Two.mkv", "Three.mkv", "Four.mkv", "Done.mkv"):
            db.add(MediaFile(library_id=library.id, filename=filename, relative_path=filename,
                             extension="mkv", size_bytes=1, mtime=1,
                             filename_pattern_signature="already done" if filename == "Done.mkv" else None))
        db.commit()
        # Signature migration must work even when unrelated old raw JSON is
        # malformed; loading full ORM records would raise JSONDecodeError.
        db.execute(text("UPDATE media_files SET raw_ffprobe_json = 'invalid JSON'"))
        db.commit()
    normalize = duplicate_service.normalize_filename_pattern_signature

    def interrupted(path, settings):
        if path.name == "Three.mkv":
            raise RuntimeError("interrupted startup")
        return normalize(path, settings)

    monkeypatch.setattr(duplicate_service, "normalize_filename_pattern_signature", interrupted)
    with factory() as db:
        with pytest.raises(RuntimeError, match="interrupted startup"):
            backfill_filename_pattern_signatures(db, commit_batches=True)
        db.rollback()
    with factory() as db:
        assert db.scalars(select(MediaFile.filename_pattern_signature).order_by(MediaFile.id)).all() == [
            "", "two", None, None, "already done",
        ]
    monkeypatch.setattr(duplicate_service, "normalize_filename_pattern_signature", normalize)
    with factory() as db:
        # Empty normalization remains compatible and cannot stall keyset paging.
        assert backfill_filename_pattern_signatures(db, commit_batches=True) == 3
        assert db.scalars(select(MediaFile.filename_pattern_signature).order_by(MediaFile.id)).all() == [
            "", "two", "three", "four", "already done",
        ]
    engine.dispose()


def test_signature_backfill_preserves_callers_transaction() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine, autoflush=False)() as db:
        library = Library(name="Movies", path="/synthetic", type=LibraryType.movies)
        db.add(library)
        db.flush()
        db.add(MediaFile(library_id=library.id, filename="Movie.mkv", relative_path="Movie.mkv",
                         extension="mkv", size_bytes=1, mtime=1))
        db.commit()
        assert backfill_filename_pattern_signatures(db) == 1
        db.rollback()
        assert db.scalar(select(MediaFile.filename_pattern_signature)) is None
    engine.dispose()


def test_duplicate_strategy_factory_returns_expected_strategy() -> None:
    assert isinstance(get_duplicate_detection_strategy(DuplicateDetectionMode.off), DisabledDuplicateDetectionStrategy)
    assert isinstance(get_duplicate_detection_strategy(DuplicateDetectionMode.filename), FilenameDuplicateDetectionStrategy)
    assert isinstance(get_duplicate_detection_strategy(DuplicateDetectionMode.filehash), FileHashDuplicateDetectionStrategy)
    assert isinstance(get_duplicate_detection_strategy(DuplicateDetectionMode.both), CombinedDuplicateDetectionStrategy)


def test_disabled_duplicate_detection_returns_no_groups(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    library_dir = tmp_path / "library"
    library_dir.mkdir()
    duplicate_a = library_dir / "Movie.Name.2024.mkv"
    duplicate_b = library_dir / "movie_name_2024.mp4"
    duplicate_a.write_text("same")
    duplicate_b.write_text("same")

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(library_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.off,
            scan_config={},
        )
        db.add(library)
        db.flush()

        db.add_all(
            [
                MediaFile(
                    library_id=library.id,
                    relative_path=duplicate_a.name,
                    filename=duplicate_a.name,
                    extension=duplicate_a.suffix.lstrip("."),
                    size_bytes=duplicate_a.stat().st_size,
                    mtime=duplicate_a.stat().st_mtime,
                    filename_signature="movie name 2024",
                    content_hash="deadbeef",
                    content_hash_algorithm="sha256",
                ),
                MediaFile(
                    library_id=library.id,
                    relative_path=duplicate_b.name,
                    filename=duplicate_b.name,
                    extension=duplicate_b.suffix.lstrip("."),
                    size_bytes=duplicate_b.stat().st_size,
                    mtime=duplicate_b.stat().st_mtime,
                    filename_signature="movie name 2024",
                    content_hash="deadbeef",
                    content_hash_algorithm="sha256",
                ),
            ]
        )
        db.commit()
        groups = list_library_duplicate_groups(db, library.id)

    assert groups.mode == DuplicateDetectionMode.off
    assert groups.total_groups == 0
    assert groups.duplicate_file_count == 0
    assert groups.items == []


def test_filename_duplicate_detection_groups_normalized_stems(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

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

        for index, file_path in enumerate(files):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=file_path.name,
                filename=file_path.name,
                extension=file_path.suffix.lstrip("."),
                size_bytes=file_path.stat().st_size,
                mtime=file_path.stat().st_mtime,
                duration_seconds=3600 + index,
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


def test_filename_duplicate_detection_groups_release_variants_with_runtime_tolerance(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    library_dir = tmp_path / "library"
    library_dir.mkdir()
    short_name = library_dir / "Atomic Blonde.mp4"
    release_name = library_dir / "Atomic Blonde (2017) [1080p, SDR, h265] [ger, eng, fra, ita, esp].mp4"
    short_name.write_text("short-release")
    release_name.write_text("full-release")

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

        for index, file_path in enumerate((short_name, release_name)):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=file_path.name,
                filename=file_path.name,
                extension=file_path.suffix.lstrip("."),
                size_bytes=file_path.stat().st_size,
                mtime=file_path.stat().st_mtime,
                duration_seconds=3600 + index * 8,
            )
            strategy.apply_payload(media_file, strategy.build_payload(file_path))
            db.add(media_file)

        db.commit()
        groups = list_library_duplicate_groups(db, library.id)

    assert normalize_filename_pattern_signature(short_name) == "atomic blonde"
    assert normalize_filename_pattern_signature(release_name) == "atomic blonde"
    assert groups.total_groups == 1
    assert groups.duplicate_file_count == 2
    assert groups.items[0].signature == "atomic blonde"


def test_filename_duplicate_detection_rejects_runtime_outside_tolerance(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    library_dir = tmp_path / "library"
    library_dir.mkdir()
    files = [library_dir / "Atomic Blonde.mp4", library_dir / "Atomic Blonde (2017).mp4"]
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

        for duration, file_path in zip((3600, 3611), files):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=file_path.name,
                filename=file_path.name,
                extension=file_path.suffix.lstrip("."),
                size_bytes=file_path.stat().st_size,
                mtime=file_path.stat().st_mtime,
                duration_seconds=duration,
            )
            strategy.apply_payload(media_file, strategy.build_payload(file_path))
            db.add(media_file)

        db.commit()
        groups = list_library_duplicate_groups(db, library.id)

    assert groups.total_groups == 0
    assert groups.duplicate_file_count == 0


def test_backfill_filename_pattern_signatures_migrates_existing_media_files(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    library_dir = tmp_path / "library"
    library_dir.mkdir()
    file_path = library_dir / "Atomic Blonde (2017) [1080p].mp4"
    file_path.write_text("release")

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
        media_file = MediaFile(
            library_id=library.id,
            relative_path=file_path.name,
            filename=file_path.name,
            extension="mp4",
            size_bytes=file_path.stat().st_size,
            mtime=file_path.stat().st_mtime,
            filename_signature="atomic blonde 2017 1080p",
        )
        db.add(media_file)
        db.commit()

        assert backfill_filename_pattern_signatures(db) == 1
        db.commit()
        db.refresh(media_file)
        assert media_file.filename_pattern_signature == "atomic blonde"
        assert backfill_filename_pattern_signatures(db) == 0


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
    assert groups.items[0].mode == DuplicateDetectionMode.filehash
    assert {item.filename for item in groups.items[0].items} == {"exact-a.mkv", "exact-b.mp4"}


def test_combined_duplicate_detection_groups_include_filename_and_filehash_matches(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    library_dir = tmp_path / "library"
    library_dir.mkdir()
    filename_a = library_dir / "Movie.Name.2024.mkv"
    filename_b = library_dir / "movie_name_2024.mp4"
    hash_a = library_dir / "hash-a.mkv"
    hash_b = library_dir / "totally-different-name.mp4"
    filename_a.write_text("cut-a")
    filename_b.write_text("cut-b")
    hash_a.write_text("same-content")
    hash_b.write_text("same-content")

    strategy = get_duplicate_detection_strategy(DuplicateDetectionMode.both)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(library_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.both,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for file_path in (filename_a, filename_b, hash_a, hash_b):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=file_path.name,
                filename=file_path.name,
                extension=file_path.suffix.lstrip("."),
                size_bytes=file_path.stat().st_size,
                mtime=file_path.stat().st_mtime,
                duration_seconds=3600 if file_path in (filename_a, filename_b) else None,
            )
            strategy.apply_payload(media_file, strategy.build_payload(file_path))
            db.add(media_file)

        db.commit()
        groups = list_library_duplicate_groups(db, library.id)

    assert groups.mode == DuplicateDetectionMode.both
    assert groups.total_groups == 2
    assert groups.duplicate_file_count == 4
    assert [group.mode for group in groups.items] == [
        DuplicateDetectionMode.filehash,
        DuplicateDetectionMode.filename,
    ]
    assert groups.items[0].label == "hash-a.mkv"
    assert groups.items[0].signature != groups.items[1].signature
    assert groups.items[1].signature == "movie name 2024"
    assert {item.filename for item in groups.items[0].items} == {"hash-a.mkv", "totally-different-name.mp4"}
    assert {item.filename for item in groups.items[1].items} == {"Movie.Name.2024.mkv", "movie_name_2024.mp4"}


def test_duplicate_suppression_hides_and_restores_filename_groups(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    library_dir = tmp_path / "library"
    library_dir.mkdir()
    files = [library_dir / "Movie.Name.2024.mkv", library_dir / "movie_name_2024.mp4"]
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
                duration_seconds=3600,
            )
            strategy.apply_payload(media_file, strategy.build_payload(file_path))
            db.add(media_file)

        db.commit()
        suppression = suppress_duplicate_group(db, library.id, DuplicateDetectionMode.filename, "movie name 2024")
        groups = list_library_duplicate_groups(db, library.id)
        groups_with_suppressed = list_library_duplicate_groups(db, library.id, include_suppressed=True)
        restored = unsuppress_duplicate_group(db, library.id, DuplicateDetectionMode.filename, "movie name 2024")
        restored_groups = list_library_duplicate_groups(db, library.id)

    assert suppression is not None
    assert groups.total_groups == 0
    assert groups.duplicate_file_count == 0
    assert groups.suppressed_group_count == 1
    assert groups.items == []
    assert groups_with_suppressed.total_groups == 0
    assert groups_with_suppressed.duplicate_file_count == 0
    assert groups_with_suppressed.suppressed_group_count == 1
    assert groups_with_suppressed.items[0].suppressed is True
    assert groups_with_suppressed.items[0].signature == "movie name 2024"
    assert restored is True
    assert restored_groups.total_groups == 1
    assert restored_groups.duplicate_file_count == 2
    assert restored_groups.suppressed_group_count == 0


def test_duplicate_suppression_is_mode_specific_for_combined_detection(tmp_path: Path) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    library_dir = tmp_path / "library"
    library_dir.mkdir()
    filename_a = library_dir / "Movie.Name.2024.mkv"
    filename_b = library_dir / "movie_name_2024.mp4"
    hash_a = library_dir / "hash-a.mkv"
    hash_b = library_dir / "totally-different-name.mp4"
    filename_a.write_text("cut-a")
    filename_b.write_text("cut-b")
    hash_a.write_text("same-content")
    hash_b.write_text("same-content")

    strategy = get_duplicate_detection_strategy(DuplicateDetectionMode.both)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path=str(library_dir),
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.both,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for file_path in (filename_a, filename_b, hash_a, hash_b):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=file_path.name,
                filename=file_path.name,
                extension=file_path.suffix.lstrip("."),
                size_bytes=file_path.stat().st_size,
                mtime=file_path.stat().st_mtime,
                duration_seconds=3600 if file_path in (filename_a, filename_b) else None,
            )
            strategy.apply_payload(media_file, strategy.build_payload(file_path))
            db.add(media_file)

        db.commit()
        original = list_library_duplicate_groups(db, library.id)
        filehash_signature = next(group.signature for group in original.items if group.mode == DuplicateDetectionMode.filehash)
        suppress_duplicate_group(db, library.id, DuplicateDetectionMode.filehash, filehash_signature)
        visible = list_library_duplicate_groups(db, library.id)
        with_suppressed = list_library_duplicate_groups(db, library.id, include_suppressed=True)
        suppress_duplicate_group(db, library.id, DuplicateDetectionMode.filehash, filehash_signature)
        idempotent = list_library_duplicate_groups(db, library.id)

    assert visible.total_groups == 1
    assert visible.duplicate_file_count == 2
    assert visible.items[0].mode == DuplicateDetectionMode.filename
    assert visible.items[0].signature == "movie name 2024"
    assert with_suppressed.suppressed_group_count == 1
    assert [group.suppressed for group in with_suppressed.items] == [True, False]
    assert idempotent.suppressed_group_count == 1


def test_file_hash_honors_worker_cancellation(tmp_path):
    from threading import Event
    from backend.app.utils.cancellation import WorkCanceled, cancellation_scope
    from backend.app.services.duplicates import FileHashDuplicateDetectionStrategy
    path = tmp_path / 'file.mkv'
    path.write_bytes(b'x' * 1024)
    event = Event()
    with cancellation_scope(event):
        event.set()
        with pytest.raises(WorkCanceled):
            FileHashDuplicateDetectionStrategy().build_payload(path)
