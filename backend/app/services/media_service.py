from __future__ import annotations

import csv
import base64
import io
import json
import re
from types import SimpleNamespace
from datetime import datetime, timezone
from typing import Iterator, Literal

from sqlalchemy import Float, String, and_, case, cast, func, literal, or_, select, union_all
from sqlalchemy.orm import Session, selectinload

from backend.app.models.entities import (
    AudioStream,
    ExternalSubtitle,
    MediaFile,
    MediaFileHistory,
    MediaFormat,
    SubtitleStream,
)
from backend.app.schemas.media import (
    MediaFileDetail,
    MediaFileHistoryEntryRead,
    MediaFileHistoryRead,
    MediaFileQualityScoreDetail,
    MediaFileStreamDetails,
    MediaFileTablePage,
    MediaFileTableRow,
)
from backend.app.schemas.quality import QualityBreakdownRead
from backend.app.services.app_settings import get_app_settings
from backend.app.services.container_formats import normalize_container
from backend.app.services.languages import normalize_language_code
from backend.app.services.media_search import (
    LibraryFileSearchFilters,
    apply_field_search_filters,
    apply_legacy_search,
)
from backend.app.services.numeric_distributions import (
    audio_bitrate_value_expression,
    bitrate_value_expression,
    build_audio_bitrate_subquery,
)
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.services.spatial_audio import format_spatial_audio_profile
from backend.app.services.video_queries import primary_video_streams_subquery

FileSortKey = Literal[
    "file",
    "container",
    "size",
    "video_codec",
    "resolution",
    "hdr_type",
    "duration",
    "bitrate",
    "audio_bitrate",
    "audio_codecs",
    "audio_spatial_profiles",
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
    "container",
    "size_bytes",
    "video_codec",
    "resolution",
    "hdr_type",
    "duration_seconds",
    "audio_codecs",
    "audio_spatial_profiles",
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
    "search_container": "container",
    "search_size": "size",
    "search_quality_score": "quality_score",
    "search_bitrate": "bitrate",
    "search_audio_bitrate": "audio_bitrate",
    "search_video_codec": "video_codec",
    "search_resolution": "resolution",
    "search_hdr_type": "hdr_type",
    "search_duration": "duration",
    "search_audio_codecs": "audio_codecs",
    "search_audio_spatial_profiles": "audio_spatial_profiles",
    "search_audio_languages": "audio_languages",
    "search_subtitle_languages": "subtitle_languages",
    "search_subtitle_codecs": "subtitle_codecs",
    "search_subtitle_sources": "subtitle_sources",
}


def _encode_cursor(sort_value, relative_path: str) -> str:
    payload = json.dumps(
        {"value": sort_value, "path": relative_path.lower()},
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(value: str | None) -> dict | None:
    if not value:
        return None
    try:
        padding = "=" * (-len(value) % 4)
        payload = base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))
        decoded = json.loads(payload.decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(decoded, dict) or "path" not in decoded:
        return None
    return decoded


def _cursor_sort_value(row: MediaFileTableRow, sort_key: FileSortKey):
    if sort_key == "file":
        return row.relative_path.lower()
    if sort_key == "container":
        return (row.extension or "").lower()
    if sort_key == "size":
        return row.size_bytes
    if sort_key == "video_codec":
        return (row.video_codec or "").lower()
    if sort_key == "resolution":
        return _resolution_pixels(row)
    if sort_key == "hdr_type":
        return (row.hdr_type or "").lower()
    if sort_key == "duration":
        return row.duration or 0
    if sort_key == "bitrate":
        return row.bitrate or 0
    if sort_key == "audio_bitrate":
        return row.audio_bitrate or 0
    if sort_key == "audio_codecs":
        return min(row.audio_codecs, default="")
    if sort_key == "audio_spatial_profiles":
        return min(row.audio_spatial_profiles, default="")
    if sort_key == "audio_languages":
        return min(row.audio_languages, default="")
    if sort_key == "subtitle_languages":
        return min(row.subtitle_languages, default="")
    if sort_key == "subtitle_codecs":
        return min(row.subtitle_codecs, default="")
    if sort_key == "subtitle_sources":
        return ",".join(row.subtitle_sources)
    if sort_key == "mtime":
        return row.mtime
    if sort_key == "last_analyzed_at":
        return row.last_analyzed_at.isoformat() if row.last_analyzed_at else ""
    if sort_key == "quality_score":
        return row.quality_score_raw if row.quality_score_raw > 0 else row.quality_score * 10
    return row.relative_path.lower()


def _resolution_pixels(row: MediaFileTableRow) -> int:
    if not row.resolution:
        return -1
    width, _, height = row.resolution.partition("x")
    try:
        return int(width) * int(height)
    except ValueError:
        return -1


def _apply_cursor(query, sort_expression, sort_direction: FileSortDirection, cursor: dict | None):
    if not cursor:
        return query
    cursor_path = str(cursor.get("path") or "")
    cursor_value = cursor.get("value")
    path_expression = func.lower(MediaFile.relative_path)
    sort_clause = sort_expression < cursor_value if sort_direction == "desc" else sort_expression > cursor_value
    return query.where(
        or_(
            sort_clause,
            and_(sort_expression == cursor_value, path_expression > cursor_path),
        )
    )


def _normalize_subtitle_codec(value: str | None) -> str:
    candidate = (value or "").strip().lower()
    return candidate or "unknown"


def _normalize_audio_codec(value: str | None) -> str:
    candidate = (value or "").strip().lower()
    return candidate or "unknown"


def _container_value(media_file: MediaFile) -> str | None:
    return normalize_container(media_file.extension)


def _audio_spatial_profiles(media_file: MediaFile) -> list[str]:
    return sorted(
        {
            label
            for label in (
                format_spatial_audio_profile(stream.spatial_audio_profile)
                for stream in media_file.audio_streams
            )
            if label
        }
    )


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
    bitrate = media_file.media_format.bit_rate if media_file.media_format else None
    audio_bitrate = sum(max(stream.bit_rate or 0, 0) for stream in media_file.audio_streams) or None
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
        container=_container_value(media_file),
        duration=duration,
        bitrate=bitrate,
        audio_bitrate=audio_bitrate,
        video_codec=primary_video.codec if primary_video else None,
        resolution=resolution,
        resolution_category_id=resolution_category.id if resolution_category else None,
        resolution_category_label=resolution_category.label if resolution_category else None,
        hdr_type=primary_video.hdr_type if primary_video else None,
        audio_codecs=sorted({_normalize_audio_codec(stream.codec) for stream in media_file.audio_streams}),
        audio_spatial_profiles=_audio_spatial_profiles(media_file),
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
    normalized_spatial_audio_profile = func.lower(func.trim(func.coalesce(AudioStream.spatial_audio_profile, "")))
    normalized_spatial_audio_profile = case(
        (func.length(normalized_spatial_audio_profile) == 0, ""),
        else_=normalized_spatial_audio_profile,
    )
    distinct_values = (
        select(
            AudioStream.media_file_id.label("media_file_id"),
            normalized_language.label("language"),
            normalized_codec.label("codec"),
            normalized_spatial_audio_profile.label("spatial_audio_profile"),
        )
        .distinct()
        .subquery(f"{name}_distinct_values")
    )
    audio_bitrate_totals = build_audio_bitrate_subquery(f"{name}_bitrate_totals")
    return (
        select(
            distinct_values.c.media_file_id.label("media_file_id"),
            func.coalesce(func.min(distinct_values.c.language), "").label("min_audio_language"),
            func.coalesce(func.min(distinct_values.c.codec), "").label("min_audio_codec"),
            func.coalesce(func.min(distinct_values.c.spatial_audio_profile), "").label("min_audio_spatial_profile"),
            func.coalesce(func.group_concat(distinct_values.c.language, " "), "").label(
                "audio_languages_search"
            ),
            func.coalesce(func.group_concat(distinct_values.c.codec, " "), "").label(
                "audio_codecs_search"
            ),
            func.coalesce(
                func.group_concat(
                    case((distinct_values.c.spatial_audio_profile == "", None), else_=distinct_values.c.spatial_audio_profile),
                    " ",
                ),
                "",
            ).label("audio_spatial_profiles_search"),
            func.coalesce(func.max(audio_bitrate_totals.c.total_audio_bitrate), 0).label("total_audio_bitrate"),
        )
        .outerjoin(audio_bitrate_totals, audio_bitrate_totals.c.media_file_id == distinct_values.c.media_file_id)
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
        "container": func.lower(func.coalesce(MediaFile.extension, "")),
        "size": MediaFile.size_bytes,
        "video_codec": func.lower(func.coalesce(primary_video_streams.c.codec, "")),
        "resolution": resolution_pixels,
        "hdr_type": func.lower(func.coalesce(primary_video_streams.c.hdr_type, "")),
        "duration": func.coalesce(MediaFile.duration_seconds, 0),
        "bitrate": func.coalesce(cast(MediaFile.bitrate, Float), 0),
        "audio_bitrate": func.coalesce(cast(MediaFile.audio_bitrate, Float), 0),
        "audio_codecs": func.coalesce(audio_aggregates.c.min_audio_codec, ""),
        "audio_spatial_profiles": func.coalesce(audio_aggregates.c.min_audio_spatial_profile, ""),
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
    _ensure_library_search_fields(db, library_id)
    primary_video_streams = SimpleNamespace(
        c=SimpleNamespace(
            codec=MediaFile.primary_video_codec,
            width=MediaFile.primary_video_width,
            height=MediaFile.primary_video_height,
            hdr_type=MediaFile.primary_video_hdr_type,
        )
    )
    audio_aggregates = SimpleNamespace(
        c=SimpleNamespace(
            min_audio_language=MediaFile.min_audio_language,
            min_audio_codec=MediaFile.min_audio_codec,
            min_audio_spatial_profile=MediaFile.min_audio_spatial_profile,
            audio_languages_search=MediaFile.audio_languages_search,
            audio_codecs_search=MediaFile.audio_codecs_search,
            audio_spatial_profiles_search=MediaFile.audio_spatial_profiles_search,
            total_audio_bitrate=MediaFile.audio_bitrate,
        )
    )
    subtitle_aggregates = SimpleNamespace(
        c=SimpleNamespace(
            min_subtitle_language=MediaFile.min_subtitle_language,
            min_subtitle_codec=MediaFile.min_subtitle_codec,
            subtitle_languages_search=MediaFile.subtitle_languages_search,
            subtitle_codecs_search=MediaFile.subtitle_codecs_search,
            has_internal_subtitles=MediaFile.has_internal_subtitles,
            has_external_subtitles=MediaFile.has_external_subtitles,
        )
    )

    base_query = (
        select(MediaFile.id)
        .select_from(MediaFile)
        .where(MediaFile.library_id == library_id)
    )
    filtered_query = apply_legacy_search(base_query, primary_video_streams, audio_aggregates, subtitle_aggregates, search)
    filtered_query = apply_field_search_filters(
        filtered_query,
        primary_video_streams,
        audio_aggregates,
        subtitle_aggregates,
        search_filters,
        bitrate_expression=MediaFile.bitrate,
        audio_bitrate_expression=MediaFile.audio_bitrate,
        duration_expression=MediaFile.duration_seconds,
        resolution_categories=get_app_settings(db).resolution_categories,
    )
    sort_expression = _sort_expression(sort_key, primary_video_streams, audio_aggregates, subtitle_aggregates)
    return filtered_query.order_by(
        sort_expression.desc() if sort_direction == "desc" else sort_expression.asc(),
        func.lower(MediaFile.relative_path).asc(),
    )


def _ensure_library_search_fields(db: Session, library_id: int) -> None:
    needs_backfill = db.scalar(
        select(func.count())
        .select_from(MediaFile)
        .where(MediaFile.library_id == library_id, MediaFile.search_fields_version < 1)
    )
    if not needs_backfill:
        return
    from backend.app.db.session import _backfill_media_file_search_fields

    with db.get_bind().begin() as connection:
        _backfill_media_file_search_fields(connection)


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
        row.container or "",
        row.size_bytes,
        row.video_codec or "",
        row.resolution or "",
        row.hdr_type or "",
        _stringify_export_scalar(row.duration),
        " | ".join(row.audio_codecs),
        " | ".join(row.audio_spatial_profiles),
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
    cursor: str | None = None,
    include_total: bool = True,
) -> MediaFileTablePage:
    ordered_query = _build_library_file_id_query(
        db,
        library_id,
        search=search,
        search_filters=search_filters,
        sort_key=sort_key,
        sort_direction=sort_direction,
    )
    total = (
        (db.scalar(select(func.count()).select_from(ordered_query.order_by(None).subquery())) or 0)
        if include_total
        else None
    )
    cursor_payload = _decode_cursor(cursor)
    if cursor_payload:
        primary_video_streams = SimpleNamespace(
            c=SimpleNamespace(
                codec=MediaFile.primary_video_codec,
                width=MediaFile.primary_video_width,
                height=MediaFile.primary_video_height,
                hdr_type=MediaFile.primary_video_hdr_type,
            )
        )
        audio_aggregates = SimpleNamespace(
            c=SimpleNamespace(
                min_audio_language=MediaFile.min_audio_language,
                min_audio_codec=MediaFile.min_audio_codec,
                min_audio_spatial_profile=MediaFile.min_audio_spatial_profile,
                total_audio_bitrate=MediaFile.audio_bitrate,
            )
        )
        subtitle_aggregates = SimpleNamespace(
            c=SimpleNamespace(
                min_subtitle_language=MediaFile.min_subtitle_language,
                min_subtitle_codec=MediaFile.min_subtitle_codec,
                has_internal_subtitles=MediaFile.has_internal_subtitles,
                has_external_subtitles=MediaFile.has_external_subtitles,
            )
        )
        sort_expression = _sort_expression(sort_key, primary_video_streams, audio_aggregates, subtitle_aggregates)
        ordered_query = _apply_cursor(ordered_query, sort_expression, sort_direction, cursor_payload)
        offset = 0

    selected_ids = list(db.scalars(ordered_query.offset(offset).limit(limit + 1)).all())
    has_more = len(selected_ids) > limit
    selected_ids = selected_ids[:limit]

    if not selected_ids:
        return MediaFileTablePage(total=total, offset=offset, limit=limit, items=[], has_more=False)

    files = _load_media_files_by_ids(db, selected_ids)
    resolution_categories = get_app_settings(db).resolution_categories
    rows = [_row_from_model(media_file, resolution_categories) for media_file in files]
    next_cursor = (
        _encode_cursor(_cursor_sort_value(rows[-1], sort_key), rows[-1].relative_path)
        if has_more and rows
        else None
    )
    return MediaFileTablePage(
        total=total,
        offset=offset,
        limit=limit,
        next_cursor=next_cursor,
        has_more=has_more,
        items=rows,
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

    return serialize_media_file_detail(media_file, get_app_settings(db).resolution_categories)


def serialize_media_file_detail(media_file: MediaFile, resolution_categories=None) -> MediaFileDetail:
    row = _row_from_model(media_file, resolution_categories)
    return MediaFileDetail(
        **row.model_dump(),
        media_format=media_file.media_format,
        video_streams=sorted(media_file.video_streams, key=lambda stream: stream.stream_index),
        audio_streams=sorted(media_file.audio_streams, key=lambda stream: stream.stream_index),
        subtitle_streams=sorted(media_file.subtitle_streams, key=lambda stream: stream.stream_index),
        external_subtitles=sorted(media_file.external_subtitles, key=lambda subtitle: subtitle.path.lower()),
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


def get_media_file_history(db: Session, file_id: int, *, limit: int = 50) -> MediaFileHistoryRead | None:
    media_file = db.get(MediaFile, file_id)
    if media_file is None:
        return None

    base_query = select(MediaFileHistory).where(
        MediaFileHistory.library_id == media_file.library_id,
        or_(
            MediaFileHistory.media_file_id == media_file.id,
            MediaFileHistory.relative_path == media_file.relative_path,
        ),
    )
    total = db.scalar(select(func.count()).select_from(base_query.subquery())) or 0
    entries = db.scalars(
        base_query.order_by(
            MediaFileHistory.captured_at.desc(),
            MediaFileHistory.id.desc(),
        ).limit(limit)
    ).all()

    return MediaFileHistoryRead(
        file_id=media_file.id,
        library_id=media_file.library_id,
        relative_path=media_file.relative_path,
        total=total,
        items=[
            MediaFileHistoryEntryRead(
                id=entry.id,
                media_file_id=entry.media_file_id,
                library_id=entry.library_id,
                relative_path=entry.relative_path,
                filename=entry.filename,
                captured_at=entry.captured_at,
                capture_reason=entry.capture_reason,
                snapshot_hash=entry.snapshot_hash,
                snapshot=entry.snapshot if isinstance(entry.snapshot, dict) else {},
            )
            for entry in entries
        ],
    )
