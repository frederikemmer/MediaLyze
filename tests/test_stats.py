from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.db.base import Base
from backend.app.models.entities import (
    AudioStream,
    ExternalSubtitle,
    Library,
    LibraryType,
    MediaFile,
    MediaFormat,
    ScanMode,
    ScanStatus,
    SubtitleStream,
    VideoStream,
)
from backend.app.services.stats import build_dashboard


def test_dashboard_counts_primary_video_only() -> None:
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
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="movie.mkv",
            filename="movie.mkv",
            extension="mkv",
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        db.add(media_file)
        db.flush()
        db.add(MediaFormat(media_file_id=media_file.id, duration=120.0))
        db.add_all(
            [
                VideoStream(
                    media_file_id=media_file.id,
                    stream_index=0,
                    codec="h264",
                    width=1920,
                    height=1080,
                    hdr_type=None,
                ),
                VideoStream(
                    media_file_id=media_file.id,
                    stream_index=1,
                    codec="hevc",
                    width=3840,
                    height=2160,
                    hdr_type="HDR10",
                ),
            ]
        )
        db.commit()

        dashboard = build_dashboard(db)

    assert dashboard.video_codec_distribution[0].label == "h264"
    assert dashboard.video_codec_distribution[0].value == 1
    assert all(item.label != "hevc" for item in dashboard.video_codec_distribution)


def test_dashboard_keeps_video_codec_and_video_bit_depth_distributions_separate() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Movies HEVC",
            path="/tmp/movies-hevc",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        files = [
            MediaFile(
                library_id=library.id,
                relative_path="movie-8bit.mkv",
                filename="movie-8bit.mkv",
                extension="mkv",
                size_bytes=100,
                mtime=1.0,
                scan_status=ScanStatus.ready,
                quality_score=5,
            ),
            MediaFile(
                library_id=library.id,
                relative_path="movie-10bit.mkv",
                filename="movie-10bit.mkv",
                extension="mkv",
                size_bytes=100,
                mtime=2.0,
                scan_status=ScanStatus.ready,
                quality_score=5,
            ),
            MediaFile(
                library_id=library.id,
                relative_path="movie-unknown.mkv",
                filename="movie-unknown.mkv",
                extension="mkv",
                size_bytes=100,
                mtime=3.0,
                scan_status=ScanStatus.ready,
                quality_score=5,
            ),
        ]
        db.add_all(files)
        db.flush()

        db.add_all(
            [
                VideoStream(media_file_id=files[0].id, stream_index=0, codec="hevc", bit_depth=8),
                VideoStream(media_file_id=files[1].id, stream_index=0, codec="hevc", bit_depth=10),
                VideoStream(media_file_id=files[2].id, stream_index=0, codec="hevc", bit_depth=None),
            ]
        )
        db.commit()

        dashboard = build_dashboard(db)

    assert [item.model_dump(exclude_none=True) for item in dashboard.video_codec_distribution] == [
        {"label": "hevc", "value": 3},
    ]
    assert [item.model_dump(exclude_none=True) for item in dashboard.video_bit_depth_distribution] == [
        {"label": "10-bit", "value": 1, "filter_value": "10"},
        {"label": "8-bit", "value": 1, "filter_value": "8"},
        {"label": "unknown", "value": 1},
    ]


def test_dashboard_audio_bit_depth_distribution_uses_best_audio_track_per_file_only() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Audio bit depth only",
            path="/tmp/audio-bit-depth-only",
            type=LibraryType.mixed,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        with_audio = MediaFile(
            library_id=library.id,
            relative_path="with-audio.mkv",
            filename="with-audio.mkv",
            extension="mkv",
            size_bytes=100,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        video_only = MediaFile(
            library_id=library.id,
            relative_path="video-only.mkv",
            filename="video-only.mkv",
            extension="mkv",
            size_bytes=100,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        db.add_all([with_audio, video_only])
        db.flush()

        db.add_all(
            [
                VideoStream(media_file_id=with_audio.id, stream_index=0, codec="hevc", bit_depth=8),
                AudioStream(media_file_id=with_audio.id, stream_index=2, codec="aac", bit_depth=16),
                AudioStream(media_file_id=with_audio.id, stream_index=1, codec="aac", bit_depth=24),
                VideoStream(media_file_id=video_only.id, stream_index=0, codec="hevc", bit_depth=10),
            ]
        )
        db.commit()

        dashboard = build_dashboard(db)

    assert [item.model_dump(exclude_none=True) for item in dashboard.bit_depth_distribution] == [
        {"label": "24-bit", "value": 1, "filter_value": "24"},
    ]


def test_dashboard_exposes_music_metadata_distributions() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

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
                size_bytes=1,
                mtime=1.0,
                scan_status=ScanStatus.ready,
                quality_score=5,
                audio_artist="Artist A",
                audio_album="Album A",
                audio_genre="Rock",
                audio_date="2026-05-18",
                audio_channels=2,
                sample_rate=96000,
                track_number="03/12",
                bit_rate_mode="VBR",
                has_embedded_cover=True,
            )
        )
        db.commit()

        dashboard = build_dashboard(
            db,
            requested_panels=[
                "audio_artists",
                "audio_albums",
                "audio_genres",
                "audio_years",
                "audio_channels",
                "sample_rates",
                "track_numbers",
                "bit_rate_modes",
                "embedded_covers",
            ],
        )

    assert dashboard.audio_artist_distribution[0].label == "artist a"
    assert dashboard.audio_album_distribution[0].label == "album a"
    assert dashboard.audio_genre_distribution[0].label == "rock"
    assert dashboard.audio_year_distribution[0].label == "2026"
    assert dashboard.audio_channel_distribution[0].label == "2"
    assert dashboard.sample_rate_distribution[0].label == "96000 Hz"
    assert dashboard.track_number_distribution[0].label == "03/12"
    assert dashboard.bit_rate_mode_distribution[0].label == "vbr"
    assert dashboard.embedded_cover_distribution[0].label == "yes"


def test_dashboard_merges_common_audio_language_aliases() -> None:
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
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="movie.mkv",
            filename="movie.mkv",
            extension="mkv",
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        db.add(media_file)
        db.flush()
        db.add_all(
            [
                AudioStream(media_file_id=media_file.id, stream_index=1, codec="aac", language="deu"),
                AudioStream(media_file_id=media_file.id, stream_index=2, codec="aac", language="ger"),
                AudioStream(media_file_id=media_file.id, stream_index=3, codec="aac", language="de"),
                AudioStream(media_file_id=media_file.id, stream_index=4, codec="aac", language="eng"),
                AudioStream(media_file_id=media_file.id, stream_index=5, codec="aac", language="en-US"),
            ]
        )
        db.commit()

        dashboard = build_dashboard(db)

    audio_languages = {item.label: item.value for item in dashboard.audio_language_distribution}
    assert audio_languages["de"] == 1
    assert audio_languages["en"] == 1
    assert "deu" not in audio_languages
    assert "ger" not in audio_languages
    assert "eng" not in audio_languages


def test_dashboard_groups_similar_resolutions_into_shared_category() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies-dashboard",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for index, (width, height) in enumerate(((3840, 1606), (3840, 2160)), start=1):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=f"movie-{index}.mkv",
                filename=f"movie-{index}.mkv",
                extension="mkv",
                size_bytes=123,
                mtime=float(index),
                scan_status=ScanStatus.ready,
                quality_score=5,
            )
            db.add(media_file)
            db.flush()
            db.add(VideoStream(media_file_id=media_file.id, stream_index=0, codec="hevc", width=width, height=height))
        db.commit()

        dashboard = build_dashboard(db)

    assert [item.model_dump(exclude_none=True) for item in dashboard.resolution_distribution] == [{"label": "4k", "value": 2}]


def test_dashboard_defaults_cover_letterboxed_cinema_widths() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Movies",
            path="/tmp/movies-dashboard-cinema",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for index, (width, height) in enumerate(((1920, 800), (2560, 1066), (3840, 1606)), start=1):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=f"movie-{index}.mkv",
                filename=f"movie-{index}.mkv",
                extension="mkv",
                size_bytes=123,
                mtime=float(index),
                scan_status=ScanStatus.ready,
                quality_score=5,
            )
            db.add(media_file)
            db.flush()
            db.add(VideoStream(media_file_id=media_file.id, stream_index=0, codec="hevc", width=width, height=height))
        db.commit()

        dashboard = build_dashboard(db)

    assert {item.label: item.value for item in dashboard.resolution_distribution} == {
        "4k": 1,
        "1080p": 2,
    }


def test_dashboard_includes_container_spatial_audio_and_subtitle_panels() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Mixed",
            path="/tmp/mixed-dashboard",
            type=LibraryType.mixed,
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
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        second_file = MediaFile(
            library_id=library.id,
            relative_path="movie-two.mp4",
            filename="movie-two.mp4",
            extension="mp4",
            size_bytes=456,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        db.add_all([first_file, second_file])
        db.flush()
        db.add_all(
            [
                AudioStream(
                    media_file_id=first_file.id,
                    stream_index=1,
                    codec="eac3",
                    spatial_audio_profile="dolby_atmos",
                ),
                AudioStream(
                    media_file_id=first_file.id,
                    stream_index=2,
                    codec="eac3",
                    spatial_audio_profile="dolby_atmos",
                ),
                AudioStream(
                    media_file_id=second_file.id,
                    stream_index=1,
                    codec="dts",
                    spatial_audio_profile="dts_x",
                ),
                SubtitleStream(
                    media_file_id=first_file.id,
                    stream_index=3,
                    codec="subrip",
                    language="en",
                ),
                SubtitleStream(
                    media_file_id=first_file.id,
                    stream_index=4,
                    codec="subrip",
                    language="de",
                ),
                ExternalSubtitle(
                    media_file_id=first_file.id,
                    path="movie-one.en.srt",
                    language="en",
                    format="srt",
                ),
                ExternalSubtitle(
                    media_file_id=second_file.id,
                    path="movie-two.ass",
                    language="en",
                    format="ass",
                ),
            ]
        )
        db.commit()

        dashboard = build_dashboard(db)

    assert {item.label: item.value for item in dashboard.container_distribution} == {
        "MKV": 1,
        "MP4": 1,
    }
    assert {item.label: item.value for item in dashboard.audio_spatial_profile_distribution} == {
        "Dolby Atmos": 1,
        "DTS:X": 1,
    }
    assert {item.label: item.value for item in dashboard.subtitle_codec_distribution} == {
        "subrip": 1,
        "ass": 1,
        "srt": 1,
    }
    assert {item.label: item.value for item in dashboard.subtitle_source_distribution} == {
        "internal": 1,
        "external": 2,
    }


def test_dashboard_includes_numeric_distributions() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Numeric",
            path="/tmp/numeric-dashboard",
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
            bitrate=8_888_888,
            audio_bitrate=768_000,
        )
        db.add(media_file)
        db.flush()
        db.add(MediaFormat(media_file_id=media_file.id, duration=5400.0, bit_rate=None))
        db.add(AudioStream(media_file_id=media_file.id, stream_index=1, codec="aac", bit_rate=256_000))
        db.add(AudioStream(media_file_id=media_file.id, stream_index=2, codec="ac3", bit_rate=512_000))
        db.commit()

        dashboard = build_dashboard(db)

    assert dashboard.numeric_distributions["quality_score"].total == 1
    assert dashboard.numeric_distributions["quality_score"].bins[7].count == 1
    assert dashboard.numeric_distributions["size"].bins[4].count == 1
    assert dashboard.numeric_distributions["bitrate"].bins[3].count == 1
    assert dashboard.numeric_distributions["audio_bitrate"].bins[3].count == 1


def test_dashboard_excludes_libraries_hidden_from_dashboard() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        visible_library = Library(
            name="Visible",
            path="/tmp/visible-dashboard",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
            show_on_dashboard=True,
        )
        hidden_library = Library(
            name="Hidden",
            path="/tmp/hidden-dashboard",
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
            size_bytes=2_000_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=7,
        )
        hidden_file = MediaFile(
            library_id=hidden_library.id,
            relative_path="hidden.mp4",
            filename="hidden.mp4",
            extension="mp4",
            size_bytes=4_000_000_000,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=9,
        )
        db.add_all([visible_file, hidden_file])
        db.flush()
        db.add(MediaFormat(media_file_id=visible_file.id, duration=3600.0))
        db.add(MediaFormat(media_file_id=hidden_file.id, duration=7200.0))
        db.add(VideoStream(media_file_id=visible_file.id, stream_index=0, codec="h264", width=1920, height=1080))
        db.add(VideoStream(media_file_id=hidden_file.id, stream_index=0, codec="hevc", width=3840, height=2160))
        db.commit()

        dashboard = build_dashboard(db)

    assert dashboard.totals["libraries"] == 1
    assert dashboard.totals["files"] == 1
    assert dashboard.totals["storage_bytes"] == 2_000_000_000
    assert dashboard.totals["duration_seconds"] == 3600.0
    assert [item.model_dump(exclude_none=True) for item in dashboard.container_distribution] == [
        {"label": "MKV", "value": 1, "filter_value": "mkv"}
    ]
    assert [item.model_dump(exclude_none=True) for item in dashboard.video_codec_distribution] == [
        {"label": "h264", "value": 1}
    ]
