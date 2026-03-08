from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.db.base import Base
from backend.app.models.entities import AudioStream, Library, LibraryType, MediaFile, MediaFormat, ScanMode, ScanStatus, VideoStream
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
    assert audio_languages["de"] == 3
    assert audio_languages["en"] == 2
    assert "deu" not in audio_languages
    assert "ger" not in audio_languages
    assert "eng" not in audio_languages
