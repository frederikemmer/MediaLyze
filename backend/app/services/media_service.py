from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone
from typing import Iterator, Literal

from sqlalchemy import String, and_, case, cast, func, literal, select, union_all
from sqlalchemy.orm import Session, selectinload

from backend.app.models.entities import AudioStream, ExternalSubtitle, MediaFile, MediaFormat, SubtitleStream
from backend.app.schemas.media import (
    MediaFileDetail,
    MediaFileQualityScoreDetail,
    MediaFileStreamDetails,
    MediaFileTablePage,
    MediaFileTableRow,
)
from backend.app.schemas.quality import QualityBreakdownRead
from backend.app.services.app_settings import get_app_settings
from backend.app.services.languages import normalize_language_code
from backend.app.services.media_search import (
    LibraryFileSearchFilters,
    apply_field_search_filters,
    apply_legacy_search,
)
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.services.video_queries import primary_video_streams_subquery

FileSortKey = Literal[
    "file",
    "size",
    "video_codec",
    "resolution",
    "hdr_type",
    "duration",
    "audio_codecs",
    "audio_languages",
    "subtitle_languages",
    "subtitle_codecs",
    "subtitle_sources",
    "mtime",
    "last_analyzed_at",
    "quality_score",
]
FileSortDirection = Literal["asc", "desc"]

CSV_EXPORT_BATCH_SIZE = 500
CSV_EXPORT_HEADERS = [
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
CSV_EXPORT_FILTER_LABELS = {
    "file_search": "file",
    "search_size": "size",
    "search_quality_score": "quality_score",
    "search_video_codec": "video_codec",
    "search_resolution": "resolution",
    "search_hdr_type": "hdr_type",
    "search_duration": "duration",
    "search_audio_codecs": "audio_codecs",
    "search_audio_languages": "audio_languages",
    "search_subtitle_languages": "subtitle_languages",
    "search_subtitle_codecs": "subtitle_codecs",
    "search_subtitle_sources": "subtitle_sources",
}


def _normalize_subtitle_codec(value: str | None) -> str:
    candidate = (value or "").strip().lower()
    return candidate or "unknown"


def _normalize_audio_codec(value: str | None) -> str:
    candidate = (value or "").strip().lower()
    return candidate or "unknown"


def _subtitle_sources(media_file: MediaFile) -> list[str]:
    sources: set[str] = set()
    if media_file.subtitle_streams:
        sources.add("internal")
    if media_file.external_subtitles:
        sources.add("external")
    return sorted(sources)


def _row_from_model(media_file: MediaFile, resolution_categories=None) -> MediaFileTableRow:
    primary_video = min(media_file.video_streams, key=lambda stream: stream.stream_index, default=None)
    duration = media_file.media_format.duration if media_file.media_format else None
    resolution = None
    if primary_video and primary_video.width and primary_video.height:
        resolution = f"{primary_video.width}x{primary_video.height}"
    resolution_category = (
        classify_resolution_category(primary_video.width, primary_video.height, resolution_categories) if primary_video else None
    )

    return MediaFileTableRow(
        id=media_file.id,
        library_id=media_file.library_id,
        relative_path=media_file.relative_path,
        filename=media_file.filename,
        extension=media_file.extension,
        size_bytes=media_file.size_bytes,
        mtime=media_file.mtime,
        last_seen_at=media_file.last_seen_at,
        last_analyzed_at=media_file.last_analyzed_at,
        scan_status=media_file.scan_status,
        quality_score=media_file.quality_score,
        quality_score_raw=media_file.quality_score_raw,
        duration=duration,
        video_codec=primary_video.codec if primary_video else None,
        resolution=resolution,
        resolution_category_id=resolution_category.id if resolution_category else None,
        resolution_category_label=resolution_category.label if resolution_category else None,
        hdr_type=primary_video.hdr_type if primary_video else None,
        audio_codecs=sorted({_normalize_audio_codec(stream.codec) for stream in media_file.audio_streams}),
        audio_languages=sorted({normalize_language_code(stream.language) or "und" for stream in media_file.audio_streams}),
        subtitle_languages=sorted(
            {normalize_language_code(stream.language) or "und" for stream in media_file.subtitle_streams}
            | {normalize_language_code(subtitle.language) or "und" for subtitle in media_file.external_subtitles}
        ),
        subtitle_codecs=sorted(
            {_normalize_subtitle_codec(stream.codec) for stream in media_file.subtitle_streams}
            | {_normalize_subtitle_codec(subtitle.format) for subtitle in media_file.external_subtitles}
        ),
        subtitle_sources=_subtitle_sources(media_file),
    )


def _audio_aggregate_subquery(name: str = "audio_aggregates"):
    normalized_language = func.lower(func.trim(func.coalesce(AudioStream.language, "")))
    normalized_language = case(
        (func.length(normalized_language) == 0, "und"),
        else_=normalized_language,
    )
    normalized_codec = func.lower(func.trim(func.coalesce(AudioStream.codec, "")))
    normalized_codec = case(
        (func.length(normalized_codec) == 0, "unknown"),
        else_=normalized_codec,
    )
    distinct_values = (
        select(
            AudioStream.media_file_id.label("media_file_id"),
            normalized_language.label("language"),
            normalized_codec.label("codec"),
        )
        .distinct()
        .subquery(f"{name}_distinct_values")
    )
    return (
        select(
            distinct_values.c.media_file_id.label("media_file_id"),
            func.coalesce(func.min(distinct_values.c.language), "").label("min_audio_language"),
            func.coalesce(func.min(distinct_values.c.codec), "").label("min_audio_codec"),
            func.coalesce(func.group_concat(distinct_values.c.language, " "), "").label(
                "audio_languages_search"
            ),
            func.coalesce(func.group_concat(distinct_values.c.codec, " "), "").label(
                "audio_codecs_search"
            ),
        )
        .group_by(distinct_values.c.media_file_id)
        .subquery(name)
    )


def _subtitle_aggregate_subquery(name: str = "subtitle_aggregates"):
    language_values = union_all(
        select(
            SubtitleStream.media_file_id.label("media_file_id"),
            func.lower(func.coalesce(SubtitleStream.language, "")).label("value"),
        ),
        select(
            ExternalSubtitle.media_file_id.label("media_file_id"),
            func.lower(func.coalesce(ExternalSubtitle.language, "")).label("value"),
        ),
    ).subquery(f"{name}_language_values")
    codec_values = union_all(
        select(
            SubtitleStream.media_file_id.label("media_file_id"),
            func.lower(func.coalesce(SubtitleStream.codec, "")).label("value"),
        ),
        select(
            ExternalSubtitle.media_file_id.label("media_file_id"),
            func.lower(func.coalesce(ExternalSubtitle.format, "")).label("value"),
        ),
    ).subquery(f"{name}_codec_values")
    source_values = union_all(
        select(
            SubtitleStream.media_file_id.label("media_file_id"),
            literal(1).label("has_internal_subtitles"),
            literal(0).label("has_external_subtitles"),
        ),
        select(
            ExternalSubtitle.media_file_id.label("media_file_id"),
            literal(0).label("has_internal_subtitles"),
            literal(1).label("has_external_subtitles"),
        ),
    ).subquery(f"{name}_source_values")
    media_file_ids = union_all(
        select(SubtitleStream.media_file_id.label("media_file_id")),
        select(ExternalSubtitle.media_file_id.label("media_file_id")),
    ).subquery(f"{name}_file_ids")

    normalized_language_value = func.lower(func.trim(func.coalesce(language_values.c.value, "")))
    normalized_language_value = case(
        (func.length(normalized_language_value) == 0, "und"),
        else_=normalized_language_value,
    )
    normalized_codec_value = func.lower(func.trim(func.coalesce(codec_values.c.value, "")))
    normalized_codec_value = case(
        (func.length(normalized_codec_value) == 0, "unknown"),
        else_=normalized_codec_value,
    )
    distinct_language_values = (
        select(
            language_values.c.media_file_id.label("media_file_id"),
            normalized_language_value.label("value"),
        )
        .distinct()
        .subquery(f"{name}_distinct_language_values")
    )
    distinct_codec_values = (
        select(
            codec_values.c.media_file_id.label("media_file_id"),
            normalized_codec_value.label("value"),
        )
        .distinct()
        .subquery(f"{name}_distinct_codec_values")
    )
    language_aggregates = (
        select(
            distinct_language_values.c.media_file_id,
            func.coalesce(func.min(distinct_language_values.c.value), "").label("min_subtitle_language"),
            func.coalesce(func.group_concat(distinct_language_values.c.value, " "), "").label("subtitle_languages_search"),
        )
        .group_by(distinct_language_values.c.media_file_id)
        .subquery(f"{name}_language_aggregates")
    )
    codec_aggregates = (
        select(
            distinct_codec_values.c.media_file_id,
            func.coalesce(func.min(distinct_codec_values.c.value), "").label("min_subtitle_codec"),
            func.coalesce(func.group_concat(distinct_codec_values.c.value, " "), "").label("subtitle_codecs_search"),
        )
        .group_by(distinct_codec_values.c.media_file_id)
        .subquery(f"{name}_codec_aggregates")
    )
    source_aggregates = (
        select(
            source_values.c.media_file_id,
            func.max(source_values.c.has_internal_subtitles).label("has_internal_subtitles"),
            func.max(source_values.c.has_external_subtitles).label("has_external_subtitles"),
        )
        .group_by(source_values.c.media_file_id)
        .subquery(f"{name}_source_aggregates")
    )
    base_ids = (
        select(media_file_ids.c.media_file_id)
        .group_by(media_file_ids.c.media_file_id)
        .subquery(f"{name}_base_ids")
    )

    return (
        select(
            base_ids.c.media_file_id,
            func.coalesce(language_aggregates.c.min_subtitle_language, "").label("min_subtitle_language"),
            func.coalesce(codec_aggregates.c.min_subtitle_codec, "").label("min_subtitle_codec"),
            func.coalesce(language_aggregates.c.subtitle_languages_search, "").label("subtitle_languages_search"),
            func.coalesce(codec_aggregates.c.subtitle_codecs_search, "").label("subtitle_codecs_search"),
            func.coalesce(source_aggregates.c.has_internal_subtitles, 0).label("has_internal_subtitles"),
            func.coalesce(source_aggregates.c.has_external_subtitles, 0).label("has_external_subtitles"),
        )
        .select_from(base_ids)
        .outerjoin(language_aggregates, language_aggregates.c.media_file_id == base_ids.c.media_file_id)
        .outerjoin(codec_aggregates, codec_aggregates.c.media_file_id == base_ids.c.media_file_id)
        .outerjoin(source_aggregates, source_aggregates.c.media_file_id == base_ids.c.media_file_id)
        .subquery(name)
    )


def _subtitle_source_sort_expr(subtitle_aggregates):
    has_internal = func.coalesce(subtitle_aggregates.c.has_internal_subtitles, 0)
    has_external = func.coalesce(subtitle_aggregates.c.has_external_subtitles, 0)
    return case(
        (and_(has_internal == 1, has_external == 1), "internal,external"),
        (has_internal == 1, "internal"),
        (has_external == 1, "external"),
        else_="",
    )


def _sort_expression(sort_key: FileSortKey, primary_video_streams, audio_aggregates, subtitle_aggregates):
    resolution_pixels = case(
        (
            and_(primary_video_streams.c.width.is_not(None), primary_video_streams.c.height.is_not(None)),
            primary_video_streams.c.width * primary_video_streams.c.height,
        ),
        else_=-1,
    )

    sort_map = {
        "file": func.lower(MediaFile.relative_path),
        "size": MediaFile.size_bytes,
        "video_codec": func.lower(func.coalesce(primary_video_streams.c.codec, "")),
        "resolution": resolution_pixels,
        "hdr_type": func.lower(func.coalesce(primary_video_streams.c.hdr_type, "")),
        "duration": func.coalesce(MediaFormat.duration, 0),
        "audio_codecs": func.coalesce(audio_aggregates.c.min_audio_codec, ""),
        "audio_languages": func.coalesce(audio_aggregates.c.min_audio_language, ""),
        "subtitle_languages": func.coalesce(subtitle_aggregates.c.min_subtitle_language, ""),
        "subtitle_codecs": func.coalesce(subtitle_aggregates.c.min_subtitle_codec, ""),
        "subtitle_sources": _subtitle_source_sort_expr(subtitle_aggregates),
        "mtime": MediaFile.mtime,
        "last_analyzed_at": func.coalesce(cast(MediaFile.last_analyzed_at, String), ""),
        "quality_score": case((MediaFile.quality_score_raw > 0, MediaFile.quality_score_raw), else_=MediaFile.quality_score * 10),
    }
    return sort_map[sort_key]


def _load_media_files_by_ids(db: Session, selected_ids: list[int]) -> list[MediaFile]:
    if not selected_ids:
        return []

    files = db.scalars(
        select(MediaFile)
        .where(MediaFile.id.in_(selected_ids))
        .options(
            selectinload(MediaFile.media_format),
            selectinload(MediaFile.video_streams),
            selectinload(MediaFile.audio_streams),
            selectinload(MediaFile.subtitle_streams),
            selectinload(MediaFile.external_subtitles),
        )
    ).all()

    order_map = {file_id: index for index, file_id in enumerate(selected_ids)}
    files.sort(key=lambda media_file: order_map[media_file.id])
    return files


def _build_library_file_id_query(
    db: Session,
    library_id: int,
    *,
    search: str = "",
    search_filters: LibraryFileSearchFilters | None = None,
    sort_key: FileSortKey = "file",
    sort_direction: FileSortDirection = "asc",
):
    primary_video_streams = primary_video_streams_subquery("media_list_primary_video")
    audio_aggregates = _audio_aggregate_subquery("media_list_audio_aggregates")
    subtitle_aggregates = _subtitle_aggregate_subquery("media_list_subtitle_aggregates")

    base_query = (
        select(MediaFile.id)
        .select_from(MediaFile)
        .outerjoin(MediaFormat, MediaFormat.media_file_id == MediaFile.id)
        .outerjoin(primary_video_streams, primary_video_streams.c.media_file_id == MediaFile.id)
        .outerjoin(audio_aggregates, audio_aggregates.c.media_file_id == MediaFile.id)
        .outerjoin(subtitle_aggregates, subtitle_aggregates.c.media_file_id == MediaFile.id)
        .where(MediaFile.library_id == library_id)
    )
    filtered_query = apply_legacy_search(base_query, primary_video_streams, audio_aggregates, subtitle_aggregates, search)
    filtered_query = apply_field_search_filters(
        filtered_query,
        primary_video_streams,
        audio_aggregates,
        subtitle_aggregates,
        search_filters,
        get_app_settings(db).resolution_categories,
    )
    sort_expression = _sort_expression(sort_key, primary_video_streams, audio_aggregates, subtitle_aggregates)
    return filtered_query.order_by(
        sort_expression.desc() if sort_direction == "desc" else sort_expression.asc(),
        func.lower(MediaFile.relative_path).asc(),
    )


def _active_export_search_entries(
    search: str,
    search_filters: LibraryFileSearchFilters | None,
) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    legacy_search = search.strip()
    if legacy_search:
        entries.append(("legacy", legacy_search))

    normalized_filters = (search_filters or LibraryFileSearchFilters()).normalized()
    for field_name, label in CSV_EXPORT_FILTER_LABELS.items():
        value = getattr(normalized_filters, field_name)
        if value:
            entries.append((label, value))
    return entries


def _csv_export_filename(library_name: str, exported_at: datetime) -> str:
    safe_library_name = re.sub(r"[^A-Za-z0-9]+", "_", library_name.strip()).strip("_")
    safe_slug = safe_library_name or "Library"
    timestamp = exported_at.strftime("%Y%m%dT%H%M%SZ")
    return f"MediaLyze_{safe_slug}_{timestamp}.csv"


def _csv_export_comment_lines(
    *,
    library_id: int,
    library_name: str,
    total_rows: int,
    sort_key: FileSortKey,
    sort_direction: FileSortDirection,
    exported_at: datetime,
    search: str,
    search_filters: LibraryFileSearchFilters | None,
) -> list[str]:
    lines = [
        "# MediaLyze CSV export",
        f"# library_id: {library_id}",
        f"# library_name: {library_name}",
        f"# exported_at_utc: {exported_at.isoformat().replace('+00:00', 'Z')}",
        f"# total_rows: {total_rows}",
        f"# sort_key: {sort_key}",
        f"# sort_direction: {sort_direction}",
    ]
    active_entries = _active_export_search_entries(search, search_filters)
    if not active_entries:
        lines.append("# search: none")
        return lines

    for field_name, value in active_entries:
        lines.append(f"# search.{field_name}: {value}")
    return lines


def _stringify_export_scalar(value: str | int | float | datetime | None) -> str | int | float:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    return value


def _csv_export_row(row: MediaFileTableRow) -> list[str | int | float]:
    return [
        row.relative_path,
        row.filename,
        row.size_bytes,
        row.video_codec or "",
        row.resolution or "",
        row.hdr_type or "",
        _stringify_export_scalar(row.duration),
        " | ".join(row.audio_codecs),
        " | ".join(row.audio_languages),
        " | ".join(row.subtitle_languages),
        " | ".join(row.subtitle_codecs),
        " | ".join(row.subtitle_sources),
        _stringify_export_scalar(row.mtime),
        _stringify_export_scalar(row.last_analyzed_at),
        row.quality_score,
    ]


def generate_library_files_csv_export(
    db: Session,
    library_id: int,
    *,
    library_name: str,
    search: str = "",
    search_filters: LibraryFileSearchFilters | None = None,
    sort_key: FileSortKey = "file",
    sort_direction: FileSortDirection = "asc",
) -> tuple[str, Iterator[bytes]]:
    ordered_query = _build_library_file_id_query(
        db,
        library_id,
        search=search,
        search_filters=search_filters,
        sort_key=sort_key,
        sort_direction=sort_direction,
    )
    total = db.scalar(select(func.count()).select_from(ordered_query.order_by(None).subquery())) or 0
    exported_at = datetime.now(timezone.utc).replace(microsecond=0)
    filename = _csv_export_filename(library_name, exported_at)
    comment_lines = _csv_export_comment_lines(
        library_id=library_id,
        library_name=library_name,
        total_rows=total,
        sort_key=sort_key,
        sort_direction=sort_direction,
        exported_at=exported_at,
        search=search,
        search_filters=search_filters,
    )

    def iter_csv_chunks() -> Iterator[bytes]:
        yield "\ufeff".encode("utf-8")

        initial_buffer = io.StringIO()
        initial_writer = csv.writer(initial_buffer, lineterminator="\n")
        initial_buffer.write("\n".join(comment_lines))
        initial_buffer.write("\n\n")
        initial_writer.writerow(CSV_EXPORT_HEADERS)
        yield initial_buffer.getvalue().encode("utf-8")

        for offset in range(0, total, CSV_EXPORT_BATCH_SIZE):
            selected_ids = list(db.scalars(ordered_query.offset(offset).limit(CSV_EXPORT_BATCH_SIZE)).all())
            files = _load_media_files_by_ids(db, selected_ids)
            if not files:
                continue

            batch_buffer = io.StringIO()
            batch_writer = csv.writer(batch_buffer, lineterminator="\n")
            for media_file in files:
                batch_writer.writerow(_csv_export_row(_row_from_model(media_file, get_app_settings(db).resolution_categories)))
            yield batch_buffer.getvalue().encode("utf-8")

    return filename, iter_csv_chunks()


def list_library_files(
    db: Session,
    library_id: int,
    *,
    offset: int = 0,
    limit: int = 50,
    search: str = "",
    search_filters: LibraryFileSearchFilters | None = None,
    sort_key: FileSortKey = "file",
    sort_direction: FileSortDirection = "asc",
) -> MediaFileTablePage:
    ordered_query = _build_library_file_id_query(
        db,
        library_id,
        search=search,
        search_filters=search_filters,
        sort_key=sort_key,
        sort_direction=sort_direction,
    )
    total = db.scalar(select(func.count()).select_from(ordered_query.order_by(None).subquery())) or 0
    selected_ids = list(db.scalars(ordered_query.offset(offset).limit(limit)).all())

    if not selected_ids:
        return MediaFileTablePage(total=total, offset=offset, limit=limit, items=[])

    files = _load_media_files_by_ids(db, selected_ids)
    resolution_categories = get_app_settings(db).resolution_categories
    return MediaFileTablePage(
        total=total,
        offset=offset,
        limit=limit,
        items=[_row_from_model(media_file, resolution_categories) for media_file in files],
    )


def get_media_file_detail(db: Session, file_id: int) -> MediaFileDetail | None:
    media_file = db.scalar(
        select(MediaFile)
        .where(MediaFile.id == file_id)
        .options(
            selectinload(MediaFile.media_format),
            selectinload(MediaFile.video_streams),
            selectinload(MediaFile.audio_streams),
            selectinload(MediaFile.subtitle_streams),
            selectinload(MediaFile.external_subtitles),
        )
    )
    if not media_file:
        return None

    row = _row_from_model(media_file, get_app_settings(db).resolution_categories)
    return MediaFileDetail(
        **row.model_dump(),
        media_format=media_file.media_format,
        video_streams=media_file.video_streams,
        audio_streams=media_file.audio_streams,
        subtitle_streams=media_file.subtitle_streams,
        external_subtitles=media_file.external_subtitles,
        raw_ffprobe_json=media_file.raw_ffprobe_json,
    )


def get_media_file_stream_details(db: Session, file_id: int) -> MediaFileStreamDetails | None:
    media_file = db.scalar(
        select(MediaFile)
        .where(MediaFile.id == file_id)
        .options(
            selectinload(MediaFile.video_streams),
            selectinload(MediaFile.audio_streams),
            selectinload(MediaFile.subtitle_streams),
            selectinload(MediaFile.external_subtitles),
        )
    )
    if not media_file:
        return None

    return MediaFileStreamDetails(
        id=media_file.id,
        video_streams=sorted(media_file.video_streams, key=lambda stream: stream.stream_index),
        audio_streams=sorted(media_file.audio_streams, key=lambda stream: stream.stream_index),
        subtitle_streams=sorted(media_file.subtitle_streams, key=lambda stream: stream.stream_index),
        external_subtitles=sorted(media_file.external_subtitles, key=lambda subtitle: subtitle.path.lower()),
    )


def get_media_file_quality_score_detail(db: Session, file_id: int) -> MediaFileQualityScoreDetail | None:
    media_file = db.get(MediaFile, file_id)
    if media_file is None:
        return None

    breakdown_payload = media_file.quality_score_breakdown or {
        "score": media_file.quality_score,
        "score_raw": media_file.quality_score_raw,
        "categories": [],
    }
    return MediaFileQualityScoreDetail(
        id=media_file.id,
        score=media_file.quality_score,
        score_raw=media_file.quality_score_raw,
        breakdown=QualityBreakdownRead.model_validate(breakdown_payload),
    )
