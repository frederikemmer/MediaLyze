from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from backend.app.schemas.quality import (
    QualityBreakdownRead,
    QualityCategoryBreakdownRead,
    QualityCategoryConfig,
    QualityLanguagePreferencesConfig,
    QualityProfile,
)
from backend.app.services.ffprobe_parser import ProbeResult
from backend.app.services.languages import normalize_language_code


RESOLUTION_RANKS = {
    "sd": 1.0,
    "720p": 2.0,
    "1080p": 3.0,
    "1440p": 4.0,
    "4k": 5.0,
    "8k": 6.0,
}
VIDEO_CODEC_RANKS = {
    "h264": 1.0,
    "hevc": 2.0,
    "av1": 3.0,
}
AUDIO_CHANNEL_RANKS = {
    "mono": 1.0,
    "stereo": 2.0,
    "5.1": 3.0,
    "7.1": 4.0,
}
AUDIO_CODEC_RANKS = {
    "aac": 1.0,
    "ac3": 2.0,
    "eac3": 3.0,
    "dts": 4.0,
    "dts_hd": 5.0,
    "truehd": 6.0,
    "flac": 6.0,
}
DYNAMIC_RANGE_RANKS = {
    "sdr": 1.0,
    "hdr10": 2.0,
    "hdr10_plus": 3.0,
    "dolby_vision": 4.0,
}
REFERENCE_1080P_PIXELS = 1920 * 1080


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
    language: str | None
    default_flag: bool


@dataclass(slots=True)
class QualitySubtitle:
    language: str | None


@dataclass(slots=True)
class QualityScoreInput:
    container_bit_rate: int | None
    video_streams: list[QualityVideoStream] = field(default_factory=list)
    audio_streams: list[QualityAudioStream] = field(default_factory=list)
    subtitle_streams: list[QualitySubtitle] = field(default_factory=list)
    external_subtitles: list[QualitySubtitle] = field(default_factory=list)


def default_quality_profile() -> dict[str, Any]:
    return QualityProfile().model_dump(mode="json")


def normalize_quality_profile(payload: dict[str, Any] | QualityProfile | None) -> dict[str, Any]:
    profile = payload if isinstance(payload, QualityProfile) else QualityProfile.model_validate(payload or {})
    normalized = profile.model_copy(
        update={
            "language_preferences": profile.language_preferences.model_copy(
                update={
                    "audio_languages": _normalized_language_list(profile.language_preferences.audio_languages),
                    "subtitle_languages": _normalized_language_list(profile.language_preferences.subtitle_languages),
                }
            )
        }
    )
    return normalized.model_dump(mode="json")


def build_quality_score_input(
    probe_result: ProbeResult,
    external_subtitles: list[dict[str, str | None]] | None = None,
) -> QualityScoreInput:
    return QualityScoreInput(
        container_bit_rate=probe_result.media_format.bit_rate,
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
                language=stream.language,
                default_flag=stream.default_flag,
            )
            for stream in probe_result.audio_streams
        ],
        subtitle_streams=[QualitySubtitle(language=stream.language) for stream in probe_result.subtitle_streams],
        external_subtitles=[QualitySubtitle(language=item.get("language")) for item in (external_subtitles or [])],
    )


def build_quality_score_input_from_media_file(media_file) -> QualityScoreInput:
    return QualityScoreInput(
        container_bit_rate=media_file.media_format.bit_rate if media_file.media_format else None,
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
                language=stream.language,
                default_flag=stream.default_flag,
            )
            for stream in media_file.audio_streams
        ],
        subtitle_streams=[QualitySubtitle(language=stream.language) for stream in media_file.subtitle_streams],
        external_subtitles=[QualitySubtitle(language=stream.language) for stream in media_file.external_subtitles],
    )


def calculate_quality_score(
    score_input: QualityScoreInput,
    quality_profile: dict[str, Any] | QualityProfile | None = None,
) -> QualityBreakdownRead:
    profile = QualityProfile.model_validate(normalize_quality_profile(quality_profile))
    primary_video = _primary_video_stream(score_input.video_streams)
    selected_audio = _select_audio_stream(score_input.audio_streams, profile.language_preferences.audio_languages)

    categories = [
        _rank_category(
            key="resolution",
            config=profile.resolution,
            actual_key=_resolution_bucket(primary_video.width, primary_video.height) if primary_video else None,
            actual_value=RESOLUTION_RANKS.get(_resolution_bucket(primary_video.width, primary_video.height))
            if primary_video
            else None,
            ranks=RESOLUTION_RANKS,
            missing_is_zero=True,
        ),
        _numeric_category(
            key="visual_density",
            config=profile.visual_density,
            actual=_visual_density(score_input, primary_video),
            missing_is_zero=True,
        ),
        _rank_category(
            key="video_codec",
            config=profile.video_codec,
            actual_key=_normalize_video_codec(primary_video.codec) if primary_video else None,
            actual_value=VIDEO_CODEC_RANKS.get(_normalize_video_codec(primary_video.codec)) if primary_video else None,
            ranks=VIDEO_CODEC_RANKS,
            missing_is_zero=False,
        ),
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
        _rank_category(
            key="dynamic_range",
            config=profile.dynamic_range,
            actual_key=_normalize_dynamic_range(primary_video.hdr_type) if primary_video else "sdr",
            actual_value=DYNAMIC_RANGE_RANKS.get(_normalize_dynamic_range(primary_video.hdr_type) if primary_video else "sdr"),
            ranks=DYNAMIC_RANGE_RANKS,
            missing_is_zero=False,
        ),
        _language_category(score_input, profile.language_preferences),
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


def _primary_video_stream(video_streams: list[QualityVideoStream]) -> QualityVideoStream | None:
    return min(video_streams, key=lambda stream: stream.stream_index, default=None)


def _resolution_bucket(width: int | None, height: int | None) -> str | None:
    if not width or not height:
        return None
    max_edge = max(width, height)
    min_edge = min(width, height)
    if max_edge >= 7680 or min_edge >= 4320:
        return "8k"
    if max_edge >= 3840 or min_edge >= 2160:
        return "4k"
    if max_edge >= 2560 or min_edge >= 1440:
        return "1440p"
    if max_edge >= 1920 or min_edge >= 1080:
        return "1080p"
    if max_edge >= 1280 or min_edge >= 720:
        return "720p"
    return "sd"


def _normalize_video_codec(value: str | None) -> str | None:
    candidate = (value or "").strip().lower()
    mapping = {
        "avc": "h264",
        "avc1": "h264",
        "h264": "h264",
        "x264": "h264",
        "h265": "hevc",
        "hevc": "hevc",
        "x265": "hevc",
        "av1": "av1",
    }
    return mapping.get(candidate, candidate or None)


def _normalize_audio_codec(value: str | None) -> str | None:
    candidate = (value or "").strip().lower()
    mapping = {
        "aac": "aac",
        "ac3": "ac3",
        "eac3": "eac3",
        "dts": "dts",
        "dca": "dts",
        "dts-hd": "dts_hd",
        "dts_hd": "dts_hd",
        "dts_hd_ma": "dts_hd",
        "dtshd_ma": "dts_hd",
        "truehd": "truehd",
        "mlp": "truehd",
        "flac": "flac",
    }
    return mapping.get(candidate, candidate or None)


def _normalize_dynamic_range(value: str | None) -> str:
    candidate = (value or "").strip().lower().replace(" ", "_")
    if not candidate:
        return "sdr"
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

    bitrate = primary_video.bit_rate
    if bitrate is None:
        audio_bitrate = sum(max(stream.bit_rate or 0, 0) for stream in score_input.audio_streams)
        if score_input.container_bit_rate is None:
            return None
        bitrate = max(score_input.container_bit_rate - audio_bitrate, 0)

    if bitrate <= 0:
        return 0.0
    bytes_per_minute = (bitrate / 8) * 60
    gb_per_minute = bytes_per_minute / 1_000_000_000
    pixel_scale = REFERENCE_1080P_PIXELS / (width * height)
    return gb_per_minute * pixel_scale


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
    config: QualityCategoryConfig,
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
            actual=None,
            notes=["missing_value"],
        )
    score = _score_value(float(actual), float(config.minimum), float(config.ideal))
    return QualityCategoryBreakdownRead(
        key=key,
        score=round(score, 2),
        weight=config.weight,
        active=True,
        minimum=config.minimum,
        ideal=config.ideal,
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
            actual=actual_key,
            unknown_mapping=True,
        )

    if minimum not in ranks or ideal not in ranks:
        raise ValueError(f"Invalid quality profile mapping for {key}")

    score = _score_value(actual_value or 0.0, ranks[minimum], ranks[ideal])
    return QualityCategoryBreakdownRead(
        key=key,
        score=round(score, 2),
        weight=config.weight,
        active=True,
        minimum=minimum,
        ideal=ideal,
        actual=actual_key,
    )


def _score_value(actual: float, minimum: float, ideal: float) -> float:
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
