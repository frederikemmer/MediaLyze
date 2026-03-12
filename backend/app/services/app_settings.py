from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from backend.app.models.entities import AppSetting
from backend.app.schemas.app_settings import AppSettingsRead, AppSettingsUpdate
from backend.app.utils.glob_patterns import normalize_ignore_patterns

APP_SETTINGS_KEY = "global"
DEFAULT_IGNORE_PATTERNS: tuple[str, ...] = ()
def _deserialize_app_settings(value: Any) -> AppSettingsRead:
    payload = value if isinstance(value, dict) else {}
    ignore_patterns = payload.get("ignore_patterns", DEFAULT_IGNORE_PATTERNS)
    if not isinstance(ignore_patterns, list):
        ignore_patterns = list(DEFAULT_IGNORE_PATTERNS)
    return AppSettingsRead(ignore_patterns=normalize_ignore_patterns(ignore_patterns))


def get_app_settings(db: Session) -> AppSettingsRead:
    setting = db.get(AppSetting, APP_SETTINGS_KEY)
    if setting is None:
        return AppSettingsRead(ignore_patterns=list(DEFAULT_IGNORE_PATTERNS))
    return _deserialize_app_settings(setting.value)


def update_app_settings(db: Session, payload: AppSettingsUpdate) -> AppSettingsRead:
    current = get_app_settings(db)
    next_ignore_patterns = (
        normalize_ignore_patterns(payload.ignore_patterns)
        if payload.ignore_patterns is not None
        else current.ignore_patterns
    )

    setting = db.get(AppSetting, APP_SETTINGS_KEY)
    if setting is None:
        setting = AppSetting(key=APP_SETTINGS_KEY, value={})
        db.add(setting)

    setting.value = {"ignore_patterns": next_ignore_patterns}
    db.commit()
    db.refresh(setting)
    return _deserialize_app_settings(setting.value)

def get_ignore_patterns(db: Session) -> tuple[str, ...]:
    settings = get_app_settings(db)
    return tuple(settings.ignore_patterns)
