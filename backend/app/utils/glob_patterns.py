from __future__ import annotations

from collections.abc import Sequence
from fnmatch import fnmatchcase


def normalize_ignore_patterns(patterns: list[str] | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()

    for raw_pattern in patterns or []:
        pattern = raw_pattern.strip()
        if not pattern or pattern in seen:
            continue
        normalized.append(pattern)
        seen.add(pattern)

    return normalized


def matches_ignore_pattern(relative_path: str, patterns: Sequence[str], *, is_dir: bool = False) -> bool:
    normalized_path = relative_path.strip("/")
    if not normalized_path:
        return False

    candidates = {normalized_path, f"/{normalized_path}"}
    if is_dir:
        candidates.update({f"{normalized_path}/", f"/{normalized_path}/"})

    return any(fnmatchcase(candidate, pattern) for pattern in patterns for candidate in candidates)
