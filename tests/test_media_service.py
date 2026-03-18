import csv
import io

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
from backend.app.services.media_search import LibraryFileSearchFilters, SearchValidationError
from backend.app.services.media_service import generate_library_files_csv_export, list_library_files


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
                MediaFormat(media_file_id=short.id, duration=1800.0),
                MediaFormat(media_file_id=feature.id, duration=7200.0),
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

    assert [item.filename for item in large_files.items] == ["feature.mkv"]
    assert [item.filename for item in long_files.items] == ["feature.mkv"]
    assert [item.filename for item in high_scores.items] == ["feature.mkv"]


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

    assert filename.startswith("medialyze-export-batch-files-")
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
        "size_bytes",
        "video_codec",
        "resolution",
        "hdr_type",
        "duration_seconds",
        "audio_codecs",
        "audio_languages",
        "subtitle_languages",
        "subtitle_codecs",
        "subtitle_sources",
        "mtime",
        "last_analyzed_at",
        "quality_score",
    ]
    assert len(data_rows) == 252
    assert data_rows[0][0] == "episode-002.mkv"
    assert data_rows[0][3] == "hevc"
    assert data_rows[0][4] == "3840x2160"
    assert data_rows[0][5] == "HDR10"
    assert data_rows[0][7] == "aac"
    assert data_rows[0][10] == "srt"
    assert data_rows[0][11] == "external | internal"
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
    assert rows[1][3] == ""
    assert rows[1][7] == ""
