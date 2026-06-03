import csv
import io

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.db.base import Base
from backend.app.models.entities import (
    AppSetting,
    AudioStream,
    ExternalSubtitle,
    Library,
    LibraryType,
    MediaChapter,
    MediaFile,
    MediaSeason,
    MediaSeries,
    MediaFormat,
    ScanMode,
    ScanStatus,
    SubtitleStream,
    VideoStream,
)
from backend.app.services.library_service import get_library_statistics
from backend.app.services.media_search import LibraryFileSearchFilters, SearchValidationError
from backend.app.services.media_service import (
    generate_library_files_csv_export,
    generate_media_chapters_csv_export,
    get_grouped_library_series_detail,
    get_media_file_quality_score_detail,
    list_grouped_library_files,
    list_library_files,
)


def _collect_csv_export_text(chunks) -> str:
    return b"".join(chunks).decode("utf-8-sig")


def _split_csv_export(text: str) -> tuple[list[str], list[list[str]]]:
    comment_lines: list[str] = []
    csv_lines: list[str] = []
    in_csv_body = False

    for line in text.splitlines():
        if not in_csv_body:
            if line.startswith("# "):
                comment_lines.append(line)
                continue
            if not line:
                continue
            in_csv_body = True
        if in_csv_body:
            csv_lines.append(line)

    rows = list(csv.reader(io.StringIO("\n".join(csv_lines))))
    return comment_lines, rows


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


def test_quality_score_detail_refreshes_stale_audio_only_video_categories() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Music",
            path="/tmp/music",
            type=LibraryType.music,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="album/song.mp3",
            filename="song.mp3",
            extension="mp3",
            size_bytes=12_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=6,
            quality_score_raw=60.0,
            quality_score_breakdown={
                "score": 6,
                "score_raw": 60.0,
                "categories": [
                    {
                        "key": "dynamic_range",
                        "score": 60.0,
                        "weight": 4,
                        "active": True,
                        "minimum": ["sdr"],
                        "ideal": ["hdr10"],
                        "actual": "sdr",
                    }
                ],
            },
        )
        db.add(media_file)
        db.flush()
        db.add(MediaFormat(media_file_id=media_file.id, duration=300.0, bit_rate=128_000))
        db.add(AudioStream(media_file_id=media_file.id, stream_index=0, codec="mp3", channels=2, channel_layout="stereo"))
        db.commit()

        detail = get_media_file_quality_score_detail(db, media_file.id)

    assert detail is not None
    categories = {category.key: category for category in detail.breakdown.categories}
    assert categories["dynamic_range"].skipped is True
    assert categories["dynamic_range"].actual is None
    assert categories["dynamic_range"].minimum is None
    assert categories["dynamic_range"].ideal is None
    assert categories["dynamic_range"].notes == ["not_applicable"]


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


def test_list_library_files_exposes_container() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Containers",
            path="/tmp/containers",
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
        db.commit()

        page = list_library_files(db, library.id, limit=50)

    assert page.total == 1
    assert page.items[0].container == "mkv"


def test_list_library_files_exposes_and_filters_music_metadata() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Music",
            path="/tmp/music",
            type=LibraryType.music,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        matching = MediaFile(
            library_id=library.id,
            relative_path="artist/album/03-song.flac",
            filename="03-song.flac",
            extension="flac",
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
            audio_title="Song A",
            audio_artist="Artist A",
            audio_album="Album A",
            audio_album_artist="Album Artist A",
            audio_genre="Rock",
            audio_date="2026-05-18",
            audio_disc="1/2",
            audio_composer="Composer A",
            audio_channels=2,
            sample_rate=96000,
            track_number="03/12",
            bit_rate_mode="VBR",
            has_embedded_cover=True,
        )
        other = MediaFile(
            library_id=library.id,
            relative_path="other.flac",
            filename="other.flac",
            extension="flac",
            size_bytes=456,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
            audio_title="Other",
            audio_artist="Other",
        )
        db.add_all([matching, other])
        db.commit()

        page = list_library_files(
            db,
            library.id,
            search_filters=LibraryFileSearchFilters(
                search_audio_artist="Artist A",
                search_audio_album="Album A",
                search_audio_channels="=2",
                search_sample_rate=">=96000",
                search_track_number="03",
                search_bit_rate_mode="VBR",
                search_has_embedded_cover="yes",
            ),
            limit=50,
        )

    assert page.total == 1
    item = page.items[0]
    assert item.audio_title == "Song A"
    assert item.audio_artist == "Artist A"
    assert item.audio_album == "Album A"
    assert item.audio_album_artist == "Album Artist A"
    assert item.audio_genre == "Rock"
    assert item.audio_date == "2026-05-18"
    assert item.audio_disc == "1/2"
    assert item.audio_composer == "Composer A"
    assert item.audio_channels == 2
    assert item.sample_rate == 96000
    assert item.track_number == "03/12"
    assert item.bit_rate_mode == "VBR"
    assert item.has_embedded_cover is True


def test_list_library_files_exposes_filters_and_sorts_audiobook_metadata() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Audiobooks",
            path="/tmp/audiobooks",
            type=LibraryType.audiobooks,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        matching = MediaFile(
            library_id=library.id,
            relative_path="series/book-a.m4b",
            filename="book-a.m4b",
            extension="m4b",
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
            chapter_count=24,
            chapter_titles_search="opening chapter one",
            audiobook_narrator="Narrator A",
            audiobook_author="Author A",
            audiobook_publisher="Publisher A",
            audiobook_series="Series A",
            audiobook_series_part="2",
            audiobook_description="Long Synopsis A",
            audiobook_copyright="Copyright A",
            audiobook_language="en",
            audiobook_abridged="unabridged",
            audiobook_asin="B000000001",
            audiobook_isbn="9781234567890",
            search_fields_version=3,
        )
        other = MediaFile(
            library_id=library.id,
            relative_path="other.aax",
            filename="other.aax",
            extension="aax",
            size_bytes=456,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
            chapter_count=4,
            chapter_titles_search="intro",
            audiobook_narrator="Other",
            audiobook_author="Other Author",
            audiobook_publisher="Other Publisher",
            audiobook_series="Other",
            audiobook_series_part="1",
            audiobook_description="Other Synopsis",
            audiobook_copyright="Other Copyright",
            audiobook_language="de",
            audiobook_abridged="abridged",
            audiobook_asin="B000000002",
            audiobook_isbn="9781234567891",
            search_fields_version=3,
        )
        db.add_all([matching, other])
        db.flush()
        db.add(MediaChapter(media_file_id=matching.id, chapter_index=0, start_time=0, end_time=10, duration=10, title="Opening"))
        db.commit()

        filtered = list_library_files(
            db,
            library.id,
            search_filters=LibraryFileSearchFilters(
                search_chapter_count=">=20",
                search_chapter_titles="chapter one",
                search_audiobook_narrator="Narrator A",
                search_audiobook_author="Author A",
                search_audiobook_publisher="Publisher A",
                search_audiobook_series="Series A",
                search_audiobook_series_part="2",
                search_audiobook_description="Synopsis A",
                search_audiobook_copyright="Copyright A",
                search_audiobook_language="en",
                search_audiobook_abridged="unabridged",
                search_audiobook_asin="B000000001",
                search_audiobook_isbn="9781234567890",
            ),
            limit=50,
        )
        sorted_page = list_library_files(
            db,
            library.id,
            limit=50,
            sort_key="chapter_count",
            sort_direction="desc",
        )

    assert [item.filename for item in filtered.items] == ["book-a.m4b"]
    item = filtered.items[0]
    assert item.chapter_count == 24
    assert item.audiobook_narrator == "Narrator A"
    assert item.audiobook_author == "Author A"
    assert item.audiobook_publisher == "Publisher A"
    assert item.audiobook_series == "Series A"
    assert item.audiobook_series_part == "2"
    assert item.audiobook_language == "en"
    assert item.audiobook_abridged == "unabridged"
    assert [item.filename for item in sorted_page.items] == ["book-a.m4b", "other.aax"]


@pytest.mark.parametrize("sort_key", ["audiobook_narrator", "audiobook_series", "audiobook_series_part"])
def test_list_library_files_sorts_each_audiobook_text_column(sort_key: str) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(name="Audiobooks", path="/tmp/audiobooks", type=LibraryType.audiobooks, scan_mode=ScanMode.manual, scan_config={})
        db.add(library)
        db.flush()
        db.add_all(
            [
                MediaFile(
                    library_id=library.id,
                    relative_path="a.m4b",
                    filename="a.m4b",
                    extension="m4b",
                    size_bytes=1,
                    mtime=1.0,
                    scan_status=ScanStatus.ready,
                    quality_score=5,
                    audiobook_narrator="A",
                    audiobook_series="A",
                    audiobook_series_part="1",
                ),
                MediaFile(
                    library_id=library.id,
                    relative_path="b.m4b",
                    filename="b.m4b",
                    extension="m4b",
                    size_bytes=1,
                    mtime=2.0,
                    scan_status=ScanStatus.ready,
                    quality_score=5,
                    audiobook_narrator="B",
                    audiobook_series="B",
                    audiobook_series_part="2",
                ),
            ]
        )
        db.commit()
        page = list_library_files(db, library.id, limit=50, sort_key=sort_key, sort_direction="asc")

    assert [item.filename for item in page.items] == ["a.m4b", "b.m4b"]


@pytest.mark.parametrize(
    ("filter_name", "filter_value"),
    [
        ("search_audio_title", "Song A"),
        ("search_audio_artist", "Artist A"),
        ("search_audio_album", "Album A"),
        ("search_audio_album_artist", "Album Artist A"),
        ("search_audio_genre", "Rock"),
        ("search_audio_date", "2026"),
        ("search_audio_disc", "1/2"),
        ("search_audio_composer", "Composer A"),
        ("search_audio_channels", "=2"),
        ("search_sample_rate", "=96000"),
        ("search_track_number", "03"),
        ("search_bit_rate_mode", "VBR"),
        ("search_has_embedded_cover", "yes"),
    ],
)
def test_list_library_files_filters_each_new_music_field(filter_name: str, filter_value: str) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with session_factory() as db:
        library = Library(name="Music", path="/tmp/music", type=LibraryType.music, scan_mode=ScanMode.manual, scan_config={})
        db.add(library)
        db.flush()
        db.add_all(
            [
                MediaFile(
                    library_id=library.id, relative_path="match.flac", filename="match.flac", extension="flac",
                    size_bytes=1, mtime=1.0, scan_status=ScanStatus.ready, quality_score=5,
                    audio_title="Song A", audio_artist="Artist A", audio_album="Album A",
                    audio_album_artist="Album Artist A", audio_genre="Rock", audio_date="2026-05-18",
                    audio_disc="1/2", audio_composer="Composer A", audio_channels=2, sample_rate=96000,
                    track_number="03/12", bit_rate_mode="VBR", has_embedded_cover=True,
                ),
                MediaFile(
                    library_id=library.id, relative_path="miss.flac", filename="miss.flac", extension="flac",
                    size_bytes=1, mtime=2.0, scan_status=ScanStatus.ready, quality_score=5,
                    audio_title="Other", audio_artist="Other", audio_album="Other", audio_album_artist="Other",
                    audio_genre="Jazz", audio_date="2025", audio_disc="2", audio_composer="Other",
                    audio_channels=6, sample_rate=48000, track_number="04", bit_rate_mode="CBR",
                    has_embedded_cover=False,
                ),
            ]
        )
        db.commit()
        page = list_library_files(
            db,
            library.id,
            search_filters=LibraryFileSearchFilters(**{filter_name: filter_value}),
            limit=50,
        )
    assert [item.filename for item in page.items] == ["match.flac"]


@pytest.mark.parametrize(
    "sort_key",
    [
        "audio_title", "audio_artist", "audio_album", "audio_album_artist", "audio_genre", "audio_date",
        "audio_disc", "audio_composer", "audio_channels", "sample_rate", "track_number", "bit_rate_mode",
        "has_embedded_cover",
    ],
)
def test_list_library_files_sorts_each_new_music_column(sort_key: str) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with session_factory() as db:
        library = Library(name="Music", path="/tmp/music", type=LibraryType.music, scan_mode=ScanMode.manual, scan_config={})
        db.add(library)
        db.flush()
        db.add_all(
            [
                MediaFile(
                    library_id=library.id, relative_path="a.flac", filename="a.flac", extension="flac",
                    size_bytes=1, mtime=1.0, scan_status=ScanStatus.ready, quality_score=5,
                    audio_title="A", audio_artist="A", audio_album="A", audio_album_artist="A", audio_genre="A",
                    audio_date="2025", audio_disc="1", audio_composer="A", audio_channels=2, sample_rate=48000,
                    track_number="01", bit_rate_mode="CBR", has_embedded_cover=False,
                ),
                MediaFile(
                    library_id=library.id, relative_path="b.flac", filename="b.flac", extension="flac",
                    size_bytes=1, mtime=2.0, scan_status=ScanStatus.ready, quality_score=5,
                    audio_title="B", audio_artist="B", audio_album="B", audio_album_artist="B", audio_genre="B",
                    audio_date="2026", audio_disc="2", audio_composer="B", audio_channels=6, sample_rate=96000,
                    track_number="02", bit_rate_mode="VBR", has_embedded_cover=True,
                ),
            ]
        )
        db.commit()
        page = list_library_files(db, library.id, limit=50, sort_key=sort_key, sort_direction="asc")
    assert [item.filename for item in page.items] == ["a.flac", "b.flac"]


def test_list_library_files_exposes_audio_spatial_profiles() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Spatial",
            path="/tmp/spatial",
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
                AudioStream(
                    media_file_id=media_file.id,
                    stream_index=1,
                    codec="eac3",
                    profile="Dolby Digital Plus + Dolby Atmos",
                    spatial_audio_profile="dolby_atmos",
                    language="eng",
                ),
                AudioStream(
                    media_file_id=media_file.id,
                    stream_index=2,
                    codec="dts",
                    profile="DTS-HD MA + DTS:X",
                    spatial_audio_profile="dts_x",
                    language="eng",
                ),
            ]
        )
        db.commit()

        page = list_library_files(db, library.id, limit=50)

    assert page.total == 1
    assert page.items[0].audio_spatial_profiles == ["DTS:X", "Dolby Atmos"]


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


def test_list_library_files_sorts_and_filters_by_audio_spatial_profiles() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Spatial Sorted",
            path="/tmp/spatial-sorted",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        atmos = MediaFile(
            library_id=library.id,
            relative_path="atmos.mkv",
            filename="atmos.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=4,
        )
        dtsx = MediaFile(
            library_id=library.id,
            relative_path="dtsx.mkv",
            filename="dtsx.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=4,
        )
        db.add_all([atmos, dtsx])
        db.flush()
        db.add_all(
            [
                AudioStream(
                    media_file_id=atmos.id,
                    stream_index=1,
                    codec="eac3",
                    profile="Dolby Digital Plus + Dolby Atmos",
                    spatial_audio_profile="dolby_atmos",
                    language="eng",
                ),
                AudioStream(
                    media_file_id=dtsx.id,
                    stream_index=1,
                    codec="dts",
                    profile="DTS-HD MA + DTS:X",
                    spatial_audio_profile="dts_x",
                    language="eng",
                ),
            ]
        )
        db.commit()

        sorted_page = list_library_files(db, library.id, limit=50, sort_key="audio_spatial_profiles", sort_direction="asc")
        filtered_page = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_audio_spatial_profiles="atmos"),
        )
        legacy_page = list_library_files(db, library.id, limit=50, search="dts")

    assert [item.filename for item in sorted_page.items] == ["atmos.mkv", "dtsx.mkv"]
    assert [item.filename for item in filtered_page.items] == ["atmos.mkv"]
    assert [item.filename for item in legacy_page.items] == ["dtsx.mkv"]


def test_generate_library_files_csv_export_includes_audio_spatial_profiles() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Spatial Export",
            path="/tmp/spatial-export",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="atmos.mkv",
            filename="atmos.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=4,
        )
        db.add(media_file)
        db.flush()
        db.add(
            AudioStream(
                media_file_id=media_file.id,
                stream_index=1,
                codec="eac3",
                profile="Dolby Digital Plus + Dolby Atmos",
                spatial_audio_profile="dolby_atmos",
                language="eng",
            )
        )
        db.commit()

        _filename, chunks = generate_library_files_csv_export(
            db,
            library.id,
            library_name=library.name,
            search_filters=LibraryFileSearchFilters(search_audio_spatial_profiles="atmos"),
        )

    comment_lines, rows = _split_csv_export(_collect_csv_export_text(chunks))
    header = rows[0]

    assert "# search.audio_spatial_profiles: atmos" in comment_lines
    assert [header.index(column) for column in ["audio_codecs", "audio_spatial_profiles", "audio_languages"]]
    assert rows[1][header.index("audio_spatial_profiles")] == "Dolby Atmos"


def test_generate_library_files_csv_export_includes_new_music_metadata_columns() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Music CSV",
            path="/tmp/music-csv",
            type=LibraryType.music,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        db.add(
            MediaFile(
                library_id=library.id,
                relative_path="song.flac",
                filename="song.flac",
                extension="flac",
                size_bytes=1024,
                mtime=1.0,
                scan_status=ScanStatus.ready,
                audio_title="Song A",
                audio_artist="Artist A",
                audio_album="Album A",
                audio_album_artist="Album Artist A",
                audio_genre="Rock",
                audio_date="2026",
                audio_disc="1/2",
                audio_composer="Composer A",
                audio_channels=2,
                sample_rate=96000,
                track_number="03/12",
                bit_rate_mode="vbr",
                has_embedded_cover=True,
            )
        )
        db.commit()

        _filename, chunks = generate_library_files_csv_export(db, library.id, library_name=library.name)

    _comment_lines, rows = _split_csv_export(_collect_csv_export_text(chunks))

    assert rows[0][9:22] == [
        "audio_title",
        "audio_artist",
        "audio_album",
        "audio_album_artist",
        "audio_genre",
        "audio_date",
        "audio_disc",
        "audio_composer",
        "audio_channels",
        "sample_rate",
        "track_number",
        "bit_rate_mode",
        "has_embedded_cover",
    ]
    assert rows[0][22:36] == [
        "chapter_count",
        "audiobook_narrator",
        "audiobook_author",
        "audiobook_publisher",
        "audiobook_series",
        "audiobook_series_part",
        "audiobook_description",
        "audiobook_copyright",
        "audiobook_language",
        "audiobook_abridged",
        "audiobook_asin",
        "audiobook_isbn",
        "analysis_failure_kind",
        "analysis_failure_reason",
    ]
    assert rows[1][9:22] == [
        "Song A",
        "Artist A",
        "Album A",
        "Album Artist A",
        "Rock",
        "2026",
        "1/2",
        "Composer A",
        "2",
        "96000",
        "03/12",
        "vbr",
        "yes",
    ]
    assert rows[1][22:26] == ["", "", "", ""]


def test_generate_library_files_csv_export_includes_audiobook_metadata_columns() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Audiobook CSV",
            path="/tmp/audiobook-csv",
            type=LibraryType.audiobooks,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        db.add(
            MediaFile(
                library_id=library.id,
                relative_path="book.m4b",
                filename="book.m4b",
                extension="m4b",
                size_bytes=1024,
                mtime=1.0,
                scan_status=ScanStatus.ready,
                chapter_count=24,
                audiobook_narrator="Narrator A",
                audiobook_author="Author A",
                audiobook_publisher="Publisher A",
                audiobook_series="Series A",
                audiobook_series_part="2",
                audiobook_description="Synopsis A",
                audiobook_copyright="Copyright A",
                audiobook_language="en",
                audiobook_abridged="unabridged",
                audiobook_asin="B000000001",
                audiobook_isbn="9781234567890",
                analysis_failure_kind="",
                analysis_failure_reason="",
                search_fields_version=3,
            )
        )
        db.commit()

        _filename, chunks = generate_library_files_csv_export(
            db,
            library.id,
            library_name=library.name,
            search_filters=LibraryFileSearchFilters(search_audiobook_narrator="Narrator A"),
        )

    comment_lines, rows = _split_csv_export(_collect_csv_export_text(chunks))
    header = rows[0]

    assert "# search.audiobook_narrator: Narrator A" in comment_lines
    assert rows[1][header.index("chapter_count")] == "24"
    assert rows[1][header.index("audiobook_narrator")] == "Narrator A"
    assert rows[1][header.index("audiobook_author")] == "Author A"
    assert rows[1][header.index("audiobook_publisher")] == "Publisher A"
    assert rows[1][header.index("audiobook_series")] == "Series A"
    assert rows[1][header.index("audiobook_series_part")] == "2"
    assert rows[1][header.index("audiobook_description")] == "Synopsis A"
    assert rows[1][header.index("audiobook_copyright")] == "Copyright A"
    assert rows[1][header.index("audiobook_language")] == "en"
    assert rows[1][header.index("audiobook_abridged")] == "unabridged"
    assert rows[1][header.index("audiobook_asin")] == "B000000001"
    assert rows[1][header.index("audiobook_isbn")] == "9781234567890"


def test_generate_media_chapters_csv_export_includes_chapter_detail_rows() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(name="Audiobooks", path="/tmp/audiobooks", type=LibraryType.audiobooks, scan_mode=ScanMode.manual, scan_config={})
        db.add(library)
        db.flush()
        media_file = MediaFile(
            library_id=library.id,
            relative_path="series/book.m4b",
            filename="book.m4b",
            extension="m4b",
            size_bytes=1024,
            mtime=1.0,
            scan_status=ScanStatus.ready,
        )
        db.add(media_file)
        db.flush()
        db.add(
            MediaChapter(
                media_file_id=media_file.id,
                chapter_index=1,
                start_time=10,
                end_time=20,
                duration=10,
                title="Chapter One",
                tags={"title": "Chapter One"},
            )
        )
        db.commit()

        filename, chunks = generate_media_chapters_csv_export(db, media_file.id)

    assert filename == "book.m4b-chapters.csv"
    _comment_lines, rows = _split_csv_export(_collect_csv_export_text(chunks))
    header = rows[0]
    assert rows[1][header.index("relative_path")] == "series/book.m4b"
    assert rows[1][header.index("chapter_index")] == "1"
    assert rows[1][header.index("title")] == "Chapter One"
    assert '"title": "Chapter One"' in rows[1][header.index("tags_json")]


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


def test_list_library_files_sorts_and_filters_by_container() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Container Filter",
            path="/tmp/container-filter",
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
            relative_path="beta.mp4",
            filename="beta.mp4",
            extension="mp4",
            size_bytes=1,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=4,
        )
        db.add_all([alpha, beta])
        db.commit()

        sorted_page = list_library_files(db, library.id, limit=50, sort_key="container", sort_direction="asc")
        filtered_page = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_container="mp4"),
        )

    assert [item.filename for item in sorted_page.items] == ["alpha.mkv", "beta.mp4"]
    assert [item.filename for item in filtered_page.items] == ["beta.mp4"]


def test_list_library_files_filters_by_field_specific_search_intersection() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Intersection",
            path="/tmp/intersection",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        first = MediaFile(
            library_id=library.id,
            relative_path="movie-a.mkv",
            filename="movie-a.mkv",
            extension="mkv",
            size_bytes=5_000_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
        )
        second = MediaFile(
            library_id=library.id,
            relative_path="movie-b.mkv",
            filename="movie-b.mkv",
            extension="mkv",
            size_bytes=2_000_000_000,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=6,
        )
        db.add_all([first, second])
        db.flush()
        db.add_all(
            [
                MediaFormat(media_file_id=first.id, duration=7200.0),
                MediaFormat(media_file_id=second.id, duration=5400.0),
                VideoStream(media_file_id=first.id, stream_index=0, codec="hevc", width=3840, height=2160, hdr_type="HDR10"),
                VideoStream(media_file_id=second.id, stream_index=0, codec="h264", width=1920, height=1080),
                AudioStream(media_file_id=first.id, stream_index=1, codec="aac", language="eng"),
                AudioStream(media_file_id=second.id, stream_index=1, codec="aac", language="eng"),
                SubtitleStream(media_file_id=first.id, stream_index=2, codec="srt", language="eng", default_flag=False, forced_flag=False),
                ExternalSubtitle(media_file_id=first.id, path="movie-a.en.srt", language="eng", format="srt"),
                ExternalSubtitle(media_file_id=second.id, path="movie-b.de.srt", language="deu", format="srt"),
            ]
        )
        db.commit()

        filtered = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(
                file_search="movie",
                search_video_codec="hevc",
                search_resolution="4k",
                search_hdr_type="hdr10",
                search_audio_languages="english",
                search_subtitle_sources="internal ext",
            ),
        )

    assert filtered.total == 1
    assert [item.filename for item in filtered.items] == ["movie-a.mkv"]


def test_list_library_files_supports_structured_numeric_field_searches() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Structured",
            path="/tmp/structured",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        short = MediaFile(
            library_id=library.id,
            relative_path="short.mkv",
            filename="short.mkv",
            extension="mkv",
            size_bytes=800_000_000,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        feature = MediaFile(
            library_id=library.id,
            relative_path="feature.mkv",
            filename="feature.mkv",
            extension="mkv",
            size_bytes=6_000_000_000,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=9,
        )
        db.add_all([short, feature])
        db.flush()
        db.add_all(
            [
                MediaFormat(media_file_id=short.id, duration=1800.0, bit_rate=2_000_000),
                MediaFormat(media_file_id=feature.id, duration=7200.0, bit_rate=10_000_000),
                AudioStream(media_file_id=short.id, stream_index=1, codec="aac", bit_rate=192_000),
                AudioStream(media_file_id=feature.id, stream_index=1, codec="eac3", bit_rate=256_000),
                AudioStream(media_file_id=feature.id, stream_index=2, codec="ac3", bit_rate=512_000),
            ]
        )
        db.commit()

        large_files = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_size=">4GB"),
        )
        long_files = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_duration=">=1h 30m"),
        )
        high_scores = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_quality_score=">=8"),
        )
        mid_sized_files = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_size=">=4GB,<8GB"),
        )
        bitrate_files = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_bitrate=">=8Mb/s,<12Mb/s"),
        )
        audio_bitrate_files = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_audio_bitrate=">=512kb/s,<1Mb/s"),
        )

    assert [item.filename for item in large_files.items] == ["feature.mkv"]
    assert [item.filename for item in long_files.items] == ["feature.mkv"]
    assert [item.filename for item in high_scores.items] == ["feature.mkv"]
    assert [item.filename for item in mid_sized_files.items] == ["feature.mkv"]
    assert [item.filename for item in bitrate_files.items] == ["feature.mkv"]
    assert [item.filename for item in audio_bitrate_files.items] == ["feature.mkv"]


def test_list_library_files_exposes_and_sorts_bitrate_columns() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Bitrate sort",
            path="/tmp/bitrate-sort",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        lower = MediaFile(
            library_id=library.id,
            relative_path="lower.mkv",
            filename="lower.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        higher = MediaFile(
            library_id=library.id,
            relative_path="higher.mkv",
            filename="higher.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        db.add_all([lower, higher])
        db.flush()
        db.add_all(
            [
                MediaFormat(media_file_id=lower.id, duration=120.0, bit_rate=2_000_000),
                MediaFormat(media_file_id=higher.id, duration=120.0, bit_rate=8_000_000),
                AudioStream(media_file_id=lower.id, stream_index=1, codec="aac", bit_rate=128_000),
                AudioStream(media_file_id=higher.id, stream_index=1, codec="aac", bit_rate=384_000),
            ]
        )
        db.commit()

        bitrate_sorted = list_library_files(db, library.id, limit=50, sort_key="bitrate", sort_direction="desc")
        audio_bitrate_sorted = list_library_files(
            db,
            library.id,
            limit=50,
            sort_key="audio_bitrate",
            sort_direction="desc",
        )

    assert [item.filename for item in bitrate_sorted.items] == ["higher.mkv", "lower.mkv"]
    assert [item.filename for item in audio_bitrate_sorted.items] == ["higher.mkv", "lower.mkv"]
    assert bitrate_sorted.items[0].bitrate == 8_000_000
    assert bitrate_sorted.items[1].bitrate == 2_000_000
    assert audio_bitrate_sorted.items[0].audio_bitrate == 384_000
    assert audio_bitrate_sorted.items[1].audio_bitrate == 128_000


def test_list_library_files_sorts_and_filters_by_audio_bit_depth_only() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Bit depth sort",
            path="/tmp/bit-depth-sort",
            type=LibraryType.mixed,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        lower = MediaFile(
            library_id=library.id,
            relative_path="lower.mkv",
            filename="lower.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        higher = MediaFile(
            library_id=library.id,
            relative_path="higher.mkv",
            filename="higher.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        db.add_all([lower, higher])
        db.flush()
        db.add_all(
            [
                VideoStream(media_file_id=lower.id, stream_index=0, codec="hevc", bit_depth=10),
                VideoStream(media_file_id=higher.id, stream_index=0, codec="hevc", bit_depth=8),
                AudioStream(media_file_id=lower.id, stream_index=1, codec="aac", bit_depth=16),
                AudioStream(media_file_id=higher.id, stream_index=1, codec="aac", bit_depth=24),
            ]
        )
        db.commit()

        sorted_page = list_library_files(db, library.id, limit=50, sort_key="bit_depth", sort_direction="desc")
        filtered_page = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_bit_depth=">=24"),
        )

    assert [item.filename for item in sorted_page.items] == ["higher.mkv", "lower.mkv"]
    assert [item.bit_depth for item in sorted_page.items] == [24, 16]
    assert [item.filename for item in filtered_page.items] == ["higher.mkv"]


def test_list_library_files_supports_negated_field_search_terms_and_comma_intersections() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Negated metadata search",
            path="/tmp/negated-metadata-search",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        bilingual_internal = MediaFile(
            library_id=library.id,
            relative_path="movie-a.mkv",
            filename="movie-a.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
        )
        german_external = MediaFile(
            library_id=library.id,
            relative_path="movie-b.mkv",
            filename="movie-b.mkv",
            extension="mkv",
            size_bytes=2,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=7,
        )
        four_k_external = MediaFile(
            library_id=library.id,
            relative_path="movie-c.mkv",
            filename="movie-c.mkv",
            extension="mkv",
            size_bytes=3,
            mtime=3.0,
            scan_status=ScanStatus.ready,
            quality_score=6,
        )
        db.add_all([bilingual_internal, german_external, four_k_external])
        db.flush()
        db.add_all(
            [
                VideoStream(
                    media_file_id=bilingual_internal.id,
                    stream_index=0,
                    codec="hevc",
                    width=3840,
                    height=2160,
                    hdr_type="HDR10",
                ),
                VideoStream(
                    media_file_id=german_external.id,
                    stream_index=0,
                    codec="h264",
                    width=1920,
                    height=1080,
                ),
                VideoStream(
                    media_file_id=four_k_external.id,
                    stream_index=0,
                    codec="hevc",
                    width=3840,
                    height=2160,
                ),
                AudioStream(media_file_id=bilingual_internal.id, stream_index=1, codec="aac", language="eng"),
                AudioStream(media_file_id=bilingual_internal.id, stream_index=2, codec="aac", language="deu"),
                AudioStream(media_file_id=german_external.id, stream_index=1, codec="aac", language="deu"),
                AudioStream(media_file_id=four_k_external.id, stream_index=1, codec="dts", language="jpn"),
                SubtitleStream(
                    media_file_id=bilingual_internal.id,
                    stream_index=3,
                    codec="subrip",
                    language="eng",
                    default_flag=False,
                    forced_flag=False,
                ),
                ExternalSubtitle(media_file_id=bilingual_internal.id, path="movie-a.en.srt", language="eng", format="srt"),
                ExternalSubtitle(media_file_id=german_external.id, path="movie-b.de.srt", language="deu", format="srt"),
                ExternalSubtitle(media_file_id=four_k_external.id, path="movie-c.en.srt", language="eng", format="srt"),
            ]
        )
        db.commit()

        without_english_audio = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_audio_languages="!en"),
        )
        external_without_internal = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_subtitle_sources="external, !internal"),
        )
        non_4k_titles = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_resolution="!4k"),
        )

    assert [item.filename for item in without_english_audio.items] == ["movie-b.mkv", "movie-c.mkv"]
    assert [item.filename for item in external_without_internal.items] == ["movie-b.mkv", "movie-c.mkv"]
    assert [item.filename for item in non_4k_titles.items] == ["movie-b.mkv"]


def test_list_library_files_supports_resolution_aliases_and_sdr_filter() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Aliases",
            path="/tmp/aliases",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        hdr = MediaFile(
            library_id=library.id,
            relative_path="hdr.mkv",
            filename="hdr.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
        )
        sdr = MediaFile(
            library_id=library.id,
            relative_path="sdr.mkv",
            filename="sdr.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=7,
        )
        db.add_all([hdr, sdr])
        db.flush()
        db.add_all(
            [
                VideoStream(
                    media_file_id=hdr.id,
                    stream_index=0,
                    codec="hevc",
                    width=3840,
                    height=2160,
                    hdr_type="Dolby Vision Profile 8",
                ),
                VideoStream(media_file_id=sdr.id, stream_index=0, codec="h264", width=1920, height=1080),
            ]
        )
        db.commit()

        four_k_files = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_resolution="4k"),
        )
        sdr_files = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_hdr_type="sdr"),
        )
        dv_files = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_hdr_type="dv"),
        )

    assert [item.filename for item in four_k_files.items] == ["hdr.mkv"]
    assert [item.filename for item in sdr_files.items] == ["sdr.mkv"]
    assert [item.filename for item in dv_files.items] == ["hdr.mkv"]


def test_list_library_files_matches_custom_resolution_category_labels_and_returns_grouped_resolution_fields() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        db.add(
            AppSetting(
                key="global",
                value={
                    "resolution_categories": [
                        {"id": "4k", "label": "UHD", "min_width": 3840, "min_height": 1600},
                        {"id": "1080p", "label": "Full HD", "min_width": 1920, "min_height": 800},
                        {"id": "sd", "label": "SD", "min_width": 0, "min_height": 0},
                    ]
                },
            )
        )
        library = Library(
            name="Custom resolution labels",
            path="/tmp/custom-resolution-labels",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="movie-uhd.mkv",
            filename="movie-uhd.mkv",
            extension="mkv",
            size_bytes=1,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
        )
        db.add(media_file)
        db.flush()
        db.add(VideoStream(media_file_id=media_file.id, stream_index=0, codec="hevc", width=3840, height=1606))
        db.commit()

        page = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_resolution="uhd"),
        )

    assert [item.filename for item in page.items] == ["movie-uhd.mkv"]
    assert page.items[0].resolution == "3840x1606"
    assert page.items[0].resolution_category_id == "4k"
    assert page.items[0].resolution_category_label == "UHD"


def test_list_library_files_matches_default_letterboxed_resolution_categories_by_width() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Cinema defaults",
            path="/tmp/cinema-defaults",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for index, (name, width, height) in enumerate(
            (
                ("movie-1080p.mkv", 1920, 800),
                ("movie-wqhd.mkv", 2560, 1066),
                ("movie-cropped-4k.mkv", 3832, 1596),
                ("movie-4k.mkv", 3840, 1606),
            ),
            start=1,
        ):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=name,
                filename=name,
                extension="mkv",
                size_bytes=index,
                mtime=float(index),
                scan_status=ScanStatus.ready,
                quality_score=8,
            )
            db.add(media_file)
            db.flush()
            db.add(VideoStream(media_file_id=media_file.id, stream_index=0, codec="hevc", width=width, height=height))
        db.commit()

        four_k_page = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_resolution="4k"),
        )
        ten_eighty_page = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_resolution="1080p"),
        )

    assert [item.filename for item in four_k_page.items] == ["movie-4k.mkv", "movie-cropped-4k.mkv"]
    assert [item.filename for item in ten_eighty_page.items] == ["movie-1080p.mkv", "movie-wqhd.mkv"]


def test_list_library_files_rejects_invalid_structured_search_expressions() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Invalid",
            path="/tmp/invalid",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.commit()

        try:
            list_library_files(
                db,
                library.id,
                limit=50,
                search_filters=LibraryFileSearchFilters(search_duration="abc"),
            )
            raised = None
        except SearchValidationError as exc:
            raised = exc

    assert raised is not None
    assert str(raised) == "Invalid search expression for duration"


def test_generate_library_files_csv_export_includes_all_filtered_rows_and_metadata() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Export Batch",
            path="/tmp/export-batch",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for index in range(1, 505):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=f"episode-{index:03d}.mkv",
                filename=f"episode-{index:03d}.mkv",
                extension="mkv",
                size_bytes=1_000 + index,
                mtime=float(index),
                scan_status=ScanStatus.ready,
                quality_score=7 if index % 2 == 0 else 5,
                quality_score_raw=70.0 if index % 2 == 0 else 50.0,
            )
            db.add(media_file)
            db.flush()
            db.add(
                MediaFormat(
                    media_file_id=media_file.id,
                    duration=1800.0 + index,
                )
            )
            db.add(
                VideoStream(
                    media_file_id=media_file.id,
                    stream_index=0,
                    codec="hevc" if index % 2 == 0 else "h264",
                    width=3840 if index % 2 == 0 else 1920,
                    height=2160 if index % 2 == 0 else 1080,
                    hdr_type="HDR10" if index % 2 == 0 else None,
                )
            )
            db.add(AudioStream(media_file_id=media_file.id, stream_index=1, codec="aac", language="eng"))
            if index % 2 == 0:
                db.add(
                    SubtitleStream(
                        media_file_id=media_file.id,
                        stream_index=2,
                        codec="srt",
                        language="eng",
                        default_flag=False,
                        forced_flag=False,
                    )
                )
                db.add(
                    ExternalSubtitle(
                        media_file_id=media_file.id,
                        path=f"episode-{index:03d}.en.srt",
                        language="eng",
                        format="srt",
                    )
                )
        db.commit()

        filename, chunks = generate_library_files_csv_export(
            db,
            library.id,
            library_name=library.name,
            search_filters=LibraryFileSearchFilters(
                file_search="episode",
                search_video_codec="hevc",
                search_subtitle_sources="internal ext",
            ),
            sort_key="quality_score",
            sort_direction="desc",
        )
        export_text = _collect_csv_export_text(chunks)

    assert filename.startswith("MediaLyze_Export_Batch_")
    comment_lines, rows = _split_csv_export(export_text)
    header, data_rows = rows[0], rows[1:]

    assert "# MediaLyze CSV export" in comment_lines
    assert f"# library_id: {library.id}" in comment_lines
    assert "# library_name: Export Batch" in comment_lines
    assert "# total_rows: 252" in comment_lines
    assert "# sort_key: quality_score" in comment_lines
    assert "# sort_direction: desc" in comment_lines
    assert "# search.file: episode" in comment_lines
    assert "# search.video_codec: hevc" in comment_lines
    assert "# search.subtitle_sources: internal ext" in comment_lines
    assert header == [
        "relative_path",
        "filename",
        "container",
        "size_bytes",
        "video_codec",
        "resolution",
        "hdr_type",
        "duration_seconds",
        "audio_bit_depth",
        "audio_title",
        "audio_artist",
        "audio_album",
        "audio_album_artist",
        "audio_genre",
        "audio_date",
        "audio_disc",
        "audio_composer",
        "audio_channels",
        "sample_rate",
        "track_number",
        "bit_rate_mode",
        "has_embedded_cover",
        "chapter_count",
        "audiobook_narrator",
        "audiobook_author",
        "audiobook_publisher",
        "audiobook_series",
        "audiobook_series_part",
        "audiobook_description",
        "audiobook_copyright",
        "audiobook_language",
        "audiobook_abridged",
        "audiobook_asin",
        "audiobook_isbn",
        "analysis_failure_kind",
        "analysis_failure_reason",
        "audio_codecs",
        "audio_spatial_profiles",
        "audio_languages",
        "subtitle_languages",
        "subtitle_codecs",
        "subtitle_sources",
        "mtime",
        "last_analyzed_at",
        "quality_score",
        "content_category",
        "series_title",
        "season_number",
        "episode_number",
        "episode_number_end",
        "episode_title",
    ]
    assert len(data_rows) == 252
    assert data_rows[0][0] == "episode-002.mkv"
    assert data_rows[0][2] == "mkv"
    assert data_rows[0][4] == "hevc"
    assert data_rows[0][5] == "3840x2160"
    assert data_rows[0][6] == "HDR10"
    assert data_rows[0][header.index("audio_codecs")] == "aac"
    assert data_rows[0][header.index("subtitle_codecs")] == "srt"
    assert data_rows[0][header.index("subtitle_sources")] == "external | internal"
    assert data_rows[0][header.index("content_category")] == "main"
    assert data_rows[0][header.index("series_title") :] == ["", "", "", "", ""]
    assert data_rows[-1][0] == "episode-504.mkv"


def test_generate_library_files_csv_export_reports_no_search_when_unfiltered() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="No Filters",
            path="/tmp/no-filters",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()
        media_file = MediaFile(
            library_id=library.id,
            relative_path="sample.mkv",
            filename="sample.mkv",
            extension="mkv",
            size_bytes=123,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
        )
        db.add(media_file)
        db.commit()

        _filename, chunks = generate_library_files_csv_export(db, library.id, library_name=library.name)
        export_text = _collect_csv_export_text(chunks)

    comment_lines, rows = _split_csv_export(export_text)

    assert "# search: none" in comment_lines
    assert rows[1][0] == "sample.mkv"
    assert rows[1][4] == ""
    assert rows[1][7] == ""


def test_list_library_files_matches_undefined_language_statistics_counts() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Undefined Language Search",
            path="/tmp/undefined-language-search",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for index in range(119):
            media_file = MediaFile(
                library_id=library.id,
                relative_path=f"episode-{index:03d}.mkv",
                filename=f"episode-{index:03d}.mkv",
                extension="mkv",
                size_bytes=100 + index,
                mtime=float(index + 1),
                scan_status=ScanStatus.ready,
                quality_score=5,
            )
            db.add(media_file)
            db.flush()
            db.add(AudioStream(media_file_id=media_file.id, stream_index=1, codec="aac", language=None))
            db.add(AudioStream(media_file_id=media_file.id, stream_index=2, codec="aac", language=""))

        german_audio = MediaFile(
            library_id=library.id,
            relative_path="german-audio.mkv",
            filename="german-audio.mkv",
            extension="mkv",
            size_bytes=999,
            mtime=150.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        subtitle_undefined = MediaFile(
            library_id=library.id,
            relative_path="subtitle-und.mkv",
            filename="subtitle-und.mkv",
            extension="mkv",
            size_bytes=1000,
            mtime=151.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        subtitle_english = MediaFile(
            library_id=library.id,
            relative_path="subtitle-en.mkv",
            filename="subtitle-en.mkv",
            extension="mkv",
            size_bytes=1001,
            mtime=152.0,
            scan_status=ScanStatus.ready,
            quality_score=5,
        )
        db.add_all([german_audio, subtitle_undefined, subtitle_english])
        db.flush()
        db.add(AudioStream(media_file_id=german_audio.id, stream_index=1, codec="aac", language="ger"))
        db.add_all(
            [
                SubtitleStream(
                    media_file_id=subtitle_undefined.id,
                    stream_index=2,
                    codec="subrip",
                    language=None,
                    default_flag=False,
                    forced_flag=False,
                ),
                ExternalSubtitle(
                    media_file_id=subtitle_undefined.id,
                    path="subtitle-und.und.srt",
                    language="",
                    format="srt",
                ),
                SubtitleStream(
                    media_file_id=subtitle_english.id,
                    stream_index=2,
                    codec="subrip",
                    language="eng",
                    default_flag=False,
                    forced_flag=False,
                ),
            ]
        )
        db.commit()

        statistics = get_library_statistics(db, library.id)
        und_audio_page = list_library_files(
            db,
            library.id,
            limit=200,
            search_filters=LibraryFileSearchFilters(search_audio_languages="und"),
        )
        de_audio_page = list_library_files(
            db,
            library.id,
            limit=200,
            search_filters=LibraryFileSearchFilters(search_audio_languages="de"),
        )
        und_subtitle_page = list_library_files(
            db,
            library.id,
            limit=200,
            search_filters=LibraryFileSearchFilters(search_subtitle_languages="und"),
        )
        en_subtitle_page = list_library_files(
            db,
            library.id,
            limit=200,
            search_filters=LibraryFileSearchFilters(search_subtitle_languages="en"),
        )

    assert statistics is not None
    audio_languages = {item.label: item.value for item in statistics.audio_language_distribution}
    subtitle_languages = {item.label: item.value for item in statistics.subtitle_language_distribution}
    assert audio_languages["und"] == 119
    assert und_audio_page.total == 119
    assert audio_languages["de"] == 1
    assert de_audio_page.total == 1
    assert subtitle_languages["und"] == 1
    assert und_subtitle_page.total == 1
    assert subtitle_languages["en"] == 1
    assert en_subtitle_page.total == 1


def test_list_library_files_matches_deduplicated_codec_and_source_statistics() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Deduplicated Filter Matches",
            path="/tmp/deduplicated-filter-matches",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        media_file = MediaFile(
            library_id=library.id,
            relative_path="episode-01.mkv",
            filename="episode-01.mkv",
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
                AudioStream(media_file_id=media_file.id, stream_index=1, codec="aac", language="eng"),
                AudioStream(media_file_id=media_file.id, stream_index=2, codec="aac", language="eng"),
                SubtitleStream(
                    media_file_id=media_file.id,
                    stream_index=3,
                    codec="subrip",
                    language="eng",
                    default_flag=False,
                    forced_flag=False,
                ),
                SubtitleStream(
                    media_file_id=media_file.id,
                    stream_index=4,
                    codec="subrip",
                    language="eng",
                    default_flag=False,
                    forced_flag=False,
                ),
                ExternalSubtitle(media_file_id=media_file.id, path="episode-01.en.srt", language="eng", format="subrip"),
            ]
        )
        db.commit()

        statistics = get_library_statistics(db, library.id)
        audio_codec_page = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_audio_codecs="aac"),
        )
        subtitle_codec_page = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_subtitle_codecs="subrip"),
        )
        subtitle_source_page = list_library_files(
            db,
            library.id,
            limit=50,
            search_filters=LibraryFileSearchFilters(search_subtitle_sources="internal"),
        )

    assert statistics is not None
    audio_codecs = {item.label: item.value for item in statistics.audio_codec_distribution}
    subtitle_codecs = {item.label: item.value for item in statistics.subtitle_codec_distribution}
    subtitle_sources = {item.label: item.value for item in statistics.subtitle_source_distribution}
    assert audio_codecs["aac"] == 1
    assert subtitle_codecs["subrip"] == 1
    assert subtitle_sources["internal"] == 1
    assert audio_codec_page.total == 1
    assert subtitle_codec_page.total == 1
    assert subtitle_source_page.total == 1


def test_grouped_library_files_page_counts_top_level_entries_and_loads_series_detail() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        library = Library(
            name="Shows",
            path="/tmp/grouped-shows",
            type=LibraryType.series,
            scan_mode=ScanMode.manual,
            scan_config={},
        )
        db.add(library)
        db.flush()

        series = MediaSeries(
            library_id=library.id,
            title="Example Show",
            normalized_title="example show",
            relative_path="Example Show",
            year=2024,
        )
        db.add(series)
        db.flush()

        season = MediaSeason(
            library_id=library.id,
            series_id=series.id,
            season_number=1,
            title="Season 1",
            relative_path="Example Show/Season 1",
        )
        db.add(season)
        db.flush()

        episode_one = MediaFile(
            library_id=library.id,
            relative_path="Example Show/Season 1/Example Show - S01E01.mkv",
            filename="Example Show - S01E01.mkv",
            extension="mkv",
            size_bytes=1024,
            mtime=1.0,
            scan_status=ScanStatus.ready,
            quality_score=8,
            duration_seconds=3600,
            bitrate=4_000_000,
            audio_bitrate=256_000,
            primary_video_codec="h264",
            primary_video_width=1920,
            primary_video_height=1080,
            primary_video_resolution_pixels=1920 * 1080,
            series_id=series.id,
            season_id=season.id,
            episode_number=1,
        )
        episode_two = MediaFile(
            library_id=library.id,
            relative_path="Example Show/Season 1/Example Show - S01E02.mkv",
            filename="Example Show - S01E02.mkv",
            extension="mkv",
            size_bytes=2048,
            mtime=2.0,
            scan_status=ScanStatus.ready,
            quality_score=7,
            duration_seconds=3500,
            bitrate=5_000_000,
            audio_bitrate=384_000,
            primary_video_codec="h264",
            primary_video_width=1920,
            primary_video_height=1080,
            primary_video_resolution_pixels=1920 * 1080,
            series_id=series.id,
            season_id=season.id,
            episode_number=2,
        )
        loose_file = MediaFile(
            library_id=library.id,
            relative_path="bonus/interview.mkv",
            filename="interview.mkv",
            extension="mkv",
            size_bytes=512,
            mtime=3.0,
            scan_status=ScanStatus.ready,
            quality_score=6,
        )
        db.add_all([episode_one, episode_two, loose_file])
        db.flush()
        db.add_all(
            [
                MediaFormat(media_file_id=episode_one.id, duration=3600, bit_rate=4_000_000),
                MediaFormat(media_file_id=episode_two.id, duration=3500, bit_rate=5_000_000),
                AudioStream(media_file_id=episode_one.id, stream_index=1, codec="aac", bit_rate=256_000),
                AudioStream(media_file_id=episode_two.id, stream_index=1, codec="aac", bit_rate=384_000),
            ]
        )
        db.commit()

        grouped_page = list_grouped_library_files(db, library.id, limit=50)
        grouped_detail = get_grouped_library_series_detail(db, library.id, series.id)

    assert grouped_page.total == 2
    assert [item.kind for item in grouped_page.items] == ["file", "series"]
    series_row = next(item for item in grouped_page.items if item.kind == "series")
    assert series_row.episode_count == 2
    assert series_row.season_count == 1
    assert series_row.total_size_bytes == 3072
    assert series_row.quality_score_average == 7.5
    assert series_row.bitrate_average == 4_500_000
    assert series_row.audio_bitrate_average == 320_000
    assert grouped_detail is not None
    assert grouped_detail.episode_count == 2
    assert grouped_detail.seasons[0].episode_count == 2
    assert [episode.filename for episode in grouped_detail.seasons[0].episodes] == [
        "Example Show - S01E01.mkv",
        "Example Show - S01E02.mkv",
    ]
