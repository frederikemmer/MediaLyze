from __future__ import annotations

from collections import defaultdict


LANGUAGE_ALIASES = {
    "und": "und",
    "mul": "mul",
    "zxx": "zxx",
    "ar": "ar",
    "ara": "ar",
    "bg": "bg",
    "bul": "bg",
    "ca": "ca",
    "cat": "ca",
    "cs": "cs",
    "ces": "cs",
    "cze": "cs",
    "da": "da",
    "dan": "da",
    "de": "de",
    "deu": "de",
    "ger": "de",
    "el": "el",
    "ell": "el",
    "gre": "el",
    "en": "en",
    "eng": "en",
    "es": "es",
    "spa": "es",
    "et": "et",
    "est": "et",
    "fa": "fa",
    "fas": "fa",
    "per": "fa",
    "fi": "fi",
    "fin": "fi",
    "fr": "fr",
    "fra": "fr",
    "fre": "fr",
    "he": "he",
    "heb": "he",
    "hi": "hi",
    "hin": "hi",
    "hr": "hr",
    "hrv": "hr",
    "hu": "hu",
    "hun": "hu",
    "id": "id",
    "ind": "id",
    "is": "is",
    "ice": "is",
    "isl": "is",
    "it": "it",
    "ita": "it",
    "ja": "ja",
    "jpn": "ja",
    "ko": "ko",
    "kor": "ko",
    "lt": "lt",
    "lit": "lt",
    "lv": "lv",
    "lav": "lv",
    "ms": "ms",
    "may": "ms",
    "msa": "ms",
    "nl": "nl",
    "dut": "nl",
    "nld": "nl",
    "no": "no",
    "nob": "no",
    "nno": "no",
    "nor": "no",
    "pl": "pl",
    "pol": "pl",
    "pt": "pt",
    "pob": "pt",
    "por": "pt",
    "ro": "ro",
    "ron": "ro",
    "rum": "ro",
    "ru": "ru",
    "rus": "ru",
    "sk": "sk",
    "slk": "sk",
    "slo": "sk",
    "sl": "sl",
    "slv": "sl",
    "sr": "sr",
    "srp": "sr",
    "sv": "sv",
    "swe": "sv",
    "th": "th",
    "tha": "th",
    "tr": "tr",
    "tur": "tr",
    "uk": "uk",
    "ukr": "uk",
    "vi": "vi",
    "vie": "vi",
    "zh": "zh",
    "chi": "zh",
    "zho": "zh",
}


def _known_language_alias(value: str) -> str | None:
    candidate = value.strip().lower()
    if not candidate:
        return None

    direct = LANGUAGE_ALIASES.get(candidate)
    if direct:
        return direct

    for separator in ("-", "_"):
        if separator in candidate:
            base = candidate.split(separator, 1)[0]
            mapped = LANGUAGE_ALIASES.get(base)
            if mapped:
                return mapped

    return None


def normalize_language_code(value: str | None) -> str | None:
    if value is None:
        return None

    candidate = value.strip().lower()
    if not candidate:
        return None

    return _known_language_alias(candidate) or candidate


def normalize_language_hint(value: str | None) -> str | None:
    if value is None:
        return None
    return _known_language_alias(value)


def merge_language_counts(
    rows: list[tuple[str | None, int]] | tuple[tuple[str | None, int], ...],
    *,
    fallback: str = "und",
) -> list[tuple[str, int]]:
    counts: dict[str, int] = defaultdict(int)
    for label, value in rows:
        key = normalize_language_code(label) or fallback
        counts[key] += value
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))
