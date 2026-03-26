from pathlib import Path


def _safe_resolve(path: Path) -> Path:
    try:
        return path.resolve()
    except RuntimeError as exc:
        if "Symlink loop" in str(exc):
            raise ValueError(f"Invalid path under MEDIA_ROOT: {path}") from exc
        raise
    except OSError as exc:
        if getattr(exc, "errno", None) == 40:
            raise ValueError(f"Invalid path under MEDIA_ROOT: {path}") from exc
        raise


def ensure_relative_to_root(candidate: Path, root: Path) -> Path:
    resolved_root = _safe_resolve(root)
    resolved_candidate = _safe_resolve(candidate)
    try:
        resolved_candidate.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError(f"Invalid path under MEDIA_ROOT: {candidate}") from exc
    return resolved_candidate


def relative_display_path(candidate: Path, root: Path) -> str:
    resolved_root = _safe_resolve(root)
    resolved_candidate = _safe_resolve(candidate)
    relative = resolved_candidate.relative_to(resolved_root)
    return "." if str(relative) == "." else relative.as_posix()
