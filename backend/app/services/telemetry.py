from __future__ import annotations

import math
import os
import platform
from collections import Counter
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.core.config import AUDIO_EXTENSIONS, VIDEO_EXTENSIONS, Settings
from backend.app.models.entities import (
    DuplicateDetectionMode,
    Library,
    LibraryType,
    MediaFile,
    ScanMode,
    ScanStatus,
)
from backend.app.schemas.app_settings import AppSettingsRead

TelemetryPreviewMode = Literal["none", "minimal", "enabled"]

_DECIMAL_GB = 1_000_000_000
_PREVIEW_INSTALLATION_ID = "00000000-0000-0000-0000-000000000000"


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


def _base_payload(settings: Settings, mode: str) -> dict:
    return {
        "schema_version": 1,
        "event_type": "installation_snapshot",
        "telemetry_mode": mode,
        "installation_id": _PREVIEW_INSTALLATION_ID,
        "sent_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "is_test": False,
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
) -> dict:
    payload = _base_payload(settings, mode)
    if mode == "enabled":
        payload["usage"] = _enabled_usage_payload(db, app_settings)
        payload["app_settings"] = _enabled_app_settings_payload(app_settings)
    return payload
