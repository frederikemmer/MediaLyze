from pathlib import Path

from backend.app.services.languages import normalize_language_hint


def detect_external_subtitles(video_path: Path, allowed_extensions: tuple[str, ...]) -> list[dict[str, str | None]]:
    parent = video_path.parent
    suffixes = {extension.lower() for extension in allowed_extensions}
    stem = video_path.stem
    detected: list[dict[str, str | None]] = []

    for entry in sorted(parent.iterdir()):
        if not entry.is_file():
            continue
        extension = entry.suffix.lower()
        if extension not in suffixes:
            continue
        if entry == video_path:
            continue
        if not (entry.stem == stem or entry.name.startswith(f"{stem}.")):
            continue

        middle = entry.name[len(stem) : -len(entry.suffix)]
        tokens = [token.lower() for token in middle.split(".") if token]
        language = None
        for token in tokens:
            language = normalize_language_hint(token)
            if language:
                break

        detected.append(
            {
                "path": entry.name,
                "language": language,
                "format": extension.lstrip("."),
            }
        )

    return detected
