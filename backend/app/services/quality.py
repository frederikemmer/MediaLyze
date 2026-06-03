from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from backend.app.schemas.app_settings import ResolutionCategory
from backend.app.schemas.quality import (
    QualityBreakdownRead,
    QualityCategoryBreakdownRead,
    QualityCategoryConfig,
    QualityLanguagePreferencesConfig,
    QualityNumericCategoryConfig,
    QualityProfile,
)
from backend.app.services.ffprobe_parser import ProbeResult
from backend.app.services.languages import normalize_language_code
from backend.app.services.resolution_categories import (
    classify_resolution_category,
    default_resolution_categories,
    resolve_resolution_category_fallback,
    resolution_category_rank_map,
)


VIDEO_CODEC_RANKS = {
    "mpeg2video": 0.5,
    "mpeg4": 0.75,
    "vc1": 0.9,
    "mjpeg": 0.95,
    "h264": 1.0,
    "vp9": 1.5,
    "hevc": 2.0,
    "prores": 2.0,
    "av1": 3.0,
}
AUDIO_CHANNEL_RANKS = {
    "mono": 1.0,
    "stereo": 2.0,
    "5.1": 3.0,
    "7.1": 4.0,
}
AUDIO_CODEC_RANKS = {
    "mp3": 0.8,
    "vorbis": 0.9,
    "aac": 1.0,
    "ac3": 2.0,
    "eac3": 3.0,
    "opus": 3.5,
    "dts": 4.0,
    "dts_hd": 5.0,
    "truehd": 6.0,
    "flac": 6.0,
    "alac": 6.0,
    "pcm_bluray": 6.0,
    "pcm_s16le": 6.0,
    "pcm_s16be": 6.0,
    "pcm_s24le": 6.0,
    "pcm_s24be": 6.0,
    "pcm_s32le": 6.0,
    "pcm_s32be": 6.0,
}
DYNAMIC_RANGE_RANKS = {
    "sdr": 1.0,
    "hdr10": 2.0,
    "hdr10_plus": 3.0,
    "dolby_vision": 4.0,
}
REFERENCE_1080P_PIXELS = 1920 * 1080
BASE_QUALITY_METRICS = (
    "resolution",
    "visual_density",
    "video_codec",
    "audio_channels",
    "audio_codec",
    "dynamic_range",
    "language_preferences",
)
VIDEO_QUALITY_METRICS = BASE_QUALITY_METRICS
MUSIC_QUALITY_METRICS = (
    "audio_channels",
    "audio_codec",
    "audio_bitrate",
    "sample_rate",
    "music_tags",
)
AUDIOBOOK_QUALITY_METRICS = (
    "audio_channels",
    "audio_codec",
    "audio_bitrate",
    "sample_rate",
    "audiobook_tags",
    "audiobook_chapters",
)
QUALITY_METRIC_KEYS = tuple(dict.fromkeys((*BASE_QUALITY_METRICS, *MUSIC_QUALITY_METRICS, *AUDIOBOOK_QUALITY_METRICS)))

MUSIC_TAG_FIELDS = (
    "title",
    "artist",
    "album",
    "album_artist",
    "genre",
    "date",
    "disc",
    "composer",
)
AUDIOBOOK_TAG_FIELDS = (
    "narrator",
    "author",
    "publisher",
    "series",
    "series_part",
    "description",
    "language",
    "isbn",
    "asin",
)


@dataclass(slots=True)
class QualityVideoStream:
    stream_index: int
    codec: str | None
    width: int | None
    height: int | None
    frame_rate: float | None
    bit_rate: int | None
    hdr_type: str | None


@dataclass(slots=True)
class QualityAudioStream:
    stream_index: int
    codec: str | None
    channels: int | None
    channel_layout: str | None
    bit_rate: int | None
    sample_rate: int | None
    language: str | None
    default_flag: bool


@dataclass(slots=True)
class QualitySubtitle:
    language: str | None


@dataclass(slots=True)
class QualityScoreInput:
    container_bit_rate: int | None
    duration_seconds: float | None = None
    size_bytes: int | None = None
    video_streams: list[QualityVideoStream] = field(default_factory=list)
    audio_streams: list[QualityAudioStream] = field(default_factory=list)
    subtitle_streams: list[QualitySubtitle] = field(default_factory=list)
    external_subtitles: list[QualitySubtitle] = field(default_factory=list)
    music_tags: dict[str, str | None] = field(default_factory=dict)
    audiobook_tags: dict[str, str | None] = field(default_factory=dict)
    chapter_count: int | None = None
    chapter_titles: list[str] = field(default_factory=list)


def default_quality_profile() -> dict[str, Any]:
    return default_quality_profile_for_media_type("video")


def default_quality_profile_for_media_type(media_type: str) -> dict[str, Any]:
    profile = QualityProfile()
    if media_type == "music":
        profile = profile.model_copy(
            update={
                "active_metrics": list(MUSIC_QUALITY_METRICS),
                "resolution": profile.resolution.model_copy(update={"weight": 0}),
                "visual_density": profile.visual_density.model_copy(update={"weight": 0}),
                "video_codec": profile.video_codec.model_copy(update={"weight": 0}),
                "dynamic_range": profile.dynamic_range.model_copy(update={"weight": 0}),
                "audio_bitrate": profile.audio_bitrate.model_copy(update={"weight": 4, "minimum": 96000, "ideal": 256000, "maximum": 512000}),
                "sample_rate": profile.sample_rate.model_copy(update={"weight": 3, "minimum": 44100, "ideal": 48000, "maximum": 96000}),
                "music_tags": profile.music_tags.model_copy(update={"weight": 6}),
                "language_preferences": profile.language_preferences.model_copy(update={"weight": 0}),
            }
        )
    elif media_type == "audiobook":
        profile = profile.model_copy(
            update={
                "active_metrics": list(AUDIOBOOK_QUALITY_METRICS),
                "resolution": profile.resolution.model_copy(update={"weight": 0}),
                "visual_density": profile.visual_density.model_copy(update={"weight": 0}),
                "video_codec": profile.video_codec.model_copy(update={"weight": 0}),
                "dynamic_range": profile.dynamic_range.model_copy(update={"weight": 0}),
                "audio_codec": profile.audio_codec.model_copy(update={"weight": 4, "minimum": "mp3", "ideal": "aac"}),
                "audio_bitrate": profile.audio_bitrate.model_copy(update={"weight": 4, "minimum": 64000, "ideal": 128000, "maximum": 256000}),
                "sample_rate": profile.sample_rate.model_copy(update={"weight": 2, "minimum": 22050, "ideal": 44100, "maximum": 48000}),
                "audiobook_tags": profile.audiobook_tags.model_copy(update={"weight": 6}),
                "audiobook_chapters": profile.audiobook_chapters.model_copy(update={"weight": 5}),
                "language_preferences": profile.language_preferences.model_copy(update={"weight": 0}),
            }
        )
    else:
        profile = profile.model_copy(update={"active_metrics": list(VIDEO_QUALITY_METRICS)})
    return normalize_quality_profile(profile)


def _first_resolution_category_id(categories: list[ResolutionCategory]) -> str:
    first = categories[0]
    if isinstance(first, dict):
        return str(first["id"])
    return first.id


def normalize_quality_profile(
    payload: dict[str, Any] | QualityProfile | None,
    resolution_categories: list[ResolutionCategory] | None = None,
) -> dict[str, Any]:
    categories = resolution_categories or default_resolution_categories()
    profile = payload if isinstance(payload, QualityProfile) else QualityProfile.model_validate(payload or {})
    active_metrics = _normalize_active_metrics(profile)
    resolution_minimum = resolve_resolution_category_fallback(str(profile.resolution.minimum), categories)
    resolution_ideal = resolve_resolution_category_fallback(str(profile.resolution.ideal), categories)
    resolution_maximum = resolve_resolution_category_fallback(
        str(profile.resolution.maximum),
        categories,
    ) if profile.resolution.maximum is not None else _first_resolution_category_id(categories)
    video_codec_minimum_values, video_codec_ideal_values = _normalized_tiered_quality_values(profile.video_codec)
    dynamic_range_minimum_values, dynamic_range_ideal_values = _normalized_tiered_quality_values(profile.dynamic_range)
    normalized = profile.model_copy(
        update={
            "resolution": profile.resolution.model_copy(
                update={
                    "minimum": resolution_minimum,
                    "ideal": resolution_ideal,
                    "maximum": resolution_maximum,
                }
            ),
            "video_codec": profile.video_codec.model_copy(
                update={
                    "values": None,
                    "minimum_values": video_codec_minimum_values,
                    "ideal_values": video_codec_ideal_values,
                }
            ),
            "dynamic_range": profile.dynamic_range.model_copy(
                update={
                    "values": None,
                    "minimum_values": dynamic_range_minimum_values,
                    "ideal_values": dynamic_range_ideal_values,
                }
            ),
            "audio_channels": profile.audio_channels.model_copy(
                update={"maximum": profile.audio_channels.maximum or "7.1"}
            ),
            "language_preferences": profile.language_preferences.model_copy(
                update={
                    "audio_languages": _normalized_language_list(profile.language_preferences.audio_languages),
                    "subtitle_languages": _normalized_language_list(profile.language_preferences.subtitle_languages),
                }
            ),
            "active_metrics": active_metrics,
        }
    )
    normalized = _apply_inactive_metric_weights(normalized, active_metrics)
    return normalized.model_dump(mode="json", exclude_none=True)


def _normalize_active_metrics(profile: QualityProfile) -> list[str]:
    if profile.active_metrics is None:
        return [key for key in BASE_QUALITY_METRICS if getattr(profile, key).weight > 0]
    normalized: list[str] = []
    for metric in profile.active_metrics:
        candidate = str(metric).strip()
        if candidate in QUALITY_METRIC_KEYS and candidate not in normalized:
            normalized.append(candidate)
    return normalized


def _apply_inactive_metric_weights(profile: QualityProfile, active_metrics: list[str]) -> QualityProfile:
    active = set(active_metrics)
    updates: dict[str, Any] = {}
    for key in QUALITY_METRIC_KEYS:
        category = getattr(profile, key, None)
        if category is None or key in active:
            continue
        updates[key] = category.model_copy(update={"weight": 0})
    return profile.model_copy(update=updates)


def build_quality_score_input(
    probe_result: ProbeResult,
    external_subtitles: list[dict[str, str | None]] | None = None,
    size_bytes: int | None = None,
) -> QualityScoreInput:
    return QualityScoreInput(
        container_bit_rate=probe_result.media_format.bit_rate,
        duration_seconds=probe_result.media_format.duration,
        size_bytes=size_bytes,
        video_streams=[
            QualityVideoStream(
                stream_index=stream.stream_index,
                codec=stream.codec,
                width=stream.width,
                height=stream.height,
                frame_rate=stream.frame_rate,
                bit_rate=stream.bit_rate,
                hdr_type=stream.hdr_type,
            )
            for stream in probe_result.video_streams
        ],
        audio_streams=[
            QualityAudioStream(
                stream_index=stream.stream_index,
                codec=stream.codec,
                channels=stream.channels,
                channel_layout=stream.channel_layout,
                bit_rate=stream.bit_rate,
                sample_rate=stream.sample_rate,
                language=stream.language,
                default_flag=stream.default_flag,
            )
            for stream in probe_result.audio_streams
        ],
        subtitle_streams=[QualitySubtitle(language=stream.language) for stream in probe_result.subtitle_streams],
        external_subtitles=[QualitySubtitle(language=item.get("language")) for item in (external_subtitles or [])],
        music_tags=_music_tags_from_probe(probe_result),
        audiobook_tags=_audiobook_tags_from_probe(probe_result),
        chapter_count=len(probe_result.chapters) or None,
        chapter_titles=[chapter.title or "" for chapter in probe_result.chapters],
    )


def build_quality_score_input_from_media_file(media_file) -> QualityScoreInput:
    return QualityScoreInput(
        container_bit_rate=media_file.media_format.bit_rate if media_file.media_format else None,
        duration_seconds=media_file.media_format.duration if media_file.media_format else None,
        size_bytes=media_file.size_bytes,
        video_streams=[
            QualityVideoStream(
                stream_index=stream.stream_index,
                codec=stream.codec,
                width=stream.width,
                height=stream.height,
                frame_rate=stream.frame_rate,
                bit_rate=stream.bit_rate,
                hdr_type=stream.hdr_type,
            )
            for stream in media_file.video_streams
        ],
        audio_streams=[
            QualityAudioStream(
                stream_index=stream.stream_index,
                codec=stream.codec,
                channels=stream.channels,
                channel_layout=stream.channel_layout,
                bit_rate=stream.bit_rate,
                sample_rate=stream.sample_rate,
                language=stream.language,
                default_flag=stream.default_flag,
            )
            for stream in media_file.audio_streams
        ],
        subtitle_streams=[QualitySubtitle(language=stream.language) for stream in media_file.subtitle_streams],
        external_subtitles=[QualitySubtitle(language=stream.language) for stream in media_file.external_subtitles],
        music_tags={
            "title": getattr(media_file, "audio_title", ""),
            "artist": getattr(media_file, "audio_artist", ""),
            "album": getattr(media_file, "audio_album", ""),
            "album_artist": getattr(media_file, "audio_album_artist", ""),
            "genre": getattr(media_file, "audio_genre", ""),
            "date": getattr(media_file, "audio_date", ""),
            "disc": getattr(media_file, "audio_disc", ""),
            "composer": getattr(media_file, "audio_composer", ""),
        },
        audiobook_tags={
            "narrator": getattr(media_file, "audiobook_narrator", ""),
            "author": getattr(media_file, "audiobook_author", ""),
            "publisher": getattr(media_file, "audiobook_publisher", ""),
            "series": getattr(media_file, "audiobook_series", ""),
            "series_part": getattr(media_file, "audiobook_series_part", ""),
            "description": getattr(media_file, "audiobook_description", ""),
            "language": getattr(media_file, "audiobook_language", ""),
            "isbn": getattr(media_file, "audiobook_isbn", ""),
            "asin": getattr(media_file, "audiobook_asin", ""),
        },
        chapter_count=getattr(media_file, "chapter_count", None) or (len(media_file.chapters) if hasattr(media_file, "chapters") else None),
        chapter_titles=[chapter.title or "" for chapter in getattr(media_file, "chapters", [])],
    )


def _music_tags_from_probe(probe_result: ProbeResult) -> dict[str, str | None]:
    selected = next((stream for stream in probe_result.audio_streams if stream.default_flag), None)
    selected = selected or (probe_result.audio_streams[0] if probe_result.audio_streams else None)
    if selected is None:
        return {}
    return {field: getattr(selected, field, None) for field in MUSIC_TAG_FIELDS}


def _audiobook_tags_from_probe(probe_result: ProbeResult) -> dict[str, str | None]:
    return {
        "narrator": probe_result.audiobook_narrator,
        "author": probe_result.audiobook_author,
        "publisher": probe_result.audiobook_publisher,
        "series": probe_result.audiobook_series,
        "series_part": probe_result.audiobook_series_part,
        "description": probe_result.audiobook_description,
        "language": probe_result.audiobook_language,
        "isbn": probe_result.audiobook_isbn,
        "asin": probe_result.audiobook_asin,
    }


def calculate_quality_score(
    score_input: QualityScoreInput,
    quality_profile: dict[str, Any] | QualityProfile | None = None,
    resolution_categories: list[ResolutionCategory] | None = None,
) -> QualityBreakdownRead:
    categories = resolution_categories or default_resolution_categories()
    resolution_ranks = resolution_category_rank_map(categories)
    profile = QualityProfile.model_validate(normalize_quality_profile(quality_profile, categories))
    active_metrics = set(profile.active_metrics or [])
    primary_video = _primary_video_stream(score_input.video_streams)
    selected_audio = _select_audio_stream(score_input.audio_streams, profile.language_preferences.audio_languages)
    resolution_category = (
        classify_resolution_category(primary_video.width, primary_video.height, categories) if primary_video else None
    )

    if primary_video is None:
        video_categories = [
            _skipped_category("resolution", profile.resolution.weight),
            _skipped_category("visual_density", profile.visual_density.weight),
            _skipped_category("video_codec", profile.video_codec.weight),
        ]
        dynamic_range_category = _skipped_category("dynamic_range", profile.dynamic_range.weight)
    else:
        video_categories = [
            _rank_category(
                key="resolution",
                config=profile.resolution,
                actual_key=resolution_category.id if resolution_category else None,
                actual_value=resolution_ranks.get(resolution_category.id) if resolution_category else None,
                ranks=resolution_ranks,
                missing_is_zero=True,
            ),
            _numeric_category(
                key="visual_density",
                config=profile.visual_density,
                actual=_visual_density(score_input, primary_video),
                missing_is_zero=True,
            ),
            _value_set_category(
                key="video_codec",
                config=profile.video_codec,
                actual_key=_normalize_video_codec(primary_video.codec),
                missing_is_zero=False,
            ),
        ]
        dynamic_range_category = _value_set_category(
            key="dynamic_range",
            config=profile.dynamic_range,
            actual_key=_normalize_dynamic_range(primary_video.hdr_type),
            missing_is_zero=False,
        )

    score_categories = [
        *video_categories,
        _rank_category(
            key="audio_channels",
            config=profile.audio_channels,
            actual_key=_audio_channel_key(selected_audio),
            actual_value=AUDIO_CHANNEL_RANKS.get(_audio_channel_key(selected_audio)) if selected_audio else None,
            ranks=AUDIO_CHANNEL_RANKS,
            missing_is_zero=True,
        ),
        _rank_category(
            key="audio_codec",
            config=profile.audio_codec,
            actual_key=_normalize_audio_codec(selected_audio.codec) if selected_audio else None,
            actual_value=AUDIO_CODEC_RANKS.get(_normalize_audio_codec(selected_audio.codec)) if selected_audio else None,
            ranks=AUDIO_CODEC_RANKS,
            missing_is_zero=False,
        ),
        dynamic_range_category,
        _language_category(score_input, profile.language_preferences),
        _numeric_category(
            key="audio_bitrate",
            config=profile.audio_bitrate,
            actual=selected_audio.bit_rate if selected_audio else None,
            missing_is_zero=True,
        ),
        _numeric_category(
            key="sample_rate",
            config=profile.sample_rate,
            actual=_audio_sample_rate(selected_audio),
            missing_is_zero=True,
        ),
        _metadata_presence_category(
            key="music_tags",
            config=profile.music_tags,
            values=score_input.music_tags,
            required_fields=MUSIC_TAG_FIELDS,
        ),
        _metadata_presence_category(
            key="audiobook_tags",
            config=profile.audiobook_tags,
            values=score_input.audiobook_tags,
            required_fields=AUDIOBOOK_TAG_FIELDS,
        ),
        _audiobook_chapters_category(score_input, profile.audiobook_chapters),
    ]
    categories = [
        category if category.key in active_metrics else _inactive_category(category.key)
        for category in score_categories
    ]

    weighted_total = 0.0
    total_weight = 0
    for category in categories:
        if not category.active or category.skipped:
            continue
        weighted_total += category.score * category.weight
        total_weight += category.weight

    score_raw = weighted_total / total_weight if total_weight > 0 else 0.0
    score = _round_score_10(score_raw)
    return QualityBreakdownRead(score=score, score_raw=round(score_raw, 2), categories=categories)


def _skipped_category(key: str, weight: int) -> QualityCategoryBreakdownRead:
    return QualityCategoryBreakdownRead(
        key=key,
        score=0.0,
        weight=weight,
        active=weight > 0,
        skipped=True,
        notes=["not_applicable"],
    )


def _inactive_category(key: str) -> QualityCategoryBreakdownRead:
    return QualityCategoryBreakdownRead(key=key, score=0.0, weight=0, active=False)


def _metadata_presence_category(
    *,
    key: str,
    config: QualityCategoryConfig,
    values: dict[str, str | None],
    required_fields: tuple[str, ...],
) -> QualityCategoryBreakdownRead:
    if config.weight <= 0:
        return QualityCategoryBreakdownRead(key=key, score=0.0, weight=0, active=False)
    present = [
        field
        for field in required_fields
        if str(values.get(field) or "").strip()
    ]
    score = (len(present) / len(required_fields)) * 100 if required_fields else 0.0
    return QualityCategoryBreakdownRead(
        key=key,
        score=round(score, 2),
        weight=config.weight,
        active=True,
        minimum="partial",
        ideal="complete",
        actual=present,
        notes=["metadata_presence"],
    )


def _audiobook_chapters_category(
    score_input: QualityScoreInput,
    config: QualityCategoryConfig,
) -> QualityCategoryBreakdownRead:
    if config.weight <= 0:
        return QualityCategoryBreakdownRead(key="audiobook_chapters", score=0.0, weight=0, active=False)
    chapter_count = score_input.chapter_count or 0
    titled_count = len([title for title in score_input.chapter_titles if str(title or "").strip()])
    if chapter_count <= 0:
        score = 0.0
    elif titled_count >= chapter_count:
        score = 100.0
    else:
        score = 60.0
    return QualityCategoryBreakdownRead(
        key="audiobook_chapters",
        score=score,
        weight=config.weight,
        active=True,
        minimum="chapters",
        ideal="chapters_with_titles",
        actual=f"{titled_count}/{chapter_count}",
    )


def _round_score_10(score_raw: float) -> int:
    rounded = int((Decimal(str(score_raw)) / Decimal("10")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return max(1, min(10, rounded))


def _normalized_language_list(values: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        candidate = normalize_language_code(value)
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        normalized.append(candidate)
    return normalized


def _normalized_quality_values(values: list[str] | None, *, fallback: list[str] | None = None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in [*(values or []), *(fallback or [])]:
        candidate = str(value).strip().lower()
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        normalized.append(candidate)
    return normalized


def _normalized_tiered_quality_values(config: QualityCategoryConfig) -> tuple[list[str], list[str]]:
    minimum_values = _normalized_quality_values(config.minimum_values)
    ideal_values = _normalized_quality_values(config.ideal_values)
    legacy_values = _normalized_quality_values(config.values)
    if not minimum_values and not ideal_values and legacy_values:
        minimum_key = str(config.minimum).strip().lower()
        ideal_key = str(config.ideal).strip().lower()
        minimum_values = [value for value in legacy_values if value == minimum_key]
        ideal_values = [value for value in legacy_values if value != minimum_key]
        if not ideal_values and ideal_key in legacy_values:
            ideal_values = [ideal_key]
    if not minimum_values and not ideal_values:
        minimum_values = _normalized_quality_values([str(config.minimum)])
        ideal_values = _normalized_quality_values([str(config.ideal)])
    return minimum_values, ideal_values


def _primary_video_stream(video_streams: list[QualityVideoStream]) -> QualityVideoStream | None:
    return min(video_streams, key=lambda stream: stream.stream_index, default=None)


def _normalize_video_codec(value: str | None) -> str | None:
    candidate = (value or "").strip().lower().replace(".", "").replace(" ", "_")
    mapping = {
        "avc": "h264",
        "avc1": "h264",
        "h264": "h264",
        "x264": "h264",
        "h265": "hevc",
        "hevc": "hevc",
        "x265": "hevc",
        "av1": "av1",
        "vp9": "vp9",
        "vc1": "vc1",
        "mpeg2": "mpeg2video",
        "mpeg2video": "mpeg2video",
        "mpeg4": "mpeg4",
        "prores": "prores",
        "mjpeg": "mjpeg",
    }
    return mapping.get(candidate, candidate or None)


def _normalize_audio_codec(value: str | None) -> str | None:
    candidate = (value or "").strip().lower().replace(" ", "_")
    mapping = {
        "aac": "aac",
        "ac3": "ac3",
        "eac3": "eac3",
        "mp3": "mp3",
        "libmp3lame": "mp3",
        "opus": "opus",
        "vorbis": "vorbis",
        "dts": "dts",
        "dca": "dts",
        "dts-hd": "dts_hd",
        "dts_hd": "dts_hd",
        "dts_hd_ma": "dts_hd",
        "dtshd_ma": "dts_hd",
        "truehd": "truehd",
        "mlp": "truehd",
        "flac": "flac",
        "alac": "alac",
        "pcm_bluray": "pcm_bluray",
        "pcm_s16le": "pcm_s16le",
        "pcm_s16be": "pcm_s16be",
        "pcm_s24le": "pcm_s24le",
        "pcm_s24be": "pcm_s24be",
        "pcm_s32le": "pcm_s32le",
        "pcm_s32be": "pcm_s32be",
    }
    return mapping.get(candidate, candidate or None)


def _normalize_dynamic_range(value: str | None) -> str:
    candidate = (value or "").strip().lower().replace(" ", "_")
    if not candidate:
        return "sdr"
    if candidate.startswith("dolby_vision"):
        return "dolby_vision"
    mapping = {
        "sdr": "sdr",
        "hdr10": "hdr10",
        "hdr10+": "hdr10_plus",
        "hdr10_plus": "hdr10_plus",
        "dolby_vision": "dolby_vision",
        "dolby-vision": "dolby_vision",
        "hlg": "hdr10",
    }
    return mapping.get(candidate, candidate)


def _audio_channel_key(stream: QualityAudioStream | None) -> str | None:
    if stream is None:
        return None
    layout = (stream.channel_layout or "").strip().lower()
    layout_mapping = {
        "mono": "mono",
        "1.0": "mono",
        "stereo": "stereo",
        "2.0": "stereo",
        "2.1": "stereo",
        "5.1": "5.1",
        "5.1(side)": "5.1",
        "5.1(back)": "5.1",
        "6.1": "5.1",
        "7.1": "7.1",
        "7.1(wide)": "7.1",
        "7.1(wide-side)": "7.1",
    }
    if layout in layout_mapping:
        return layout_mapping[layout]
    channels = stream.channels or 0
    if channels <= 1:
        return "mono"
    if channels <= 2:
        return "stereo"
    if channels <= 6:
        return "5.1"
    return "7.1"


def _audio_sample_rate(stream: QualityAudioStream | None) -> int | None:
    return stream.sample_rate if stream else None


def _audio_stream_sort_key(stream: QualityAudioStream) -> tuple[float, float, int, int]:
    channel_rank = AUDIO_CHANNEL_RANKS.get(_audio_channel_key(stream) or "", 0.0)
    codec_rank = AUDIO_CODEC_RANKS.get(_normalize_audio_codec(stream.codec) or "", 0.0)
    return (channel_rank, codec_rank, 1 if stream.default_flag else 0, -stream.stream_index)


def _select_audio_stream(
    streams: list[QualityAudioStream],
    preferred_languages: list[str],
) -> QualityAudioStream | None:
    if not streams:
        return None
    normalized_streams = [
        (normalize_language_code(stream.language), stream)
        for stream in streams
    ]
    for language in preferred_languages:
        matching = [stream for stream_language, stream in normalized_streams if stream_language == language]
        if matching:
            return max(matching, key=_audio_stream_sort_key)
    return max(streams, key=_audio_stream_sort_key)


def _visual_density(score_input: QualityScoreInput, primary_video: QualityVideoStream | None) -> float | None:
    if primary_video is None:
        return None
    width = primary_video.width
    height = primary_video.height
    if not width or not height:
        return None

    candidates: list[float] = []

    bitrate = primary_video.bit_rate
    if bitrate is not None and bitrate > 0:
        candidates.append(_gb_per_minute_from_bitrate(bitrate))
    else:
        audio_bitrate = sum(max(stream.bit_rate or 0, 0) for stream in score_input.audio_streams)
        if score_input.container_bit_rate is not None:
            estimated_video_bitrate = max(score_input.container_bit_rate - audio_bitrate, 0)
            if estimated_video_bitrate > 0:
                candidates.append(_gb_per_minute_from_bitrate(estimated_video_bitrate))

    if score_input.size_bytes is not None and score_input.duration_seconds and score_input.duration_seconds > 0:
        candidates.append(_gb_per_minute_from_size(score_input.size_bytes, score_input.duration_seconds))

    if not candidates:
        return None

    gb_per_minute = max(candidates)
    pixel_scale = REFERENCE_1080P_PIXELS / (width * height)
    return gb_per_minute * pixel_scale


def _gb_per_minute_from_bitrate(bitrate: int) -> float:
    bytes_per_minute = (bitrate / 8) * 60
    return bytes_per_minute / 1_000_000_000


def _gb_per_minute_from_size(size_bytes: int, duration_seconds: float) -> float:
    if duration_seconds <= 0:
        return 0.0
    return (size_bytes / 1_000_000_000) / (duration_seconds / 60)


def _language_category(
    score_input: QualityScoreInput,
    config: QualityLanguagePreferencesConfig,
) -> QualityCategoryBreakdownRead:
    active = config.weight > 0
    audio_wants = _normalized_language_list(config.audio_languages)
    subtitle_wants = _normalized_language_list(config.subtitle_languages)

    if not active:
        return QualityCategoryBreakdownRead(key="language_preferences", score=0.0, weight=0, active=False)
    if not audio_wants and not subtitle_wants:
        return QualityCategoryBreakdownRead(
            key="language_preferences",
            score=0.0,
            weight=config.weight,
            active=True,
            skipped=True,
            actual=[],
            notes=["no_preferences"],
        )

    audio_have = {
        normalize_language_code(stream.language)
        for stream in score_input.audio_streams
        if normalize_language_code(stream.language)
    }
    subtitle_have = {
        normalize_language_code(stream.language)
        for stream in [*score_input.subtitle_streams, *score_input.external_subtitles]
        if normalize_language_code(stream.language)
    }

    scores: list[float] = []
    notes: list[str] = []
    actual: list[str] = []

    if audio_wants:
        actual.extend(sorted(audio_have))
        scores.append((len(audio_have.intersection(audio_wants)) / len(audio_wants)) * 100)
        notes.append("audio_preferences")
    if subtitle_wants:
        actual.extend(sorted(subtitle_have))
        scores.append((len(subtitle_have.intersection(subtitle_wants)) / len(subtitle_wants)) * 100)
        notes.append("subtitle_preferences")

    score = sum(scores) / len(scores) if scores else 0.0
    return QualityCategoryBreakdownRead(
        key="language_preferences",
        score=round(score, 2),
        weight=config.weight,
        active=True,
        minimum=None,
        ideal=None,
        actual=sorted(set(actual)),
        notes=notes,
    )


def _numeric_category(
    *,
    key: str,
    config: QualityNumericCategoryConfig,
    actual: float | None,
    missing_is_zero: bool,
) -> QualityCategoryBreakdownRead:
    active = config.weight > 0
    if not active:
        return QualityCategoryBreakdownRead(key=key, score=0.0, weight=0, active=False)
    if actual is None:
        return QualityCategoryBreakdownRead(
            key=key,
            score=0.0 if missing_is_zero else 60.0,
            weight=config.weight,
            active=True,
            minimum=config.minimum,
            ideal=config.ideal,
            maximum=config.maximum,
            actual=None,
            notes=["missing_value"],
        )
    score = _score_value(float(actual), config.minimum, config.ideal, config.maximum)
    return QualityCategoryBreakdownRead(
        key=key,
        score=round(score, 2),
        weight=config.weight,
        active=True,
        minimum=config.minimum,
        ideal=config.ideal,
        maximum=config.maximum,
        actual=round(actual, 6),
    )


def _rank_category(
    *,
    key: str,
    config: QualityCategoryConfig,
    actual_key: str | None,
    actual_value: float | None,
    ranks: dict[str, float],
    missing_is_zero: bool,
) -> QualityCategoryBreakdownRead:
    active = config.weight > 0
    if not active:
        return QualityCategoryBreakdownRead(key=key, score=0.0, weight=0, active=False)
    minimum = str(config.minimum)
    ideal = str(config.ideal)

    if actual_key is None and actual_value is None:
        return QualityCategoryBreakdownRead(
            key=key,
            score=0.0 if missing_is_zero else 60.0,
            weight=config.weight,
            active=True,
            minimum=minimum,
            ideal=ideal,
            maximum=config.maximum,
            actual=None,
            notes=["missing_value"],
        )

    if actual_key is not None and actual_key not in ranks:
        return QualityCategoryBreakdownRead(
            key=key,
            score=60.0,
            weight=config.weight,
            active=True,
            minimum=minimum,
            ideal=ideal,
            maximum=config.maximum,
            actual=actual_key,
            unknown_mapping=True,
        )

    maximum = str(config.maximum) if config.maximum is not None else None
    if minimum not in ranks or ideal not in ranks or (maximum is not None and maximum not in ranks):
        raise ValueError(f"Invalid quality profile mapping for {key}")

    score = _score_value(
        actual_value or 0.0,
        ranks[minimum],
        ranks[ideal],
        ranks[maximum] if maximum is not None else None,
    )
    return QualityCategoryBreakdownRead(
        key=key,
        score=round(score, 2),
        weight=config.weight,
        active=True,
        minimum=minimum,
        ideal=ideal,
        maximum=maximum,
        actual=actual_key,
    )


def _value_set_category(
    *,
    key: str,
    config: QualityCategoryConfig,
    actual_key: str | None,
    missing_is_zero: bool,
) -> QualityCategoryBreakdownRead:
    active = config.weight > 0
    if not active:
        return QualityCategoryBreakdownRead(key=key, score=0.0, weight=0, active=False)
    minimum_values, ideal_values = _normalized_tiered_quality_values(config)

    if actual_key is None:
        return QualityCategoryBreakdownRead(
            key=key,
            score=0.0 if missing_is_zero else 60.0,
            weight=config.weight,
            active=True,
            minimum=None,
            ideal=None,
            maximum=None,
            actual=None,
            notes=["missing_value"],
        )

    if actual_key in ideal_values:
        score = 100.0
    elif actual_key in minimum_values:
        score = 60.0
    else:
        score = 0.0
    return QualityCategoryBreakdownRead(
        key=key,
        score=score,
        weight=config.weight,
        active=True,
        minimum=minimum_values,
        ideal=ideal_values,
        maximum=None,
        actual=actual_key,
    )


def _score_value(actual: float, minimum: float, ideal: float, maximum: float | None = None) -> float:
    if maximum is not None:
        if maximum < ideal:
            raise ValueError("maximum must be greater than or equal to ideal")
        if actual <= ideal:
            return _score_value(actual, minimum, ideal)
        if maximum == ideal:
            if maximum <= 0:
                return 0.0
            return max(0.0, min(100.0, (maximum / actual) * 100.0))
        if actual <= maximum:
            return 100.0 - ((actual - ideal) / (maximum - ideal)) * 40.0
        if maximum <= 0:
            return 0.0
        return max(0.0, min(60.0, (maximum / actual) * 60.0))
    if ideal == minimum:
        if actual >= ideal:
            return 100.0
        if minimum <= 0:
            return 0.0
        return max(0.0, min(100.0, (actual / minimum) * 100.0))
    if actual >= ideal:
        return 100.0
    if actual >= minimum:
        return 60.0 + ((actual - minimum) / (ideal - minimum)) * 40.0
    if minimum <= 0:
        return 0.0
    return max(0.0, (actual / minimum) * 60.0)
