import subprocess
from pathlib import Path
from types import SimpleNamespace

import backend.app.services.ffprobe_parser as ffprobe_parser
from backend.app.services.ffprobe_parser import _ffprobe_error_message, _ffprobe_input_path, normalize_ffprobe_payload, run_ffprobe


def test_normalize_ffprobe_payload_extracts_streams() -> None:
    payload = {
        "format": {
            "format_name": "matroska,webm",
            "duration": "5423.21",
            "bit_rate": "14000000",
            "probe_score": 100,
        },
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "hevc",
                "profile": "Main 10",
                "width": 3840,
                "height": 2160,
                "pix_fmt": "yuv420p10le",
                "color_transfer": "smpte2084",
                "avg_frame_rate": "24000/1001",
                "bit_rate": "12000000",
            },
            {
                "index": 1,
                "codec_type": "audio",
                "codec_name": "eac3",
                "channels": 6,
                "channel_layout": "5.1(side)",
                "sample_rate": "48000",
                "bit_rate": "768000",
                "tags": {"language": "eng"},
                "disposition": {"default": 1, "forced": 0},
            },
            {
                "index": 2,
                "codec_type": "subtitle",
                "codec_name": "subrip",
                "tags": {"language": "deu"},
                "disposition": {"default": 0, "forced": 1},
            },
        ],
    }

    normalized = normalize_ffprobe_payload(payload)

    assert normalized.media_format.container_format == "matroska,webm"
    assert normalized.media_format.duration == 5423.21
    assert normalized.video_streams[0].hdr_type == "HDR10"
    assert normalized.video_streams[0].frame_rate == 24000 / 1001
    assert normalized.audio_streams[0].language == "en"
    assert normalized.subtitle_streams[0].language == "de"
    assert normalized.subtitle_streams[0].subtitle_type == "text"


def test_normalize_ffprobe_payload_ignores_attached_pictures() -> None:
    payload = {
        "format": {"format_name": "matroska"},
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "24/1",
                "disposition": {"attached_pic": 0},
            },
            {
                "index": 1,
                "codec_type": "video",
                "codec_name": "mjpeg",
                "width": 600,
                "height": 900,
                "avg_frame_rate": "0/0",
                "disposition": {"attached_pic": 1},
            },
        ],
    }

    normalized = normalize_ffprobe_payload(payload)

    assert len(normalized.video_streams) == 1
    assert normalized.video_streams[0].codec == "h264"


def test_normalize_ffprobe_payload_extracts_dolby_vision_profile() -> None:
    payload = {
        "format": {"format_name": "matroska"},
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "hevc",
                "profile": "Main 10",
                "width": 3840,
                "height": 2160,
                "color_transfer": "smpte2084",
                "avg_frame_rate": "24/1",
                "side_data_list": [
                    {
                        "side_data_type": "DOVI configuration record",
                        "dv_profile": 8,
                    }
                ],
            }
        ],
    }

    normalized = normalize_ffprobe_payload(payload)

    assert normalized.video_streams[0].hdr_type == "Dolby Vision Profile 8"


def test_normalize_ffprobe_payload_extracts_hdr10_plus() -> None:
    payload = {
        "format": {"format_name": "matroska"},
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "codec_name": "hevc",
                "profile": "Main 10",
                "width": 3840,
                "height": 2160,
                "color_transfer": "smpte2084",
                "avg_frame_rate": "24/1",
                "side_data_list": [
                    {
                        "side_data_type": "HDR Dynamic Metadata SMPTE2094-40 (HDR10+)",
                        "application_version": 1,
                    }
                ],
            }
        ],
    }

    normalized = normalize_ffprobe_payload(payload)

    assert normalized.video_streams[0].hdr_type == "HDR10+"


def test_ffprobe_error_message_prefers_stderr() -> None:
    exc = subprocess.CalledProcessError(
        1,
        ["ffprobe", "movie.mkv"],
        stderr="Invalid data found when processing input\nmore details",
    )

    assert _ffprobe_error_message(exc) == "Invalid data found when processing input"


def test_ffprobe_input_path_preserves_non_windows_paths(tmp_path: Path) -> None:
    file_path = tmp_path / "movie.mkv"

    assert _ffprobe_input_path(file_path) == str(file_path)


def test_ffprobe_input_path_preserves_windows_unc_paths(monkeypatch) -> None:
    monkeypatch.setattr(ffprobe_parser, "os", SimpleNamespace(name="nt"))

    assert _ffprobe_input_path(Path(r"\\server\share\movies\movie.mkv")) == r"\\server\share\movies\movie.mkv"


def test_ffprobe_input_path_adds_extended_prefix_for_windows_drive_paths(monkeypatch) -> None:
    monkeypatch.setattr(ffprobe_parser, "os", SimpleNamespace(name="nt"))

    assert _ffprobe_input_path(Path(r"C:\media\movie.mkv")) == r"\\?\C:\media\movie.mkv"


def test_run_ffprobe_disables_stdin_and_uses_nostdin(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    class CompletedProcess:
        stdout = "{}"

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return CompletedProcess()

    monkeypatch.setattr(ffprobe_parser.subprocess, "run", fake_run)

    result = run_ffprobe(tmp_path / "movie.mkv", "ffprobe")

    assert result == {}
    assert captured["command"][1] == "-nostdin"
    assert captured["kwargs"]["stdin"] is ffprobe_parser.subprocess.DEVNULL
