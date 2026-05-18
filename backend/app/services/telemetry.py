from __future__ import annotations

import math
import os
import platform
import json
import ssl
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

import certifi
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.core.config import AUDIO_EXTENSIONS, VIDEO_EXTENSIONS, Settings
from backend.app.models.entities import (
    AppSetting,
    DuplicateDetectionMode,
    Library,
    LibraryType,
    MediaFile,
    ScanMode,
    ScanStatus,
)
from backend.app.schemas.app_settings import AppSettingsRead
from backend.app.services.app_settings import APP_SETTINGS_KEY, get_app_settings

TelemetryPreviewMode = Literal["none", "minimal", "enabled"]

_DECIMAL_GB = 1_000_000_000
_PREVIEW_INSTALLATION_ID = "00000000-0000-0000-0000-000000000000"
_TELEMETRY_RETRY_DELAYS_SECONDS = (1, 2, 5, 10)


def round_count_for_telemetry(value: int) -> int:
    if value <= 0:
        return 0
    if value < 100:
        return value
    magnitude = 10 ** (int(math.log10(value)) - 1)
    return (value // magnitude) * magnitude


def round_storage_gb_for_telemetry(bytes_value: int) -> int:
    if bytes_value <= 0:
        return 0
    gb_value = bytes_value // _DECIMAL_GB
    if gb_value == 0:
        return 1
    return round_count_for_telemetry(int(gb_value))


def _normalized_extension(value: str | None) -> str:
    return (value or "").strip().lower().lstrip(".")


def _extension_set(values: tuple[str, ...]) -> set[str]:
    return {_normalized_extension(value) for value in values}


_AUDIO_EXTENSION_SET = _extension_set(AUDIO_EXTENSIONS)
_VIDEO_EXTENSION_SET = _extension_set(VIDEO_EXTENSIONS)


def _classify_media_kind(extension: str) -> str:
    normalized = _normalized_extension(extension)
    if normalized in _AUDIO_EXTENSION_SET:
        return "audio"
    if normalized in _VIDEO_EXTENSION_SET:
        return "video"
    return "other"


def _counter_with_enum_defaults(enum_type) -> dict[str, int]:
    return {item.value: 0 for item in enum_type}


def _deployment_channel(settings: Settings) -> str:
    if settings.is_desktop:
        return "desktop"
    if os.environ.get("MEDIALYZE_RUNTIME") == "server" and os.path.exists("/.dockerenv"):
        return "docker"
    if os.path.exists("/.dockerenv"):
        return "docker"
    return "server"


def _base_payload(
    settings: Settings,
    mode: str,
    *,
    installation_id: str = _PREVIEW_INSTALLATION_ID,
    is_test: bool = False,
) -> dict:
    return {
        "schema_version": 1,
        "event_type": "installation_snapshot",
        "telemetry_mode": mode,
        "installation_id": installation_id,
        "sent_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "is_test": is_test,
        "app": {
            "name": settings.app_name,
            "version": settings.app_version,
            "runtime_mode": settings.runtime_mode.value,
            "deployment_channel": _deployment_channel(settings),
        },
        "system": {
            "os_family": platform.system().lower() or "unknown",
            "architecture": platform.machine().lower() or "unknown",
        },
    }


def _library_type_counts(db: Session) -> dict[str, int]:
    counts = _counter_with_enum_defaults(LibraryType)
    rows = db.execute(select(Library.type, func.count(Library.id)).group_by(Library.type)).all()
    for library_type, count in rows:
        key = library_type.value if isinstance(library_type, LibraryType) else str(library_type)
        counts[key] = int(count)
    return counts


def _scan_mode_counts(db: Session) -> dict[str, int]:
    counts = _counter_with_enum_defaults(ScanMode)
    rows = db.execute(select(Library.scan_mode, func.count(Library.id)).group_by(Library.scan_mode)).all()
    for scan_mode, count in rows:
        key = scan_mode.value if isinstance(scan_mode, ScanMode) else str(scan_mode)
        counts[key] = int(count)
    return counts


def _duplicate_detection_mode_counts(db: Session) -> dict[str, int]:
    counts = _counter_with_enum_defaults(DuplicateDetectionMode)
    rows = db.execute(
        select(Library.duplicate_detection_mode, func.count(Library.id)).group_by(Library.duplicate_detection_mode)
    ).all()
    for duplicate_mode, count in rows:
        key = duplicate_mode.value if isinstance(duplicate_mode, DuplicateDetectionMode) else str(duplicate_mode)
        counts[key] = int(count)
    return counts


def build_media_kind_counts_for_telemetry(db: Session) -> dict[str, int]:
    counts: Counter[str] = Counter({"audio": 0, "video": 0, "other": 0})
    rows = db.execute(
        select(MediaFile.extension, func.count(MediaFile.id))
        .where(MediaFile.scan_status == ScanStatus.ready)
        .group_by(func.lower(MediaFile.extension))
    ).all()
    for extension, count in rows:
        counts[_classify_media_kind(extension)] += int(count)
    return {key: round_count_for_telemetry(value) for key, value in counts.items()}


def _enabled_usage_payload(db: Session, app_settings: AppSettingsRead) -> dict:
    analyzed_file_count = db.scalar(
        select(func.count(MediaFile.id)).where(MediaFile.scan_status == ScanStatus.ready)
    ) or 0
    storage_size_bytes = db.scalar(
        select(func.coalesce(func.sum(MediaFile.size_bytes), 0)).where(MediaFile.scan_status == ScanStatus.ready)
    ) or 0
    library_count = db.scalar(select(func.count(Library.id))) or 0
    enabled_feature_flags = [
        key
        for key, value in app_settings.feature_flags.model_dump(mode="json").items()
        if value is True
    ]

    return {
        "library_count": int(library_count),
        "library_type_counts": _library_type_counts(db),
        "media_kind_counts": build_media_kind_counts_for_telemetry(db),
        "analyzed_file_count_rounded": round_count_for_telemetry(int(analyzed_file_count)),
        "storage_size_gb_rounded": round_storage_gb_for_telemetry(int(storage_size_bytes)),
        "scan_mode_counts": _scan_mode_counts(db),
        "duplicate_detection_mode_counts": _duplicate_detection_mode_counts(db),
        "enabled_feature_flags": enabled_feature_flags,
    }


def _enabled_app_settings_payload(app_settings: AppSettingsRead) -> dict:
    return {
        "interface_language": app_settings.ui_preferences.interface_language,
        "color_theme": app_settings.ui_preferences.color_theme,
        "scan_worker_count": app_settings.scan_performance.scan_worker_count,
        "parallel_scan_jobs": app_settings.scan_performance.parallel_scan_jobs,
        "comparison_scatter_point_limit": app_settings.scan_performance.comparison_scatter_point_limit,
    }


def build_telemetry_payload(
    db: Session,
    settings: Settings,
    app_settings: AppSettingsRead,
    *,
    mode: TelemetryPreviewMode,
    installation_id: str = _PREVIEW_INSTALLATION_ID,
    is_test: bool = False,
) -> dict:
    payload = _base_payload(settings, mode, installation_id=installation_id, is_test=is_test)
    if mode == "enabled":
        payload["usage"] = _enabled_usage_payload(db, app_settings)
        payload["app_settings"] = _enabled_app_settings_payload(app_settings)
    return payload


def should_send_telemetry(app_settings: AppSettingsRead, now: datetime) -> bool:
    if app_settings.telemetry.environment_disabled:
        return False
    if app_settings.telemetry.mode not in ("minimal", "enabled"):
        return False
    if app_settings.telemetry.last_sent_at is None:
        return True
    last_sent = app_settings.telemetry.last_sent_at
    if last_sent.tzinfo is None:
        last_sent = last_sent.replace(tzinfo=UTC)
    return last_sent.astimezone(UTC).date() < now.astimezone(UTC).date()


def should_send_update_telemetry(app_settings: AppSettingsRead, settings: Settings) -> bool:
    if app_settings.telemetry.environment_disabled:
        return False
    if app_settings.telemetry.mode not in ("minimal", "enabled"):
        return False
    if app_settings.telemetry.last_sent_app_version is not None:
        return app_settings.telemetry.last_sent_app_version != settings.app_version

    last_payload = app_settings.telemetry.last_user_visible_payload
    if isinstance(last_payload, dict):
        app_payload = last_payload.get("app")
        if isinstance(app_payload, dict) and app_payload.get("version") == settings.app_version:
            return False
    return True


def _stored_telemetry_payload(db: Session) -> dict:
    setting = db.get(AppSetting, APP_SETTINGS_KEY)
    if setting is None:
        setting = AppSetting(key=APP_SETTINGS_KEY, value={})
        db.add(setting)
        db.flush()
    value = setting.value if isinstance(setting.value, dict) else {}
    telemetry = value.get("telemetry") if isinstance(value.get("telemetry"), dict) else {}
    return telemetry


def _ensure_installation_id(db: Session) -> str:
    telemetry = _stored_telemetry_payload(db)
    installation_id = telemetry.get("installation_id")
    if isinstance(installation_id, str) and installation_id:
        return installation_id

    installation_id = str(uuid4())
    setting = db.get(AppSetting, APP_SETTINGS_KEY)
    value = dict(setting.value) if setting is not None and isinstance(setting.value, dict) else {}
    value["telemetry"] = {**telemetry, "installation_id": installation_id}
    if setting is None:
        setting = AppSetting(key=APP_SETTINGS_KEY, value=value)
        db.add(setting)
    else:
        setting.value = value
    db.commit()
    return installation_id


def _post_json(url: str, payload: dict, timeout: float) -> None:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        status = getattr(response, "status", response.getcode())
        if status >= 400:
            raise urllib.error.HTTPError(url, status, "Telemetry ingest rejected payload", response.headers, None)


def send_telemetry_payload(payload: dict, settings: Settings) -> bool:
    import logging

    last_error: Exception | None = None
    for attempt_index in range(len(_TELEMETRY_RETRY_DELAYS_SECONDS) + 1):
        try:
            _post_json(settings.telemetry_endpoint, payload, settings.telemetry_timeout_seconds)
            return True
        except Exception as exc:
            # Telemetry is strictly best effort and must not affect runtime behavior.
            last_error = exc
            if attempt_index >= len(_TELEMETRY_RETRY_DELAYS_SECONDS):
                break
            time.sleep(_TELEMETRY_RETRY_DELAYS_SECONDS[attempt_index])

    logging.getLogger(__name__).info("Telemetry send failed after retries: %s", last_error)
    return False


def mark_telemetry_sent(
    db: Session,
    timestamp: datetime,
    payload: dict,
    *,
    mode: str | None = None,
    store_last_user_visible_payload: bool = True,
) -> None:
    telemetry = _stored_telemetry_payload(db)
    setting = db.get(AppSetting, APP_SETTINGS_KEY)
    value = dict(setting.value) if setting is not None and isinstance(setting.value, dict) else {}
    next_telemetry = {
        **telemetry,
        "last_sent_at": timestamp.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "last_sent_app_version": payload.get("app", {}).get("version"),
    }
    if mode is not None:
        next_telemetry["mode"] = mode
    if store_last_user_visible_payload:
        next_telemetry["last_user_visible_payload"] = payload
    else:
        next_telemetry["last_user_visible_payload"] = telemetry.get("last_user_visible_payload")
    value["telemetry"] = next_telemetry
    if setting is None:
        db.add(AppSetting(key=APP_SETTINGS_KEY, value=value))
    else:
        setting.value = value
    db.commit()


def send_current_telemetry_snapshot(db: Session, settings: Settings, *, force: bool = False) -> bool:
    app_settings = get_app_settings(db, settings)
    now = datetime.now(UTC)
    if not force and not should_send_telemetry(app_settings, now):
        return False
    if app_settings.telemetry.environment_disabled or app_settings.telemetry.mode not in ("minimal", "enabled"):
        return False

    installation_id = _ensure_installation_id(db)
    payload = build_telemetry_payload(
        db,
        settings,
        get_app_settings(db, settings),
        mode=app_settings.telemetry.mode,
        installation_id=installation_id,
        is_test=False,
    )
    if not send_telemetry_payload(payload, settings):
        return False
    mark_telemetry_sent(db, now, payload)
    return True


def send_initial_telemetry_snapshot(db: Session, settings: Settings) -> bool:
    app_settings = get_app_settings(db, settings)
    if app_settings.telemetry.environment_disabled or app_settings.telemetry.mode != "none":
        return False

    now = datetime.now(UTC)
    installation_id = _ensure_installation_id(db)
    payload = build_telemetry_payload(
        db,
        settings,
        get_app_settings(db, settings),
        mode="minimal",
        installation_id=installation_id,
        is_test=False,
    )
    if not send_telemetry_payload(payload, settings):
        return False
    mark_telemetry_sent(
        db,
        now,
        payload,
        mode="initialized",
        store_last_user_visible_payload=False,
    )
    return True


def send_update_telemetry_snapshot(db: Session, settings: Settings) -> bool:
    app_settings = get_app_settings(db, settings)
    if not should_send_update_telemetry(app_settings, settings):
        return False
    return send_current_telemetry_snapshot(db, settings, force=True)
