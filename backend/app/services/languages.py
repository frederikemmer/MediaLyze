from __future__ import annotations

from collections import defaultdict


LANGUAGE_ALIASES = {
    "und": "und",
    "mul": "mul",
    "zxx": "zxx",
    "ar": "ar",
    "ara": "ar",
    "arabic": "ar",
    "bg": "bg",
    "bul": "bg",
    "bulgarian": "bg",
    "ca": "ca",
    "cat": "ca",
    "catalan": "ca",
    "cs": "cs",
    "ces": "cs",
    "cze": "cs",
    "czech": "cs",
    "da": "da",
    "dan": "da",
    "danish": "da",
    "de": "de",
    "deu": "de",
    "ger": "de",
    "german": "de",
    "deutsch": "de",
    "el": "el",
    "ell": "el",
    "gre": "el",
    "greek": "el",
    "en": "en",
    "eng": "en",
    "english": "en",
    "es": "es",
    "spa": "es",
    "spanish": "es",
    "et": "et",
    "est": "et",
    "estonian": "et",
    "fa": "fa",
    "fas": "fa",
    "per": "fa",
    "persian": "fa",
    "fi": "fi",
    "fin": "fi",
    "finnish": "fi",
    "fr": "fr",
    "fra": "fr",
    "fre": "fr",
    "french": "fr",
    "he": "he",
    "heb": "he",
    "hebrew": "he",
    "hi": "hi",
    "hin": "hi",
    "hindi": "hi",
    "hr": "hr",
    "hrv": "hr",
    "croatian": "hr",
    "hu": "hu",
    "hun": "hu",
    "hungarian": "hu",
    "id": "id",
    "ind": "id",
    "indonesian": "id",
    "is": "is",
    "ice": "is",
    "isl": "is",
    "icelandic": "is",
    "it": "it",
    "ita": "it",
    "italian": "it",
    "ja": "ja",
    "jpn": "ja",
    "japanese": "ja",
    "ko": "ko",
    "kor": "ko",
    "korean": "ko",
    "lt": "lt",
    "lit": "lt",
    "lithuanian": "lt",
    "lv": "lv",
    "lav": "lv",
    "latvian": "lv",
    "ms": "ms",
    "may": "ms",
    "msa": "ms",
    "malay": "ms",
    "nl": "nl",
    "dut": "nl",
    "nld": "nl",
    "dutch": "nl",
    "no": "no",
    "nob": "no",
    "nno": "no",
    "nor": "no",
    "norwegian": "no",
    "pl": "pl",
    "pol": "pl",
    "polish": "pl",
    "pt": "pt",
    "pob": "pt",
    "por": "pt",
    "portuguese": "pt",
    "ro": "ro",
    "ron": "ro",
    "rum": "ro",
    "romanian": "ro",
    "ru": "ru",
    "rus": "ru",
    "russian": "ru",
    "sk": "sk",
    "slk": "sk",
    "slo": "sk",
    "slovak": "sk",
    "sl": "sl",
    "slv": "sl",
    "slovenian": "sl",
    "sr": "sr",
    "srp": "sr",
    "serbian": "sr",
    "sv": "sv",
    "swe": "sv",
    "swedish": "sv",
    "th": "th",
    "tha": "th",
    "thai": "th",
    "tr": "tr",
    "tur": "tr",
    "turkish": "tr",
    "uk": "uk",
    "ukr": "uk",
    "ukrainian": "uk",
    "vi": "vi",
    "vie": "vi",
    "vietnamese": "vi",
    "zh": "zh",
    "chi": "zh",
    "zho": "zh",
    "chinese": "zh",
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


def expand_language_search_terms(value: str | None) -> set[str]:
    if value is None:
        return set()

    candidate = value.strip().lower()
    if not candidate:
        return set()

    terms = {candidate}
    normalized = normalize_language_hint(candidate) or normalize_language_code(candidate)
    if normalized is None:
        return terms

    terms.add(normalized)
    for alias, mapped in LANGUAGE_ALIASES.items():
        if mapped == normalized:
            terms.add(alias)
    return terms


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
