from __future__ import annotations

from pathlib import Path


def classify_analysis_failure(
    relative_path: str,
    reason: str,
    detail: str,
    *,
    file_size: int | None = None,
    internal: bool = False,
) -> tuple[str, str, str]:
    """Keep technical diagnostics while giving each failure an actionable reason."""
    if internal:
        return (
            "internal_processing_error",
            "Internal MediaLyze error while processing metadata or saving history. See diagnostics.",
            detail,
        )

    message = reason.lower()
    if any(token in message for token in ("permission denied", "access denied", "permissionerror")):
        return "permission_denied", "Access denied. Check the media mount and file permissions.", detail
    if "no such file or directory" in message or "filenotfounderror" in message:
        return "file_unavailable", "File or ffprobe executable unavailable. Check paths and media mounts.", detail
    if any(token in message for token in ("input/output error", "stale file handle", "transport endpoint", "device not ready")):
        return "io_error", "Media could not be read. Check the storage device or network mount.", detail
    if file_size == 0:
        return "empty_file", "File is empty (0 bytes). Complete or replace the download before scanning again.", detail
    if "ffprobe timed out" in message:
        return "probe_timeout", "ffprobe timed out. Check storage availability and whether the file is complete.", detail
    if "ffprobe" in message and "safety limit" in message:
        return "probe_output_limit", "ffprobe output exceeded the safety limit. See diagnostics.", detail
    if "moov atom not found" in message:
        return (
            "mp4_metadata_missing",
            "Required MP4 metadata (moov atom) is missing. The file may be incomplete or damaged.",
            detail,
        )
    if Path(relative_path).suffix.lower() in {".aa", ".aax"} and any(
        token in message
        for token in ("invalid data", "could not find codec parameters", "unsupported", "encrypted", "decryption", "activation", "audible", "drm")
    ):
        return "audible_drm_or_unreadable", "Probably DRM-protected or unreadable by ffprobe.", detail
    if any(token in message for token in ("invalid sample size", "invalid as first byte of an ebml number", "ebml header parsing failed", "error reading header")):
        return "container_invalid", "Container structure is invalid or damaged. Check or replace the source file.", detail
    if "invalid data found when processing input" in message:
        return "invalid_media", "Input is not readable media or is incomplete or damaged. See diagnostics.", detail
    if any(token in message for token in ("could not find codec parameters", "unsupported codec", "unknown codec")):
        return "stream_unrecognized", "Media stream could not be identified. Check codec support and probe diagnostics.", detail
    return "ffprobe_error", reason, detail
