from __future__ import annotations


SPATIAL_AUDIO_LABELS: dict[str, str] = {
    "dolby_atmos": "Dolby Atmos",
    "dts_x": "DTS:X",
}


def normalize_spatial_audio_profile(value: str | None) -> str | None:
    candidate = (value or "").strip().lower()
    return candidate or None


def format_spatial_audio_profile(value: str | None) -> str | None:
    normalized = normalize_spatial_audio_profile(value)
    if not normalized:
        return None
    return SPATIAL_AUDIO_LABELS.get(normalized)
