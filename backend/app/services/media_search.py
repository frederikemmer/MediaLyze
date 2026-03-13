from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import String, and_, case, cast, func, literal, or_

from backend.app.models.entities import MediaFile, MediaFormat
from backend.app.services.languages import expand_language_search_terms


class SearchValidationError(ValueError):
    pass


@dataclass(frozen=True)
class LibraryFileSearchFilters:
    file_search: str = ""
    search_size: str = ""
    search_quality_score: str = ""
    search_video_codec: str = ""
    search_resolution: str = ""
    search_hdr_type: str = ""
    search_duration: str = ""
    search_audio_codecs: str = ""
    search_audio_languages: str = ""
    search_subtitle_languages: str = ""
    search_subtitle_codecs: str = ""
    search_subtitle_sources: str = ""

    def normalized(self) -> LibraryFileSearchFilters:
        return LibraryFileSearchFilters(
            file_search=self.file_search.strip(),
            search_size=self.search_size.strip(),
            search_quality_score=self.search_quality_score.strip(),
            search_video_codec=self.search_video_codec.strip(),
            search_resolution=self.search_resolution.strip(),
            search_hdr_type=self.search_hdr_type.strip(),
            search_duration=self.search_duration.strip(),
            search_audio_codecs=self.search_audio_codecs.strip(),
            search_audio_languages=self.search_audio_languages.strip(),
            search_subtitle_languages=self.search_subtitle_languages.strip(),
            search_subtitle_codecs=self.search_subtitle_codecs.strip(),
            search_subtitle_sources=self.search_subtitle_sources.strip(),
        )

    def active(self) -> dict[str, str]:
        normalized = self.normalized()
        return {
            key: value
            for key, value in normalized.__dict__.items()
            if value
        }


_COMPARATOR_RE = re.compile(r"^\s*(>=|<=|>|<|=)?\s*(.*?)\s*$")
_SIZE_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([kmgt]?i?b|b)?\s*$", re.IGNORECASE)
_DURATION_PART_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([smhd])", re.IGNORECASE)
_RESOLUTION_RE = re.compile(r"^\s*(\d{2,5})\s*x\s*(\d{2,5})\s*$", re.IGNORECASE)

_SIZE_UNITS = {
    "b": 1,
    "kb": 1000,
    "mb": 1000**2,
    "gb": 1000**3,
    "tb": 1000**4,
    "kib": 1024,
    "mib": 1024**2,
    "gib": 1024**3,
    "tib": 1024**4,
}
_RESOLUTION_HEIGHT_ALIASES = {
    "720p": 720,
    "1080p": 1080,
    "1440p": 1440,
    "2160p": 2160,
    "4k": 2160,
}
_HDR_TOKEN_ALIASES = {
    "dv": {"dv", "dolby vision"},
    "dovi": {"dovi", "dolby vision"},
}
_NUMERIC_FIELD_LABELS = {
    "size": "size",
    "quality_score": "quality score",
    "duration": "duration",
}


def search_tokens(search: str) -> list[str]:
    return [token.strip().lower() for token in search.split() if token.strip()]


def resolution_label_expr(primary_video_streams):
    return case(
        (
            and_(primary_video_streams.c.width.is_not(None), primary_video_streams.c.height.is_not(None)),
            cast(primary_video_streams.c.width, String) + literal("x") + cast(primary_video_streams.c.height, String),
        ),
        else_="",
    )


def match_patterns(expression, patterns: list[str]):
    return or_(*(func.lower(func.coalesce(expression, "")).like(pattern) for pattern in patterns))


def token_matches_source(token: str, source_label: str) -> bool:
    return bool(token) and source_label.startswith(token)


def apply_legacy_search(query, primary_video_streams, audio_aggregates, subtitle_aggregates, search: str):
    resolution_label = resolution_label_expr(primary_video_streams)

    for token in search_tokens(search):
        patterns = {f"%{token}%"}
        for language_term in expand_language_search_terms(token):
            patterns.add(f"%{language_term}%")
        pattern_list = sorted(patterns)

        source_matches = []
        if any(token_matches_source(pattern.strip("%"), "internal") for pattern in pattern_list):
            source_matches.append(func.coalesce(subtitle_aggregates.c.has_internal_subtitles, 0) == 1)
        if any(token_matches_source(pattern.strip("%"), "external") for pattern in pattern_list):
            source_matches.append(func.coalesce(subtitle_aggregates.c.has_external_subtitles, 0) == 1)

        query = query.where(
            or_(
                match_patterns(MediaFile.filename, pattern_list),
                match_patterns(MediaFile.relative_path, pattern_list),
                match_patterns(MediaFile.extension, pattern_list),
                match_patterns(primary_video_streams.c.codec, pattern_list),
                match_patterns(primary_video_streams.c.hdr_type, pattern_list),
                match_patterns(resolution_label, pattern_list),
                match_patterns(audio_aggregates.c.audio_codecs_search, pattern_list),
                match_patterns(audio_aggregates.c.audio_languages_search, pattern_list),
                match_patterns(subtitle_aggregates.c.subtitle_languages_search, pattern_list),
                match_patterns(subtitle_aggregates.c.subtitle_codecs_search, pattern_list),
                or_(*source_matches) if source_matches else literal(False),
            )
        )
    return query


def _comparison_clause(expression, operator: str, value: float | int):
    if operator == ">":
        return expression > value
    if operator == ">=":
        return expression >= value
    if operator == "<":
        return expression < value
    if operator == "<=":
        return expression <= value
    return expression == value


def _parse_comparison(raw_value: str, field_key: str) -> tuple[str, str]:
    match = _COMPARATOR_RE.match(raw_value)
    if not match:
        raise SearchValidationError(f"Invalid search expression for {_NUMERIC_FIELD_LABELS[field_key]}")

    operator = match.group(1) or "="
    value = match.group(2).strip()
    if not value:
        raise SearchValidationError(f"Invalid search expression for {_NUMERIC_FIELD_LABELS[field_key]}")
    return operator, value


def _parse_size_value(raw_value: str) -> int:
    match = _SIZE_RE.match(raw_value)
    if not match:
        raise SearchValidationError("Invalid search expression for size")

    amount = float(match.group(1))
    unit = (match.group(2) or "b").lower()
    multiplier = _SIZE_UNITS.get(unit)
    if multiplier is None:
        raise SearchValidationError("Invalid search expression for size")
    return int(amount * multiplier)


def _parse_duration_value(raw_value: str) -> float:
    consumed = []
    total_seconds = 0.0

    for match in _DURATION_PART_RE.finditer(raw_value):
        consumed.append(match.group(0))
        amount = float(match.group(1))
        unit = match.group(2).lower()
        if unit == "s":
            total_seconds += amount
        elif unit == "m":
            total_seconds += amount * 60
        elif unit == "h":
            total_seconds += amount * 3600
        else:
            total_seconds += amount * 86400

    normalized_source = re.sub(r"\s+", "", raw_value).lower()
    normalized_consumed = "".join(part.replace(" ", "").lower() for part in consumed)
    if not consumed or normalized_source != normalized_consumed:
        raise SearchValidationError("Invalid search expression for duration")
    return total_seconds


def _parse_quality_score_value(raw_value: str) -> int:
    candidate = raw_value.strip()
    if not re.fullmatch(r"\d+", candidate):
        raise SearchValidationError("Invalid search expression for quality score")

    score = int(candidate)
    if score < 1 or score > 10:
        raise SearchValidationError("Invalid search expression for quality score")
    return score


def _text_token_patterns(token: str) -> list[str]:
    return [f"%{token}%"]


def _language_token_patterns(token: str) -> list[str]:
    return sorted({f"%{term}%" for term in expand_language_search_terms(token)})


def _hdr_token_patterns(token: str) -> list[str]:
    patterns = {f"%{token}%"}
    for alias in _HDR_TOKEN_ALIASES.get(token, {token}):
        patterns.add(f"%{alias}%")
    return sorted(patterns)


def _apply_text_filter(query, expression, raw_value: str, token_builder=_text_token_patterns):
    for token in search_tokens(raw_value):
        query = query.where(match_patterns(expression, token_builder(token)))
    return query


def _apply_file_search_filter(query, raw_value: str):
    for token in search_tokens(raw_value):
        patterns = _text_token_patterns(token)
        query = query.where(
            or_(
                match_patterns(MediaFile.filename, patterns),
                match_patterns(MediaFile.relative_path, patterns),
                match_patterns(MediaFile.extension, patterns),
            )
        )
    return query


def _apply_resolution_filter(query, primary_video_streams, raw_value: str):
    resolution_label = resolution_label_expr(primary_video_streams)

    for token in search_tokens(raw_value):
        resolution_match = _RESOLUTION_RE.match(token)
        if resolution_match:
            width = int(resolution_match.group(1))
            height = int(resolution_match.group(2))
            query = query.where(
                and_(
                    primary_video_streams.c.width == width,
                    primary_video_streams.c.height == height,
                )
            )
            continue

        alias_height = _RESOLUTION_HEIGHT_ALIASES.get(token)
        if alias_height is not None:
            query = query.where(primary_video_streams.c.height == alias_height)
            continue

        query = query.where(match_patterns(resolution_label, _text_token_patterns(token)))

    return query


def _apply_hdr_filter(query, primary_video_streams, raw_value: str):
    for token in search_tokens(raw_value):
        if token == "sdr":
            query = query.where(func.length(func.trim(func.coalesce(primary_video_streams.c.hdr_type, ""))) == 0)
            continue
        query = query.where(match_patterns(primary_video_streams.c.hdr_type, _hdr_token_patterns(token)))
    return query


def _apply_subtitle_source_filter(query, subtitle_aggregates, raw_value: str):
    for token in search_tokens(raw_value):
        source_matches = []
        if token_matches_source(token, "internal"):
            source_matches.append(func.coalesce(subtitle_aggregates.c.has_internal_subtitles, 0) == 1)
        if token_matches_source(token, "external"):
            source_matches.append(func.coalesce(subtitle_aggregates.c.has_external_subtitles, 0) == 1)

        query = query.where(or_(*source_matches) if source_matches else literal(False))

    return query


def _apply_numeric_filter(query, expression, raw_value: str, parser, field_key: str):
    operator, value = _parse_comparison(raw_value, field_key)
    parsed_value = parser(value)
    query = query.where(expression.is_not(None))
    query = query.where(_comparison_clause(expression, operator, parsed_value))
    return query


def apply_field_search_filters(
    query,
    primary_video_streams,
    audio_aggregates,
    subtitle_aggregates,
    filters: LibraryFileSearchFilters | None,
):
    if filters is None:
        return query

    normalized = filters.normalized()
    if normalized.file_search:
        query = _apply_file_search_filter(query, normalized.file_search)
    if normalized.search_size:
        query = _apply_numeric_filter(query, MediaFile.size_bytes, normalized.search_size, _parse_size_value, "size")
    if normalized.search_quality_score:
        query = _apply_numeric_filter(
            query,
            MediaFile.quality_score,
            normalized.search_quality_score,
            _parse_quality_score_value,
            "quality_score",
        )
    if normalized.search_video_codec:
        query = _apply_text_filter(query, primary_video_streams.c.codec, normalized.search_video_codec)
    if normalized.search_resolution:
        query = _apply_resolution_filter(query, primary_video_streams, normalized.search_resolution)
    if normalized.search_hdr_type:
        query = _apply_hdr_filter(query, primary_video_streams, normalized.search_hdr_type)
    if normalized.search_duration:
        query = _apply_numeric_filter(
            query,
            MediaFormat.duration,
            normalized.search_duration,
            _parse_duration_value,
            "duration",
        )
    if normalized.search_audio_codecs:
        query = _apply_text_filter(query, audio_aggregates.c.audio_codecs_search, normalized.search_audio_codecs)
    if normalized.search_audio_languages:
        query = _apply_text_filter(
            query,
            audio_aggregates.c.audio_languages_search,
            normalized.search_audio_languages,
            _language_token_patterns,
        )
    if normalized.search_subtitle_languages:
        query = _apply_text_filter(
            query,
            subtitle_aggregates.c.subtitle_languages_search,
            normalized.search_subtitle_languages,
            _language_token_patterns,
        )
    if normalized.search_subtitle_codecs:
        query = _apply_text_filter(query, subtitle_aggregates.c.subtitle_codecs_search, normalized.search_subtitle_codecs)
    if normalized.search_subtitle_sources:
        query = _apply_subtitle_source_filter(query, subtitle_aggregates, normalized.search_subtitle_sources)

    return query
