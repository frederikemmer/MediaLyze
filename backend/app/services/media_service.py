from __future__ import annotations

from typing import Literal

from sqlalchemy import String, and_, case, cast, func, literal, or_, select, union_all
from sqlalchemy.orm import Session, selectinload

from backend.app.models.entities import AudioStream, ExternalSubtitle, MediaFile, MediaFormat, SubtitleStream
from backend.app.schemas.media import MediaFileDetail, MediaFileTablePage, MediaFileTableRow
from backend.app.services.languages import expand_language_search_terms, normalize_language_code
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


def _row_from_model(media_file: MediaFile) -> MediaFileTableRow:
    primary_video = min(media_file.video_streams, key=lambda stream: stream.stream_index, default=None)
    duration = media_file.media_format.duration if media_file.media_format else None
    resolution = None
    if primary_video and primary_video.width and primary_video.height:
        resolution = f"{primary_video.width}x{primary_video.height}"

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
        duration=duration,
        video_codec=primary_video.codec if primary_video else None,
        resolution=resolution,
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


def _search_tokens(search: str) -> list[str]:
    return [token.strip().lower() for token in search.split() if token.strip()]


def _resolution_label_expr(primary_video_streams):
    return case(
        (
            and_(primary_video_streams.c.width.is_not(None), primary_video_streams.c.height.is_not(None)),
            cast(primary_video_streams.c.width, String) + literal("x") + cast(primary_video_streams.c.height, String),
        ),
        else_="",
    )


def _match_patterns(expression, patterns: list[str]):
    return or_(*(func.lower(func.coalesce(expression, "")).like(pattern) for pattern in patterns))


def _audio_aggregate_subquery(name: str = "audio_aggregates"):
    return (
        select(
            AudioStream.media_file_id.label("media_file_id"),
            func.coalesce(func.min(func.lower(AudioStream.language)), "").label("min_audio_language"),
            func.coalesce(func.min(func.lower(AudioStream.codec)), "").label("min_audio_codec"),
            func.coalesce(func.group_concat(func.lower(func.coalesce(AudioStream.language, "")), " "), "").label(
                "audio_languages_search"
            ),
            func.coalesce(func.group_concat(func.lower(func.coalesce(AudioStream.codec, "")), " "), "").label(
                "audio_codecs_search"
            ),
        )
        .group_by(AudioStream.media_file_id)
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

    language_aggregates = (
        select(
            language_values.c.media_file_id,
            func.coalesce(func.min(language_values.c.value), "").label("min_subtitle_language"),
            func.coalesce(func.group_concat(language_values.c.value, " "), "").label("subtitle_languages_search"),
        )
        .group_by(language_values.c.media_file_id)
        .subquery(f"{name}_language_aggregates")
    )
    codec_aggregates = (
        select(
            codec_values.c.media_file_id,
            func.coalesce(func.min(codec_values.c.value), "").label("min_subtitle_codec"),
            func.coalesce(func.group_concat(codec_values.c.value, " "), "").label("subtitle_codecs_search"),
        )
        .group_by(codec_values.c.media_file_id)
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
        "quality_score": MediaFile.quality_score,
    }
    return sort_map[sort_key]


def _token_matches_source(token: str, source_label: str) -> bool:
    return bool(token) and source_label.startswith(token)


def _apply_search(query, primary_video_streams, audio_aggregates, subtitle_aggregates, search: str):
    resolution_label = _resolution_label_expr(primary_video_streams)

    for token in _search_tokens(search):
        patterns = {f"%{token}%"}
        for language_term in expand_language_search_terms(token):
            patterns.add(f"%{language_term}%")
        pattern_list = sorted(patterns)

        source_matches = []
        if any(_token_matches_source(pattern.strip("%"), "internal") for pattern in pattern_list):
            source_matches.append(func.coalesce(subtitle_aggregates.c.has_internal_subtitles, 0) == 1)
        if any(_token_matches_source(pattern.strip("%"), "external") for pattern in pattern_list):
            source_matches.append(func.coalesce(subtitle_aggregates.c.has_external_subtitles, 0) == 1)

        query = query.where(
            or_(
                _match_patterns(MediaFile.filename, pattern_list),
                _match_patterns(MediaFile.relative_path, pattern_list),
                _match_patterns(MediaFile.extension, pattern_list),
                _match_patterns(primary_video_streams.c.codec, pattern_list),
                _match_patterns(primary_video_streams.c.hdr_type, pattern_list),
                _match_patterns(resolution_label, pattern_list),
                _match_patterns(audio_aggregates.c.audio_codecs_search, pattern_list),
                _match_patterns(audio_aggregates.c.audio_languages_search, pattern_list),
                _match_patterns(subtitle_aggregates.c.subtitle_languages_search, pattern_list),
                _match_patterns(subtitle_aggregates.c.subtitle_codecs_search, pattern_list),
                or_(*source_matches) if source_matches else literal(False),
            )
        )
    return query


def list_library_files(
    db: Session,
    library_id: int,
    *,
    offset: int = 0,
    limit: int = 50,
    search: str = "",
    sort_key: FileSortKey = "file",
    sort_direction: FileSortDirection = "asc",
) -> MediaFileTablePage:
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
    filtered_query = _apply_search(base_query, primary_video_streams, audio_aggregates, subtitle_aggregates, search)
    total = db.scalar(select(func.count()).select_from(filtered_query.order_by(None).subquery())) or 0

    sort_expression = _sort_expression(sort_key, primary_video_streams, audio_aggregates, subtitle_aggregates)
    ordered_query = filtered_query.order_by(
        sort_expression.desc() if sort_direction == "desc" else sort_expression.asc(),
        func.lower(MediaFile.relative_path).asc(),
    )
    selected_ids = list(db.scalars(ordered_query.offset(offset).limit(limit)).all())

    if not selected_ids:
        return MediaFileTablePage(total=total, offset=offset, limit=limit, items=[])

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
    return MediaFileTablePage(
        total=total,
        offset=offset,
        limit=limit,
        items=[_row_from_model(media_file) for media_file in files],
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

    row = _row_from_model(media_file)
    return MediaFileDetail(
        **row.model_dump(),
        media_format=media_file.media_format,
        video_streams=media_file.video_streams,
        audio_streams=media_file.audio_streams,
        subtitle_streams=media_file.subtitle_streams,
        external_subtitles=media_file.external_subtitles,
        raw_ffprobe_json=media_file.raw_ffprobe_json,
    )
