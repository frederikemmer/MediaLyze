from backend.app.services.ffprobe_parser import (
    NormalizedAudioStream,
    NormalizedFormat,
    NormalizedVideoStream,
    ProbeResult,
)
from backend.app.services.quality import build_quality_score_input, calculate_quality_score


def test_quality_score_rewards_modern_high_quality_media() -> None:
    probe = ProbeResult(
        raw={},
        media_format=NormalizedFormat(
            container_format="matroska",
            duration=7200,
            bit_rate=14000000,
            probe_score=100,
        ),
        video_streams=[
            NormalizedVideoStream(
                stream_index=0,
                codec="hevc",
                profile="Main 10",
                width=3840,
                height=2160,
                pix_fmt="yuv420p10le",
                color_space=None,
                color_transfer="smpte2084",
                color_primaries=None,
                frame_rate=23.976,
                bit_rate=12000000,
                hdr_type="HDR10",
            )
        ],
        audio_streams=[
            NormalizedAudioStream(
                stream_index=1,
                codec="truehd",
                channels=8,
                channel_layout="7.1",
                sample_rate=48000,
                bit_rate=3000000,
                language="eng",
                default_flag=True,
                forced_flag=False,
            )
        ],
    )

    assert calculate_quality_score(build_quality_score_input(probe)).score >= 8


def test_quality_score_penalizes_low_quality_media() -> None:
    probe = ProbeResult(
        raw={},
        media_format=NormalizedFormat(
            container_format="matroska",
            duration=7200,
            bit_rate=500000,
            probe_score=100,
        ),
        video_streams=[
            NormalizedVideoStream(
                stream_index=0,
                codec="h264",
                profile="High",
                width=640,
                height=360,
                pix_fmt="yuv420p",
                color_space=None,
                color_transfer=None,
                color_primaries=None,
                frame_rate=24.0,
                bit_rate=450000,
                hdr_type=None,
            )
        ],
    )

    assert calculate_quality_score(build_quality_score_input(probe)).score <= 5


def test_quality_score_treats_dolby_vision_profiles_as_dolby_vision() -> None:
    probe = ProbeResult(
        raw={},
        media_format=NormalizedFormat(
            container_format="matroska",
            duration=7200,
            bit_rate=14000000,
            probe_score=100,
        ),
        video_streams=[
            NormalizedVideoStream(
                stream_index=0,
                codec="hevc",
                profile="Main 10",
                width=3840,
                height=2160,
                pix_fmt="yuv420p10le",
                color_space=None,
                color_transfer="smpte2084",
                color_primaries=None,
                frame_rate=23.976,
                bit_rate=12000000,
                hdr_type="Dolby Vision Profile 8",
            )
        ],
    )

    breakdown = calculate_quality_score(build_quality_score_input(probe))
    dynamic_range = next(category for category in breakdown.categories if category.key == "dynamic_range")

    assert dynamic_range.actual == "dolby_vision"
