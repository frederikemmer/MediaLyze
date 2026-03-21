from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from backend.app.core.config import Settings, get_settings
from backend.app.models.entities import AppSetting
from backend.app.schemas.app_settings import (
    AppSettingsRead,
    AppSettingsUpdate,
    FeatureFlagsRead,
)
from backend.app.utils.glob_patterns import normalize_ignore_patterns

APP_SETTINGS_KEY = "global"
BUILT_IN_DEFAULT_IGNORE_PATTERNS: tuple[str, ...] = (
    "*/.DS_Store",
    "*/._*",
    "*/@eaDir/*",
    "*/#recycle/*",
    "*/.deletedByTMM/*",
    "*/.recycle/*",
    "*/Thumbs.db",
    "*/Desktop.ini",
    "*/$RECYCLE.BIN/*",
    "*/.thumbnails/*",
    "*.part",
    "*.tmp",
    "*.temp",
    "*thumbs.db",
)


def _seeded_default_ignore_patterns(settings: Settings) -> list[str]:
    if settings.disable_default_ignore_patterns:
        return []
    return list(BUILT_IN_DEFAULT_IGNORE_PATTERNS)


def _merge_ignore_patterns(*pattern_groups: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()

    for group in pattern_groups:
        for pattern in group:
            if pattern in seen:
                continue
            merged.append(pattern)
            seen.add(pattern)

    return merged


def _default_feature_flags() -> FeatureFlagsRead:
    return FeatureFlagsRead()


def _deserialize_feature_flags(payload: Any) -> FeatureFlagsRead:
    candidate = payload if isinstance(payload, dict) else {}
    return FeatureFlagsRead(
        show_dolby_vision_profiles=bool(candidate.get("show_dolby_vision_profiles", False)),
        show_analyzed_files_csv_export=bool(candidate.get("show_analyzed_files_csv_export", False)),
    )


def _deserialize_app_settings(value: Any, settings: Settings) -> AppSettingsRead:
    payload = value if isinstance(value, dict) else {}
    user_ignore_patterns = payload.get("user_ignore_patterns")
    default_ignore_patterns = payload.get("default_ignore_patterns")
    legacy_ignore_patterns = payload.get("ignore_patterns")

    if isinstance(user_ignore_patterns, list) or isinstance(default_ignore_patterns, list):
        normalized_user = normalize_ignore_patterns(user_ignore_patterns if isinstance(user_ignore_patterns, list) else [])
        normalized_default = normalize_ignore_patterns(
            default_ignore_patterns if isinstance(default_ignore_patterns, list) else []
        )
    elif isinstance(legacy_ignore_patterns, list):
        normalized_user = normalize_ignore_patterns(legacy_ignore_patterns)
        normalized_default = []
    else:
        normalized_user = []
        normalized_default = _seeded_default_ignore_patterns(settings)
    feature_flags = _deserialize_feature_flags(payload.get("feature_flags"))

    return AppSettingsRead(
        ignore_patterns=_merge_ignore_patterns(normalized_user, normalized_default),
        user_ignore_patterns=normalized_user,
        default_ignore_patterns=normalized_default,
        feature_flags=feature_flags,
    )


def get_app_settings(db: Session, settings: Settings | None = None) -> AppSettingsRead:
    resolved_settings = settings or get_settings()
    setting = db.get(AppSetting, APP_SETTINGS_KEY)
    if setting is None:
        return AppSettingsRead(
            ignore_patterns=_seeded_default_ignore_patterns(resolved_settings),
            user_ignore_patterns=[],
            default_ignore_patterns=_seeded_default_ignore_patterns(resolved_settings),
            feature_flags=_default_feature_flags(),
        )
    return _deserialize_app_settings(setting.value, resolved_settings)


def update_app_settings(db: Session, payload: AppSettingsUpdate, settings: Settings | None = None) -> AppSettingsRead:
    current = get_app_settings(db, settings)

    update_user_patterns = payload.user_ignore_patterns is not None
    update_default_patterns = payload.default_ignore_patterns is not None
    use_legacy_ignore_patterns = (
        not update_user_patterns and not update_default_patterns and payload.ignore_patterns is not None
    )

    next_user_ignore_patterns = (
        normalize_ignore_patterns(payload.user_ignore_patterns)
        if update_user_patterns
        else normalize_ignore_patterns(payload.ignore_patterns)
        if use_legacy_ignore_patterns
        else current.user_ignore_patterns
    )
    next_default_ignore_patterns = (
        normalize_ignore_patterns(payload.default_ignore_patterns)
        if update_default_patterns
        else current.default_ignore_patterns
    )
    next_feature_flags = current.feature_flags.model_copy(
        update=payload.feature_flags.model_dump(exclude_none=True) if payload.feature_flags is not None else {}
    )

    setting = db.get(AppSetting, APP_SETTINGS_KEY)
    if setting is None:
        setting = AppSetting(key=APP_SETTINGS_KEY, value={})
        db.add(setting)

    setting.value = {
        "user_ignore_patterns": next_user_ignore_patterns,
        "default_ignore_patterns": next_default_ignore_patterns,
        "feature_flags": next_feature_flags.model_dump(mode="json"),
    }
    db.commit()
    db.refresh(setting)
    return _deserialize_app_settings(setting.value, settings or get_settings())


def get_ignore_patterns(db: Session, settings: Settings | None = None) -> tuple[str, ...]:
    app_settings = get_app_settings(db, settings)
    return tuple(app_settings.ignore_patterns)
