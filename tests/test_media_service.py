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
from backend.app.services.media_service import list_library_files


def test_list_library_files_paginates_and_sorts_by_quality_score() -> None:
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

        for index, score in enumerate((3, 8, 5), start=1):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=f"movie-{index}.mkv",
                filename=f"movie-{index}.mkv",
                extension="mkv",
                size_bytes=100 * index,
                mtime=float(index),
                scan_status=ScanStatus.ready,
                quality_score=score,
            )
            db.add(media_file)
            db.flush()
            db.add(MediaFormat(media_file_id=media_file.id, duration=90.0 + index))
            db.add(VideoStream(media_file_id=media_file.id, stream_index=0, codec="h264", width=1920, height=1080))
        db.commit()

        first_page = list_library_files(
            db,
            library.id,
            offset=0,
            limit=2,
            sort_key="quality_score",
            sort_direction="desc",
        )
        second_page = list_library_files(
            db,
            library.id,
            offset=2,
            limit=2,
            sort_key="quality_score",
            sort_direction="desc",
        )

    assert first_page.total == 3
    assert [item.quality_score for item in first_page.items] == [8, 5]
    assert [item.quality_score for item in second_page.items] == [3]


def test_list_library_files_filters_by_search_across_languages() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Shows",
            path="/tmp/shows",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        german_file = MediaFile(
            library_id=library.id,
            relative_path="file-01.mkv",
            filename="file-01.mkv",
            extension="mkv",
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=6,
        )
        english_file = MediaFile(
            library_id=library.id,
            relative_path="file-02.mkv",
            filename="file-02.mkv",
            extension="mkv",
            size_bytes=456,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=4,
        )
        db.add_all([german_file, english_file])
        db.flush()
        db.add_all(
            [
                MediaFormat(media_file_id=german_file.id, duration=60.0),
                MediaFormat(media_file_id=english_file.id, duration=60.0),
                VideoStream(media_file_id=german_file.id, stream_index=0, codec="hevc", width=3840, height=2160, hdr_type="HDR10"),
                VideoStream(media_file_id=english_file.id, stream_index=0, codec="h264", width=1920, height=1080),
                AudioStream(media_file_id=german_file.id, stream_index=1, codec="aac", language="ger"),
                AudioStream(media_file_id=english_file.id, stream_index=1, codec="dts", language="eng"),
                SubtitleStream(media_file_id=german_file.id, stream_index=2, codec="srt", language="deu", default_flag=False, forced_flag=False),
                ExternalSubtitle(media_file_id=english_file.id, path="file-02.en.srt", language="eng", format="srt"),
            ]
        )
        db.commit()

        german_search = list_library_files(db, library.id, search="de", limit=50)
        hdr_search = list_library_files(db, library.id, search="hdr10", limit=50)
        audio_codec_search = list_library_files(db, library.id, search="dts", limit=50)
        subtitle_codec_search = list_library_files(db, library.id, search="srt", limit=50)
        subtitle_source_search = list_library_files(db, library.id, search="external", limit=50)

    assert german_search.total == 1
    assert [item.filename for item in german_search.items] == ["file-01.mkv"]
    assert hdr_search.total == 1
    assert [item.filename for item in hdr_search.items] == ["file-01.mkv"]
    assert audio_codec_search.total == 1
    assert [item.filename for item in audio_codec_search.items] == ["file-02.mkv"]
    assert subtitle_codec_search.total == 2
    assert [item.filename for item in subtitle_codec_search.items] == ["file-01.mkv", "file-02.mkv"]
    assert subtitle_source_search.total == 1
    assert [item.filename for item in subtitle_source_search.items] == ["file-02.mkv"]


def test_list_library_files_exposes_subtitle_languages_codecs_and_sources() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Shows",
            path="/tmp/shows",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="file-01.mkv",
            filename="file-01.mkv",
            extension="mkv",
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=6,
        )
        db.add(media_file)
        db.flush()
        db.add_all(
            [
                AudioStream(media_file_id=media_file.id, stream_index=1, codec="dts", language="eng"),
                SubtitleStream(media_file_id=media_file.id, stream_index=2, codec="subrip", language="deu", default_flag=False, forced_flag=False),
                ExternalSubtitle(media_file_id=media_file.id, path="file-01.en.ass", language="eng", format="ass"),
            ]
        )
        db.commit()

        page = list_library_files(db, library.id, limit=50)

    assert page.total == 1
    assert page.items[0].audio_codecs == ["dts"]
    assert page.items[0].subtitle_languages == ["de", "en"]
    assert page.items[0].subtitle_codecs == ["ass", "subrip"]
    assert page.items[0].subtitle_sources == ["external", "internal"]
