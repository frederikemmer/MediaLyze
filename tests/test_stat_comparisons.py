from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.db.base import Base
from backend.app.models.entities import AudioStream, Library, LibraryType, MediaFile, MediaFormat, ScanMode, ScanStatus, VideoStream
from backend.app.schemas.app_settings import AppSettingsUpdate
from backend.app.services.app_settings import update_app_settings
from backend.app.services.stat_comparisons import get_dashboard_comparison, get_library_comparison
from backend.app.services.stats_cache import stats_cache
import pytest


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
            duration_seconds=3600.0,
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
            duration_seconds=4000.0,
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
    assert payload.scatter_points[0].asset_name == "movie-one.mkv"
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
                duration_seconds=5400.0,
            primary_video_codec="hevc",
            primary_video_width=3840,
            primary_video_height=1606,
            primary_video_resolution_pixels=3840 * 1606,
            primary_video_hdr_type="HDR10",
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


def test_library_comparison_supports_new_music_axes() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        library = Library(name="Music", path="/tmp/music", type=LibraryType.music, scan_mode=ScanMode.manual, scan_config={})
        db.add(library)
        db.flush()
        db.add(
            MediaFile(
                library_id=library.id,
                relative_path="song.flac",
                filename="song.flac",
                extension="flac",
                size_bytes=100,
                mtime=1.0,
                scan_status=ScanStatus.ready,
                quality_score=5,
                audio_artist="Artist A",
                sample_rate=96000,
            )
        )
        db.commit()

        payload = get_library_comparison(db, library_id=library.id, x_field="audio_artist", y_field="sample_rate")

    assert payload is not None
    assert payload.available_renderers == ["heatmap"]
    assert payload.x_buckets[0].key == "artist a"
    assert payload.y_buckets[0].key == "96000"
    assert payload.y_buckets[0].label == "96000 Hz"
    assert payload.heatmap_cells[0].count == 1


def test_library_comparison_treats_audiobooks_as_audio_only_media_type() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        library = Library(name="Audiobooks", path="/tmp/audiobooks", type=LibraryType.audiobooks, scan_mode=ScanMode.manual, scan_config={})
        db.add(library)
        db.flush()
        library_id = library.id
        db.add(
            MediaFile(
                library_id=library.id,
                relative_path="book.m4b",
                filename="book.m4b",
                extension="m4b",
                size_bytes=100,
                mtime=1.0,
                scan_status=ScanStatus.ready,
                quality_score=5,
                audio_artist="Narrator A",
                sample_rate=44100,
            )
        )
        db.commit()

        payload = get_library_comparison(db, library_id=library.id, x_field="video_codec", y_field="hdr_type")

    assert payload is not None
    assert payload.x_field != "video_codec"
    assert payload.y_field != "hdr_type"
    assert payload.x_field != payload.y_field


def test_library_comparison_supports_audiobook_axes() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        library = Library(name="Audiobooks", path="/tmp/audiobooks", type=LibraryType.audiobooks, scan_mode=ScanMode.manual, scan_config={})
        db.add(library)
        db.flush()
        library_id = library.id
        db.add(
            MediaFile(
                library_id=library_id,
                relative_path="book.m4b",
                filename="book.m4b",
                extension="m4b",
                size_bytes=100,
                mtime=1.0,
                scan_status=ScanStatus.ready,
                quality_score=5,
                chapter_count=24,
                audiobook_narrator="Narrator A",
                audiobook_author="Author A",
                audiobook_publisher="Publisher A",
                audiobook_series="Series A",
                audiobook_series_part="1",
            )
        )
        db.commit()

        payload = get_library_comparison(
            db,
            library_id=library_id,
            x_field="audiobook_narrator",
            y_field="chapter_count",
        )

    assert payload is not None
    assert payload.available_renderers == ["heatmap", "bar"]
    assert payload.x_buckets[0].key == "narrator a"
    assert any(bucket.lower == 10 and bucket.upper == 25 for bucket in payload.y_buckets)
    assert payload.heatmap_cells[0].count == 1

    with session_factory() as db:
        payload = get_library_comparison(
            db,
            library_id=library_id,
            x_field="audiobook_author",
            y_field="audiobook_publisher",
        )

    assert payload is not None
    assert payload.x_buckets[0].key == "author a"
    assert payload.y_buckets[0].key == "publisher a"
    stats_cache.invalidate("default")


@pytest.mark.parametrize(
    ("field_id", "expected_key"),
    [
        ("audio_channels", "2"),
        ("sample_rate", "96000"),
        ("audio_artist", "artist a"),
        ("audio_album", "album a"),
        ("audio_genre", "rock"),
        ("audio_year", "2026"),
        ("track_number", "03/12"),
        ("bit_rate_mode", "vbr"),
        ("embedded_cover", "yes"),
    ],
)
def test_library_comparison_supports_each_new_music_axis(field_id: str, expected_key: str) -> None:
    session_factory = _session_factory()
    with session_factory() as db:
        library = Library(name="Music", path="/tmp/music", type=LibraryType.music, scan_mode=ScanMode.manual, scan_config={})
        db.add(library)
        db.flush()
        db.add(
            MediaFile(
                library_id=library.id, relative_path="song.flac", filename="song.flac", extension="flac",
                size_bytes=100, mtime=1.0, scan_status=ScanStatus.ready, quality_score=5, duration_seconds=60,
                audio_channels=2, sample_rate=96000, audio_artist="Artist A", audio_album="Album A",
                audio_genre="Rock", audio_date="2026-05-18", track_number="03/12", bit_rate_mode="VBR",
                has_embedded_cover=True,
            )
        )
        db.commit()
        payload = get_library_comparison(db, library_id=library.id, x_field=field_id, y_field="duration")
    assert payload is not None
    assert payload.x_buckets[0].key == expected_key


def test_dashboard_comparison_supports_resolution_mp_as_numeric_axis() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        library = Library(
            name="Resolution MP",
            path="/tmp/comparison-resolution-mp",
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
            duration_seconds=3600.0,
            primary_video_codec="hevc",
            primary_video_width=3840,
            primary_video_height=2160,
            primary_video_resolution_pixels=3840 * 2160,
            primary_video_hdr_type="HDR10",
        )
        db.add(media_file)
        db.flush()
        db.add(MediaFormat(media_file_id=media_file.id, duration=3600.0))
        db.add(VideoStream(media_file_id=media_file.id, stream_index=0, codec="hevc", width=3840, height=2160, hdr_type="HDR10"))
        db.commit()

        payload = get_dashboard_comparison(db, x_field="resolution_mp", y_field="size")

    assert payload.available_renderers == ["heatmap", "scatter", "bar"]
    assert payload.scatter_points is not None
    assert payload.scatter_points[0].x_value == 8.2944
    assert payload.scatter_points[0].asset_name == "movie.mkv"
    assert payload.x_buckets[4].key == "8:12"
    assert payload.heatmap_cells[0].x_key == "8:12"


def test_dashboard_comparison_marks_scatter_payload_as_sampled() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        update_app_settings(
            db,
            AppSettingsUpdate(scan_performance={"comparison_scatter_point_limit": 3}),
        )
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
                duration_seconds=1800.0 * (index + 1),
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


def test_dashboard_comparison_excludes_libraries_hidden_from_dashboard() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        visible_library = Library(
            name="Visible",
            path="/tmp/comparison-visible",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            show_on_dashboard=True,
        )
        hidden_library = Library(
            name="Hidden",
            path="/tmp/comparison-hidden",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            show_on_dashboard=False,
        )
        db.add_all([visible_library, hidden_library])
        db.flush()

        visible_file = MediaFile(
            library_id=visible_library.id,
            relative_path="visible.mkv",
            filename="visible.mkv",
            extension="mkv",
            size_bytes=4_000_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=7,
            duration_seconds=3600.0,
        )
        hidden_file = MediaFile(
            library_id=hidden_library.id,
            relative_path="hidden.mkv",
            filename="hidden.mkv",
            extension="mkv",
            size_bytes=8_000_000_000,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=9,
            duration_seconds=5400.0,
        )
        db.add_all([visible_file, hidden_file])
        db.flush()
        visible_file_id = visible_file.id
        db.add(MediaFormat(media_file_id=visible_file.id, duration=3600.0))
        db.add(MediaFormat(media_file_id=hidden_file.id, duration=5400.0))
        db.commit()

        payload = get_dashboard_comparison(db, x_field="duration", y_field="size")

    assert payload.total_files == 1
    assert payload.included_files == 1
    assert payload.scatter_points is not None
    assert payload.scatter_points[0].media_file_id == visible_file_id


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
            duration_seconds=3600.0,
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
            duration_seconds=5400.0,
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
