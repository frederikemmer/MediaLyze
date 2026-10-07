from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.db.base import Base
from backend.app.models.entities import (
    AudioStream,
    JellyfinItem,
    JellyfinMediaMatch,
    JellyfinUser,
    JellyfinUserItemData,
    Library,
    LibraryType,
    MediaFile,
    MediaFormat,
    ScanMode,
    ScanStatus,
    VideoStream,
)
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


def test_library_comparison_excludes_files_without_plays() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        library = Library(
            name="Playback comparison",
            path="/tmp/playback-comparison",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        files = [
            MediaFile(
                library_id=library.id,
                relative_path=f"movie-{index}.mkv",
                filename=f"movie-{index}.mkv",
                extension="mkv",
                size_bytes=index * 1_000_000_000,
                mtime=float(index),
                scan_status=ScanStatus.ready,
                quality_score=5,
            )
            for index in (1, 2, 3)
        ]
        db.add_all(files)
        db.flush()
        played_file_id = files[0].id
        items = [
            JellyfinItem(
                jellyfin_item_id=f"comparison-item-{index}",
                item_type="Movie",
                title=f"Movie {index}",
            )
            for index in (1, 2)
        ]
        db.add_all(items)
        db.flush()
        db.add_all(
            [
                JellyfinMediaMatch(
                    media_file_id=files[index].id,
                    jellyfin_item_id=items[index].id,
                    match_method="path",
                    status="matched",
                )
                for index in (0, 1)
            ]
        )
        db.add(JellyfinUser(jellyfin_user_id="viewer", name="Viewer", enabled_for_sync=True))
        db.flush()
        db.add_all(
            [
                JellyfinUserItemData(
                    jellyfin_item_id=items[0].id,
                    jellyfin_user_id="viewer",
                    play_count=3,
                ),
                JellyfinUserItemData(
                    jellyfin_item_id=items[1].id,
                    jellyfin_user_id="viewer",
                    play_count=0,
                ),
            ]
        )
        db.commit()

        payload = get_library_comparison(
            db,
            library_id=library.id,
            x_field="size",
            y_field="play_count",
        )

    assert payload is not None
    assert payload.total_files == 3
    assert payload.included_files == 1
    assert payload.excluded_files == 2
    assert payload.scatter_points is not None
    assert [(point.media_file_id, point.y_value) for point in payload.scatter_points] == [
        (played_file_id, 3.0)
    ]
    assert sum(cell.count for cell in payload.heatmap_cells) == 1


def test_library_comparison_counts_distinct_users_who_played_each_asset() -> None:
    session_factory = _session_factory()

    with session_factory() as db:
        library = Library(
            name="Users played comparison",
            path="/tmp/users-played-comparison",
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
            size_bytes=1_000_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        item = JellyfinItem(
            jellyfin_item_id="users-played-item",
            item_type="Movie",
            title="Movie",
        )
        db.add_all([media_file, item])
        db.flush()
        media_file_id = media_file.id
        db.add(
            JellyfinMediaMatch(
                media_file_id=media_file.id,
                jellyfin_item_id=item.id,
                match_method="path",
                status="matched",
            )
        )
        db.add_all(
            [
                JellyfinUser(jellyfin_user_id="alice", name="Alice", enabled_for_sync=True),
                JellyfinUser(jellyfin_user_id="bob", name="Bob", enabled_for_sync=True),
                JellyfinUser(jellyfin_user_id="carol", name="Carol", enabled_for_sync=True),
                JellyfinUser(jellyfin_user_id="disabled", name="Disabled", enabled_for_sync=False),
            ]
        )
        db.flush()
        db.add_all(
            [
                JellyfinUserItemData(
                    jellyfin_item_id=item.id,
                    jellyfin_user_id="alice",
                    play_count=4,
                    played=True,
                ),
                JellyfinUserItemData(
                    jellyfin_item_id=item.id,
                    jellyfin_user_id="bob",
                    play_count=1,
                    played=True,
                ),
                JellyfinUserItemData(
                    jellyfin_item_id=item.id,
                    jellyfin_user_id="carol",
                    play_count=3,
                    played=False,
                ),
                JellyfinUserItemData(
                    jellyfin_item_id=item.id,
                    jellyfin_user_id="disabled",
                    play_count=99,
                    played=True,
                ),
            ]
        )
        db.commit()

        payload = get_library_comparison(
            db,
            library_id=library.id,
            x_field="size",
            y_field="users_played",
        )

    assert payload is not None
    assert payload.included_files == 1
    assert payload.scatter_points is not None
    assert [(point.media_file_id, point.y_value) for point in payload.scatter_points] == [
        (media_file_id, 2.0)
    ]
    assert payload.y_buckets[1].lower == 2
    assert payload.y_buckets[1].upper == 3
    assert payload.heatmap_cells[0].y_key == "2:3"


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


def test_large_scatter_sampling_does_not_exceed_sqlite_parameter_limit():
    import sqlite3
    from sqlalchemy import insert
    factory = _session_factory()
    with factory() as db:
        update_app_settings(db, AppSettingsUpdate(scan_performance={"comparison_scatter_point_limit": 300}))
        library = Library(name="Large sampling", path="/tmp/large-sampling", type=LibraryType.movies)
        db.add(library)
        db.flush()
        db.execute(insert(MediaFile), [dict(library_id=library.id, relative_path=f"{index}.mkv", filename=f"{index}.mkv", extension="mkv", size_bytes=1000 + index, duration_seconds=10 + index, mtime=1) for index in range(401)])
        db.commit()
        connection = db.connection().connection.driver_connection
        old_limit = connection.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 250)
        try:
            payload = get_library_comparison(db, library_id=library.id, x_field="size", y_field="duration", renderer="scatter")
        finally:
            connection.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, old_limit)
        assert payload.total_files == payload.included_files == 401
        assert payload.sampled_points
        assert len(payload.scatter_points) == 300
        assert [point.media_file_id for point in payload.scatter_points] == [min(400, round(index * 400 / 299)) + 1 for index in range(300)]


def test_sql_numeric_renderers_match_python_semantics_at_invalid_values_and_bin_edges():
    from collections import Counter, defaultdict
    from itertools import product
    from backend.app.services import stat_comparisons as service
    fields = ["size", "duration", "quality_score", "bitrate", "audio_bitrate", "resolution_mp", "chapter_count"]
    factory = _session_factory()
    with factory() as db:
        library = Library(name="Edges", path="/tmp/comparison-edges", type=LibraryType.movies)
        db.add(library)
        db.flush()
        # Includes missing/invalid values and values exactly on bucket boundaries.
        values = [None, -1, 0, 1, 2, 5, 10, 20, 60, 120, 1000, 1000000, 1000000000]
        for index, value in enumerate(values):
            db.add(MediaFile(library_id=library.id, relative_path=f"{index}.mkv", filename=f"{index}.mkv", extension="mkv", size_bytes=value or 0, mtime=1, duration_seconds=value, quality_score=value, bitrate=value, audio_bitrate=value, chapter_count=value, primary_video_width=value, primary_video_height=1000))
        db.commit()
        for x_field, y_field in product(fields, repeat=2):
            rows = list(service._comparison_source_rows(db, x_field=x_field, y_field=y_field, library_id=library.id))
            counts, bars, points = Counter(), defaultdict(list), []
            included = 0
            for row in rows:
                x, y = service._numeric_value(row, x_field), service._numeric_value(row, y_field)
                if x is None or y is None:
                    continue
                included += 1
                xb, yb = service._numeric_bucket(x_field, x), service._numeric_bucket(y_field, y)
                if xb is None or yb is None:
                    continue
                counts[(xb.key, yb.key)] += 1
                bars[xb.key].append(y)
                points.append((row.media_file_id, x, y))
            payload = service._sql_numeric_comparison(db, x_field=x_field, y_field=y_field, library_id=library.id, renderer=None, sample_limit=3)
            assert payload.total_files == len(rows)
            assert payload.included_files == included
            assert payload.excluded_files == len(rows) - included
            assert {(cell.x_key, cell.y_key): cell.count for cell in payload.heatmap_cells} == dict(counts)
            indices = sorted({round(index * (len(points) - 1) / 2) for index in range(3)}) if len(points) > 3 else range(len(points))
            assert [(point.media_file_id, point.x_value, point.y_value) for point in payload.scatter_points] == [points[index] for index in indices]
            assert payload.sampled_points == (len(points) > 3)
            assert {bar.x_key for bar in payload.bar_entries} == set(bars)
            for bar in payload.bar_entries:
                assert bar.count == len(bars[bar.x_key])
                assert bar.value == pytest.approx(sum(bars[bar.x_key]) / bar.count)
