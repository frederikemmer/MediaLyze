from backend.app.services.ffprobe_parser import normalize_ffprobe_payload


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
