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


def test_visual_density_rewards_the_ideal_and_penalizes_bloated_media() -> None:
    ideal_probe = ProbeResult(
        raw={},
        media_format=NormalizedFormat(
            container_format="matroska",
            duration=7200,
            bit_rate=8000000,
            probe_score=100,
        ),
        video_streams=[
            NormalizedVideoStream(
                stream_index=0,
                codec="h264",
                profile="High",
                width=1920,
                height=1080,
                pix_fmt="yuv420p",
                color_space=None,
                color_transfer=None,
                color_primaries=None,
                frame_rate=24.0,
                bit_rate=8000000,
                hdr_type=None,
            )
        ],
    )
    bloated_probe = ProbeResult(
        raw={},
        media_format=NormalizedFormat(
            container_format="matroska",
            duration=7200,
            bit_rate=16000000,
            probe_score=100,
        ),
        video_streams=[
            NormalizedVideoStream(
                stream_index=0,
                codec="h264",
                profile="High",
                width=1920,
                height=1080,
                pix_fmt="yuv420p",
                color_space=None,
                color_transfer=None,
                color_primaries=None,
                frame_rate=24.0,
                bit_rate=16000000,
                hdr_type=None,
            )
        ],
    )
    profile = {
        "visual_density": {
            "weight": 10,
            "minimum": 0.03,
            "ideal": 0.06,
            "maximum": 0.09,
        }
    }

    ideal_breakdown = calculate_quality_score(build_quality_score_input(ideal_probe), quality_profile=profile)
    bloated_breakdown = calculate_quality_score(build_quality_score_input(bloated_probe), quality_profile=profile)
    ideal_density = next(category for category in ideal_breakdown.categories if category.key == "visual_density")
    bloated_density = next(category for category in bloated_breakdown.categories if category.key == "visual_density")

    assert ideal_density.score == 100.0
    assert bloated_density.actual == 0.12
    assert bloated_density.maximum == 0.09
    assert bloated_density.score == 45.0


def test_visual_density_uses_real_file_size_to_penalize_short_bloated_files() -> None:
    misleading_probe = ProbeResult(
        raw={},
        media_format=NormalizedFormat(
            container_format="matroska",
            duration=300,
            bit_rate=6000000,
            probe_score=100,
        ),
        video_streams=[
            NormalizedVideoStream(
                stream_index=0,
                codec="h264",
                profile="High",
                width=1920,
                height=1080,
                pix_fmt="yuv420p",
                color_space=None,
                color_transfer=None,
                color_primaries=None,
                frame_rate=24.0,
                bit_rate=6000000,
                hdr_type=None,
            )
        ],
    )
    profile = {
        "visual_density": {
            "weight": 10,
            "minimum": 0.02,
            "ideal": 0.04,
            "maximum": 0.08,
        }
    }

    breakdown = calculate_quality_score(
        build_quality_score_input(misleading_probe, size_bytes=8_000_000_000),
        quality_profile=profile,
    )
    density = next(category for category in breakdown.categories if category.key == "visual_density")

    assert density.actual == 1.6
    assert density.score == 3.0


def test_quality_score_uses_dynamic_resolution_categories() -> None:
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
                height=1606,
                pix_fmt="yuv420p10le",
                color_space=None,
                color_transfer="smpte2084",
                color_primaries=None,
                frame_rate=23.976,
                bit_rate=12000000,
                hdr_type="HDR10",
            )
        ],
    )

    breakdown = calculate_quality_score(
        build_quality_score_input(probe),
        quality_profile={"resolution": {"weight": 8, "minimum": "1080p", "ideal": "4k"}},
        resolution_categories=[
            {"id": "4k", "label": "UHD", "min_width": 3840, "min_height": 1600},
            {"id": "1080p", "label": "Full HD", "min_width": 1920, "min_height": 800},
            {"id": "sd", "label": "SD", "min_width": 0, "min_height": 0},
        ],
    )
    resolution = next(category for category in breakdown.categories if category.key == "resolution")

    assert resolution.actual == "4k"


def test_quality_score_defaults_treat_letterboxed_cinema_variants_as_expected_bucket() -> None:
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
                width=1920,
                height=800,
                pix_fmt="yuv420p10le",
                color_space=None,
                color_transfer="smpte2084",
                color_primaries=None,
                frame_rate=23.976,
                bit_rate=12000000,
                hdr_type="HDR10",
            )
        ],
    )

    breakdown = calculate_quality_score(
        build_quality_score_input(probe),
        quality_profile={"resolution": {"weight": 8, "minimum": "720p", "ideal": "1080p"}},
    )
    resolution = next(category for category in breakdown.categories if category.key == "resolution")

    assert resolution.actual == "1080p"
