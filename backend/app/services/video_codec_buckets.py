from __future__ import annotations

from collections import defaultdict

from backend.app.schemas.media import DistributionItem

_HEVC_CODECS = frozenset({"hevc", "h265", "x265"})


def _video_codec_bucket_label(codec: str | None, bit_depth: int | None) -> str:
    normalized_codec = (codec or "").strip().lower()
    if not normalized_codec:
        return "unknown"

    if normalized_codec in _HEVC_CODECS:
        if bit_depth == 8:
            return "hevc_8bit"
        if bit_depth == 10:
            return "hevc_10bit"
        if bit_depth is None:
            return "hevc_unknown_bit_depth"
        if bit_depth > 0:
            return f"hevc_{bit_depth}bit"
        return "hevc_unknown_bit_depth"

    return normalized_codec


def build_video_codec_distribution(rows: list[tuple[str | None, int | None, int]]) -> list[DistributionItem]:
    counts: dict[str, int] = defaultdict(int)
    for codec, bit_depth, count in rows:
        if count <= 0:
            continue
        counts[_video_codec_bucket_label(codec, bit_depth)] += count

    items: list[DistributionItem] = []
    for label, value in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        if label.startswith("hevc_"):
            items.append(DistributionItem(label=label, value=value, filter_value="hevc"))
        else:
            items.append(DistributionItem(label=label, value=value))

    return items
