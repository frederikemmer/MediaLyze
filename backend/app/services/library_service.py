from __future__ import annotations

from collections.abc import Iterable
from collections import defaultdict
from copy import deepcopy
import os
from pathlib import Path, PurePosixPath

from sqlalchemy import case, delete, distinct, func, literal, select, union_all
from sqlalchemy.orm import Session

from backend.app.core.config import Settings
from backend.app.models.entities import (
    AudioStream,
    ConnectorConnection,
    ConnectorLibrary,
    ConnectorLibraryLink,
    ExternalSubtitle,
    JellyfinItem,
    JellyfinLibrary,
    JellyfinUser,
    JellyfinUserItemData,
    Library,
    LibraryRoot,
    MediaChapter,
    MediaFile,
    MediaFormat,
    ScanJob,
    ScanStatus,
    SubtitleStream,
    VideoStream,
)
from backend.app.schemas.library import (
    ConnectorLibraryLinkRead,
    LibraryCreate,
    LibraryRootRead,
    LibraryStatistics,
    LibrarySummary,
    LibraryUpdate,
    LinkedJellyfinLibraryRead,
)
from backend.app.schemas.media import DistributionItem
from backend.app.schemas.quality import QualityProfile
from backend.app.services.app_settings import get_app_settings as load_app_settings
from backend.app.services.container_formats import format_container_label
from backend.app.services.languages import normalize_language_code
from backend.app.services.numeric_distributions import build_numeric_distributions
from backend.app.services.path_access import (
    ResolvedLibraryRoot,
    is_watch_supported_for_library,
    library_root_display_name,
    normalized_library_path_key,
    resolve_library_roots,
)
from backend.app.services.quality import normalize_quality_profile
from backend.app.services.quality_profiles import (
    effective_quality_profile_for_library,
    ensure_default_quality_profiles,
    validate_library_quality_profile,
)
from backend.app.services.resolution_categories import classify_resolution_category
from backend.app.services.spatial_audio import format_spatial_audio_profile
from backend.app.services.stats_cache import stats_cache
from backend.app.services.video_codec_buckets import build_video_codec_distribution
from backend.app.services.video_queries import primary_video_streams_subquery


DEFAULT_SCAN_CONFIG = {
    "interval_minutes": 60,
    "scheduled_time": "02:00",
    "debounce_seconds": 15,
}

_NUMERIC_PANEL_METRIC_IDS = {
    "quality_score": "quality_score",
    "duration": "duration",
    "size": "size",
    "bitrate": "bitrate",
    "audio_bitrate": "audio_bitrate",
    "chapter_counts": "chapter_count",
}
_MUSIC_HIDDEN_PANEL_IDS = {
    "video_codec",
    "resolution",
    "hdr_type",
    "video_bit_depth",
    "audio_bitrate",
    "subtitle_languages",
    "subtitle_codecs",
    "subtitle_sources",
    "audio_languages",
}
_AUDIOBOOK_PANEL_IDS = {
    "audiobook_narrators",
    "audiobook_authors",
    "audiobook_publishers",
    "audiobook_series",
    "audiobook_series_parts",
    "chapter_counts",
}
_DISTRIBUTION_FIELD_BY_PANEL = {
    "container": "container_distribution",
    "video_codec": "video_codec_distribution",
    "resolution": "resolution_distribution",
    "hdr_type": "hdr_distribution",
    "video_bit_depth": "video_bit_depth_distribution",
    "bit_depth": "bit_depth_distribution",
    "audio_codecs": "audio_codec_distribution",
    "audio_spatial_profiles": "audio_spatial_profile_distribution",
    "audio_languages": "audio_language_distribution",
    "audio_artists": "audio_artist_distribution",
    "audio_albums": "audio_album_distribution",
    "audio_genres": "audio_genre_distribution",
    "audio_years": "audio_year_distribution",
    "audio_channels": "audio_channel_distribution",
    "sample_rates": "sample_rate_distribution",
    "track_numbers": "track_number_distribution",
    "bit_rate_modes": "bit_rate_mode_distribution",
    "embedded_covers": "embedded_cover_distribution",
    "audiobook_narrators": "audiobook_narrator_distribution",
    "audiobook_authors": "audiobook_author_distribution",
    "audiobook_publishers": "audiobook_publisher_distribution",
    "audiobook_series": "audiobook_series_distribution",
    "audiobook_series_parts": "audiobook_series_part_distribution",
    "chapter_counts": "chapter_count_distribution",
    "subtitle_languages": "subtitle_language_distribution",
    "subtitle_codecs": "subtitle_codec_distribution",
    "subtitle_sources": "subtitle_source_distribution",
    "user_plays": "user_play_count_distribution",
}


def _normalize_subtitle_codec(value: str | None) -> str:
    candidate = (value or "").strip().lower()
    return candidate or "unknown"


def _normalize_audio_codec(value: str | None) -> str:
    candidate = (value or "").strip().lower()
    return candidate or "unknown"


def _sorted_count_items(counts: dict[str, int]) -> list[tuple[str, int]]:
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))


def _resolution_label(width: int | None, height: int | None) -> str:
    if not width or not height:
        return "unknown"
    return f"{width}x{height}"


def _group_resolution_distribution(
    rows: list[tuple[int | None, int | None, int]],
    *,
    resolution_categories,
) -> list[DistributionItem]:
    counts: dict[str, int] = defaultdict(int)
    labels: dict[str, str] = {}

    for width, height, value in rows:
        category = classify_resolution_category(width, height, resolution_categories)
        label = category.label if category else "unknown"
        filter_value = category.id if category else None
        key = filter_value or label
        counts[key] += value
        labels[key] = label

    return [
        DistributionItem(label=labels[key], value=value, filter_value=key if key in labels and key != labels[key] else None)
        for key, value in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def _library_summary_from_model(
    db: Session,
    library: Library,
    aggregate: dict[str, int | float] | None = None,
    resolution_categories=None,
    linked_jellyfin_library: JellyfinLibrary | None = None,
) -> LibrarySummary:
    app_resolution_categories = resolution_categories or load_app_settings(db).resolution_categories
    summary = LibrarySummary.model_validate(library)
    if not summary.roots:
        summary.roots = [
            LibraryRootRead(
                id=0,
                path=library.path,
                display_name=library_root_display_name(library.path),
                path_key=normalized_library_path_key(library.path),
            )
        ]
    summary.quality_profile = QualityProfile.model_validate(
        effective_quality_profile_for_library(db, library, app_resolution_categories)
    )
    for key, value in (aggregate or {}).items():
        setattr(summary, key, value)
    if linked_jellyfin_library is not None:
        summary.linked_jellyfin_library = LinkedJellyfinLibraryRead(
            id=linked_jellyfin_library.id,
            name=linked_jellyfin_library.name,
            last_synced_at=linked_jellyfin_library.last_synced_at,
        )
    connector_links = db.execute(
        select(ConnectorLibraryLink, ConnectorLibrary, ConnectorConnection)
        .join(
            ConnectorLibrary,
            ConnectorLibrary.id == ConnectorLibraryLink.connector_library_id,
        )
        .join(
            ConnectorConnection,
            ConnectorConnection.id == ConnectorLibrary.connection_id,
        )
        .where(ConnectorLibraryLink.library_id == library.id)
        .order_by(
            ConnectorConnection.provider,
            ConnectorConnection.name,
            ConnectorLibrary.name,
        )
    ).all()
    summary.connector_links = [
        ConnectorLibraryLinkRead(
            connection_id=connection.id,
            connection_name=connection.name,
            provider=connection.provider,
            connector_library_id=connector_library.id,
            connector_library_name=connector_library.name,
            link_method=link.link_method,
        )
        for link, connector_library, connection in connector_links
    ]
    return summary


def _distribution_items(rows: list[tuple[str | None, int]], *, fallback: str = "unknown") -> list[DistributionItem]:
    return [
        DistributionItem(label=(label or fallback), value=value)
        for label, value in rows
        if value > 0
    ]


def _statistics_panel_view(
    payload: LibraryStatistics,
    requested_panels: set[str] | None,
    hidden_panel_ids: set[str],
) -> LibraryStatistics:
    if requested_panels is None and not hidden_panel_ids:
        return payload

    visible_panels = set(_DISTRIBUTION_FIELD_BY_PANEL) | set(_NUMERIC_PANEL_METRIC_IDS)
    if requested_panels is not None:
        visible_panels &= requested_panels
    visible_panels -= hidden_panel_ids
    updates = {
        field_name: getattr(payload, field_name) if panel_id in visible_panels else []
        for panel_id, field_name in _DISTRIBUTION_FIELD_BY_PANEL.items()
    }
    updates["numeric_distributions"] = {
        metric_id: distribution
        for metric_id, distribution in payload.numeric_distributions.items()
        if any(
            requested_panel in visible_panels and metric_id == configured_metric_id
            for requested_panel, configured_metric_id in _NUMERIC_PANEL_METRIC_IDS.items()
        )
    }
    return payload.model_copy(update=updates)


def _normalized_language_expr(expression):
    candidate = func.lower(func.trim(func.coalesce(expression, "")))
    return case((func.length(candidate) == 0, "und"), else_=candidate)


def _normalized_text_expr(expression, fallback: str):
    candidate = func.lower(func.trim(func.coalesce(expression, "")))
    return case((func.length(candidate) == 0, fallback), else_=candidate)


def _count_distinct_normalized_languages(
    rows: list[tuple[int, str | None]] | tuple[tuple[int, str | None], ...],
    *,
    fallback: str = "und",
) -> list[tuple[str, int]]:
    values_by_file: dict[int, set[str]] = defaultdict(set)
    for media_file_id, raw_value in rows:
        values_by_file[media_file_id].add(normalize_language_code(raw_value) or fallback)

    counts: dict[str, int] = defaultdict(int)
    for values in values_by_file.values():
        for value in values:
            counts[value] += 1
    return _sorted_count_items(counts)


def normalize_scan_config(scan_mode, scan_config: dict | None) -> dict:
    candidate = dict(scan_config or {})
    normalized = deepcopy(DEFAULT_SCAN_CONFIG)
    selected_paths: list[str] = []

    interval_minutes = candidate.get("interval_minutes", normalized["interval_minutes"])
    scheduled_time = str(candidate.get("scheduled_time", normalized["scheduled_time"]) or normalized["scheduled_time"])
    debounce_seconds = candidate.get("debounce_seconds", normalized["debounce_seconds"])
    for raw_path in candidate.get("selected_paths") or []:
        normalized_path = PurePosixPath(str(raw_path).strip().replace("\\", "/")).as_posix().strip("/")
        if normalized_path and normalized_path not in selected_paths:
            selected_paths.append(normalized_path)

    try:
        normalized["interval_minutes"] = max(5, int(interval_minutes))
    except (TypeError, ValueError):
        normalized["interval_minutes"] = DEFAULT_SCAN_CONFIG["interval_minutes"]

    try:
        hour_str, minute_str = scheduled_time.split(":", 1)
        normalized["scheduled_time"] = f"{max(0, min(23, int(hour_str))):02d}:{max(0, min(59, int(minute_str))):02d}"
    except (AttributeError, TypeError, ValueError):
        normalized["scheduled_time"] = DEFAULT_SCAN_CONFIG["scheduled_time"]

    try:
        normalized["debounce_seconds"] = max(3, int(debounce_seconds))
    except (TypeError, ValueError):
        normalized["debounce_seconds"] = DEFAULT_SCAN_CONFIG["debounce_seconds"]

    if scan_mode == "manual":
        return {"selected_paths": selected_paths} if selected_paths else {}
    if scan_mode == "scheduled":
        result = {"interval_minutes": normalized["interval_minutes"]}
        if selected_paths:
            result["selected_paths"] = selected_paths
        return result
    if scan_mode == "scheduled_daily":
        result = {"scheduled_time": normalized["scheduled_time"]}
        if selected_paths:
            result["selected_paths"] = selected_paths
        return result
    if scan_mode == "watch":
        result = {"debounce_seconds": normalized["debounce_seconds"]}
        if selected_paths:
            result["selected_paths"] = selected_paths
        return result
    return normalized


def _normalize_library_root_scan_settings(
    settings: Settings,
    root_paths: Iterable[str],
    scan_mode,
    scan_config: dict | None,
) -> tuple:
    normalized_scan_config = normalize_scan_config(scan_mode, scan_config)
    if scan_mode == "watch" and any(not is_watch_supported_for_library(settings, path_value) for path_value in root_paths):
        fallback_config = dict(normalized_scan_config)
        fallback_config["interval_minutes"] = 60
        return "scheduled", normalize_scan_config("scheduled", fallback_config)
    return scan_mode, normalized_scan_config


def _resolved_library_path_config(
    settings: Settings,
    root_inputs: Iterable[str],
    scan_config: dict | None,
    *,
    derive_selected_paths: bool,
) -> tuple[Path, list[ResolvedLibraryRoot], dict]:
    resolved_roots = resolve_library_roots(settings, list(root_inputs))
    safe_path = resolved_roots[0].path
    if len(resolved_roots) > 1:
        try:
            common_path = os.path.commonpath([str(root.path) for root in resolved_roots])
        except ValueError:
            common_path = ""
        if common_path and common_path != os.path.sep:
            safe_path = type(resolved_roots[0].path)(common_path)

    next_scan_config = dict(scan_config or {})
    if derive_selected_paths and len(resolved_roots) > 1:
        try:
            selected_paths = [root.path.relative_to(safe_path).as_posix() for root in resolved_roots]
        except ValueError:
            selected_paths = []
        if selected_paths:
            next_scan_config["selected_paths"] = selected_paths
        else:
            next_scan_config.pop("selected_paths", None)
    elif derive_selected_paths:
        next_scan_config.pop("selected_paths", None)
    return safe_path, resolved_roots, next_scan_config


def _replace_library_roots_preserving_media(
    db: Session,
    library: Library,
    resolved_roots: list[ResolvedLibraryRoot],
) -> None:
    existing_roots = list(library.roots or [])
    existing_by_key = {root.path_key: root for root in existing_roots}
    reused_root_ids: set[int] = set()
    resolved_path_keys = {item.path_key for item in resolved_roots}
    unmatched_existing = [
        root for root in existing_roots if root.path_key not in resolved_path_keys
    ]

    for resolved_root in resolved_roots:
        root = existing_by_key.get(resolved_root.path_key)
        if root is not None:
            reused_root_ids.add(root.id)
            root.path = str(resolved_root.path)
            root.path_key = resolved_root.path_key
            continue

        if unmatched_existing:
            root = unmatched_existing.pop(0)
            reused_root_ids.add(root.id)
            root.path = str(resolved_root.path)
            root.path_key = resolved_root.path_key
        else:
            root = LibraryRoot(
                library_id=library.id,
                path=str(resolved_root.path),
                display_name=resolved_root.display_name,
                path_key=resolved_root.path_key,
            )
            db.add(root)

    stale_roots = [root for root in existing_roots if root.id not in reused_root_ids]
    for root in stale_roots:
        db.execute(
            MediaFile.__table__.update()
            .where(MediaFile.library_root_id == root.id)
            .values(library_root_id=None)
        )
        db.delete(root)


def _unique_root_alias(candidate: str, used: set[str]) -> str:
    base = candidate.strip()
    if not base:
        raise ValueError("Library root alias must not be empty")
    alias = base
    suffix = 2
    while alias.casefold() in used:
        alias = f"{base} ({suffix})"
        suffix += 1
    used.add(alias.casefold())
    return alias


def _apply_structured_root_aliases(library: Library, root_specs) -> None:
    if not root_specs:
        # Derived aliases still need to be unique for roots with identical basenames.
        used: set[str] = set()
        for root in library.roots:
            root.display_name = _unique_root_alias(root.display_name, used)
        return

    by_id = {root.id: root for root in library.roots}
    by_key = {root.path_key: root for root in library.roots}
    assignments: list[tuple[LibraryRoot, str]] = []
    assigned_ids: set[int] = set()
    for spec in root_specs:
        root = by_id.get(spec.id) if spec.id is not None else None
        if spec.id is not None and root is None:
            raise ValueError(f"Library root {spec.id} does not belong to this library")
        if root is None:
            root = by_key.get(normalized_library_path_key(spec.path))
        if root is None or root.id in assigned_ids:
            continue
        alias = spec.display_name.strip() if spec.display_name else root.display_name
        assignments.append((root, alias))
        assigned_ids.add(root.id)

    explicit_aliases = [alias.casefold() for _root, alias in assignments]
    if len(explicit_aliases) != len(set(explicit_aliases)):
        raise ValueError("Library root aliases must be unique ignoring case")

    used: set[str] = set()
    assignment_map = {root.id: alias for root, alias in assignments}
    for root in library.roots:
        requested = assignment_map.get(root.id)
        if requested is not None:
            if requested.casefold() in used:
                raise ValueError("Library root aliases must be unique ignoring case")
            root.display_name = requested
            used.add(requested.casefold())
        else:
            root.display_name = _unique_root_alias(root.display_name, used)


def create_library(db: Session, settings: Settings, payload: LibraryCreate) -> Library:
    cache_key = str(id(db.get_bind()))
    app_settings = load_app_settings(db, settings)
    ensure_default_quality_profiles(db, app_settings.resolution_categories)
    selected_profile = validate_library_quality_profile(db, payload.type, payload.quality_profile_id)
    root_inputs = [root.path for root in payload.roots] or payload.paths or [payload.path]
    safe_path, resolved_roots, initial_scan_config = _resolved_library_path_config(
        settings,
        root_inputs,
        payload.scan_config,
        derive_selected_paths=bool(payload.paths),
    )
    scan_mode, scan_config = _normalize_library_root_scan_settings(
        settings,
        [str(root.path) for root in resolved_roots],
        payload.scan_mode,
        initial_scan_config,
    )
    library = Library(
        name=payload.name,
        path=str(safe_path),
        type=payload.type,
        scan_mode=scan_mode,
        duplicate_detection_mode=payload.duplicate_detection_mode,
        scan_config=scan_config,
        quality_profile=normalize_quality_profile(payload.quality_profile, app_settings.resolution_categories),
        quality_profile_id=selected_profile.id if selected_profile else None,
        show_on_dashboard=payload.show_on_dashboard,
        history_added_date_source=payload.history_added_date_source,
        preferred_connector_connection_id=payload.preferred_connector_connection_id,
    )
    db.add(library)
    db.flush()
    for root in resolved_roots:
        db.add(
            LibraryRoot(
                library_id=library.id,
                path=str(root.path),
                display_name=root.display_name,
                path_key=root.path_key,
            )
        )
    db.flush()
    db.expire(library, ["roots"])
    _apply_structured_root_aliases(library, payload.roots)
    db.commit()
    db.refresh(library)
    stats_cache.invalidate(cache_key)
    return library


def update_library_settings(
    db: Session,
    settings: Settings,
    library_id: int,
    payload: LibraryUpdate,
) -> tuple[Library | None, bool]:
    cache_key = str(id(db.get_bind()))
    library = db.get(Library, library_id)
    if not library:
        return None, False

    quality_profile_changed = False
    app_settings = load_app_settings(db, settings)
    ensure_default_quality_profiles(db, app_settings.resolution_categories)

    if payload.name is not None:
        next_name = payload.name.strip()
        if not next_name:
            raise ValueError("Library name must not be empty")
        library.name = next_name
    if payload.type is not None:
        library.type = payload.type
        try:
            compatible_profile = validate_library_quality_profile(db, library.type, library.quality_profile_id)
        except ValueError:
            compatible_profile = None
        if compatible_profile is None:
            library.quality_profile_id = None

    path_fields_updated = (
        "path" in payload.model_fields_set
        or "paths" in payload.model_fields_set
        or "roots" in payload.model_fields_set
    )
    if path_fields_updated:
        root_inputs = [root.path for root in (payload.roots or [])]
        if not root_inputs:
            root_inputs = payload.paths if payload.paths is not None else []
        if not root_inputs and payload.path is not None:
            root_inputs = [payload.path]
        safe_path, resolved_roots, next_scan_config = _resolved_library_path_config(
            settings,
            root_inputs,
            library.scan_config,
            derive_selected_paths=True,
        )
        _replace_library_roots_preserving_media(db, library, resolved_roots)
        db.flush()
        db.expire(library, ["roots"])
        _apply_structured_root_aliases(library, payload.roots)
        library.path = str(safe_path)
        library.scan_mode, library.scan_config = _normalize_library_root_scan_settings(
            settings,
            [str(root.path) for root in resolved_roots],
            library.scan_mode,
            next_scan_config,
        )

    if payload.scan_mode is not None:
        next_scan_config = dict(library.scan_config or {})
        next_scan_config.update(payload.scan_config or {})
        root_paths = [str(root.path) for root in (library.roots or [])] or [library.path]
        library.scan_mode, library.scan_config = _normalize_library_root_scan_settings(
            settings,
            root_paths,
            payload.scan_mode,
            next_scan_config,
        )
    if payload.duplicate_detection_mode is not None:
        library.duplicate_detection_mode = payload.duplicate_detection_mode
    if "quality_profile_id" in payload.model_fields_set:
        selected_profile = validate_library_quality_profile(db, library.type, payload.quality_profile_id)
        next_profile_id = selected_profile.id if selected_profile else None
        if library.quality_profile_id != next_profile_id:
            library.quality_profile_id = next_profile_id
            quality_profile_changed = True
    if payload.quality_profile is not None:
        next_quality_profile = normalize_quality_profile(payload.quality_profile, app_settings.resolution_categories)
        current_quality_profile = normalize_quality_profile(library.quality_profile, app_settings.resolution_categories)
        if next_quality_profile != current_quality_profile or library.quality_profile != current_quality_profile:
            library.quality_profile = next_quality_profile
            quality_profile_changed = True
    if payload.show_on_dashboard is not None:
        library.show_on_dashboard = payload.show_on_dashboard
    if payload.history_added_date_source is not None:
        if (
            payload.history_added_date_source.value == "connector"
            and library.preferred_connector_connection_id is None
            and payload.preferred_connector_connection_id is None
        ):
            raise ValueError("Choose a preferred connector connection before using connector history dates")
        library.history_added_date_source = payload.history_added_date_source
    if "preferred_connector_connection_id" in payload.model_fields_set:
        if payload.preferred_connector_connection_id is not None:
            linked = db.scalar(
                select(ConnectorLibraryLink.id)
                .join(
                    ConnectorLibrary,
                    ConnectorLibrary.id == ConnectorLibraryLink.connector_library_id,
                )
                .where(
                    ConnectorLibraryLink.library_id == library.id,
                    ConnectorLibrary.connection_id == payload.preferred_connector_connection_id,
                )
            )
            if linked is None:
                raise ValueError("Preferred connector connection must be linked to this library")
        library.preferred_connector_connection_id = payload.preferred_connector_connection_id
    db.commit()
    db.refresh(library)
    stats_cache.invalidate(cache_key, library.id)
    return library, quality_profile_changed


def delete_library(db: Session, library_id: int) -> bool:
    cache_key = str(id(db.get_bind()))
    existing = db.scalar(select(Library.id).where(Library.id == library_id))
    if existing is None:
        return False

    media_file_ids = select(MediaFile.id).where(MediaFile.library_id == library_id)
    db.execute(delete(ExternalSubtitle).where(ExternalSubtitle.media_file_id.in_(media_file_ids)))
    db.execute(delete(SubtitleStream).where(SubtitleStream.media_file_id.in_(media_file_ids)))
    db.execute(delete(AudioStream).where(AudioStream.media_file_id.in_(media_file_ids)))
    db.execute(delete(MediaChapter).where(MediaChapter.media_file_id.in_(media_file_ids)))
    db.execute(delete(VideoStream).where(VideoStream.media_file_id.in_(media_file_ids)))
    db.execute(delete(MediaFormat).where(MediaFormat.media_file_id.in_(media_file_ids)))
    db.execute(delete(MediaFile).where(MediaFile.library_id == library_id))
    db.execute(delete(ScanJob).where(ScanJob.library_id == library_id))
    db.execute(delete(Library).where(Library.id == library_id))
    db.commit()
    stats_cache.invalidate(cache_key, library_id)
    return True


def library_exists(db: Session, library_id: int) -> bool:
    return db.scalar(select(Library.id).where(Library.id == library_id)) is not None


def _library_aggregate_map(db: Session) -> dict[int, dict[str, int | float]]:
    rows = db.execute(
        select(
            MediaFile.library_id,
            func.count(MediaFile.id),
            func.coalesce(func.sum(MediaFile.size_bytes), 0),
            func.coalesce(func.sum(MediaFormat.duration), 0.0),
            func.sum(case((MediaFile.scan_status == ScanStatus.ready, 1), else_=0)),
            func.sum(case((MediaFile.scan_status != ScanStatus.ready, 1), else_=0)),
        )
        .join(MediaFormat, MediaFormat.media_file_id == MediaFile.id, isouter=True)
        .where(MediaFile.is_transcode_variant.is_(False))
        .group_by(MediaFile.library_id)
    ).all()

    aggregates: dict[int, dict[str, int | float]] = {}
    for library_id, count, size_bytes, duration, ready_files, pending_files in rows:
        aggregates[library_id] = {
            "file_count": count or 0,
            "total_size_bytes": size_bytes or 0,
            "total_duration_seconds": duration or 0.0,
            "ready_files": ready_files or 0,
            "pending_files": pending_files or 0,
        }
    return aggregates


def _library_aggregate(db: Session, library_id: int) -> dict[str, int | float]:
    row = db.execute(
        select(
            func.count(MediaFile.id),
            func.coalesce(func.sum(MediaFile.size_bytes), 0),
            func.coalesce(func.sum(MediaFormat.duration), 0.0),
            func.sum(case((MediaFile.scan_status == ScanStatus.ready, 1), else_=0)),
            func.sum(case((MediaFile.scan_status != ScanStatus.ready, 1), else_=0)),
        )
        .select_from(MediaFile)
        .join(MediaFormat, MediaFormat.media_file_id == MediaFile.id, isouter=True)
        .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
    ).one()

    count, size_bytes, duration, ready_files, pending_files = row
    return {
        "file_count": count or 0,
        "total_size_bytes": size_bytes or 0,
        "total_duration_seconds": duration or 0.0,
        "ready_files": ready_files or 0,
        "pending_files": pending_files or 0,
    }


def list_libraries(db: Session) -> list[LibrarySummary]:
    cache_key = str(id(db.get_bind()))
    cached = stats_cache.get_libraries(cache_key)
    if cached is not None:
        return cached

    libraries = db.scalars(select(Library).order_by(Library.name.asc())).all()
    app_settings = load_app_settings(db)
    ensure_default_quality_profiles(db, app_settings.resolution_categories)
    aggregates = _library_aggregate_map(db)
    jellyfin_libraries_by_library_id = {
        jellyfin_library.linked_library_id: jellyfin_library
        for jellyfin_library in db.scalars(
            select(JellyfinLibrary).where(JellyfinLibrary.linked_library_id.is_not(None))
        )
    }
    result = [
        _library_summary_from_model(
            db,
            library,
            aggregates.get(library.id),
            app_settings.resolution_categories,
            jellyfin_libraries_by_library_id.get(library.id),
        )
        for library in libraries
    ]
    stats_cache.set_libraries(cache_key, result)
    return result


def get_library_summary(db: Session, library_id: int) -> LibrarySummary | None:
    cache_key = str(id(db.get_bind()))
    cached = stats_cache.get_library_summary(cache_key, library_id)
    if cached is not None:
        return cached

    library = db.get(Library, library_id)
    if not library:
        return None

    app_settings = load_app_settings(db)
    ensure_default_quality_profiles(db, app_settings.resolution_categories)
    linked_jellyfin_library = db.scalar(
        select(JellyfinLibrary).where(JellyfinLibrary.linked_library_id == library_id)
    )
    payload = _library_summary_from_model(
        db,
        library,
        _library_aggregate(db, library_id),
        app_settings.resolution_categories,
        linked_jellyfin_library,
    )
    stats_cache.set_library_summary(cache_key, library_id, payload)
    return payload


def get_library_statistics(
    db: Session,
    library_id: int,
    requested_panels: Iterable[str] | None = None,
    *,
    _coalesced: bool = False,
) -> LibraryStatistics | None:
    panel_filter = set(requested_panels) if requested_panels is not None else None
    panel_key = tuple(sorted(panel_filter)) if panel_filter is not None else None
    cache_key = str(id(db.get_bind()))

    library = db.get(Library, library_id)
    if library is None:
        return None

    hidden_panel_ids = (
        _MUSIC_HIDDEN_PANEL_IDS | (_AUDIOBOOK_PANEL_IDS if library.type == "music" else set())
        if library.type in {"music", "audiobooks"}
        else _AUDIOBOOK_PANEL_IDS
    )
    if not _coalesced:
        cached = stats_cache.get_library_statistics(cache_key, library_id, panel_key)
        if cached is not None:
            return cached
        if panel_key is not None:
            complete = stats_cache.get_library_statistics(cache_key, library_id)
            if complete is not None:
                return _statistics_panel_view(complete, panel_filter, hidden_panel_ids)
        return stats_cache.get_or_compute_library_statistics(
            cache_key,
            library_id,
            panel_key,
            lambda: get_library_statistics(
                db,
                library_id,
                panel_filter,
                _coalesced=True,
            ),
        )

    visible_requested_panels = set(_DISTRIBUTION_FIELD_BY_PANEL) | set(_NUMERIC_PANEL_METRIC_IDS)
    if panel_filter is not None:
        visible_requested_panels &= panel_filter
    visible_requested_panels -= hidden_panel_ids

    def wants(panel_id: str) -> bool:
        return panel_id in visible_requested_panels

    app_settings = load_app_settings(db)
    primary_video_streams = (
        primary_video_streams_subquery("library_primary_video_streams")
        if wants("video_codec") or wants("resolution") or wants("hdr_type") or wants("video_bit_depth")
        else None
    )
    container_distribution = (
        [
            DistributionItem(label=label, value=value, filter_value=raw_value)
            for raw_value, value in db.execute(
                select(
                    _normalized_text_expr(MediaFile.extension, "unknown"),
                    func.count(MediaFile.id),
                )
                .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
                .group_by(_normalized_text_expr(MediaFile.extension, "unknown"))
                .order_by(func.count(MediaFile.id).desc(), _normalized_text_expr(MediaFile.extension, "unknown").asc())
            ).all()
            for label in [format_container_label(raw_value)]
            if label
        ]
        if wants("container")
        else []
    )

    video_codec_distribution = (
        db.execute(
            select(
                primary_video_streams.c.codec,
                primary_video_streams.c.bit_depth,
                func.count(primary_video_streams.c.id),
            )
            .join(MediaFile, MediaFile.id == primary_video_streams.c.media_file_id)
            .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
            .group_by(primary_video_streams.c.codec, primary_video_streams.c.bit_depth)
            .order_by(func.count(primary_video_streams.c.id).desc())
        ).all()
        if primary_video_streams is not None and wants("video_codec")
        else []
    )
    resolution_distribution = (
        db.execute(
            select(
                primary_video_streams.c.width,
                primary_video_streams.c.height,
                func.count(primary_video_streams.c.id),
            )
            .join(MediaFile, MediaFile.id == primary_video_streams.c.media_file_id)
            .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
            .group_by(primary_video_streams.c.width, primary_video_streams.c.height)
            .order_by(func.count(primary_video_streams.c.id).desc())
        ).all()
        if primary_video_streams is not None and wants("resolution")
        else []
    )
    hdr_distribution = (
        db.execute(
            select(
                func.coalesce(primary_video_streams.c.hdr_type, "SDR"),
                func.count(primary_video_streams.c.id),
            )
            .join(MediaFile, MediaFile.id == primary_video_streams.c.media_file_id)
            .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
            .group_by(func.coalesce(primary_video_streams.c.hdr_type, "SDR"))
            .order_by(func.count(primary_video_streams.c.id).desc())
        ).all()
        if primary_video_streams is not None and wants("hdr_type")
        else []
    )
    video_bit_depth_distribution = (
        db.execute(
            select(
                primary_video_streams.c.bit_depth,
                func.count(primary_video_streams.c.id),
            )
            .join(MediaFile, MediaFile.id == primary_video_streams.c.media_file_id)
            .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
            .group_by(primary_video_streams.c.bit_depth)
            .order_by(func.count(primary_video_streams.c.id).desc())
        ).all()
        if primary_video_streams is not None and wants("video_bit_depth")
        else []
    )

    audio_language_distribution: list[tuple[str, int]] = []
    if wants("audio_languages"):
        audio_language_values = (
            select(
                AudioStream.media_file_id.label("media_file_id"),
                _normalized_language_expr(AudioStream.language).label("value"),
            )
            .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
            .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
            .distinct()
            .subquery("library_audio_language_values")
        )
        audio_language_distribution = _count_distinct_normalized_languages(
            db.execute(
                select(audio_language_values.c.media_file_id, audio_language_values.c.value)
            ).all(),
            fallback="und",
        )

    audio_codec_distribution = []
    if wants("audio_codecs"):
        audio_codec_values = (
            select(
                AudioStream.media_file_id.label("media_file_id"),
                _normalized_text_expr(AudioStream.codec, "unknown").label("value"),
            )
            .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
            .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
            .distinct()
            .subquery()
        )
        audio_codec_distribution = db.execute(
            select(
                audio_codec_values.c.value,
                func.count(distinct(audio_codec_values.c.media_file_id)),
            )
            .group_by(audio_codec_values.c.value)
            .order_by(func.count(distinct(audio_codec_values.c.media_file_id)).desc())
        ).all()

    bit_depth_distribution = []
    if wants("bit_depth"):
        audio_bit_depth_values = (
            select(
                AudioStream.media_file_id.label("media_file_id"),
                func.max(AudioStream.bit_depth).label("value"),
            )
            .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
            .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
            .where(AudioStream.bit_depth.is_not(None))
            .group_by(AudioStream.media_file_id)
            .subquery("library_audio_bit_depth_values")
        )
        bit_depth_distribution = db.execute(
            select(
                audio_bit_depth_values.c.value,
                func.count(distinct(audio_bit_depth_values.c.media_file_id)),
            )
            .group_by(audio_bit_depth_values.c.value)
            .order_by(func.count(distinct(audio_bit_depth_values.c.media_file_id)).desc())
        ).all()

    def file_distribution(column, *, enabled: bool, fallback: str | None = None):
        if not enabled:
            return []
        expression = _normalized_text_expr(column, fallback or "")
        query = select(expression.label("value"), func.count(MediaFile.id)).where(
            MediaFile.library_id == library_id,
            MediaFile.is_transcode_variant.is_(False),
        )
        if fallback is None:
            query = query.where(func.length(func.trim(func.coalesce(column, ""))) > 0)
        return db.execute(query.group_by(expression).order_by(func.count(MediaFile.id).desc())).all()

    audio_artist_distribution = file_distribution(MediaFile.audio_artist, enabled=wants("audio_artists"))
    audio_album_distribution = file_distribution(MediaFile.audio_album, enabled=wants("audio_albums"))
    audio_genre_distribution = file_distribution(MediaFile.audio_genre, enabled=wants("audio_genres"))
    audio_year_distribution = file_distribution(func.substr(MediaFile.audio_date, 1, 4), enabled=wants("audio_years"))
    track_number_distribution = file_distribution(MediaFile.track_number, enabled=wants("track_numbers"))
    bit_rate_mode_distribution = file_distribution(MediaFile.bit_rate_mode, enabled=wants("bit_rate_modes"))
    audiobook_narrator_distribution = file_distribution(MediaFile.audiobook_narrator, enabled=wants("audiobook_narrators"))
    audiobook_author_distribution = file_distribution(MediaFile.audiobook_author, enabled=wants("audiobook_authors"))
    audiobook_publisher_distribution = file_distribution(MediaFile.audiobook_publisher, enabled=wants("audiobook_publishers"))
    audiobook_series_distribution = file_distribution(MediaFile.audiobook_series, enabled=wants("audiobook_series"))
    audiobook_series_part_distribution = file_distribution(
        MediaFile.audiobook_series_part,
        enabled=wants("audiobook_series_parts"),
    )
    chapter_count_distribution = (
        db.execute(
            select(func.coalesce(MediaFile.chapter_count, 0), func.count(MediaFile.id))
            .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
            .group_by(func.coalesce(MediaFile.chapter_count, 0))
            .order_by(func.count(MediaFile.id).desc())
        ).all()
        if wants("chapter_counts")
        else []
    )
    audio_channel_distribution = (
        db.execute(
            select(MediaFile.audio_channels, func.count(MediaFile.id))
            .where(
                MediaFile.library_id == library_id,
                MediaFile.is_transcode_variant.is_(False),
                MediaFile.audio_channels.is_not(None),
            )
            .group_by(MediaFile.audio_channels)
            .order_by(func.count(MediaFile.id).desc())
        ).all()
        if wants("audio_channels")
        else []
    )
    sample_rate_distribution = (
        db.execute(
            select(MediaFile.sample_rate, func.count(MediaFile.id))
            .where(
                MediaFile.library_id == library_id,
                MediaFile.is_transcode_variant.is_(False),
                MediaFile.sample_rate.is_not(None),
            )
            .group_by(MediaFile.sample_rate)
            .order_by(func.count(MediaFile.id).desc())
        ).all()
        if wants("sample_rates")
        else []
    )
    embedded_cover_distribution = (
        db.execute(
            select(MediaFile.has_embedded_cover, func.count(MediaFile.id))
            .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
            .group_by(MediaFile.has_embedded_cover)
            .order_by(MediaFile.has_embedded_cover.desc())
        ).all()
        if wants("embedded_covers")
        else []
    )

    audio_spatial_profile_distribution = []
    if wants("audio_spatial_profiles"):
        audio_spatial_profile_values = (
            select(
                AudioStream.media_file_id.label("media_file_id"),
                _normalized_text_expr(AudioStream.spatial_audio_profile, "").label("value"),
            )
            .join(MediaFile, MediaFile.id == AudioStream.media_file_id)
            .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
            .where(func.length(func.trim(func.coalesce(AudioStream.spatial_audio_profile, ""))) > 0)
            .distinct()
            .subquery()
        )
        audio_spatial_profile_distribution_rows = db.execute(
            select(
                audio_spatial_profile_values.c.value,
                func.count(distinct(audio_spatial_profile_values.c.media_file_id)),
            )
            .group_by(audio_spatial_profile_values.c.value)
            .order_by(func.count(distinct(audio_spatial_profile_values.c.media_file_id)).desc())
        ).all()
        audio_spatial_profile_distribution = [
            DistributionItem(label=label, value=value)
            for raw_label, value in audio_spatial_profile_distribution_rows
            if value > 0
            for label in [format_spatial_audio_profile(raw_label)]
            if label
        ]

    subtitle_counts: dict[str, int] = {}
    if wants("subtitle_languages"):
        subtitle_language_values = union_all(
            select(
                SubtitleStream.media_file_id.label("media_file_id"),
                _normalized_language_expr(SubtitleStream.language).label("value"),
            ),
            select(
                ExternalSubtitle.media_file_id.label("media_file_id"),
                _normalized_language_expr(ExternalSubtitle.language).label("value"),
            ),
        ).subquery("library_subtitle_language_values")
        subtitle_counts = dict(
            _count_distinct_normalized_languages(
                db.execute(
                    select(subtitle_language_values.c.media_file_id, subtitle_language_values.c.value)
                    .join(MediaFile, MediaFile.id == subtitle_language_values.c.media_file_id)
                    .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
                ).all(),
                fallback="und",
            )
        )

    subtitle_codec_counts: dict[str, int] = {}
    if wants("subtitle_codecs"):
        subtitle_codec_values = union_all(
            select(
                SubtitleStream.media_file_id.label("media_file_id"),
                _normalized_text_expr(SubtitleStream.codec, "unknown").label("value"),
            ),
            select(
                ExternalSubtitle.media_file_id.label("media_file_id"),
                _normalized_text_expr(ExternalSubtitle.format, "unknown").label("value"),
            ),
        ).subquery("library_subtitle_codec_values")
        subtitle_codec_counts = dict(
            db.execute(
                select(
                    subtitle_codec_values.c.value,
                    func.count(distinct(subtitle_codec_values.c.media_file_id)),
                )
                .join(MediaFile, MediaFile.id == subtitle_codec_values.c.media_file_id)
                .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
                .group_by(subtitle_codec_values.c.value)
                .order_by(func.count(distinct(subtitle_codec_values.c.media_file_id)).desc())
            ).all()
        )

    subtitle_source_distribution = []
    if wants("subtitle_sources"):
        subtitle_source_values = union_all(
            select(SubtitleStream.media_file_id.label("media_file_id"), literal("internal").label("value")),
            select(ExternalSubtitle.media_file_id.label("media_file_id"), literal("external").label("value")),
        ).subquery("library_subtitle_source_values")
        subtitle_source_distinct_values = (
            select(
                subtitle_source_values.c.media_file_id,
                subtitle_source_values.c.value,
            )
            .join(MediaFile, MediaFile.id == subtitle_source_values.c.media_file_id)
            .where(MediaFile.library_id == library_id, MediaFile.is_transcode_variant.is_(False))
            .distinct()
            .subquery("library_subtitle_source_distinct_values")
        )
        subtitle_source_distribution = _distribution_items(
            db.execute(
                select(
                    subtitle_source_distinct_values.c.value,
                    func.count(distinct(subtitle_source_distinct_values.c.media_file_id)),
                )
                .group_by(subtitle_source_distinct_values.c.value)
                .order_by(func.count(distinct(subtitle_source_distinct_values.c.media_file_id)).desc())
            ).all()
        )

    user_play_count_distribution = []
    linked_jellyfin_library_id = (
        db.scalar(
            select(JellyfinLibrary.id).where(
                JellyfinLibrary.linked_library_id == library_id
            )
        )
        if wants("user_plays")
        else None
    )
    if linked_jellyfin_library_id is not None:
        user_play_count_distribution = _distribution_items(
            db.execute(
                select(
                    JellyfinUser.name,
                    func.sum(JellyfinUserItemData.play_count).label("play_count"),
                )
                .select_from(JellyfinUser)
                .join(
                    JellyfinUserItemData,
                    JellyfinUserItemData.jellyfin_user_id == JellyfinUser.jellyfin_user_id,
                )
                .join(
                    JellyfinItem,
                    JellyfinItem.id == JellyfinUserItemData.jellyfin_item_id,
                )
                .where(
                    JellyfinUser.enabled_for_sync.is_(True),
                    JellyfinItem.library_id == linked_jellyfin_library_id,
                    JellyfinUserItemData.play_count > 0,
                )
                .group_by(JellyfinUser.jellyfin_user_id, JellyfinUser.name)
                .order_by(
                    func.sum(JellyfinUserItemData.play_count).desc(),
                    JellyfinUser.name.asc(),
                )
            ).all()
        )

    numeric_distributions = build_numeric_distributions(
        db,
        library_id=library_id,
        metric_ids={
            metric_id
            for panel_id, metric_id in _NUMERIC_PANEL_METRIC_IDS.items()
            if panel_id in visible_requested_panels
        },
    )

    payload = LibraryStatistics(
        container_distribution=container_distribution,
        video_codec_distribution=build_video_codec_distribution(video_codec_distribution),
        resolution_distribution=_group_resolution_distribution(
            resolution_distribution,
            resolution_categories=app_settings.resolution_categories,
        ),
        hdr_distribution=_distribution_items(hdr_distribution, fallback="SDR"),
        video_bit_depth_distribution=[
            DistributionItem(
                label=f"{label}-bit" if label is not None else "unknown",
                value=value,
                filter_value=str(label) if label is not None else None,
            )
            for label, value in video_bit_depth_distribution
            if value > 0
        ],
        bit_depth_distribution=[
            DistributionItem(label=f"{label}-bit", value=value, filter_value=str(label))
            for label, value in bit_depth_distribution
            if label is not None and value > 0
        ],
        audio_artist_distribution=_distribution_items(audio_artist_distribution),
        audio_album_distribution=_distribution_items(audio_album_distribution),
        audio_genre_distribution=_distribution_items(audio_genre_distribution),
        audio_year_distribution=_distribution_items(audio_year_distribution),
        audio_channel_distribution=[
            DistributionItem(label=str(label), value=value, filter_value=str(label))
            for label, value in audio_channel_distribution
        ],
        sample_rate_distribution=[
            DistributionItem(label=f"{label} Hz", value=value, filter_value=str(label))
            for label, value in sample_rate_distribution
        ],
        track_number_distribution=_distribution_items(track_number_distribution),
        bit_rate_mode_distribution=_distribution_items(bit_rate_mode_distribution),
        embedded_cover_distribution=[
            DistributionItem(label="yes" if label else "no", value=value, filter_value="yes" if label else "no")
            for label, value in embedded_cover_distribution
        ],
        audiobook_narrator_distribution=_distribution_items(audiobook_narrator_distribution),
        audiobook_author_distribution=_distribution_items(audiobook_author_distribution),
        audiobook_publisher_distribution=_distribution_items(audiobook_publisher_distribution),
        audiobook_series_distribution=_distribution_items(audiobook_series_distribution),
        audiobook_series_part_distribution=_distribution_items(audiobook_series_part_distribution),
        chapter_count_distribution=[
            DistributionItem(label=str(label), value=value, filter_value=str(label))
            for label, value in chapter_count_distribution
            if label is not None
        ],
        audio_codec_distribution=_distribution_items(audio_codec_distribution),
        audio_spatial_profile_distribution=audio_spatial_profile_distribution,
        audio_language_distribution=[
            DistributionItem(label=key, value=value)
            for key, value in audio_language_distribution
        ],
        subtitle_language_distribution=[
            DistributionItem(label=key, value=value)
            for key, value in _sorted_count_items(subtitle_counts)
        ],
        subtitle_codec_distribution=[
            DistributionItem(label=key, value=value)
            for key, value in _sorted_count_items(subtitle_codec_counts)
        ],
        subtitle_source_distribution=subtitle_source_distribution,
        user_play_count_distribution=user_play_count_distribution,
        numeric_distributions=numeric_distributions,
    )
    return _statistics_panel_view(payload, panel_filter, hidden_panel_ids)
