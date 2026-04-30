from __future__ import annotations


CONTAINER_LABELS: dict[str, str] = {
    # Video containers
    "mkv": "MKV",
    "mp4": "MP4",
    "avi": "AVI",
    "mov": "MOV",
    "webm": "WebM",
    "ts": "TS",
    "m2ts": "M2TS",
    "wmv": "WMV",
    "flv": "FLV",
    "mpeg": "MPEG",
    "mpg": "MPG",
    "ogm": "OGM",
    "asf": "ASF",
    # Audio containers
    "mp3": "MP3",
    "flac": "FLAC",
    "m4a": "M4A",
    "aac": "AAC",
    "opus": "Opus",
    "wav": "WAV",
    "wma": "WMA",
}


def normalize_container(value: str | None) -> str | None:
    candidate = (value or "").strip().lstrip(".").lower()
    return candidate or None


def format_container_label(value: str | None) -> str | None:
    normalized = normalize_container(value)
    if not normalized:
        return None
    return CONTAINER_LABELS.get(normalized, normalized.upper() if len(normalized) <= 4 else normalized.title())
