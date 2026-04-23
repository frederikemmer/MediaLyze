from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.config import Settings, get_settings
from backend.app.models.entities import AppSetting, Library
from backend.app.schemas.app_settings import (
    AppSettingsRead,
    AppSettingsUpdate,
    FeatureFlagsRead,
    HistoryRetentionBucketRead,
    HistoryRetentionRead,
    ResolutionCategory,
    ScanPerformanceRead,
)
from backend.app.services.quality import normalize_quality_profile
from backend.app.services.resolution_categories import (
    ResolutionCategoryUpdateResult,
    default_resolution_categories,
    normalize_resolution_categories,
    resolve_resolution_category_fallback,
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


def _default_feature_flags(settings: Settings) -> FeatureFlagsRead:
    return FeatureFlagsRead(show_full_width_app_shell=settings.is_desktop)


def _default_scan_performance(settings: Settings) -> ScanPerformanceRead:
    return ScanPerformanceRead(
        scan_worker_count=settings.ffprobe_worker_count,
        parallel_scan_jobs=settings.scan_runtime_worker_count,
        comparison_scatter_point_limit=ScanPerformanceRead.model_fields["comparison_scatter_point_limit"].default,
    )


def _default_history_retention() -> HistoryRetentionRead:
    return HistoryRetentionRead()


def _deserialize_feature_flags(payload: Any, settings: Settings) -> FeatureFlagsRead:
    candidate = payload if isinstance(payload, dict) else {}
    defaults = _default_feature_flags(settings)
    return FeatureFlagsRead(
        show_analyzed_files_csv_export=bool(
            candidate.get("show_analyzed_files_csv_export", defaults.show_analyzed_files_csv_export)
        ),
        show_full_width_app_shell=bool(candidate.get("show_full_width_app_shell", defaults.show_full_width_app_shell)),
        hide_quality_score_meter=bool(candidate.get("hide_quality_score_meter", defaults.hide_quality_score_meter)),
        unlimited_panel_size=bool(candidate.get("unlimited_panel_size", defaults.unlimited_panel_size)),
        in_depth_dolby_vision_profiles=bool(
            candidate.get(
                "in_depth_dolby_vision_profiles",
                defaults.in_depth_dolby_vision_profiles,
            )
        ),
    )


def _deserialize_scan_performance(payload: Any, settings: Settings) -> ScanPerformanceRead:
    candidate = payload if isinstance(payload, dict) else {}
    defaults = _default_scan_performance(settings)
    return ScanPerformanceRead(
        scan_worker_count=int(candidate.get("scan_worker_count", defaults.scan_worker_count)),
        parallel_scan_jobs=int(candidate.get("parallel_scan_jobs", defaults.parallel_scan_jobs)),
        comparison_scatter_point_limit=int(
            candidate.get("comparison_scatter_point_limit", defaults.comparison_scatter_point_limit)
        ),
    )


def _deserialize_history_retention_bucket(
    payload: Any,
    defaults: HistoryRetentionBucketRead,
) -> HistoryRetentionBucketRead:
    candidate = payload if isinstance(payload, dict) else {}
    return HistoryRetentionBucketRead(
        days=int(candidate.get("days", defaults.days)),
        storage_limit_gb=float(candidate.get("storage_limit_gb", defaults.storage_limit_gb)),
    )


def _deserialize_history_retention(payload: Any) -> HistoryRetentionRead:
    candidate = payload if isinstance(payload, dict) else {}
    defaults = _default_history_retention()
    return HistoryRetentionRead(
        file_history=_deserialize_history_retention_bucket(candidate.get("file_history"), defaults.file_history),
        library_history=_deserialize_history_retention_bucket(candidate.get("library_history"), defaults.library_history),
        scan_history=_deserialize_history_retention_bucket(candidate.get("scan_history"), defaults.scan_history),
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
    feature_flags = _deserialize_feature_flags(payload.get("feature_flags"), settings)
    scan_performance = _deserialize_scan_performance(payload.get("scan_performance"), settings)
    history_retention = _deserialize_history_retention(payload.get("history_retention"))
    resolution_categories_payload = payload.get("resolution_categories")
    normalized_resolution_categories = normalize_resolution_categories(
        resolution_categories_payload if isinstance(resolution_categories_payload, list) else None
    ).categories

    return AppSettingsRead(
        ignore_patterns=_merge_ignore_patterns(normalized_user, normalized_default),
        user_ignore_patterns=normalized_user,
        default_ignore_patterns=normalized_default,
        resolution_categories=normalized_resolution_categories,
        feature_flags=feature_flags,
        scan_performance=scan_performance,
        history_retention=history_retention,
    )


def get_app_settings(db: Session, settings: Settings | None = None) -> AppSettingsRead:
    resolved_settings = settings or get_settings()
    setting = db.get(AppSetting, APP_SETTINGS_KEY)
    if setting is None:
        return AppSettingsRead(
            ignore_patterns=_seeded_default_ignore_patterns(resolved_settings),
            user_ignore_patterns=[],
            default_ignore_patterns=_seeded_default_ignore_patterns(resolved_settings),
            resolution_categories=default_resolution_categories(),
            feature_flags=_default_feature_flags(resolved_settings),
            scan_performance=_default_scan_performance(resolved_settings),
            history_retention=_default_history_retention(),
        )
    return _deserialize_app_settings(setting.value, resolved_settings)


def _update_libraries_for_resolution_categories(
    db: Session,
    categories: list[ResolutionCategory],
    current_categories: list[ResolutionCategory],
) -> list[int]:
    affected_library_ids: list[int] = []
    current_ids = {item.id for item in current_categories}
    next_ids = {item.id for item in categories}
    removed_ids = current_ids - next_ids

    for library in db.scalars(select(Library).order_by(Library.id.asc())).all():
        current_profile = normalize_quality_profile(library.quality_profile, current_categories)
        next_profile = normalize_quality_profile(current_profile, categories)
        if removed_ids:
            for key in ("minimum", "ideal"):
                next_profile["resolution"][key] = resolve_resolution_category_fallback(
                    str(current_profile["resolution"][key]),
                    categories,
                )
        if current_profile != next_profile or library.quality_profile != next_profile:
            library.quality_profile = next_profile
            affected_library_ids.append(library.id)

    return affected_library_ids


def update_app_settings(
    db: Session,
    payload: AppSettingsUpdate,
    settings: Settings | None = None,
    *,
    include_effects: bool = False,
) -> AppSettingsRead | tuple[AppSettingsRead, list[int]]:
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
    resolution_update: ResolutionCategoryUpdateResult
    if payload.resolution_categories is not None:
        resolution_update = normalize_resolution_categories(
            payload.resolution_categories,
            existing_categories=current.resolution_categories,
        )
        next_resolution_categories = resolution_update.categories
    else:
        resolution_update = ResolutionCategoryUpdateResult(
            categories=current.resolution_categories,
            changed=False,
            logic_changed=False,
            removed_ids=set(),
        )
        next_resolution_categories = current.resolution_categories
    next_feature_flags = current.feature_flags.model_copy(
        update=payload.feature_flags.model_dump(exclude_none=True) if payload.feature_flags is not None else {}
    )
    next_scan_performance = current.scan_performance.model_copy(
        update=payload.scan_performance.model_dump(exclude_none=True) if payload.scan_performance is not None else {}
    )
    history_retention_updates = {}
    if payload.history_retention is not None:
        for key in ("file_history", "library_history", "scan_history"):
            bucket_update = getattr(payload.history_retention, key)
            if bucket_update is None:
                continue
            history_retention_updates[key] = getattr(current.history_retention, key).model_copy(
                update=bucket_update.model_dump(exclude_none=True)
            )
    next_history_retention = current.history_retention.model_copy(
        update=history_retention_updates
    )

    affected_library_ids: list[int] = []
    if resolution_update.changed:
        affected_library_ids = _update_libraries_for_resolution_categories(
            db,
            next_resolution_categories,
            current.resolution_categories,
        )

    setting = db.get(AppSetting, APP_SETTINGS_KEY)
    if setting is None:
        setting = AppSetting(key=APP_SETTINGS_KEY, value={})
        db.add(setting)

    setting.value = {
        "user_ignore_patterns": next_user_ignore_patterns,
        "default_ignore_patterns": next_default_ignore_patterns,
        "resolution_categories": [item.model_dump(mode="json") for item in next_resolution_categories],
        "feature_flags": next_feature_flags.model_dump(mode="json"),
        "scan_performance": next_scan_performance.model_dump(mode="json"),
        "history_retention": next_history_retention.model_dump(mode="json"),
    }
    db.commit()
    db.refresh(setting)
    result = _deserialize_app_settings(setting.value, settings or get_settings())
    if include_effects:
        recompute_library_ids = affected_library_ids if resolution_update.logic_changed else []
        return result, recompute_library_ids
    return result


def get_ignore_patterns(db: Session, settings: Settings | None = None) -> tuple[str, ...]:
    app_settings = get_app_settings(db, settings)
    return tuple(app_settings.ignore_patterns)
