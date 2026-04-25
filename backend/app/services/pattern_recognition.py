from __future__ import annotations

from dataclasses import dataclass
from fnmatch import fnmatchcase
from pathlib import Path
import re

from backend.app.models.entities import LibraryType
from backend.app.schemas.app_settings import (
    BonusContentPatternSettings,
    PatternRecognitionSettings,
    ShowSeasonRecognitionMode,
    ShowSeasonPatternSettings,
)

DEFAULT_BONUS_FOLDER_NAMES: tuple[str, ...] = (
    "behind the scenes",
    "deleted scenes",
    "interviews",
    "scenes",
    "samples",
    "shorts",
    "featurettes",
    "clips",
    "other",
    "extras",
    "trailers",
    "theme-music",
    "backdrops",
    "Specials",
    "Season 00",
)

DEFAULT_SHOW_SEASON_PATTERNS = ShowSeasonPatternSettings(
    recognition_mode=ShowSeasonRecognitionMode.folder_depth,
    series_folder_depth=1,
    season_folder_depth=2,
    series_folder_regexes=[
        r"^(?P<title>.+?)(?:\s+\((?P<year>\d{4})\))?(?:\s+\[[^\]]+\])?$",
    ],
    season_folder_regexes=[
        r"^(?:Season|Staffel)\s*(?P<season>\d{1,3})(?:\s+\([^)]*\))?(?:\s+\[[^\]]+\])*$",
    ],
    episode_file_regexes=[],
)

EPISODE_METADATA_PATTERNS: tuple[str, ...] = (
    (
        r"S(?P<season>\d{1,3})E(?P<episode>\d{1,4})"
        r"(?:\s*[-–]\s*E?(?P<episode_end>\d{1,4}))?"
        r"(?:\s*(?P<title>.*?))?$"
    ),
    (
        r"(?P<season_alt>\d{1,3})x(?P<episode_alt>\d{1,4})"
        r"(?:\s*[-–]\s*(?P<episode_end_alt>\d{1,4}))?"
        r"(?:\s*(?P<title_alt>.*?))?$"
    ),
    (
        r"^(?:E|Ep\.?|Episode|Folge)\s*(?P<episode_only>\d{1,4})"
        r"(?:\s*[-–]\s*E?(?P<episode_only_end>\d{1,4}))?"
        r"(?:\s*(?P<title_only>.*?))?$"
    ),
)


@dataclass(frozen=True)
class PathRecognition:
    content_category: str = "main"
    series_title: str | None = None
    series_normalized_title: str | None = None
    series_relative_path: str | None = None
    series_year: int | None = None
    season_number: int | None = None
    season_title: str | None = None
    season_relative_path: str | None = None
    episode_number: int | None = None
    episode_number_end: int | None = None
    episode_title: str | None = None
    matched_patterns: tuple[str, ...] = ()

    @property
    def is_bonus(self) -> bool:
        return self.content_category == "bonus"

    @property
    def is_episode(self) -> bool:
        return self.series_title is not None and self.season_number is not None


def normalize_pattern_list(patterns: list[str] | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_pattern in patterns or []:
        pattern = raw_pattern.strip()
        if not pattern or pattern in seen:
            continue
        normalized.append(pattern)
        seen.add(pattern)
    return normalized


def merge_pattern_lists(*pattern_groups: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for group in pattern_groups:
        for pattern in group:
            if pattern in seen:
                continue
            merged.append(pattern)
            seen.add(pattern)
    return merged


def default_bonus_folder_patterns() -> list[str]:
    patterns: list[str] = []
    for name in DEFAULT_BONUS_FOLDER_NAMES:
        patterns.extend((f"{name}/", f"{name}/*", f"*/{name}/", f"*/{name}/*"))
    return patterns


def default_bonus_content_patterns() -> BonusContentPatternSettings:
    default_folder = default_bonus_folder_patterns()
    return BonusContentPatternSettings(
        default_folder_patterns=default_folder,
        effective_folder_patterns=default_folder,
        default_file_patterns=[],
        effective_file_patterns=[],
    )


def default_pattern_recognition_settings() -> PatternRecognitionSettings:
    return PatternRecognitionSettings(
        analyze_bonus_content=True,
        show_season_patterns=DEFAULT_SHOW_SEASON_PATTERNS.model_copy(deep=True),
        bonus_content=default_bonus_content_patterns(),
    )


def validate_regex_patterns(patterns: list[str], label: str) -> None:
    for pattern in patterns:
        try:
            re.compile(pattern, re.IGNORECASE)
        except re.error as exc:
            raise ValueError(f"Invalid {label} regex {pattern!r}: {exc}") from exc


def validate_pattern_recognition_settings(settings: PatternRecognitionSettings) -> None:
    show_settings = settings.show_season_patterns
    if show_settings.season_folder_depth <= show_settings.series_folder_depth:
        raise ValueError("Season folder depth must be greater than series folder depth")
    if show_settings.recognition_mode == ShowSeasonRecognitionMode.regex:
        validate_regex_patterns(show_settings.series_folder_regexes, "series folder")
        validate_regex_patterns(show_settings.season_folder_regexes, "season folder")


def _candidate_paths(relative_path: str, *, is_dir: bool = False) -> set[str]:
    normalized_path = relative_path.strip("/").lower()
    if not normalized_path:
        return set()
    candidates = {normalized_path, f"/{normalized_path}"}
    if is_dir:
        candidates.update({f"{normalized_path}/", f"/{normalized_path}/"})
    return candidates


def matching_bonus_patterns(
    relative_path: str,
    settings: PatternRecognitionSettings,
    *,
    is_dir: bool = False,
) -> list[str]:
    candidates = _candidate_paths(relative_path, is_dir=is_dir)
    if not candidates:
        return []

    patterns = settings.bonus_content.effective_folder_patterns
    return [
        pattern
        for pattern in patterns
        if any(fnmatchcase(candidate, pattern.lower()) for candidate in candidates)
    ]


def matches_bonus_path(
    relative_path: str,
    settings: PatternRecognitionSettings,
    *,
    is_dir: bool = False,
) -> bool:
    return bool(matching_bonus_patterns(relative_path, settings, is_dir=is_dir))


def normalize_series_title(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _match_first(patterns: list[str], value: str) -> re.Match[str] | None:
    for pattern in patterns:
        match = re.search(pattern, value, flags=re.IGNORECASE)
        if match:
            return match
    return None


def _clean_episode_title(value: str | None) -> str | None:
    if not value:
        return None
    candidate = re.sub(r"^[\s._-]+", "", value).strip()
    candidate = re.sub(r"\s+", " ", candidate)
    return candidate or None


def _parse_series_folder(folder_name: str, settings: ShowSeasonPatternSettings) -> tuple[str, int | None] | None:
    series_match = _match_first(settings.series_folder_regexes, folder_name)
    if series_match:
        series_title = (series_match.groupdict().get("title") or folder_name).strip()
        try:
            series_year = int(series_match.groupdict().get("year") or 0) or None
        except ValueError:
            series_year = None
        return series_title, series_year
    return folder_name.strip(), None


def _parse_season_number(folder_name: str, settings: ShowSeasonPatternSettings) -> int | None:
    season_match = _match_first(settings.season_folder_regexes, folder_name)
    if season_match:
        try:
            return int(season_match.groupdict().get("season") or 0)
        except ValueError:
            return None

    fallback_match = re.search(r"(?:season|staffel)\s*(?P<season>\d{1,3})", folder_name, flags=re.IGNORECASE)
    if not fallback_match:
        return None
    try:
        return int(fallback_match.group("season") or 0)
    except ValueError:
        return None


def _parse_episode_metadata(path: Path) -> tuple[int | None, int | None, str | None]:
    episode_number: int | None = None
    episode_number_end: int | None = None
    episode_title: str | None = None
    episode_match = _match_first(list(EPISODE_METADATA_PATTERNS), path.stem)
    if episode_match:
        episode_groups = episode_match.groupdict()
        episode_raw = (
            episode_groups.get("episode")
            or episode_groups.get("episode_alt")
            or episode_groups.get("episode_only")
        )
        try:
            episode_number = int(episode_raw) if episode_raw else None
        except ValueError:
            episode_number = None
        episode_end_raw = (
            episode_groups.get("episode_end")
            or episode_groups.get("episode_end_alt")
            or episode_groups.get("episode_only_end")
        )
        try:
            episode_number_end = int(episode_end_raw) if episode_end_raw else None
        except ValueError:
            episode_number_end = None
        episode_title = _clean_episode_title(
            episode_groups.get("title")
            or episode_groups.get("title_alt")
            or episode_groups.get("title_only")
        )
    return episode_number, episode_number_end, episode_title


def _recognize_media_path_by_folder_depth(path: Path, settings: ShowSeasonPatternSettings) -> PathRecognition:
    parts = path.parts
    season_index = settings.season_folder_depth - 1
    series_index = settings.series_folder_depth - 1
    if len(parts) <= season_index or len(parts) < settings.season_folder_depth + 1:
        return PathRecognition()

    series_folder = parts[series_index]
    season_folder = parts[season_index]
    parsed_series = _parse_series_folder(series_folder, settings)
    if not parsed_series:
        return PathRecognition()
    series_title, series_year = parsed_series
    season_number = _parse_season_number(season_folder, settings)
    if season_number is None:
        return PathRecognition()
    episode_number, episode_number_end, episode_title = _parse_episode_metadata(path)

    return PathRecognition(
        content_category="main",
        series_title=series_title,
        series_normalized_title=normalize_series_title(series_title),
        series_relative_path="/".join(parts[: series_index + 1]),
        series_year=series_year,
        season_number=season_number,
        season_title=f"Season {season_number:02d}" if season_number > 0 else "Specials",
        season_relative_path="/".join(parts[: season_index + 1]),
        episode_number=episode_number,
        episode_number_end=episode_number_end,
        episode_title=episode_title,
    )


def _recognize_media_path_by_regex(path: Path, settings: ShowSeasonPatternSettings) -> PathRecognition:
    parts = path.parts
    if len(parts) < 3:
        return PathRecognition()

    season_index: int | None = None
    season_match: re.Match[str] | None = None
    for index, part in enumerate(parts[:-1]):
        candidate_match = _match_first(settings.season_folder_regexes, part)
        if candidate_match:
            season_index = index
            season_match = candidate_match
            break
    if season_index is None or season_match is None or season_index == 0:
        return PathRecognition()

    series_folder = parts[season_index - 1]
    parsed_series = _parse_series_folder(series_folder, settings)
    if not parsed_series:
        return PathRecognition()
    series_title, series_year = parsed_series
    try:
        season_number = int(season_match.groupdict().get("season") or 0)
    except ValueError:
        return PathRecognition()

    episode_number, episode_number_end, episode_title = _parse_episode_metadata(path)

    return PathRecognition(
        content_category="main",
        series_title=series_title,
        series_normalized_title=normalize_series_title(series_title),
        series_relative_path="/".join(parts[:season_index]),
        series_year=series_year,
        season_number=season_number,
        season_title=f"Season {season_number:02d}" if season_number > 0 else "Specials",
        season_relative_path="/".join(parts[: season_index + 1]),
        episode_number=episode_number,
        episode_number_end=episode_number_end,
        episode_title=episode_title,
    )


def recognize_media_path(
    relative_path: str,
    library_type: LibraryType | str,
    settings: PatternRecognitionSettings,
) -> PathRecognition:
    bonus_matches = matching_bonus_patterns(relative_path, settings)
    if bonus_matches:
        return PathRecognition(content_category="bonus", matched_patterns=tuple(bonus_matches))

    library_type_value = getattr(library_type, "value", library_type)
    if str(library_type_value) not in {LibraryType.series.value, LibraryType.mixed.value}:
        return PathRecognition()

    path = Path(relative_path)
    if settings.show_season_patterns.recognition_mode == ShowSeasonRecognitionMode.folder_depth:
        return _recognize_media_path_by_folder_depth(path, settings.show_season_patterns)
    return _recognize_media_path_by_regex(path, settings.show_season_patterns)
