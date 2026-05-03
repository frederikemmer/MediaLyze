from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.app.services.languages import normalize_language_code


@dataclass(slots=True)
class DolbyVisionMetadata:
    profile: int | None = None
    level: int | None = None
    compatibility_id: int | None = None
    rpu_present: bool | None = None
    enhancement_layer_present: bool | None = None
    base_layer_present: bool | None = None
    enhancement_layer_type: str | None = None


def _safe_int(value: Any) -> int | None:
    if value in (None, "", "N/A"):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _safe_float(value: Any) -> float | None:
    if value in (None, "", "N/A"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_frame_rate(value: str | None) -> float | None:
    if not value or value in {"0/0", "N/A"}:
        return None
    if "/" in value:
        numerator, denominator = value.split("/", 1)
        try:
            denominator_value = float(denominator)
            if denominator_value == 0:
                return None
            return float(numerator) / denominator_value
        except ValueError:
            return None
    return _safe_float(value)


def _safe_bool(value: Any) -> bool | None:
    if value in (None, "", "N/A"):
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y"}:
        return True
    if normalized in {"0", "false", "no", "n"}:
        return False
    return None


def _first_present_int(entry: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = _safe_int(entry.get(key))
        if value is not None:
            return value
    return None


def _first_present_bool(entry: dict[str, Any], *keys: str) -> bool | None:
    for key in keys:
        value = _safe_bool(entry.get(key))
        if value is not None:
            return value
    return None


def _dolby_vision_enhancement_layer_type(text: str) -> str | None:
    normalized = text.lower()
    if re.search(r"\bfel\b", normalized) or "full enhancement layer" in normalized:
        return "FEL"
    if re.search(r"\bmel\b", normalized) or "minimal enhancement layer" in normalized:
        return "MEL"
    return None


def _dolby_vision_codec_profile_metadata(text: str) -> DolbyVisionMetadata | None:
    match = re.search(r"\b(?:dvhe|dvh1)\.(\d{1,2})\.(\d{1,2})\b", text.lower())
    if not match:
        return None
    return DolbyVisionMetadata(profile=int(match.group(1)), level=int(match.group(2)))


def _dolby_vision_metadata(stream: dict[str, Any]) -> DolbyVisionMetadata | None:
    metadata_text = _metadata_text(stream)
    codec_metadata = _dolby_vision_codec_profile_metadata(metadata_text)
    metadata = DolbyVisionMetadata(
        profile=codec_metadata.profile if codec_metadata else None,
        level=codec_metadata.level if codec_metadata else None,
        enhancement_layer_type=_dolby_vision_enhancement_layer_type(metadata_text),
    )
    found_dovi_record = False
    side_data = stream.get("side_data_list") or []
    for entry in side_data:
        if not isinstance(entry, dict):
            continue
        side_data_type = str(entry.get("side_data_type") or "").strip().lower()
        if "dovi configuration record" not in side_data_type:
            continue
        found_dovi_record = True
        profile = _first_present_int(entry, "dv_profile", "profile")
        level = _first_present_int(entry, "dv_level", "level")
        compatibility_id = _first_present_int(
            entry,
            "dv_bl_signal_compatibility_id",
            "bl_signal_compatibility_id",
            "compatibility_id",
        )
        metadata.profile = profile if profile is not None else metadata.profile
        metadata.level = level if level is not None else metadata.level
        metadata.compatibility_id = compatibility_id if compatibility_id is not None else metadata.compatibility_id
        metadata.rpu_present = _first_present_bool(entry, "rpu_present_flag", "dv_rpu_present_flag")
        metadata.enhancement_layer_present = _first_present_bool(
            entry,
            "el_present_flag",
            "dv_el_present_flag",
        )
        metadata.base_layer_present = _first_present_bool(entry, "bl_present_flag", "dv_bl_present_flag")
    has_metadata_value = any(
        value is not None
        for value in (
            metadata.profile,
            metadata.level,
            metadata.compatibility_id,
            metadata.rpu_present,
            metadata.enhancement_layer_present,
            metadata.base_layer_present,
            metadata.enhancement_layer_type,
        )
    )
    if found_dovi_record or (
        has_metadata_value and re.search(r"\b(dovi|dolby vision|dvhe|dvh1)\b", metadata_text.lower())
    ):
        return metadata
    return None


def _format_dolby_vision_hdr_type(metadata: DolbyVisionMetadata | None) -> str:
    if metadata is None or metadata.profile is None:
        return "Dolby Vision"

    if metadata.profile == 8 and metadata.compatibility_id is not None:
        label = f"Dolby Vision Profile 8.{metadata.compatibility_id}"
    else:
        label = f"Dolby Vision Profile {metadata.profile}"

    if metadata.level is not None:
        label = f"{label} Level {metadata.level}"

    if metadata.profile == 7:
        if metadata.enhancement_layer_type:
            label = f"{label} {metadata.enhancement_layer_type}"
        else:
            layers = [
                ("BL", metadata.base_layer_present),
                ("EL", metadata.enhancement_layer_present),
                ("RPU", metadata.rpu_present),
            ]
            present_layers = [name for name, present in layers if present]
            if present_layers:
                label = f"{label} {'+'.join(present_layers)}"

    return label


def _metadata_text(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(
            part
            for item in value.items()
            for part in (
                str(item[0]),
                _metadata_text(item[1]),
            )
            if part
        )
    if isinstance(value, list):
        return " ".join(_metadata_text(item) for item in value if item is not None)
    if value in (None, ""):
        return ""
    return str(value)


def _hdr_type(stream: dict[str, Any]) -> str | None:
    transfer = (stream.get("color_transfer") or "").lower()
    profile = (stream.get("profile") or "").lower()
    side_data = stream.get("side_data_list") or []
    side_data_text = _metadata_text(side_data).lower()
    dolby_vision_metadata = _dolby_vision_metadata(stream)

    if dolby_vision_metadata is not None:
        return _format_dolby_vision_hdr_type(dolby_vision_metadata)
    if (
        "dovi" in profile
        or "dovi" in side_data_text
        or re.search(r"\b(?:dolby vision|dvhe|dvh1)\b", _metadata_text(stream).lower())
    ):
        return "Dolby Vision"
    if "arib-std-b67" in transfer:
        return "HLG"
    if "smpte2084" in transfer:
        if (
            "dynamic_metadata_plus" in side_data_text
            or "dynamic metadata plus" in side_data_text
            or "dynamic hdr10+" in side_data_text
            or "hdr10+" in side_data_text
            or "hdr10plus" in side_data_text
            or "smpte2094" in side_data_text
            or "smpte 2094" in side_data_text
        ):
            return "HDR10+"
        return "HDR10"
    return None


def _subtitle_type(codec_name: str | None) -> str | None:
    if not codec_name:
        return None
    text_codecs = {"subrip", "ass", "ssa", "webvtt", "mov_text"}
    image_codecs = {"hdmv_pgs_subtitle", "dvd_subtitle", "xsub", "dvb_subtitle"}
    codec_name = codec_name.lower()
    if codec_name in text_codecs:
        return "text"
    if codec_name in image_codecs:
        return "image"
    return None


def _spatial_audio_profile(stream: dict[str, Any]) -> str | None:
    tags = stream.get("tags") or {}
    candidates = [
        str(stream.get("profile") or "").strip().lower(),
        str(stream.get("codec_name") or "").strip().lower(),
        str(stream.get("codec_long_name") or "").strip().lower(),
        str(tags.get("title") or "").strip().lower(),
        _metadata_text(stream.get("side_data_list") or []).strip().lower(),
    ]
    if any("dolby atmos" in candidate for candidate in candidates):
        return "dolby_atmos"
    if any("dts:x" in candidate or "dts x" in candidate for candidate in candidates):
        return "dts_x"

    if any(re.search(r"\batmos\b", candidate) for candidate in candidates):
        dolby_candidates = candidates[:4]
        if any(
            marker in candidate
            for candidate in dolby_candidates
            for marker in ("truehd", "mlp", "eac3", "dolby digital plus", "dolby truehd")
        ):
            return "dolby_atmos"
    return None


def _is_attached_picture(stream: dict[str, Any]) -> bool:
    disposition = stream.get("disposition") or {}
    return bool(disposition.get("attached_pic"))


def _ffprobe_input_path(file_path: Path) -> str:
    path_value = str(file_path)
    if os.name != "nt":
        return path_value
    if path_value.startswith("\\\\?\\"):
        return path_value
    if path_value.startswith("\\\\"):
        # Keep UNC paths in their canonical form for ffprobe. Discovery works with
        # network shares directly, but the extended-length UNC prefix can prevent
        # ffprobe from opening the same file on Windows desktop scans.
        return path_value
    if len(path_value) >= 2 and path_value[1] == ":":
        return f"\\\\?\\{path_value}"
    return path_value


def _ffprobe_error_message(exc: subprocess.CalledProcessError) -> str:
    stderr = (exc.stderr or "").strip()
    if stderr:
        return stderr.splitlines()[0].strip()[:300]
    stdout = (exc.stdout or "").strip()
    if stdout and stdout != "{":
        return stdout.splitlines()[0].strip()[:300]
    return f"ffprobe exited with status {exc.returncode}"


@dataclass(slots=True)
class NormalizedFormat:
    container_format: str | None
    duration: float | None
    bit_rate: int | None
    probe_score: int | None


@dataclass(slots=True)
class NormalizedVideoStream:
    stream_index: int
    codec: str | None
    profile: str | None
    width: int | None
    height: int | None
    pix_fmt: str | None
    color_space: str | None
    color_transfer: str | None
    color_primaries: str | None
    frame_rate: float | None
    bit_rate: int | None
    hdr_type: str | None


@dataclass(slots=True)
class NormalizedAudioStream:
    stream_index: int
    codec: str | None
    profile: str | None
    spatial_audio_profile: str | None
    channels: int | None
    channel_layout: str | None
    sample_rate: int | None
    bit_rate: int | None
    language: str | None
    default_flag: bool
    forced_flag: bool
    bit_depth: int | None = None
    bit_rate_mode: str | None = None
    compression_mode: str | None = None
    replay_gain: str | None = None
    replay_gain_peak: str | None = None
    writing_library: str | None = None
    md5_unencoded: str | None = None
    # Music-specific metadata
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    album_artist: str | None = None
    genre: str | None = None
    date: str | None = None
    disc: str | None = None
    composer: str | None = None


@dataclass(slots=True)
class NormalizedSubtitleStream:
    stream_index: int
    codec: str | None
    language: str | None
    default_flag: bool
    forced_flag: bool
    subtitle_type: str | None


@dataclass(slots=True)
class ProbeResult:
    raw: dict[str, Any]
    media_format: NormalizedFormat
    video_streams: list[NormalizedVideoStream] = field(default_factory=list)
    audio_streams: list[NormalizedAudioStream] = field(default_factory=list)
    subtitle_streams: list[NormalizedSubtitleStream] = field(default_factory=list)


def run_ffprobe(file_path: Path, ffprobe_path: str) -> dict[str, Any]:
    command = [
        ffprobe_path,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-show_chapters",
        _ffprobe_input_path(file_path),
    ]
    run_kwargs: dict[str, Any] = {
        "capture_output": True,
        "text": True,
        "check": True,
    }
    if os.name == "nt":
        run_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        run_kwargs["startupinfo"] = startupinfo
    try:
        completed = subprocess.run(command, **run_kwargs)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(_ffprobe_error_message(exc)) from exc
    return json.loads(completed.stdout or "{}")


def normalize_ffprobe_payload(payload: dict[str, Any]) -> ProbeResult:
    format_data = payload.get("format") or {}
    streams = payload.get("streams") or []

    normalized = ProbeResult(
        raw=payload,
        media_format=NormalizedFormat(
            container_format=format_data.get("format_name"),
            duration=_safe_float(format_data.get("duration")),
            bit_rate=_safe_int(format_data.get("bit_rate")),
            probe_score=_safe_int(format_data.get("probe_score")),
        ),
    )

    for stream in streams:
        codec_type = stream.get("codec_type")
        if codec_type == "video":
            if _is_attached_picture(stream):
                continue
            normalized.video_streams.append(
                NormalizedVideoStream(
                    stream_index=int(stream.get("index", 0)),
                    codec=stream.get("codec_name"),
                    profile=stream.get("profile"),
                    width=_safe_int(stream.get("width")),
                    height=_safe_int(stream.get("height")),
                    pix_fmt=stream.get("pix_fmt"),
                    color_space=stream.get("color_space"),
                    color_transfer=stream.get("color_transfer"),
                    color_primaries=stream.get("color_primaries"),
                    frame_rate=_parse_frame_rate(stream.get("avg_frame_rate") or stream.get("r_frame_rate")),
                    bit_rate=_safe_int(stream.get("bit_rate")),
                    hdr_type=_hdr_type(stream),
                )
            )
        elif codec_type == "audio":
            disposition = stream.get("disposition") or {}
            tags = stream.get("tags") or {}
            normalized.audio_streams.append(
                NormalizedAudioStream(
                    stream_index=int(stream.get("index", 0)),
                    codec=stream.get("codec_name"),
                    profile=stream.get("profile"),
                    spatial_audio_profile=_spatial_audio_profile(stream),
                    channels=_safe_int(stream.get("channels")),
                    channel_layout=stream.get("channel_layout"),
                    sample_rate=_safe_int(stream.get("sample_rate")),
                    bit_rate=_safe_int(stream.get("bit_rate")),
                    bit_depth=_safe_int(stream.get("bits_per_raw_sample") or stream.get("bits_per_sample")),
                    bit_rate_mode=tags.get("bit_rate_mode") or tags.get("bitrate_mode"),
                    compression_mode=tags.get("compression_mode"),
                    replay_gain=tags.get("replaygain_track_gain") or tags.get("replay_gain"),
                    replay_gain_peak=tags.get("replaygain_track_peak") or tags.get("replay_gain_peak"),
                    writing_library=tags.get("encoder") or tags.get("writing_library"),
                    md5_unencoded=tags.get("md5") or tags.get("MD5") or tags.get("md5_unencoded"),
                    language=normalize_language_code(tags.get("language")),
                    default_flag=bool(disposition.get("default")),
                    forced_flag=bool(disposition.get("forced")),
                    # Music-specific metadata from tags
                    title=tags.get("title"),
                    artist=tags.get("artist"),
                    album=tags.get("album"),
                    album_artist=tags.get("album_artist"),
                    genre=tags.get("genre"),
                    date=tags.get("date"),
                    disc=tags.get("disc"),
                    composer=tags.get("composer"),
                )
            )
        elif codec_type == "subtitle":
            disposition = stream.get("disposition") or {}
            tags = stream.get("tags") or {}
            codec_name = stream.get("codec_name")
            normalized.subtitle_streams.append(
                NormalizedSubtitleStream(
                    stream_index=int(stream.get("index", 0)),
                    codec=codec_name,
                    language=normalize_language_code(tags.get("language")),
                    default_flag=bool(disposition.get("default")),
                    forced_flag=bool(disposition.get("forced")),
                    subtitle_type=_subtitle_type(codec_name),
                )
            )

    return normalized
