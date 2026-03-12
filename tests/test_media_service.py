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


def test_list_library_files_sorts_by_audio_and_subtitle_aggregates() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Sorted",
            path="/tmp/sorted",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        alpha = MediaFile(
            library_id=library.id,
            relative_path="alpha.mkv",
            filename="alpha.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=4,
        )
        beta = MediaFile(
            library_id=library.id,
            relative_path="beta.mkv",
            filename="beta.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=4,
        )
        db.add_all([alpha, beta])
        db.flush()
        db.add_all(
            [
                AudioStream(media_file_id=alpha.id, stream_index=1, codec="aac", language="eng"),
                AudioStream(media_file_id=beta.id, stream_index=1, codec="aac", language="ger"),
                SubtitleStream(media_file_id=alpha.id, stream_index=2, codec="srt", language="eng", default_flag=False, forced_flag=False),
                ExternalSubtitle(media_file_id=beta.id, path="beta.de.ass", language="ger", format="ass"),
            ]
        )
        db.commit()

        audio_sorted = list_library_files(db, library.id, limit=50, sort_key="audio_languages", sort_direction="asc")
        subtitle_sorted = list_library_files(
            db,
            library.id,
            limit=50,
            sort_key="subtitle_languages",
            sort_direction="asc",
        )

    assert [item.filename for item in audio_sorted.items] == ["alpha.mkv", "beta.mkv"]
    assert [item.filename for item in subtitle_sorted.items] == ["alpha.mkv", "beta.mkv"]


def test_list_library_files_sorts_and_filters_by_subtitle_sources() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Sources",
            path="/tmp/sources",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        no_subs = MediaFile(
            library_id=library.id,
            relative_path="00-none.mkv",
            filename="00-none.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=4,
        )
        external_only = MediaFile(
            library_id=library.id,
            relative_path="01-external.mkv",
            filename="01-external.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=4,
        )
        internal_only = MediaFile(
            library_id=library.id,
            relative_path="02-internal.mkv",
            filename="02-internal.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=3.0,
            scan_status=ScanStatus.ready,
            quality_score=4,
        )
        both = MediaFile(
            library_id=library.id,
            relative_path="03-both.mkv",
            filename="03-both.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=4.0,
            scan_status=ScanStatus.ready,
            quality_score=4,
        )
        db.add_all([no_subs, external_only, internal_only, both])
        db.flush()
        db.add_all(
            [
                ExternalSubtitle(media_file_id=external_only.id, path="01-external.en.srt", language="eng", format="srt"),
                SubtitleStream(media_file_id=internal_only.id, stream_index=2, codec="srt", language="eng", default_flag=False, forced_flag=False),
                SubtitleStream(media_file_id=both.id, stream_index=2, codec="srt", language="eng", default_flag=False, forced_flag=False),
                ExternalSubtitle(media_file_id=both.id, path="03-both.en.srt", language="eng", format="srt"),
            ]
        )
        db.commit()

        sorted_page = list_library_files(db, library.id, limit=50, sort_key="subtitle_sources", sort_direction="asc")
        internal_search = list_library_files(db, library.id, limit=50, search="internal")
        external_search = list_library_files(db, library.id, limit=50, search="external")

    assert [item.filename for item in sorted_page.items] == [
        "00-none.mkv",
        "01-external.mkv",
        "02-internal.mkv",
        "03-both.mkv",
    ]
    assert [item.filename for item in internal_search.items] == ["02-internal.mkv", "03-both.mkv"]
    assert [item.filename for item in external_search.items] == ["01-external.mkv", "03-both.mkv"]
