from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.db.base import Base
from backend.app.models.entities import AudioStream, Library, LibraryType, MediaFile, MediaFormat, ScanMode, ScanStatus, VideoStream
from backend.app.services import stat_comparisons
from backend.app.services.stat_comparisons import get_dashboard_comparison, get_library_comparison
from backend.app.services.stats_cache import stats_cache


def _session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def test_dashboard_comparison_includes_heatmap_scatter_and_bar() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        library = Library(
            name="Comparison",
            path="/tmp/comparison-dashboard",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        first_file = MediaFile(
            library_id=library.id,
            relative_path="movie-one.mkv",
            filename="movie-one.mkv",
            extension="mkv",
            size_bytes=4_000_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=7,
        )
        second_file = MediaFile(
            library_id=library.id,
            relative_path="movie-two.mkv",
            filename="movie-two.mkv",
            extension="mkv",
            size_bytes=8_000_000_000,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=9,
        )
        db.add_all([first_file, second_file])
        db.flush()
        first_file_id = first_file.id
        db.add(MediaFormat(media_file_id=first_file.id, duration=3600.0))
        db.add(MediaFormat(media_file_id=second_file.id, duration=4000.0))
        db.commit()

        payload = get_dashboard_comparison(db, x_field="duration", y_field="size")

    assert payload.available_renderers == ["heatmap", "scatter", "bar"]
    assert payload.total_files == 2
    assert payload.included_files == 2
    assert payload.excluded_files == 0
    assert sum(cell.count for cell in payload.heatmap_cells) == 2
    assert payload.scatter_points is not None
    assert len(payload.scatter_points) == 2
    assert payload.scatter_points[0].media_file_id == first_file_id
    assert payload.bar_entries is not None
    assert len(payload.bar_entries) == 1
    assert payload.bar_entries[0].value == 6_000_000_000


def test_library_comparison_uses_resolution_categories_for_resolution_axis() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        library = Library(
            name="Resolution",
            path="/tmp/comparison-resolution",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="movie.mkv",
            filename="movie.mkv",
            extension="mkv",
            size_bytes=6_000_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
        )
        db.add(media_file)
        db.flush()
        db.add(VideoStream(media_file_id=media_file.id, stream_index=0, codec="hevc", width=3840, height=1606, hdr_type="HDR10"))
        db.commit()

        payload = get_library_comparison(db, library_id=library.id, x_field="resolution", y_field="container")

    assert payload is not None
    assert payload.available_renderers == ["heatmap"]
    assert payload.x_buckets[0].key == "4k"
    assert payload.x_buckets[0].label == "4k"
    assert payload.y_buckets[0].key == "mkv"
    assert payload.heatmap_cells[0].count == 1


def test_dashboard_comparison_marks_scatter_payload_as_sampled(monkeypatch) -> None:
    session_factory = _session_factory()
    monkeypatch.setattr(stat_comparisons, "COMPARISON_SAMPLE_LIMIT", 3)

    with session_factory() as db:
        library = Library(
            name="Sampling",
            path="/tmp/comparison-sampling",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for index in range(5):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=f"movie-{index}.mkv",
                filename=f"movie-{index}.mkv",
                extension="mkv",
                size_bytes=1_000_000_000 * (index + 1),
                mtime=float(index + 1),
                scan_status=ScanStatus.ready,
                quality_score=5,
            )
            db.add(media_file)
            db.flush()
            db.add(MediaFormat(media_file_id=media_file.id, duration=1800.0 * (index + 1)))
        db.commit()

        payload = get_dashboard_comparison(db, x_field="duration", y_field="size")

    assert payload.sampled_points is True
    assert payload.sample_limit == 3
    assert payload.scatter_points is not None
    assert len(payload.scatter_points) == 3


def test_stats_cache_invalidation_clears_dashboard_comparison_payloads() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        cache_key = str(id(db.get_bind()))
        library = Library(
            name="Cache",
            path="/tmp/comparison-cache",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="movie-one.mkv",
            filename="movie-one.mkv",
            extension="mkv",
            size_bytes=4_000_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=7,
        )
        db.add(media_file)
        db.flush()
        db.add(MediaFormat(media_file_id=media_file.id, duration=3600.0))
        db.commit()

        first_payload = get_dashboard_comparison(db, x_field="duration", y_field="size")
        assert first_payload.included_files == 1

        second_file = MediaFile(
            library_id=library.id,
            relative_path="movie-two.mkv",
            filename="movie-two.mkv",
            extension="mkv",
            size_bytes=8_000_000_000,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
        )
        db.add(second_file)
        db.flush()
        db.add(MediaFormat(media_file_id=second_file.id, duration=5400.0))
        db.commit()

        cached_payload = get_dashboard_comparison(db, x_field="duration", y_field="size")
        assert cached_payload.included_files == 1

        stats_cache.invalidate(cache_key)
        refreshed_payload = get_dashboard_comparison(db, x_field="duration", y_field="size")

    assert refreshed_payload.included_files == 2
