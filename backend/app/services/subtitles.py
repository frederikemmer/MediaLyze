from collections.abc import Iterable
from pathlib import Path

from backend.app.services.languages import normalize_language_hint


def _detect_external_subtitles_from_names(
    video_path: Path,
    candidate_names: Iterable[str],
    allowed_extensions: tuple[str, ...],
) -> list[dict[str, str | None]]:
    suffixes = {extension.lower() for extension in allowed_extensions}
    stem = video_path.stem
    detected: list[dict[str, str | None]] = []

    for entry_name in sorted(candidate_names, key=str.lower):
        if entry_name == video_path.name:
            continue
        entry_path = Path(entry_name)
        extension = entry_path.suffix.lower()
        if extension not in suffixes:
            continue
        if not (entry_path.stem == stem or entry_name.startswith(f"{stem}.")):
            continue

        middle = entry_name[len(stem) : -len(extension)]
        tokens = [token.lower() for token in middle.split(".") if token]
        language = None
        for token in tokens:
            language = normalize_language_hint(token)
            if language:
                break

        detected.append(
            {
                "path": entry_name,
                "language": language,
                "format": extension.lstrip("."),
            }
        )

    return detected


def detect_external_subtitles_from_names(
    video_path: Path,
    sibling_names: Iterable[str],
    allowed_extensions: tuple[str, ...],
) -> list[dict[str, str | None]]:
    return _detect_external_subtitles_from_names(video_path, sibling_names, allowed_extensions)


def detect_external_subtitles(
    video_path: Path,
    allowed_extensions: tuple[str, ...],
) -> list[dict[str, str | None]]:
    sibling_names = [entry.name for entry in video_path.parent.iterdir() if entry.is_file()]
    return _detect_external_subtitles_from_names(video_path, sibling_names, allowed_extensions)
