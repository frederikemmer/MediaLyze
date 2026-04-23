from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from fnmatch import fnmatchcase
import logging
import os
from pathlib import Path
import re
import traceback

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, selectinload

from backend.app.core.config import Settings
from backend.app.db.session import SessionLocal
from backend.app.models.entities import (
    AudioStream,
    ExternalSubtitle,
    JobStatus,
    Library,
    MediaContentCategory,
    MediaFile,
    MediaFileHistoryCaptureReason,
    MediaFormat,
    MediaSeason,
    MediaSeries,
    ScanJob,
    ScanStatus,
    ScanTriggerSource,
    SubtitleStream,
    VideoStream,
)
from backend.app.services.duplicates import (
    FILE_HASH_ALGORITHM,
    FileHashDuplicateDetectionStrategy,
    get_duplicate_detection_strategy,
    get_duplicate_group_counts,
    normalize_filename_signature,
)
from backend.app.services.app_settings import get_app_settings, get_ignore_patterns
from backend.app.services.ffprobe_parser import normalize_ffprobe_payload, run_ffprobe
from backend.app.services.history_snapshots import (
    create_media_file_history_entry_if_changed,
    upsert_library_history_snapshot,
)
from backend.app.services.quality import (
    build_quality_score_input,
    build_quality_score_input_from_media_file,
    calculate_quality_score,
)
from backend.app.services.pattern_recognition import (
    PathRecognition,
    matches_bonus_path,
    matching_bonus_patterns,
    recognize_media_path,
)
from backend.app.services.stats_cache import stats_cache
from backend.app.services.subtitles import (
    detect_external_subtitles,
    detect_external_subtitles_from_names,
)
from backend.app.utils.glob_patterns import matches_ignore_pattern
from backend.app.utils.time import utc_now

logger = logging.getLogger(__name__)
MAX_FILE_LIST_SAMPLE_SIZE = 50
MAX_FAILED_FILE_SAMPLE_SIZE = 200
MAX_IGNORE_PATTERN_SAMPLE_SIZE = 10
MAX_FAILURE_DETAIL_LENGTH = 12000
RENAME_MATCH_SCORE_THRESHOLD = 0.82
RENAME_MATCH_SCORE_GAP = 0.08
RENAME_SINGLE_MISSING_SCORE_THRESHOLD = 0.68
RENAME_NUMBER_PATTERN = re.compile(r"\d+")


class ScanCanceled(Exception):
    pass


@dataclass
class PatternHit:
    count: int = 0
    paths: list[str] = field(default_factory=list)
    truncated_count: int = 0


@dataclass
class DiscoveryResult:
    files: list[Path]
    collect_files: bool = True
    file_count: int = 0
    ignored_total: int = 0
    ignored_dir_total: int = 0
    ignored_file_total: int = 0
    ignored_pattern_hits: dict[str, PatternHit] = field(default_factory=dict)
    bonus_ignored_total: int = 0
    bonus_pattern_hits: dict[str, PatternHit] = field(default_factory=dict)


@dataclass(frozen=True)
class DiscoveredMediaFile:
    path: Path
    sibling_filenames: tuple[str, ...]


@dataclass
class SampledPathList:
    count: int = 0
    paths: list[str] = field(default_factory=list)
    truncated_count: int = 0
    sample_limit: int = MAX_FILE_LIST_SAMPLE_SIZE

    def add(self, path: str) -> None:
        self.count += 1
        if len(self.paths) < self.sample_limit:
            self.paths.append(path)
        else:
            self.truncated_count += 1

    def as_dict(self) -> dict:
        return {
            "count": self.count,
            "paths": self.paths,
            "truncated_count": self.truncated_count,
        }


@dataclass
class FailedFileSamples:
    items: list[dict[str, str | None]] = field(default_factory=list)
    truncated_count: int = 0

    def add(self, path: str, reason: str, detail: str | None = None) -> None:
        if len(self.items) < MAX_FAILED_FILE_SAMPLE_SIZE:
            self.items.append({"path": path, "reason": reason, "detail": detail})
        else:
            self.truncated_count += 1

    def as_dict(self) -> dict:
        return {
            "failed_files": self.items,
            "failed_files_truncated_count": self.truncated_count,
        }


@dataclass
class QueuedMediaWork:
    media_file: MediaFile
    path: Path
    needs_analysis: bool
    needs_duplicate_processing: bool


def _library_root(library: Library) -> Path:
    return Path(library.path)


def _rename_similarity_score(
    old_relative_path: str,
    new_relative_path: str,
    old_size: int,
    new_size: int,
) -> float:
    old_path = Path(old_relative_path)
    new_path = Path(new_relative_path)
    old_signature = normalize_filename_signature(old_path)
    new_signature = normalize_filename_signature(new_path)
    if not old_signature or not new_signature:
        return 0.0

    old_numbers = Counter(
        match.lstrip("0") or "0"
        for match in RENAME_NUMBER_PATTERN.findall(old_signature)
    )
    new_numbers = Counter(
        match.lstrip("0") or "0"
        for match in RENAME_NUMBER_PATTERN.findall(new_signature)
    )
    if old_numbers and new_numbers and not (old_numbers <= new_numbers or new_numbers <= old_numbers):
        return 0.0

    score = SequenceMatcher(None, old_signature, new_signature).ratio()
    if old_path.parent == new_path.parent:
        score += 0.05
    if old_path.suffix.lower() == new_path.suffix.lower():
        score += 0.03

    max_size = max(old_size, new_size, 1)
    size_delta_ratio = abs(old_size - new_size) / max_size
    if size_delta_ratio <= 0.01:
        score += 0.07
    elif size_delta_ratio <= 0.05:
        score += 0.04
    elif size_delta_ratio <= 0.15:
        score += 0.02

    return min(score, 1.0)


def _candidate_ignore_paths(relative_path: str, *, is_dir: bool = False) -> set[str]:
    normalized_path = relative_path.strip("/")
    if not normalized_path:
        return set()

    candidates = {normalized_path, f"/{normalized_path}"}
    if is_dir:
        candidates.update({f"{normalized_path}/", f"/{normalized_path}/"})
    return candidates


def _matching_ignore_patterns(relative_path: str, patterns: tuple[str, ...], *, is_dir: bool = False) -> list[str]:
    candidates = _candidate_ignore_paths(relative_path, is_dir=is_dir)
    if not candidates:
        return []
    return [pattern for pattern in patterns if any(fnmatchcase(candidate, pattern) for candidate in candidates)]


def _record_pattern_hits(
    relative_path: str,
    matches: list[str],
    ignored_pattern_hits: dict[str, PatternHit],
) -> None:
    for pattern in matches:
        hit = ignored_pattern_hits.setdefault(pattern, PatternHit())
        hit.count += 1
        if len(hit.paths) < MAX_IGNORE_PATTERN_SAMPLE_SIZE:
            hit.paths.append(relative_path)
        else:
            hit.truncated_count += 1


def _pattern_hits_as_list(pattern_hits: dict[str, PatternHit]) -> list[dict[str, int | str | list[str]]]:
    return [
        {
            "pattern": pattern,
            "count": hit.count,
            "paths": hit.paths,
            "truncated_count": hit.truncated_count,
        }
        for pattern, hit in sorted(pattern_hits.items(), key=lambda entry: entry[0].lower())
    ]


def _coerce_trigger_details(trigger_details: dict | None) -> dict:
    return dict(trigger_details or {})


def _append_coalesced_trigger(existing_details: dict, trigger_source: ScanTriggerSource, trigger_details: dict | None) -> dict:
    details = dict(existing_details or {})
    coalesced_triggers = list(details.get("coalesced_triggers") or [])
    truncated_count = int(details.get("coalesced_triggers_truncated_count") or 0)
    details["coalesced_trigger_count"] = int(details.get("coalesced_trigger_count") or 0) + 1

    entry = {"trigger_source": trigger_source.value, **_coerce_trigger_details(trigger_details)}
    if len(coalesced_triggers) < 20:
        coalesced_triggers.append(entry)
    else:
        truncated_count += 1

    details["coalesced_triggers"] = coalesced_triggers
    details["coalesced_triggers_truncated_count"] = truncated_count
    return details


def _short_error_reason(exc: Exception) -> str:
    message = str(exc).strip()
    if message:
        first_line = message.splitlines()[0].strip()
        if first_line:
            return first_line[:300]
    return exc.__class__.__name__


def _detailed_error_reason(exc: Exception) -> str:
    detail = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)).strip()
    if not detail:
        detail = f"{exc.__class__.__name__}: {str(exc).strip() or 'No additional details available.'}"
    if len(detail) <= MAX_FAILURE_DETAIL_LENGTH:
        return detail
    suffix = "\n... [truncated]"
    return f"{detail[: MAX_FAILURE_DETAIL_LENGTH - len(suffix)]}{suffix}"


def _error_details(exc: Exception) -> tuple[str, str]:
    return _short_error_reason(exc), _detailed_error_reason(exc)


def _iter_media_files(
    root: Path,
    allowed_extensions: tuple[str, ...],
    *,
    ignore_patterns: tuple[str, ...] = (),
    should_cancel: Callable[[], bool] | None = None,
) -> DiscoveryResult:
    result = DiscoveryResult(files=[])
    for _ in _stream_media_files(
        root,
        allowed_extensions,
        discovery=result,
        ignore_patterns=ignore_patterns,
        should_cancel=should_cancel,
    ):
        pass
    return result


def _stream_media_files(
    root: Path,
    allowed_extensions: tuple[str, ...],
    *,
    discovery: DiscoveryResult,
    ignore_patterns: tuple[str, ...] = (),
    pattern_recognition_settings=None,
    should_cancel: Callable[[], bool] | None = None,
):
    suffixes = {extension.lower() for extension in allowed_extensions}

    for current_root, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        if should_cancel and should_cancel():
            raise ScanCanceled()

        current_root_path = Path(current_root)
        visible_dirnames: list[str] = []
        for dirname in dirnames:
            candidate = current_root_path / dirname
            if candidate.is_symlink():
                continue
            relative_path = candidate.relative_to(root).as_posix()
            matches = _matching_ignore_patterns(relative_path, ignore_patterns, is_dir=True)
            if matches:
                discovery.ignored_total += 1
                discovery.ignored_dir_total += 1
                _record_pattern_hits(relative_path, matches, discovery.ignored_pattern_hits)
                continue
            if (
                pattern_recognition_settings is not None
                and not pattern_recognition_settings.analyze_bonus_content
                and matches_bonus_path(relative_path, pattern_recognition_settings, is_dir=True)
            ):
                bonus_matches = matching_bonus_patterns(relative_path, pattern_recognition_settings, is_dir=True)
                discovery.ignored_total += 1
                discovery.ignored_dir_total += 1
                discovery.bonus_ignored_total += 1
                _record_pattern_hits(relative_path, bonus_matches, discovery.bonus_pattern_hits)
                continue
            visible_dirnames.append(dirname)

        dirnames[:] = sorted(visible_dirnames, key=str.lower)
        sorted_filenames = sorted(filenames, key=str.lower)

        for filename in sorted_filenames:
            file_path = current_root_path / filename
            if file_path.is_symlink():
                continue
            relative_path = file_path.relative_to(root).as_posix()
            matches = _matching_ignore_patterns(relative_path, ignore_patterns)
            if matches:
                discovery.ignored_total += 1
                discovery.ignored_file_total += 1
                _record_pattern_hits(relative_path, matches, discovery.ignored_pattern_hits)
                continue
            if (
                pattern_recognition_settings is not None
                and not pattern_recognition_settings.analyze_bonus_content
                and matches_bonus_path(relative_path, pattern_recognition_settings)
            ):
                bonus_matches = matching_bonus_patterns(relative_path, pattern_recognition_settings)
                discovery.ignored_total += 1
                discovery.ignored_file_total += 1
                discovery.bonus_ignored_total += 1
                _record_pattern_hits(relative_path, bonus_matches, discovery.bonus_pattern_hits)
                continue
            if file_path.suffix.lower() in suffixes:
                discovery.file_count += 1
                if discovery.collect_files:
                    discovery.files.append(file_path)
                yield DiscoveredMediaFile(path=file_path, sibling_filenames=tuple(sorted_filenames))


def _replace_analysis(media_file: MediaFile, normalized, external_subtitles: list[dict[str, str | None]]) -> None:
    if media_file.media_format is None:
        media_file.media_format = MediaFormat()

    media_file.media_format.container_format = normalized.media_format.container_format
    media_file.media_format.duration = normalized.media_format.duration
    media_file.media_format.bit_rate = normalized.media_format.bit_rate
    media_file.media_format.probe_score = normalized.media_format.probe_score
    media_file.video_streams = [
        VideoStream(
            stream_index=stream.stream_index,
            codec=stream.codec,
            profile=stream.profile,
            width=stream.width,
            height=stream.height,
            pix_fmt=stream.pix_fmt,
            color_space=stream.color_space,
            color_transfer=stream.color_transfer,
            color_primaries=stream.color_primaries,
            frame_rate=stream.frame_rate,
            bit_rate=stream.bit_rate,
            hdr_type=stream.hdr_type,
        )
        for stream in normalized.video_streams
    ]
    media_file.audio_streams = [
        AudioStream(
            stream_index=stream.stream_index,
            codec=stream.codec,
            profile=stream.profile,
            spatial_audio_profile=stream.spatial_audio_profile,
            channels=stream.channels,
            channel_layout=stream.channel_layout,
            sample_rate=stream.sample_rate,
            bit_rate=stream.bit_rate,
            language=stream.language,
            default_flag=stream.default_flag,
            forced_flag=stream.forced_flag,
        )
        for stream in normalized.audio_streams
    ]
    media_file.subtitle_streams = [
        SubtitleStream(
            stream_index=stream.stream_index,
            codec=stream.codec,
            language=stream.language,
            default_flag=stream.default_flag,
            forced_flag=stream.forced_flag,
            subtitle_type=stream.subtitle_type,
        )
        for stream in normalized.subtitle_streams
    ]
    media_file.external_subtitles = [
        ExternalSubtitle(path=item["path"], language=item["language"], format=item["format"])
        for item in external_subtitles
    ]


def _persist_quality_breakdown(media_file: MediaFile, breakdown) -> None:
    media_file.quality_score = breakdown.score
    media_file.quality_score_raw = breakdown.score_raw
    media_file.quality_score_breakdown = breakdown.model_dump(mode="json")


def _normalized_text(value: str | None, fallback: str = "") -> str:
    candidate = (value or "").strip().lower()
    return candidate or fallback


def _joined_unique(values: list[str]) -> str:
    return " ".join(sorted({value for value in values if value}))


def _update_media_file_search_fields(media_file: MediaFile) -> None:
    primary_video = min(media_file.video_streams, key=lambda stream: stream.stream_index, default=None)
    media_file.duration_seconds = media_file.media_format.duration if media_file.media_format else None
    media_file.bitrate = media_file.media_format.bit_rate if media_file.media_format else None
    media_file.audio_bitrate = sum(max(stream.bit_rate or 0, 0) for stream in media_file.audio_streams) or None
    media_file.primary_video_codec = primary_video.codec if primary_video else None
    media_file.primary_video_width = primary_video.width if primary_video else None
    media_file.primary_video_height = primary_video.height if primary_video else None
    media_file.primary_video_resolution_pixels = (
        primary_video.width * primary_video.height
        if primary_video and primary_video.width is not None and primary_video.height is not None
        else None
    )
    media_file.primary_video_hdr_type = primary_video.hdr_type if primary_video else None

    audio_codecs = [_normalized_text(stream.codec, "unknown") for stream in media_file.audio_streams]
    audio_spatial_profiles = [_normalized_text(stream.spatial_audio_profile) for stream in media_file.audio_streams]
    audio_languages = [_normalized_text(stream.language, "und") for stream in media_file.audio_streams]
    subtitle_languages = [
        *[_normalized_text(stream.language, "und") for stream in media_file.subtitle_streams],
        *[_normalized_text(subtitle.language, "und") for subtitle in media_file.external_subtitles],
    ]
    subtitle_codecs = [
        *[_normalized_text(stream.codec, "unknown") for stream in media_file.subtitle_streams],
        *[_normalized_text(subtitle.format, "unknown") for subtitle in media_file.external_subtitles],
    ]

    media_file.min_audio_codec = min(audio_codecs, default="")
    media_file.min_audio_spatial_profile = min((value for value in audio_spatial_profiles if value), default="")
    media_file.min_audio_language = min(audio_languages, default="")
    media_file.min_subtitle_language = min(subtitle_languages, default="")
    media_file.min_subtitle_codec = min(subtitle_codecs, default="")
    media_file.audio_codecs_search = _joined_unique(audio_codecs)
    media_file.audio_spatial_profiles_search = _joined_unique(audio_spatial_profiles)
    media_file.audio_languages_search = _joined_unique(audio_languages)
    media_file.subtitle_languages_search = _joined_unique(subtitle_languages)
    media_file.subtitle_codecs_search = _joined_unique(subtitle_codecs)
    media_file.has_internal_subtitles = bool(media_file.subtitle_streams)
    media_file.has_external_subtitles = bool(media_file.external_subtitles)
    media_file.subtitle_sources_search = " ".join(
        source
        for source, has_source in (
            ("internal", media_file.has_internal_subtitles),
            ("external", media_file.has_external_subtitles),
        )
        if has_source
    )
    media_file.search_fields_version = 1


def _apply_analysis_result(
    media_file: MediaFile,
    payload: dict,
    subtitles: list[dict[str, str | None]],
    library: Library,
    resolution_categories,
) -> None:
    media_file.scan_status = ScanStatus.analyzing
    normalized = normalize_ffprobe_payload(payload)
    media_file.raw_ffprobe_json = payload
    _replace_analysis(media_file, normalized, subtitles)
    breakdown = calculate_quality_score(
        build_quality_score_input(normalized, subtitles, size_bytes=media_file.size_bytes),
        library.quality_profile,
        resolution_categories,
    )
    _persist_quality_breakdown(media_file, breakdown)
    _update_media_file_search_fields(media_file)
    media_file.last_analyzed_at = utc_now()
    media_file.scan_status = ScanStatus.ready


def _analyze_path(
    file_path: Path,
    library_root: Path,
    settings: Settings,
    ignore_patterns: tuple[str, ...],
) -> tuple[dict, list[dict[str, str | None]]]:
    payload = run_ffprobe(file_path, settings.ffprobe_path)
    subtitles = _visible_external_subtitles(
        file_path,
        library_root,
        settings.subtitle_extensions,
        ignore_patterns,
    )
    return payload, subtitles


def _get_or_create_series(db: Session, library: Library, recognition: PathRecognition) -> MediaSeries | None:
    if not recognition.series_title or not recognition.series_normalized_title or not recognition.series_relative_path:
        return None
    series = db.scalar(
        select(MediaSeries).where(
            MediaSeries.library_id == library.id,
            MediaSeries.normalized_title == recognition.series_normalized_title,
            MediaSeries.relative_path == recognition.series_relative_path,
        )
    )
    if series is None:
        series = MediaSeries(
            library_id=library.id,
            title=recognition.series_title,
            normalized_title=recognition.series_normalized_title,
            relative_path=recognition.series_relative_path,
            year=recognition.series_year,
        )
        db.add(series)
        db.flush()
    else:
        series.title = recognition.series_title
        series.year = recognition.series_year
    return series


def _get_or_create_season(
    db: Session,
    library: Library,
    series: MediaSeries,
    recognition: PathRecognition,
) -> MediaSeason | None:
    if recognition.season_number is None or not recognition.season_title or not recognition.season_relative_path:
        return None
    season = db.scalar(
        select(MediaSeason).where(
            MediaSeason.library_id == library.id,
            MediaSeason.series_id == series.id,
            MediaSeason.season_number == recognition.season_number,
        )
    )
    if season is None:
        season = MediaSeason(
            library_id=library.id,
            series_id=series.id,
            season_number=recognition.season_number,
            title=recognition.season_title,
            relative_path=recognition.season_relative_path,
        )
        db.add(season)
        db.flush()
    else:
        season.title = recognition.season_title
        season.relative_path = recognition.season_relative_path
    return season


def _apply_path_recognition(
    db: Session,
    library: Library,
    media_file: MediaFile,
    recognition: PathRecognition,
) -> bool:
    before = (
        media_file.content_category,
        media_file.series_id,
        media_file.season_id,
        media_file.episode_number,
        media_file.episode_number_end,
        media_file.episode_title,
        media_file.recognition_details,
    )
    media_file.content_category = (
        MediaContentCategory.bonus if recognition.is_bonus else MediaContentCategory.main
    )
    media_file.series_id = None
    media_file.season_id = None
    media_file.episode_number = None
    media_file.episode_number_end = None
    media_file.episode_title = None
    media_file.recognition_details = {
        "matched_patterns": list(recognition.matched_patterns),
    } if recognition.matched_patterns else None

    if not recognition.is_bonus and recognition.is_episode:
        series = _get_or_create_series(db, library, recognition)
        season = _get_or_create_season(db, library, series, recognition) if series else None
        media_file.series_id = series.id if series else None
        media_file.season_id = season.id if season else None
        media_file.episode_number = recognition.episode_number
        media_file.episode_number_end = recognition.episode_number_end
        media_file.episode_title = recognition.episode_title
        media_file.recognition_details = {
            "series_relative_path": recognition.series_relative_path,
            "season_relative_path": recognition.season_relative_path,
        }

    after = (
        media_file.content_category,
        media_file.series_id,
        media_file.season_id,
        media_file.episode_number,
        media_file.episode_number_end,
        media_file.episode_title,
        media_file.recognition_details,
    )
    return before != after


def _cleanup_empty_series_entries(db: Session, library_id: int) -> None:
    for season in db.scalars(select(MediaSeason).where(MediaSeason.library_id == library_id)).all():
        has_files = db.scalar(select(MediaFile.id).where(MediaFile.season_id == season.id).limit(1))
        if has_files is None:
            db.delete(season)
    db.flush()
    for series in db.scalars(select(MediaSeries).where(MediaSeries.library_id == library_id)).all():
        has_files = db.scalar(select(MediaFile.id).where(MediaFile.series_id == series.id).limit(1))
        if has_files is None:
            db.delete(series)
    db.flush()


def _visible_external_subtitles(
    file_path: Path,
    library_root: Path,
    allowed_extensions: tuple[str, ...],
    ignore_patterns: tuple[str, ...],
    *,
    sibling_filenames: tuple[str, ...] | None = None,
) -> list[dict[str, str | None]]:
    detected = (
        detect_external_subtitles(file_path, allowed_extensions)
        if sibling_filenames is None
        else detect_external_subtitles_from_names(
            file_path,
            sibling_filenames,
            allowed_extensions,
        )
    )
    return [
        subtitle
        for subtitle in detected
        if not matches_ignore_pattern(
            (file_path.parent / str(subtitle["path"])).relative_to(library_root).as_posix(),
            ignore_patterns,
        )
    ]


def _external_subtitle_signature(
    subtitles: list[ExternalSubtitle] | list[dict[str, str | None]],
) -> tuple[tuple[str, str | None, str | None], ...]:
    signature: list[tuple[str, str | None, str | None]] = []
    for subtitle in subtitles:
        if isinstance(subtitle, dict):
            path = str(subtitle.get("path") or "").strip()
            language = (
                str(subtitle.get("language")).strip() or None
                if subtitle.get("language")
                else None
            )
            format_name = (
                str(subtitle.get("format")).strip().lower() or None
                if subtitle.get("format")
                else None
            )
        else:
            path = str(subtitle.path or "").strip()
            language = str(subtitle.language).strip() or None if subtitle.language else None
            format_name = str(subtitle.format).strip().lower() or None if subtitle.format else None
        signature.append((path, language, format_name))
    return tuple(sorted(signature))


def _empty_scan_summary(ignore_patterns: tuple[str, ...] = ()) -> dict:
    return {
        "ignore_patterns": list(ignore_patterns),
        "discovery": {
            "discovered_files": 0,
            "ignored_total": 0,
            "ignored_dir_total": 0,
            "ignored_file_total": 0,
            "ignored_pattern_hits": [],
        },
        "changes": {
            "queued_for_analysis": 0,
            "unchanged_files": 0,
            "reanalyzed_incomplete_files": 0,
            "new_files": {"count": 0, "paths": [], "truncated_count": 0},
            "modified_files": {"count": 0, "paths": [], "truncated_count": 0},
            "deleted_files": {"count": 0, "paths": [], "truncated_count": 0},
        },
        "analysis": {
            "queued_for_analysis": 0,
            "analyzed_successfully": 0,
            "analysis_failed": 0,
            "failed_files": [],
            "failed_files_truncated_count": 0,
        },
        "duplicates": {
            "mode": "off",
            "queued_for_processing": 0,
            "processed_successfully": 0,
            "processing_failed": 0,
            "failed_files": [],
            "failed_files_truncated_count": 0,
            "duplicate_groups": 0,
            "duplicate_files": 0,
        },
        "pattern_recognition": {
            "analyze_bonus_content": True,
            "bonus_ignored_total": 0,
            "bonus_pattern_hits": [],
            "series_detected": 0,
            "seasons_detected": 0,
            "episodes_classified": 0,
            "classification_updated_files": 0,
        },
    }


def queue_scan_job(
    db: Session,
    library_id: int,
    scan_type: str = "incremental",
    *,
    trigger_source: ScanTriggerSource = ScanTriggerSource.manual,
    trigger_details: dict | None = None,
) -> tuple[ScanJob, bool]:
    existing_job = db.scalar(
        select(ScanJob)
        .where(
            ScanJob.library_id == library_id,
            ScanJob.job_type.in_(["incremental", "full"]),
            ScanJob.status.in_([JobStatus.queued, JobStatus.running]),
        )
        .order_by(ScanJob.id.desc())
    )
    if existing_job is not None:
        existing_job.trigger_details = _append_coalesced_trigger(existing_job.trigger_details, trigger_source, trigger_details)
        db.commit()
        db.refresh(existing_job)
        return existing_job, False

    library = db.get(Library, library_id)
    scan_summary = _empty_scan_summary()
    if library is not None:
        scan_summary["duplicates"]["mode"] = library.duplicate_detection_mode.value

    job = ScanJob(
        library_id=library_id,
        status=JobStatus.queued,
        job_type=scan_type,
        trigger_source=trigger_source,
        trigger_details=_coerce_trigger_details(trigger_details),
        scan_summary=scan_summary,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job, True


def queue_quality_recompute_job(db: Session, library_id: int) -> tuple[ScanJob, bool]:
    active_jobs = db.scalars(
        select(ScanJob)
        .where(
            ScanJob.library_id == library_id,
            ScanJob.job_type == "quality_recompute",
            ScanJob.status.in_([JobStatus.queued, JobStatus.running]),
        )
        .order_by(ScanJob.id.asc())
    ).all()
    queued_job = next((job for job in active_jobs if job.status == JobStatus.queued), None)
    if queued_job is not None:
        return queued_job, False

    running_job = next((job for job in active_jobs if job.status == JobStatus.running), None)
    if running_job is None and active_jobs:
        return active_jobs[0], False

    job = ScanJob(library_id=library_id, status=JobStatus.queued, job_type="quality_recompute")
    db.add(job)
    db.commit()
    db.refresh(job)
    return job, True


def libraries_needing_quality_backfill(db: Session) -> list[int]:
    rows = db.scalars(
        select(MediaFile.library_id)
        .where(
            or_(
                MediaFile.quality_score_raw <= 0,
                MediaFile.quality_score_breakdown.is_(None),
            )
        )
        .group_by(MediaFile.library_id)
        .order_by(MediaFile.library_id.asc())
    ).all()
    return list(rows)


def _incomplete_analysis_file_ids(db: Session, library_id: int) -> set[int]:
    incomplete_ids = set(
        db.scalars(
            select(MediaFile.id).where(
                MediaFile.library_id == library_id,
                or_(
                    MediaFile.last_analyzed_at.is_(None),
                    MediaFile.raw_ffprobe_json.is_(None),
                    MediaFile.scan_status != ScanStatus.ready,
                ),
            )
        ).all()
    )
    incomplete_ids.update(
        db.scalars(
            select(AudioStream.media_file_id)
            .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
            .where(MediaFile.library_id == library_id, AudioStream.codec.is_(None))
        ).all()
    )
    incomplete_ids.update(
        db.scalars(
            select(SubtitleStream.media_file_id)
            .join(MediaFile, MediaFile.id == SubtitleStream.media_file_id)
            .where(
                MediaFile.library_id == library_id,
                or_(SubtitleStream.codec.is_(None), SubtitleStream.subtitle_type.is_(None)),
            )
        ).all()
    )
    incomplete_ids.update(
        db.scalars(
            select(ExternalSubtitle.media_file_id)
            .join(MediaFile, MediaFile.id == ExternalSubtitle.media_file_id)
            .where(MediaFile.library_id == library_id, ExternalSubtitle.format.is_(None))
        ).all()
    )
    return incomplete_ids


def execute_scan_job(job_id: int, settings: Settings) -> None:
    db = SessionLocal()
    try:
        _run_scan_job(db, settings, job_id)
    except ScanCanceled:
        job = db.get(ScanJob, job_id)
        if job:
            job.status = JobStatus.canceled
            job.finished_at = utc_now()
            db.commit()
    except Exception:
        job = db.get(ScanJob, job_id)
        if job:
            job.status = JobStatus.failed
            job.finished_at = utc_now()
            job.errors += 1
            db.commit()
    finally:
        db.close()


def _run_scan_job(db: Session, settings: Settings, job_id: int) -> ScanJob:
    job = db.get(ScanJob, job_id)
    if not job:
        raise ValueError(f"Scan job {job_id} not found")
    if job.status == JobStatus.canceled:
        job.finished_at = job.finished_at or utc_now()
        db.commit()
        return job

    job.status = JobStatus.running
    job.started_at = utc_now()
    job.finished_at = None
    db.commit()
    db.refresh(job)

    if job.job_type == "quality_recompute":
        return run_quality_recompute(db, job.library_id, job)
    return run_scan(db, settings, job.library_id, job.job_type, job)


def run_scan(
    db: Session,
    settings: Settings,
    library_id: int,
    scan_type: str = "incremental",
    existing_job: ScanJob | None = None,
) -> ScanJob:
    cache_key = str(id(db.get_bind()))
    library = db.get(Library, library_id)
    if not library:
        raise ValueError(f"Library {library_id} not found")

    root = _library_root(library)
    job = existing_job or ScanJob(
        library_id=library_id,
        status=JobStatus.running,
        job_type=scan_type,
        started_at=utc_now(),
    )
    if existing_job is None:
        db.add(job)
        db.commit()
        db.refresh(job)

    def _should_cancel() -> bool:
        db.refresh(job)
        return job.status == JobStatus.canceled

    existing_by_path = {
        media_file.relative_path: media_file
        for media_file in db.scalars(
            select(MediaFile)
            .where(MediaFile.library_id == library_id)
            .options(selectinload(MediaFile.external_subtitles))
        ).all()
    }
    incomplete_analysis_ids = _incomplete_analysis_file_ids(db, library_id)
    app_settings = get_app_settings(db, settings)
    ignore_patterns = tuple(app_settings.ignore_patterns)
    pattern_recognition_settings = app_settings.pattern_recognition
    duplicate_strategy = get_duplicate_detection_strategy(library.duplicate_detection_mode)
    new_files = SampledPathList()
    modified_files = SampledPathList()
    deleted_files = SampledPathList()
    failed_files = FailedFileSamples()
    duplicate_failed_files = FailedFileSamples()
    unchanged_files = 0
    reanalyzed_incomplete_files = 0
    analyzed_successfully = 0
    duplicate_processed_successfully = 0
    duplicate_processing_failed = 0
    classification_updated_files = 0
    episodes_classified = 0
    recognized_series_ids: set[int] = set()
    recognized_season_ids: set[int] = set()

    def _missing_rename_candidates() -> list[MediaFile]:
        return [
            candidate
            for candidate_path, candidate in existing_by_path.items()
            if candidate_path not in seen_relative_paths
            and not (root / candidate.relative_path).exists()
        ]

    def _log_rename_candidate(candidate: MediaFile, relative_path: str, reason: str) -> MediaFile:
        logger.info(
            "Detected media rename in library %s via %s: %s -> %s",
            library.id,
            reason,
            candidate.relative_path,
            relative_path,
        )
        return candidate

    def _find_hash_rename_candidate(
        relative_path: str,
        candidates: list[MediaFile],
    ) -> MediaFile | None:
        hash_candidates = [
            candidate
            for candidate in candidates
            if candidate.content_hash_algorithm == FILE_HASH_ALGORITHM
            and (candidate.content_hash or "").strip()
        ]
        if not hash_candidates:
            return None
        try:
            payload = FileHashDuplicateDetectionStrategy().build_payload(root / relative_path)
        except OSError:
            logger.exception("Failed to hash rename candidate %s", relative_path)
            return None

        content_hash = payload.get("content_hash")
        matches = [
            candidate
            for candidate in hash_candidates
            if candidate.content_hash == content_hash
        ]
        if len(matches) != 1:
            return None
        return _log_rename_candidate(matches[0], relative_path, "content hash")

    def _find_similar_rename_candidate(
        relative_path: str,
        size_bytes: int,
        candidates: list[MediaFile],
    ) -> MediaFile | None:
        scored_candidates = sorted(
            (
                (
                    _rename_similarity_score(
                        candidate.relative_path,
                        relative_path,
                        candidate.size_bytes,
                        size_bytes,
                    ),
                    candidate,
                )
                for candidate in candidates
            ),
            key=lambda item: item[0],
            reverse=True,
        )
        if not scored_candidates:
            return None

        best_score, best_candidate = scored_candidates[0]
        if len(scored_candidates) == 1 and best_score >= RENAME_SINGLE_MISSING_SCORE_THRESHOLD:
            return _log_rename_candidate(
                best_candidate,
                relative_path,
                f"name similarity {best_score:.2f}",
            )
        if best_score < RENAME_MATCH_SCORE_THRESHOLD:
            return None
        if (
            len(scored_candidates) > 1
            and best_score - scored_candidates[1][0] < RENAME_MATCH_SCORE_GAP
        ):
            return None
        return _log_rename_candidate(
            best_candidate,
            relative_path,
            f"name similarity {best_score:.2f}",
        )

    def _find_rename_candidate(
        relative_path: str,
        size_bytes: int,
        mtime: float,
    ) -> MediaFile | None:
        candidates = _missing_rename_candidates()
        exact_candidates = [
            candidate
            for candidate in candidates
            if candidate.size_bytes == size_bytes and candidate.mtime == mtime
        ]
        if len(exact_candidates) == 1:
            return _log_rename_candidate(exact_candidates[0], relative_path, "size and mtime")

        hash_candidate = _find_hash_rename_candidate(relative_path, candidates)
        if hash_candidate is not None:
            return hash_candidate

        similar_candidate = _find_similar_rename_candidate(relative_path, size_bytes, candidates)
        if similar_candidate is not None:
            return similar_candidate

        return None

    def _build_scan_summary(
        discovery: DiscoveryResult,
        queued_for_analysis: int,
        queued_for_duplicate_processing: int,
        *,
        include_duplicate_counts: bool,
    ) -> dict:
        duplicate_groups = 0
        duplicate_files = 0
        if include_duplicate_counts:
            duplicate_groups, duplicate_files = get_duplicate_group_counts(db, library.id, library.duplicate_detection_mode)
        return {
            "ignore_patterns": list(ignore_patterns),
            "discovery": {
                "discovered_files": discovery.file_count,
                "ignored_total": discovery.ignored_total,
                "ignored_dir_total": discovery.ignored_dir_total,
                "ignored_file_total": discovery.ignored_file_total,
                "ignored_pattern_hits": [
                    {
                        "pattern": pattern,
                        "count": hit.count,
                        "paths": hit.paths,
                        "truncated_count": hit.truncated_count,
                    }
                    for pattern, hit in sorted(discovery.ignored_pattern_hits.items(), key=lambda entry: entry[0].lower())
                ],
            },
            "changes": {
                "queued_for_analysis": queued_for_analysis,
                "unchanged_files": unchanged_files,
                "reanalyzed_incomplete_files": reanalyzed_incomplete_files,
                "new_files": new_files.as_dict(),
                "modified_files": modified_files.as_dict(),
                "deleted_files": deleted_files.as_dict(),
            },
            "analysis": {
                "queued_for_analysis": queued_for_analysis,
                "analyzed_successfully": analyzed_successfully,
                "analysis_failed": len(failed_files.items) + failed_files.truncated_count,
                **failed_files.as_dict(),
            },
            "duplicates": {
                "mode": duplicate_strategy.mode.value,
                "queued_for_processing": queued_for_duplicate_processing,
                "processed_successfully": duplicate_processed_successfully,
                "processing_failed": duplicate_processing_failed,
                "duplicate_groups": duplicate_groups,
                "duplicate_files": duplicate_files,
                **duplicate_failed_files.as_dict(),
            },
            "pattern_recognition": {
                "analyze_bonus_content": pattern_recognition_settings.analyze_bonus_content,
                "bonus_ignored_total": discovery.bonus_ignored_total,
                "bonus_pattern_hits": _pattern_hits_as_list(discovery.bonus_pattern_hits),
                "series_detected": len(recognized_series_ids),
                "seasons_detected": len(recognized_season_ids),
                "episodes_classified": episodes_classified,
                "classification_updated_files": classification_updated_files,
            },
        }

    def _recognize_media_file(media_file: MediaFile, relative_path: str) -> None:
        nonlocal classification_updated_files
        nonlocal episodes_classified
        recognition = recognize_media_path(relative_path, library.type, pattern_recognition_settings)
        if _apply_path_recognition(db, library, media_file, recognition):
            classification_updated_files += 1
        if media_file.series_id is not None:
            recognized_series_ids.add(media_file.series_id)
        if media_file.season_id is not None:
            recognized_season_ids.add(media_file.season_id)
        if media_file.series_id is not None and media_file.season_id is not None:
            episodes_classified += 1

    discovery = DiscoveryResult(files=[], collect_files=False)
    seen_relative_paths: set[str] = set()
    queued_work_total = 0
    queued_for_analysis = 0
    queued_for_duplicate_processing = 0
    discovery_progress_counter = 0
    processing_progress_counter = 0

    job.files_total = 0
    job.files_scanned = 0
    job.scan_summary = _build_scan_summary(
        discovery,
        queued_for_analysis,
        queued_for_duplicate_processing,
        include_duplicate_counts=False,
    )
    db.commit()

    def _safe_process_work(
        work: QueuedMediaWork,
    ) -> tuple[
        str,
        dict | None,
        list[dict[str, str | None]],
        str | None,
        str | None,
        dict[str, str | None] | None,
        str | None,
        str | None,
    ]:
        relative_path = work.path.relative_to(root).as_posix()
        payload: dict | None = None
        subtitles: list[dict[str, str | None]] = []
        analysis_error: str | None = None
        analysis_error_detail: str | None = None
        duplicate_payload: dict[str, str | None] | None = None
        duplicate_error: str | None = None
        duplicate_error_detail: str | None = None

        if work.needs_analysis:
            try:
                payload, subtitles = _analyze_path(work.path, root, settings, ignore_patterns)
            except Exception as exc:
                logger.exception("Media analysis failed for %s", relative_path)
                analysis_error, analysis_error_detail = _error_details(exc)

        if work.needs_duplicate_processing:
            try:
                duplicate_payload = duplicate_strategy.build_payload(work.path)
            except Exception as exc:
                logger.exception("Duplicate processing failed for %s", relative_path)
                duplicate_error, duplicate_error_detail = _error_details(exc)

        return (
            relative_path,
            payload,
            subtitles,
            analysis_error,
            analysis_error_detail,
            duplicate_payload,
            duplicate_error,
            duplicate_error_detail,
        )

    scan_worker_count = max(1, app_settings.scan_performance.scan_worker_count)
    discovery_progress_interval = max(1, min(settings.scan_discovery_batch_size, 25))

    def _commit_scan_progress(*, include_duplicate_counts: bool) -> None:
        job.files_total = queued_work_total
        job.scan_summary = _build_scan_summary(
            discovery,
            queued_for_analysis,
            queued_for_duplicate_processing,
            include_duplicate_counts=include_duplicate_counts,
        )
        db.commit()

    with ThreadPoolExecutor(max_workers=scan_worker_count) as executor:
        pending: dict[Future, QueuedMediaWork] = {}
        max_in_flight = max(1, scan_worker_count * 2)

        def _poll_completed_work(*, wait_for_completion: bool) -> int:
            nonlocal analyzed_successfully
            nonlocal duplicate_processed_successfully
            nonlocal duplicate_processing_failed
            nonlocal processing_progress_counter

            if not pending:
                return 0

            done, _ = wait(
                pending.keys(),
                timeout=None if wait_for_completion else 0,
                return_when=FIRST_COMPLETED,
            )
            if not done:
                return 0

            processed_count = 0
            for future in done:
                work = pending.pop(future)
                (
                    relative_path,
                    payload,
                    subtitles,
                    analysis_error,
                    analysis_error_detail,
                    duplicate_payload,
                    duplicate_error,
                    duplicate_error_detail,
                ) = future.result()
                if work.needs_analysis:
                    if analysis_error is None and payload is not None:
                        try:
                            _apply_analysis_result(
                                work.media_file,
                                payload,
                                subtitles,
                                library,
                                app_settings.resolution_categories,
                            )
                            create_media_file_history_entry_if_changed(
                                db,
                                work.media_file,
                                MediaFileHistoryCaptureReason.scan_analysis,
                                app_settings.resolution_categories,
                            )
                            analyzed_successfully += 1
                        except Exception as exc:
                            logger.exception("Media normalization failed for %s", relative_path)
                            work.media_file.scan_status = ScanStatus.failed
                            job.errors += 1
                            reason, detail = _error_details(exc)
                            failed_files.add(relative_path, reason, detail)
                    else:
                        work.media_file.scan_status = ScanStatus.failed
                        job.errors += 1
                        failed_files.add(
                            relative_path,
                            analysis_error or "Unknown analysis failure",
                            analysis_error_detail or analysis_error or "Unknown analysis failure",
                        )

                if work.needs_duplicate_processing:
                    if duplicate_error is None and duplicate_payload is not None:
                        try:
                            duplicate_strategy.apply_payload(work.media_file, duplicate_payload)
                            duplicate_processed_successfully += 1
                        except Exception as exc:
                            logger.exception("Duplicate persistence failed for %s", relative_path)
                            duplicate_processing_failed += 1
                            job.errors += 1
                            reason, detail = _error_details(exc)
                            duplicate_failed_files.add(relative_path, reason, detail)
                    else:
                        duplicate_processing_failed += 1
                        job.errors += 1
                        duplicate_failed_files.add(
                            relative_path,
                            duplicate_error or "Unknown duplicate processing failure",
                            duplicate_error_detail or duplicate_error or "Unknown duplicate processing failure",
                        )

                job.files_scanned += 1
                processing_progress_counter += 1
                processed_count += 1

            if processing_progress_counter >= settings.scan_commit_batch_size:
                _commit_scan_progress(include_duplicate_counts=False)
                processing_progress_counter = 0

            return processed_count

        def _submit_work(work: QueuedMediaWork) -> None:
            while len(pending) >= max_in_flight:
                _poll_completed_work(wait_for_completion=True)
            pending[executor.submit(_safe_process_work, work)] = work

        for discovered_media_file in _stream_media_files(
            root,
            settings.allowed_media_extensions,
            discovery=discovery,
            ignore_patterns=ignore_patterns,
            pattern_recognition_settings=pattern_recognition_settings,
            should_cancel=_should_cancel,
        ):
            file_path = discovered_media_file.path
            relative_path = file_path.relative_to(root).as_posix()
            seen_relative_paths.add(relative_path)
            discovery_progress_counter += 1
            stat = file_path.stat()
            media_file = existing_by_path.get(relative_path)

            if media_file is None:
                rename_candidate = _find_rename_candidate(relative_path, stat.st_size, stat.st_mtime)
                if rename_candidate is None:
                    media_file = MediaFile(
                        library_id=library.id,
                        relative_path=relative_path,
                        filename=file_path.name,
                        extension=file_path.suffix.lower().lstrip("."),
                        size_bytes=stat.st_size,
                        mtime=stat.st_mtime,
                        last_seen_at=utc_now(),
                        scan_status=ScanStatus.pending,
                    )
                    db.add(media_file)
                    db.flush()
                    _recognize_media_file(media_file, relative_path)
                    new_files.add(relative_path)
                else:
                    existing_by_path.pop(rename_candidate.relative_path, None)
                    media_file = rename_candidate
                    media_file.relative_path = relative_path
                    media_file.filename = file_path.name
                    media_file.extension = file_path.suffix.lower().lstrip(".")
                    media_file.size_bytes = stat.st_size
                    media_file.mtime = stat.st_mtime
                    media_file.last_seen_at = utc_now()
                    media_file.scan_status = ScanStatus.pending
                    _recognize_media_file(media_file, relative_path)
                    modified_files.add(relative_path)
                queued_work_total += 1
                queued_for_analysis += 1
                queued_for_duplicate_processing += 1
                _submit_work(
                    QueuedMediaWork(
                        media_file=media_file,
                        path=file_path,
                        needs_analysis=True,
                        needs_duplicate_processing=True,
                    )
                )
            else:
                changed = media_file.size_bytes != stat.st_size or media_file.mtime != stat.st_mtime
                analysis_incomplete = media_file.id in incomplete_analysis_ids
                external_subtitles_changed = False
                if not changed and scan_type != "full" and not analysis_incomplete:
                    current_external_subtitles = _visible_external_subtitles(
                        file_path,
                        root,
                        settings.subtitle_extensions,
                        ignore_patterns,
                        sibling_filenames=discovered_media_file.sibling_filenames,
                    )
                    external_subtitles_changed = (
                        _external_subtitle_signature(current_external_subtitles)
                        != _external_subtitle_signature(media_file.external_subtitles)
                    )
                media_file.filename = file_path.name
                media_file.extension = file_path.suffix.lower().lstrip(".")
                media_file.size_bytes = stat.st_size
                media_file.mtime = stat.st_mtime
                media_file.last_seen_at = utc_now()
                _recognize_media_file(media_file, relative_path)
                needs_duplicate_processing = changed or duplicate_strategy.needs_processing(media_file)
                needs_analysis = (
                    changed
                    or scan_type == "full"
                    or analysis_incomplete
                    or external_subtitles_changed
                )
                if needs_analysis or needs_duplicate_processing:
                    if changed or external_subtitles_changed:
                        modified_files.add(relative_path)
                    elif analysis_incomplete:
                        reanalyzed_incomplete_files += 1
                    if needs_analysis:
                        media_file.scan_status = ScanStatus.pending
                    else:
                        unchanged_files += 1

                    queued_work_total += 1
                    if needs_analysis:
                        queued_for_analysis += 1
                    if needs_duplicate_processing:
                        queued_for_duplicate_processing += 1
                    _submit_work(
                        QueuedMediaWork(
                            media_file=media_file,
                            path=file_path,
                            needs_analysis=needs_analysis,
                            needs_duplicate_processing=needs_duplicate_processing,
                        )
                    )
                else:
                    unchanged_files += 1

            _poll_completed_work(wait_for_completion=False)
            if discovery_progress_counter >= discovery_progress_interval:
                _commit_scan_progress(include_duplicate_counts=False)
                discovery_progress_counter = 0
                if _should_cancel():
                    raise ScanCanceled()

        stale_ids = [
            media_file.id
            for relative_path, media_file in existing_by_path.items()
            if relative_path not in seen_relative_paths
        ]
        for relative_path, media_file in existing_by_path.items():
            if relative_path not in seen_relative_paths:
                deleted_files.add(relative_path)
        if stale_ids:
            db.execute(delete(MediaFile).where(MediaFile.id.in_(stale_ids)))
        _cleanup_empty_series_entries(db, library.id)

        _commit_scan_progress(include_duplicate_counts=False)
        discovery_progress_counter = 0
        if _should_cancel():
            raise ScanCanceled()

        while pending:
            if _should_cancel():
                for future in pending:
                    future.cancel()
                raise ScanCanceled()
            _poll_completed_work(wait_for_completion=True)

        if processing_progress_counter:
            _commit_scan_progress(include_duplicate_counts=False)
            processing_progress_counter = 0

    if _should_cancel():
        raise ScanCanceled()
    library.last_scan_at = utc_now()
    job.status = JobStatus.completed
    job.finished_at = utc_now()
    job.scan_summary = _build_scan_summary(
        discovery,
        queued_for_analysis,
        queued_for_duplicate_processing,
        include_duplicate_counts=True,
    )
    stats_cache.invalidate(cache_key, job.library_id)
    upsert_library_history_snapshot(
        db,
        library,
        source_scan_job_id=job.id,
        scan_summary=job.scan_summary,
        captured_at=job.finished_at,
    )
    db.commit()
    stats_cache.invalidate(cache_key, job.library_id)
    db.refresh(job)
    return job


def run_quality_recompute(db: Session, library_id: int, existing_job: ScanJob | None = None) -> ScanJob:
    cache_key = str(id(db.get_bind()))
    library = db.get(Library, library_id)
    if not library:
        raise ValueError(f"Library {library_id} not found")

    job = existing_job or ScanJob(
        library_id=library_id,
        status=JobStatus.running,
        job_type="quality_recompute",
        started_at=utc_now(),
    )
    if existing_job is None:
        db.add(job)
        db.commit()
        db.refresh(job)

    def _should_cancel() -> bool:
        db.refresh(job)
        return job.status == JobStatus.canceled

    media_files = db.scalars(
        select(MediaFile)
        .where(
            MediaFile.library_id == library_id,
            MediaFile.last_analyzed_at.is_not(None),
            MediaFile.raw_ffprobe_json.is_not(None),
            MediaFile.scan_status == ScanStatus.ready,
        )
        .options(
            selectinload(MediaFile.media_format),
            selectinload(MediaFile.video_streams),
            selectinload(MediaFile.audio_streams),
            selectinload(MediaFile.subtitle_streams),
            selectinload(MediaFile.external_subtitles),
        )
        .order_by(MediaFile.id.asc())
    ).all()

    job.files_total = len(media_files)
    job.files_scanned = 0
    db.commit()

    batch_counter = 0
    resolution_categories = get_app_settings(db).resolution_categories
    for media_file in media_files:
        if _should_cancel():
            raise ScanCanceled()
        breakdown = calculate_quality_score(
            build_quality_score_input_from_media_file(media_file),
            library.quality_profile,
            resolution_categories,
        )
        _persist_quality_breakdown(media_file, breakdown)
        create_media_file_history_entry_if_changed(
            db,
            media_file,
            MediaFileHistoryCaptureReason.quality_recompute,
            resolution_categories,
        )
        job.files_scanned += 1
        batch_counter += 1
        if batch_counter >= 200:
            db.commit()
            batch_counter = 0

    if batch_counter:
        db.commit()

    job.status = JobStatus.failed if job.errors else JobStatus.completed
    job.finished_at = utc_now()
    db.commit()
    stats_cache.invalidate(cache_key, library_id)
    db.refresh(job)
    return job
