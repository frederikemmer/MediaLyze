from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.app.services.languages import normalize_language_code


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


def _dolby_vision_profile(stream: dict[str, Any]) -> int | None:
    side_data = stream.get("side_data_list") or []
    for entry in side_data:
        if not isinstance(entry, dict):
            continue
        side_data_type = str(entry.get("side_data_type") or "").strip().lower()
        if "dovi configuration record" not in side_data_type:
            continue
        profile = _safe_int(entry.get("dv_profile"))
        if profile is not None:
            return profile
    return None


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
    dolby_vision_profile = _dolby_vision_profile(stream)

    if dolby_vision_profile is not None:
        return f"Dolby Vision Profile {dolby_vision_profile}"
    if "dovi" in profile or "dovi" in side_data_text:
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
    channels: int | None
    channel_layout: str | None
    sample_rate: int | None
    bit_rate: int | None
    language: str | None
    default_flag: bool
    forced_flag: bool


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


def run_ffprobe(file_path: Path, ffprobe_path: str, timeout_seconds: int | None = None) -> dict[str, Any]:
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
    if timeout_seconds and timeout_seconds > 0:
        run_kwargs["timeout"] = timeout_seconds
    if os.name == "nt":
        run_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        run_kwargs["startupinfo"] = startupinfo
    try:
        completed = subprocess.run(command, **run_kwargs)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(_ffprobe_error_message(exc)) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"ffprobe timed out after {int(timeout_seconds or 0)}s") from exc
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
                    channels=_safe_int(stream.get("channels")),
                    channel_layout=stream.get("channel_layout"),
                    sample_rate=_safe_int(stream.get("sample_rate")),
                    bit_rate=_safe_int(stream.get("bit_rate")),
                    language=normalize_language_code(tags.get("language")),
                    default_flag=bool(disposition.get("default")),
                    forced_flag=bool(disposition.get("forced")),
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
