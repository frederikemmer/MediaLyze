from __future__ import annotations

from backend.app.schemas.media import DistributionItem

def _video_codec_bucket_label(codec: str | None) -> str:
    normalized_codec = (codec or "").strip().lower()
    return normalized_codec or "unknown"


def build_video_codec_distribution(rows: list[tuple[str | None, int | None, int]]) -> list[DistributionItem]:
    counts: dict[str, int] = {}
    for codec, bit_depth, count in rows:
        if count <= 0:
            continue
        del bit_depth
        label = _video_codec_bucket_label(codec)
        counts[label] = counts.get(label, 0) + count

    return [
        DistributionItem(label=label, value=value)
        for label, value in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]
