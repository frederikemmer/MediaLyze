import pytest

from backend.app.services.analysis_failures import classify_analysis_failure
from backend.app.utils.glob_patterns import matches_ignore_pattern
from backend.app.services.app_settings import BUILT_IN_DEFAULT_IGNORE_PATTERNS


@pytest.mark.parametrize(
    "path,reason,size,internal,expected",
    [
        ("video.mp4", "moov atom not found", 0, False, "empty_file"),
        ("video.mp4", "moov atom not found", 123, False, "mp4_metadata_missing"),
        ("video.mp4", "Invalid sample size -663916689", 123, False, "container_invalid"),
        ("video.mkv", "0x00 at pos 0 invalid as first byte of an EBML number", 123, False, "container_invalid"),
        ("video.mkv", "Permission denied", 0, False, "permission_denied"),
        ("video.mkv", "No such file or directory", None, False, "file_unavailable"),
        ("video.mkv", "Input/output error", 123, False, "io_error"),
        ("video.mkv", "ffprobe timed out after 120 seconds", 123, False, "probe_timeout"),
        ("video.mkv", "ffprobe metadata exceeded the safety limit", 123, False, "probe_output_limit"),
        ("video.mkv", "Invalid data found when processing input", 123, False, "invalid_media"),
        ("video.mkv", "Could not find codec parameters", 123, False, "stream_unrecognized"),
        ("locked.aax", "Invalid data found when processing input", 123, False, "audible_drm_or_unreadable"),
        ("video.mkv", "1 validation error for MediaFileDetail", 123, True, "internal_processing_error"),
        # Internal errors and filenames must not be misclassified as file damage.
        ("video.mp4", "moov atom not found", 0, True, "internal_processing_error"),
        ("moov atom not found.mp4", "Unexpected probe failure", 123, False, "ffprobe_error"),
    ],
)
def test_analysis_failure_classification_preserves_diagnostics(path, reason, size, internal, expected):
    detail = f"Traceback with original error: {reason}"
    kind, display_reason, preserved_detail = classify_analysis_failure(
        path, reason, detail, file_size=size, internal=internal,
    )
    assert kind == expected
    assert display_reason
    assert preserved_detail == detail


def test_default_rules_ignore_temporary_mp4_at_any_folder_depth():
    assert matches_ignore_pattern("episode_temp.mp4", BUILT_IN_DEFAULT_IGNORE_PATTERNS)
    assert matches_ignore_pattern("series/season/episode_temp.mp4", BUILT_IN_DEFAULT_IGNORE_PATTERNS)
    assert not matches_ignore_pattern("series/episode.mp4", BUILT_IN_DEFAULT_IGNORE_PATTERNS)
