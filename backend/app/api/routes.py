import io
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from backend.app.api.deps import get_app_settings, get_db_session, get_scan_runtime
from backend.app.core.config import Settings
from backend.app.schemas.app_settings import AppSettingsRead, AppSettingsUpdate
from backend.app.schemas.browse import BrowseResponse
from backend.app.schemas.comparison import ComparisonFieldId, ComparisonRendererId, ComparisonResponse
from backend.app.schemas.compatibility import (
    CompatibilityEvaluateRequest,
    CompatibilityEvaluation,
    CompatibilityProfile,
    HardwareProfile,
    ProfileEvaluation,
    SoftwareProfile,
)
from backend.app.schemas.connectors import (
    ConnectorBindingBatchUpdate,
    ConnectorBindingRead,
    ConnectorConnectionCreate,
    ConnectorConnectionRead,
    ConnectorConnectionUpdate,
    ConnectorItemPageRead,
    ConnectorItemRead,
    ConnectorLibraryRead,
    ConnectorLibraryLinkBatchUpdate,
    ConnectorLocationRead,
    ConnectorMappingOverviewRead,
    ConnectorPlaybackEventRead,
    ConnectorPlaybackSourceRead,
    ConnectorPlaybackUserDataRead,
    ConnectorSyncCancelRead,
    ConnectorSyncJobRead,
    ConnectorSyncStartRead,
    ConnectorTestRead,
    ConnectorTestRequest,
    ConnectorUserRead,
    ConnectorUsersUpdate,
    FileConnectorSourceRead,
)
from backend.app.schemas.duplicates import (
    DuplicateGroupPageRead,
    DuplicateSuppressionCreate,
    DuplicateSuppressionRead,
)
from backend.app.schemas.history import HistoryReconstructionStatusRead, HistoryStorageRead
from backend.app.schemas.library import LibraryCreate, LibraryStatistics, LibrarySummary, LibraryUpdate
from backend.app.schemas.jellyfin import (
    JellyfinConnectionRead,
    JellyfinConnectionUpdate,
    JellyfinCatalogSummaryRead,
    JellyfinFileOverlayRead,
    JellyfinItemDetailRead,
    JellyfinItemRead,
    JellyfinLibraryItemPageRead,
    JellyfinLibraryLinkUpdate,
    JellyfinLibraryOverviewRead,
    JellyfinLibraryRead,
    JellyfinMatchRecomputeStatusRead,
    JellyfinMatchRead,
    JellyfinPathMappingCreate,
    JellyfinPathMappingBatchUpdate,
    JellyfinPathMappingRead,
    JellyfinPathMappingUpdate,
    JellyfinPlaybackEventRead,
    JellyfinSyncCancelRead,
    JellyfinSyncStartRead,
    JellyfinSyncStatusRead,
    JellyfinTestRead,
    JellyfinTestRequest,
    JellyfinUnmatchedRead,
    JellyfinUserItemDataRead,
    JellyfinUserRead,
    JellyfinUsersUpdate,
)
from backend.app.schemas.library_history import DashboardHistoryResponse, LibraryHistoryResponse
from backend.app.schemas.media import (
    DashboardResponse,
    GroupedMediaTablePageRead,
    MediaFileDetail,
    MediaFileRawProbeRead,
    MediaFileHistoryRead,
    MediaFileQualityScoreDetail,
    MediaFileSearchResponse,
    MediaSeriesGroupedDetailRead,
    MediaSeriesDetailRead,
    MediaSeriesSummaryRead,
    MediaFileStreamDetails,
    MediaFileTablePage,
)
from backend.app.schemas.path_access import PathInspectRequest, PathInspectResponse
from backend.app.schemas.quality_profiles import QualityProfileCreate, QualityProfileRead, QualityProfileUpdate
from backend.app.schemas.scan import (
    RecentScanJobPageRead,
    ScanCancelResponse,
    ScanJobDetailRead,
    ScanJobRead,
    ScanRequest,
)
from backend.app.schemas.storage_map import LibraryStorageMapRead
from backend.app.schemas.transcoding import (
    FileTranscodeRead,
    TranscodeCapabilityMatrixRead,
    TranscodeCapabilitiesRead,
    TranscodeJobPageRead,
    TranscodeJobRead,
    TranscodePlan,
    TranscodeValidationRead,
)
from backend.app.schemas.update_status import (
    DesktopUpdateReminderMark,
    DesktopUpdateReminderRead,
    UpdateStatusRead,
)
from backend.app.models.entities import (
    ConnectorConnection,
    ConnectorItem,
    ConnectorLibrary,
    ConnectorLibraryLink,
    ConnectorLibraryLocation,
    ConnectorMediaMatch,
    ConnectorPlaybackEvent,
    ConnectorRootBinding,
    ConnectorSyncJob,
    ConnectorUser,
    ConnectorUserItemData,
    DuplicateDetectionMode,
    JellyfinConnection,
    JellyfinItem,
    JellyfinLibrary,
    JellyfinSyncJob,
    JellyfinMediaMatch,
    JellyfinPathMapping,
    JellyfinPlaybackEvent,
    JellyfinUser,
    JellyfinUserItemData,
    JobStatus,
    Library,
    LibraryType,
    MediaFile,
    ScanJob,
    ScanTriggerSource,
    TranscodeJob,
)
from backend.app.services.connector_credentials import read_connector_secret
from backend.app.services.connector_registry import connector_registry
from backend.app.services.connector_security import (
    public_connector_payload,
    redact_connector_error,
)
from backend.app.services.connector_service import (
    create_connector_connection,
    delete_connector_connection,
    list_connector_libraries,
    mirror_legacy_jellyfin_connection,
    is_legacy_default_connection,
    replace_connector_bindings,
    replace_connector_library_links,
    serialize_connector_connection,
    update_connector_connection,
    update_legacy_default_connection,
)
from backend.app.services.connector_mapping import get_connector_mapping_overview
from backend.app.services.app_settings import get_app_settings as load_app_settings
from backend.app.services.app_settings import update_app_settings
from backend.app.services.browse import browse_media_root
from backend.app.services.compatibility import (
    evaluate_compatibility,
    evaluate_hardware_profile,
    evaluate_software_profile,
)
from backend.app.services.compatibility_profiles import (
    ProfileCatalogError,
    create_local_profile,
    delete_local_profile,
    get_profile,
    list_profiles,
    update_local_profile,
)
from backend.app.services.duplicates import (
    list_library_duplicate_groups,
    suppress_duplicate_group,
    unsuppress_duplicate_group,
)
from backend.app.services.history_storage import get_cached_history_storage
from backend.app.services.history_retention import has_active_scan_jobs
from backend.app.services.library_history_service import get_dashboard_history, get_library_history
from backend.app.services.library_service import (
    create_library,
    delete_library,
    get_library_statistics,
    get_library_summary,
    library_exists,
    list_libraries,
    update_library_settings,
)
from backend.app.services.jellyfin_client import JellyfinClient, JellyfinError
from backend.app.services.jellyfin_catalog import (
    catalog_summary as get_jellyfin_catalog_summary,
    library_items as get_jellyfin_library_items,
    library_overview as get_jellyfin_library_overview,
    library_read as get_jellyfin_library_read,
    item_duration as get_jellyfin_item_duration,
    item_size as get_jellyfin_item_size,
)
from backend.app.services.jellyfin_images import JELLYFIN_IMAGE_CACHE
from backend.app.services.jellyfin_credentials import read_jellyfin_api_key
from backend.app.services.jellyfin_jobs import (
    get_active_jellyfin_sync_job,
    get_latest_jellyfin_sync_job,
)
from backend.app.services.jellyfin_progress import get_jellyfin_progress
from backend.app.services.jellyfin_sync import get_or_create_jellyfin_connection
from backend.app.services.media_search import LibraryFileSearchFilters, SearchValidationError
from backend.app.services.media_service import (
    generate_media_chapters_csv_export,
    generate_media_cover_png,
    generate_library_files_csv_export,
    get_media_file_detail,
    get_media_file_history,
    get_media_file_raw_ffprobe,
    get_media_file_source,
    get_media_file_quality_score_detail,
    get_media_file_stream_details,
    get_grouped_library_series_detail,
    get_library_series_detail,
    list_grouped_library_files,
    list_library_series,
    list_library_files,
    search_media_files,
)
from backend.app.services.transcoding import (
    TranscodeValidationError,
    get_file_transcode,
    get_transcode_capabilities,
    list_transcode_jobs,
    serialize_transcode_job,
    validate_transcode_plan,
)
from backend.app.services.transcode_matrix import (
    TranscodeMatrixBusyError,
    load_transcode_matrix,
    run_transcode_matrix_test,
)
from backend.app.services.path_access import inspect_desktop_path
from backend.app.services.quality_profiles import (
    create_quality_profile,
    delete_quality_profile,
    ensure_default_quality_profiles,
    list_quality_profiles,
    update_quality_profile,
)
from backend.app.services.runtime import ScanCancelPersistenceError, ScanRuntimeManager
from backend.app.services.scan_jobs import (
    get_scan_job_detail,
    list_active_scan_jobs,
    list_library_scan_jobs,
    list_recent_scan_jobs,
    serialize_scan_job,
)
from backend.app.services.stat_comparisons import get_dashboard_comparison, get_library_comparison
from backend.app.services.stats import build_dashboard
from backend.app.services.stats_cache import stats_cache
from backend.app.services.storage_map import StorageMapPathError, get_library_storage_map
from backend.app.services.telemetry import build_telemetry_payload, send_current_telemetry_snapshot
from backend.app.services.update_status import (
    get_desktop_update_reminder,
    get_or_check_update_status,
    mark_desktop_update_reminder,
)

router = APIRouter()


def _profile_error(exc: ProfileCatalogError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


def _normalize_panel_query(panels: list[str] | None) -> list[str] | None:
    if panels is None:
        return None
    normalized: list[str] = []
    for entry in panels:
        for panel_id in entry.split(","):
            candidate = panel_id.strip()
            if candidate and candidate not in normalized:
                normalized.append(candidate)
    return normalized


def _library_file_search_filters(
    *,
    file_search: str = "",
    search_container: str = "",
    search_size: str = "",
    search_quality_score: str = "",
    search_bitrate: str = "",
    search_audio_bitrate: str = "",
    search_bit_depth: str = "",
    search_video_codec: str = "",
    search_resolution: str = "",
    search_hdr_type: str = "",
    search_duration: str = "",
    search_audio_codecs: str = "",
    search_audio_spatial_profiles: str = "",
    search_audio_languages: str = "",
    search_jellyfin_name: str = "",
    search_audio_title: str = "",
    search_audio_artist: str = "",
    search_audio_album: str = "",
    search_audio_album_artist: str = "",
    search_audio_genre: str = "",
    search_audio_date: str = "",
    search_audio_disc: str = "",
    search_audio_composer: str = "",
    search_audio_channels: str = "",
    search_sample_rate: str = "",
    search_track_number: str = "",
    search_bit_rate_mode: str = "",
    search_has_embedded_cover: str = "",
    search_chapter_count: str = "",
    search_chapter_titles: str = "",
    search_audiobook_narrator: str = "",
    search_audiobook_author: str = "",
    search_audiobook_publisher: str = "",
    search_audiobook_series: str = "",
    search_audiobook_series_part: str = "",
    search_audiobook_description: str = "",
    search_audiobook_copyright: str = "",
    search_audiobook_asin: str = "",
    search_audiobook_isbn: str = "",
    search_audiobook_language: str = "",
    search_audiobook_abridged: str = "",
    search_subtitle_languages: str = "",
    search_subtitle_codecs: str = "",
    search_subtitle_sources: str = "",
) -> LibraryFileSearchFilters:
    return LibraryFileSearchFilters(
        file_search=file_search,
        search_container=search_container,
        search_size=search_size,
        search_quality_score=search_quality_score,
        search_bitrate=search_bitrate,
        search_audio_bitrate=search_audio_bitrate,
        search_bit_depth=search_bit_depth,
        search_video_codec=search_video_codec,
        search_resolution=search_resolution,
        search_hdr_type=search_hdr_type,
        search_duration=search_duration,
        search_audio_codecs=search_audio_codecs,
        search_audio_spatial_profiles=search_audio_spatial_profiles,
        search_audio_languages=search_audio_languages,
        search_jellyfin_name=search_jellyfin_name,
        search_audio_title=search_audio_title,
        search_audio_artist=search_audio_artist,
        search_audio_album=search_audio_album,
        search_audio_album_artist=search_audio_album_artist,
        search_audio_genre=search_audio_genre,
        search_audio_date=search_audio_date,
        search_audio_disc=search_audio_disc,
        search_audio_composer=search_audio_composer,
        search_audio_channels=search_audio_channels,
        search_sample_rate=search_sample_rate,
        search_track_number=search_track_number,
        search_bit_rate_mode=search_bit_rate_mode,
        search_has_embedded_cover=search_has_embedded_cover,
        search_chapter_count=search_chapter_count,
        search_chapter_titles=search_chapter_titles,
        search_audiobook_narrator=search_audiobook_narrator,
        search_audiobook_author=search_audiobook_author,
        search_audiobook_publisher=search_audiobook_publisher,
        search_audiobook_series=search_audiobook_series,
        search_audiobook_series_part=search_audiobook_series_part,
        search_audiobook_description=search_audiobook_description,
        search_audiobook_copyright=search_audiobook_copyright,
        search_audiobook_asin=search_audiobook_asin,
        search_audiobook_isbn=search_audiobook_isbn,
        search_audiobook_language=search_audiobook_language,
        search_audiobook_abridged=search_audiobook_abridged,
        search_subtitle_languages=search_subtitle_languages,
        search_subtitle_codecs=search_subtitle_codecs,
        search_subtitle_sources=search_subtitle_sources,
    )


def _library_has_active_scan_job(db: Session, library_id: int) -> bool:
    return (
        db.scalar(
            select(ScanJob.id)
            .where(
                ScanJob.library_id == library_id,
                ScanJob.status.in_([JobStatus.queued, JobStatus.running]),
            )
            .limit(1)
        )
        is not None
    )


@router.get("/health")
def health(settings: Settings = Depends(get_app_settings)) -> dict[str, str]:
    return {"status": "ok", "version": settings.app_version}


@router.get("/browse", response_model=BrowseResponse)
def browse(
    path: str = Query(default="."),
    settings: Settings = Depends(get_app_settings),
) -> BrowseResponse:
    try:
        return browse_media_root(settings, path)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/paths/inspect", response_model=PathInspectResponse)
def inspect_path(
    payload: PathInspectRequest,
    settings: Settings = Depends(get_app_settings),
) -> PathInspectResponse:
    if not settings.is_desktop:
        raise HTTPException(status_code=404, detail="Path inspection is only available in desktop mode")
    try:
        return inspect_desktop_path(payload.path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/dashboard", response_model=DashboardResponse)
def dashboard(
    panels: list[str] | None = Query(default=None),
    db: Session = Depends(get_db_session),
) -> DashboardResponse:
    return build_dashboard(db, requested_panels=_normalize_panel_query(panels))


@router.get("/dashboard/history", response_model=DashboardHistoryResponse)
def dashboard_history(db: Session = Depends(get_db_session)) -> DashboardHistoryResponse:
    return get_dashboard_history(db)


@router.get("/dashboard/comparison", response_model=ComparisonResponse)
def dashboard_comparison(
    x_field: ComparisonFieldId = Query(...),
    y_field: ComparisonFieldId = Query(...),
    renderer: ComparisonRendererId | None = Query(default=None),
    db: Session = Depends(get_db_session),
) -> ComparisonResponse:
    if x_field == y_field:
        raise HTTPException(status_code=400, detail="Comparison axes must use different fields")
    return get_dashboard_comparison(db, x_field=x_field, y_field=y_field, renderer=renderer)


@router.get("/scan-jobs/active", response_model=list[ScanJobRead])
def active_scan_jobs(db: Session = Depends(get_db_session)) -> list[ScanJobRead]:
    return list_active_scan_jobs(db)


@router.get("/scan-jobs/recent", response_model=RecentScanJobPageRead)
def recent_scan_jobs(
    limit: int = Query(default=20, ge=1, le=200),
    since_hours: int | None = Query(default=None, ge=1, le=168),
    before_finished_at: datetime | None = Query(default=None),
    before_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db_session),
) -> RecentScanJobPageRead:
    return list_recent_scan_jobs(
        db,
        limit,
        since_hours=since_hours,
        before_finished_at=before_finished_at,
        before_id=before_id,
    )


@router.get("/history-storage", response_model=HistoryStorageRead)
def history_storage(
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> HistoryStorageRead:
    return get_cached_history_storage(db, settings)


@router.get("/history/reconstruct", response_model=HistoryReconstructionStatusRead)
def history_reconstruct_status(
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> HistoryReconstructionStatusRead:
    return runtime.get_history_reconstruction_status()


@router.post("/history/reconstruct", response_model=HistoryReconstructionStatusRead)
def history_reconstruct(
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
    db: Session = Depends(get_db_session),
) -> HistoryReconstructionStatusRead:
    if has_active_scan_jobs(db):
        raise HTTPException(status_code=409, detail="Wait until active scans finish before reconstructing history")
    return runtime.request_history_reconstruction()


@router.get("/scan-jobs/{job_id}", response_model=ScanJobDetailRead)
def scan_job_detail(job_id: int, db: Session = Depends(get_db_session)) -> ScanJobDetailRead:
    payload = get_scan_job_detail(db, job_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Scan job not found")
    return payload


@router.get("/app-settings", response_model=AppSettingsRead)
def app_settings(
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> AppSettingsRead:
    return load_app_settings(db, settings)


@router.get("/update-status", response_model=UpdateStatusRead)
def update_status(
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> UpdateStatusRead:
    return get_or_check_update_status(db, settings)


@router.get("/desktop/update-reminder", response_model=DesktopUpdateReminderRead)
def desktop_update_reminder(
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> DesktopUpdateReminderRead:
    if not settings.is_desktop:
        raise HTTPException(status_code=404, detail="Update reminders are only available in desktop mode")
    return get_desktop_update_reminder(db)


@router.post("/desktop/update-reminder/mark", response_model=DesktopUpdateReminderRead)
def mark_desktop_update_reminder_route(
    payload: DesktopUpdateReminderMark,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> DesktopUpdateReminderRead:
    if not settings.is_desktop:
        raise HTTPException(status_code=404, detail="Update reminders are only available in desktop mode")
    try:
        return mark_desktop_update_reminder(db, settings, payload.version)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/telemetry/preview")
def telemetry_preview(
    mode: Literal["none", "minimal", "enabled"] = Query(default="minimal"),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    app_settings_payload = load_app_settings(db, settings)
    installation_id = app_settings_payload.telemetry.installation_id
    return {
        "payload": build_telemetry_payload(
            db,
            settings,
            app_settings_payload,
            mode=mode,
            installation_id=installation_id or "00000000-0000-0000-0000-000000000000",
        ),
        "redacted": installation_id is None,
        "mode": mode,
    }


@router.post("/telemetry/send-now", response_model=AppSettingsRead)
def telemetry_send_now(
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> AppSettingsRead:
    app_settings_payload = load_app_settings(db, settings)
    if (
        app_settings_payload.telemetry.environment_disabled
        or app_settings_payload.telemetry.mode not in {"minimal", "enabled"}
    ):
        raise HTTPException(status_code=409, detail="Telemetry is not enabled.")
    send_current_telemetry_snapshot(db, settings, force=True)
    return load_app_settings(db, settings)


@router.patch("/app-settings", response_model=AppSettingsRead)
def app_settings_update(
    payload: AppSettingsUpdate,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> AppSettingsRead:
    current_settings = load_app_settings(db, settings)
    try:
        updated_settings, recompute_library_ids = update_app_settings(db, payload, settings, include_effects=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    runtime.refresh_worker_settings()
    if updated_settings.history_retention != current_settings.history_retention:
        runtime.run_history_retention()
    if (
        payload.telemetry is not None
        and payload.telemetry.mode in {"minimal", "enabled"}
        and updated_settings.telemetry.mode in {"minimal", "enabled"}
    ):
        runtime.schedule_telemetry_send_after_settings_change()
    elif payload.telemetry is not None and payload.telemetry.mode == "off":
        runtime.cancel_pending_telemetry_send()
    for library_id in recompute_library_ids:
        runtime.request_quality_recompute(library_id)
    return updated_settings


@router.get("/quality-profiles", response_model=list[QualityProfileRead])
def quality_profiles_list(
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> list[QualityProfileRead]:
    app_settings_payload = load_app_settings(db, settings)
    ensure_default_quality_profiles(db, app_settings_payload.resolution_categories)
    db.commit()
    return list_quality_profiles(db)


@router.post("/quality-profiles", response_model=QualityProfileRead)
def quality_profile_create(
    payload: QualityProfileCreate,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> QualityProfileRead:
    app_settings_payload = load_app_settings(db, settings)
    try:
        profile, recompute_library_ids = create_quality_profile(db, payload, app_settings_payload.resolution_categories)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    for library_id in recompute_library_ids:
        runtime.request_quality_recompute(library_id)
    return QualityProfileRead.model_validate(profile)


@router.patch("/quality-profiles/{profile_id}", response_model=QualityProfileRead)
def quality_profile_update(
    profile_id: int,
    payload: QualityProfileUpdate,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> QualityProfileRead:
    app_settings_payload = load_app_settings(db, settings)
    try:
        profile, recompute_library_ids = update_quality_profile(
            db,
            profile_id,
            payload,
            app_settings_payload.resolution_categories,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if profile is None:
        raise HTTPException(status_code=404, detail="Quality profile not found")
    for library_id in recompute_library_ids:
        runtime.request_quality_recompute(library_id)
    return QualityProfileRead.model_validate(profile)


@router.delete("/quality-profiles/{profile_id}", status_code=204)
def quality_profile_delete(
    profile_id: int,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> None:
    try:
        deleted, recompute_library_ids = delete_quality_profile(db, profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Quality profile not found")
    for library_id in recompute_library_ids:
        runtime.request_quality_recompute(library_id)


@router.post("/scan-jobs/active/cancel", response_model=ScanCancelResponse)
def cancel_active_scan_jobs(
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> ScanCancelResponse:
    try:
        canceled_ids = runtime.cancel_active_jobs()
    except ScanCancelPersistenceError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Scan cancellation was requested for {len(exc.canceled_job_ids)} active job(s), "
                "but the database is still busy. Try again shortly."
            ),
        ) from exc
    return ScanCancelResponse(canceled_jobs=len(canceled_ids))


def _clear_jellyfin_connection_state(
    db: Session,
    generic_connection: ConnectorConnection | None,
) -> None:
    db.execute(delete(JellyfinMediaMatch))
    db.execute(delete(JellyfinUserItemData))
    db.execute(delete(JellyfinItem))
    db.execute(delete(JellyfinLibrary))
    db.execute(delete(JellyfinPathMapping))
    db.execute(delete(JellyfinUser))
    legacy = db.get(JellyfinConnection, 1)
    if legacy is not None:
        legacy.base_url = ""
        legacy.api_key = ""
        legacy.enabled = False
        legacy.server_name = None
        legacy.server_version = None
        legacy.last_status = "never"
        legacy.last_error = None
        legacy.last_sync_started_at = None
        legacy.last_sync_finished_at = None
        legacy.last_successful_sync_at = None
    if generic_connection is not None:
        delete_connector_connection(db, generic_connection, commit=False)
    db.commit()
    stats_cache.invalidate(str(id(db.get_bind())))


@router.get("/connectors/providers", response_model=list[str])
def connector_providers() -> list[str]:
    return list(connector_registry.providers())


@router.get("/connectors/provider-descriptors", response_model=list[dict])
def connector_provider_descriptors() -> list[dict]:
    return [
        {
            "provider": descriptor.provider,
            "configuration_fields": [
                {
                    "key": field.key,
                    "input_type": field.input_type,
                    "required": field.required,
                    "secret": field.secret,
                }
                for field in descriptor.configuration_fields
            ],
            "optional_capabilities": list(descriptor.optional_capabilities),
        }
        for descriptor in connector_registry.descriptors()
    ]


@router.get("/connectors", response_model=list[ConnectorConnectionRead])
def connector_connections(db: Session = Depends(get_db_session)) -> list[ConnectorConnectionRead]:
    return [
        serialize_connector_connection(db, connection)
        for connection in db.scalars(
            select(ConnectorConnection).order_by(
                ConnectorConnection.provider, ConnectorConnection.name, ConnectorConnection.id
            )
        )
    ]


@router.post("/connectors", response_model=ConnectorConnectionRead, status_code=201)
def connector_connection_create(
    payload: ConnectorConnectionCreate,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> ConnectorConnectionRead:
    try:
        connection = create_connector_connection(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    refresh_connector_schedules = getattr(runtime, "refresh_connector_schedules", None)
    if callable(refresh_connector_schedules):
        refresh_connector_schedules()
    return serialize_connector_connection(db, connection)


@router.get("/connectors/{connection_id}", response_model=ConnectorConnectionRead)
def connector_connection_get(
    connection_id: int,
    db: Session = Depends(get_db_session),
) -> ConnectorConnectionRead:
    connection = db.get(ConnectorConnection, connection_id)
    if connection is None:
        raise HTTPException(status_code=404, detail="Connector connection not found")
    return serialize_connector_connection(db, connection)


@router.patch("/connectors/{connection_id}", response_model=ConnectorConnectionRead)
def connector_connection_update(
    connection_id: int,
    payload: ConnectorConnectionUpdate,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
    settings: Settings = Depends(get_app_settings),
) -> ConnectorConnectionRead:
    connection = db.get(ConnectorConnection, connection_id)
    if connection is None:
        raise HTTPException(status_code=404, detail="Connector connection not found")
    previous_path_mode = connection.path_mapping_mode
    previous_library_mode = connection.library_mapping_mode
    try:
        if is_legacy_default_connection(connection):
            legacy = get_or_create_jellyfin_connection(db)
            update_legacy_default_connection(
                db,
                connection,
                legacy,
                payload,
                external_secret_available=bool(
                    settings.jellyfin_api_key_file
                    and settings.jellyfin_api_key_file.exists()
                ),
            )
            runtime.refresh_jellyfin_schedule()
        else:
            update_connector_connection(db, connection, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    refresh_connector_schedules = getattr(runtime, "refresh_connector_schedules", None)
    if callable(refresh_connector_schedules):
        refresh_connector_schedules()
    if (
        connection.path_mapping_mode != previous_path_mode
        or connection.library_mapping_mode != previous_library_mode
    ):
        request_recompute = getattr(runtime, "request_connector_recompute", None)
        if callable(request_recompute):
            request_recompute(
                connection_id,
                trigger_source="mapping_mode_changed",
            )
    return serialize_connector_connection(db, connection)


@router.delete("/connectors/{connection_id}", status_code=204)
def connector_connection_delete(
    connection_id: int,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> Response:
    connection = db.get(ConnectorConnection, connection_id)
    if connection is None:
        raise HTTPException(status_code=404, detail="Connector connection not found")
    active = db.scalar(
        select(ConnectorSyncJob.id).where(
            ConnectorSyncJob.connection_id == connection_id,
            ConnectorSyncJob.status.in_([JobStatus.queued, JobStatus.running]),
        )
    )
    if active is not None:
        raise HTTPException(status_code=409, detail="Cancel the active connector sync before deletion")
    if is_legacy_default_connection(connection) and get_active_jellyfin_sync_job(db) is not None:
        raise HTTPException(status_code=409, detail="Cancel the active Jellyfin sync before deletion")
    if is_legacy_default_connection(connection):
        _clear_jellyfin_connection_state(db, connection)
        JELLYFIN_IMAGE_CACHE.clear()
        runtime.refresh_jellyfin_schedule()
    else:
        delete_connector_connection(db, connection)
    refresh_connector_schedules = getattr(runtime, "refresh_connector_schedules", None)
    if callable(refresh_connector_schedules):
        refresh_connector_schedules()
    return Response(status_code=204)


@router.post("/connectors/{connection_id}/test", response_model=ConnectorTestRead)
def connector_connection_test(
    connection_id: int,
    payload: ConnectorTestRequest,
    db: Session = Depends(get_db_session),
) -> ConnectorTestRead:
    stored = db.get(ConnectorConnection, connection_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="Connector connection not found")
    secret = payload.secret if payload.secret is not None else read_connector_secret(db, connection_id)
    candidate = ConnectorConnection(
        id=stored.id,
        provider=stored.provider,
        name=stored.name,
        base_url=payload.base_url if payload.base_url is not None else stored.base_url,
        config=stored.config,
    )
    try:
        with connector_registry.create(candidate, secret) as adapter:
            info = adapter.test_connection()
        return ConnectorTestRead(
            success=True,
            server_name=info.name,
            server_version=info.version,
        )
    except Exception as exc:
        return ConnectorTestRead(
            success=False,
            error=redact_connector_error(exc, secrets=(secret,)),
        )


@router.post(
    "/connectors/{connection_id}/sync",
    response_model=ConnectorSyncStartRead,
    status_code=202,
)
def connector_sync_start(
    connection_id: int,
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> ConnectorSyncStartRead:
    try:
        return ConnectorSyncStartRead.model_validate(
            runtime.request_connector_sync(connection_id)
        )
    except ValueError as exc:
        status_code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.post("/connectors/{connection_id}/sync/cancel", response_model=ConnectorSyncCancelRead)
def connector_sync_cancel(
    connection_id: int,
    job_id: int | None = Query(default=None, ge=1),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> ConnectorSyncCancelRead:
    return ConnectorSyncCancelRead.model_validate(
        runtime.cancel_connector_sync(connection_id, job_id)
    )


@router.get("/connectors/{connection_id}/sync/status", response_model=ConnectorSyncJobRead | None)
def connector_sync_status(
    connection_id: int,
    db: Session = Depends(get_db_session),
) -> ConnectorSyncJob | ConnectorSyncJobRead | None:
    connection = db.get(ConnectorConnection, connection_id)
    if connection is None:
        raise HTTPException(status_code=404, detail="Connector connection not found")
    if is_legacy_default_connection(connection):
        generic_job = db.scalar(
            select(ConnectorSyncJob)
            .where(ConnectorSyncJob.connection_id == connection_id)
            .order_by(ConnectorSyncJob.id.desc())
        )
        legacy_job = db.scalar(
            select(JellyfinSyncJob).order_by(JellyfinSyncJob.id.desc())
        )
        if generic_job is not None and (
            generic_job.status in {JobStatus.queued, JobStatus.running}
            or legacy_job is None
            or generic_job.queued_at >= legacy_job.queued_at
        ):
            return generic_job
        if legacy_job is None:
            return None
        return ConnectorSyncJobRead(
            id=legacy_job.id,
            connection_id=connection_id,
            job_type="sync",
            sync_run_id=None,
            status=legacy_job.status.value,
            trigger_source=legacy_job.trigger_source.value,
            cancellation_requested=legacy_job.cancellation_requested,
            progress_phase=legacy_job.progress_phase,
            progress_detail=legacy_job.progress_detail,
            progress_current=legacy_job.progress_current,
            progress_total=legacy_job.progress_total,
            queued_at=legacy_job.queued_at,
            started_at=legacy_job.started_at,
            finished_at=legacy_job.finished_at,
            error=legacy_job.error,
            sync_summary=dict(legacy_job.sync_summary or {}),
        )
    return db.scalar(
        select(ConnectorSyncJob)
        .where(ConnectorSyncJob.connection_id == connection_id)
        .order_by(ConnectorSyncJob.id.desc())
    )


def _connector_with_capability(
    db: Session,
    connection_id: int,
    capability: str,
) -> ConnectorConnection:
    connection = db.get(ConnectorConnection, connection_id)
    if connection is None:
        raise HTTPException(status_code=404, detail="Connector connection not found")
    if not bool((connection.capabilities or {}).get(capability)):
        raise HTTPException(
            status_code=409,
            detail=f"Connector does not support {capability}",
        )
    return connection


@router.get("/connectors/{connection_id}/users", response_model=list[ConnectorUserRead])
def connector_users(
    connection_id: int,
    db: Session = Depends(get_db_session),
) -> list[ConnectorUser]:
    _connector_with_capability(db, connection_id, "users")
    return list(
        db.scalars(
            select(ConnectorUser)
            .where(ConnectorUser.connection_id == connection_id)
            .order_by(ConnectorUser.name, ConnectorUser.remote_id)
        )
    )


@router.put("/connectors/{connection_id}/users", response_model=list[ConnectorUserRead])
def connector_users_update(
    connection_id: int,
    payload: ConnectorUsersUpdate,
    db: Session = Depends(get_db_session),
) -> list[ConnectorUser]:
    connection = _connector_with_capability(db, connection_id, "users")
    users = list(
        db.scalars(
            select(ConnectorUser)
            .where(ConnectorUser.connection_id == connection_id)
            .order_by(ConnectorUser.name, ConnectorUser.remote_id)
        )
    )
    enabled_ids = set(payload.enabled_user_ids)
    known_ids = {user.remote_id for user in users}
    if enabled_ids - known_ids:
        raise HTTPException(status_code=400, detail="Unknown connector user id")
    for user in users:
        user.enabled_for_sync = user.remote_id in enabled_ids
    disabled_user_ids = [user.id for user in users if not user.enabled_for_sync]
    if disabled_user_ids:
        db.execute(
            delete(ConnectorUserItemData).where(
                ConnectorUserItemData.connector_user_id.in_(disabled_user_ids)
            )
        )
    if is_legacy_default_connection(connection):
        legacy_users = list(db.scalars(select(JellyfinUser)))
        for user in legacy_users:
            user.enabled_for_sync = user.jellyfin_user_id in enabled_ids
        disabled_legacy_ids = [
            user.jellyfin_user_id for user in legacy_users if not user.enabled_for_sync
        ]
        if disabled_legacy_ids:
            db.execute(
                delete(JellyfinUserItemData).where(
                    JellyfinUserItemData.jellyfin_user_id.in_(disabled_legacy_ids)
                )
            )
    db.commit()
    stats_cache.invalidate(str(id(db.get_bind())))
    return users


@router.get("/connectors/{connection_id}/libraries", response_model=list[ConnectorLibraryRead])
def connector_libraries(
    connection_id: int,
    db: Session = Depends(get_db_session),
) -> list[ConnectorLibraryRead]:
    if db.get(ConnectorConnection, connection_id) is None:
        raise HTTPException(status_code=404, detail="Connector connection not found")
    return list_connector_libraries(db, connection_id)


@router.post(
    "/connectors/{connection_id}/libraries/{connector_library_id}/create-medialyze-library",
    response_model=LibrarySummary,
    status_code=201,
)
def connector_library_create_medialyze(
    connection_id: int,
    connector_library_id: int,
    payload: LibraryCreate,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> LibrarySummary:
    connection = db.get(ConnectorConnection, connection_id)
    source = db.get(ConnectorLibrary, connector_library_id)
    if connection is None:
        raise HTTPException(status_code=404, detail="Connector connection not found")
    if source is None or source.connection_id != connection_id:
        raise HTTPException(status_code=404, detail="Connector library not found")
    if not settings.is_desktop:
        media_root = settings.media_root.resolve()

        def relative_server_path(value: str) -> str:
            candidate = Path(value).expanduser()
            if not candidate.is_absolute():
                return value
            try:
                return str(candidate.resolve().relative_to(media_root))
            except ValueError as exc:
                raise HTTPException(
                    status_code=400,
                    detail="Selected library roots must be below MEDIA_ROOT",
                ) from exc

        payload = payload.model_copy(
            update={
                "path": relative_server_path(payload.path),
                "paths": [relative_server_path(path) for path in payload.paths],
                "roots": [
                    root.model_copy(update={"path": relative_server_path(root.path)})
                    for root in payload.roots
                ],
            }
        )
    try:
        library = create_library(db, settings, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if str(getattr(connection.library_mapping_mode, "value", connection.library_mapping_mode)) == "manual":
        db.add(
            ConnectorLibraryLink(
                connector_library_id=source.id,
                library_id=library.id,
                link_method="manual",
            )
        )
        db.commit()
    stats_cache.invalidate(str(id(db.get_bind())))
    runtime.sync_library(library.id)
    result = get_library_summary(db, library.id)
    if result is None:
        raise HTTPException(status_code=500, detail="Failed to load created library")
    return result


@router.get("/connectors/{connection_id}/locations", response_model=list[ConnectorLocationRead])
def connector_locations(
    connection_id: int,
    db: Session = Depends(get_db_session),
) -> list[ConnectorLibraryLocation]:
    if db.get(ConnectorConnection, connection_id) is None:
        raise HTTPException(status_code=404, detail="Connector connection not found")
    return list(
        db.scalars(
            select(ConnectorLibraryLocation)
            .join(ConnectorLibrary)
            .where(ConnectorLibrary.connection_id == connection_id)
            .order_by(ConnectorLibraryLocation.connector_library_id, ConnectorLibraryLocation.id)
        )
    )


@router.get("/connectors/{connection_id}/bindings", response_model=list[ConnectorBindingRead])
def connector_bindings(
    connection_id: int,
    db: Session = Depends(get_db_session),
) -> list[ConnectorRootBinding]:
    if db.get(ConnectorConnection, connection_id) is None:
        raise HTTPException(status_code=404, detail="Connector connection not found")
    return list(
        db.scalars(
            select(ConnectorRootBinding)
            .join(ConnectorLibraryLocation)
            .join(ConnectorLibrary)
            .where(ConnectorLibrary.connection_id == connection_id)
            .order_by(
                ConnectorRootBinding.location_id,
                ConnectorRootBinding.priority.desc(),
                ConnectorRootBinding.id,
            )
        )
    )


@router.get(
    "/connectors/{connection_id}/mapping-overview",
    response_model=ConnectorMappingOverviewRead,
)
def connector_mapping_overview(
    connection_id: int,
    db: Session = Depends(get_db_session),
) -> ConnectorMappingOverviewRead:
    try:
        return get_connector_mapping_overview(db, connection_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/connectors/{connection_id}/bindings", response_model=list[ConnectorBindingRead])
def connector_bindings_replace(
    connection_id: int,
    payload: ConnectorBindingBatchUpdate,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> list[ConnectorRootBinding]:
    try:
        bindings = replace_connector_bindings(db, connection_id, payload)
        runtime.request_connector_recompute(connection_id)
        return bindings
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/connectors/{connection_id}/library-links", response_model=list[ConnectorLibraryRead])
def connector_library_links_replace(
    connection_id: int,
    payload: ConnectorLibraryLinkBatchUpdate,
    db: Session = Depends(get_db_session),
) -> list[ConnectorLibraryRead]:
    try:
        return replace_connector_library_links(db, connection_id, payload)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/connectors/{connection_id}/items", response_model=ConnectorItemPageRead)
def connector_items(
    connection_id: int,
    status: str | None = Query(default=None, max_length=32),
    attention_only: bool = Query(default=False),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db_session),
) -> ConnectorItemPageRead:
    if db.get(ConnectorConnection, connection_id) is None:
        raise HTTPException(status_code=404, detail="Connector connection not found")
    filters = [ConnectorItem.connection_id == connection_id]
    if status:
        filters.append(ConnectorItem.match_status == status)
    elif attention_only:
        filters.append(ConnectorItem.match_status != "matched")
    total = db.scalar(select(func.count()).select_from(ConnectorItem).where(*filters)) or 0
    items = list(
        db.scalars(
            select(ConnectorItem)
            .where(*filters)
            .order_by(ConnectorItem.id)
            .offset(offset)
            .limit(limit)
        )
    )
    return ConnectorItemPageRead(
        total=total,
        offset=offset,
        limit=limit,
        items=[ConnectorItemRead.model_validate(item) for item in items],
    )


@router.get("/connectors/{connection_id}/item-status-summary", response_model=dict[str, int])
def connector_item_status_summary(
    connection_id: int,
    db: Session = Depends(get_db_session),
) -> dict[str, int]:
    if db.get(ConnectorConnection, connection_id) is None:
        raise HTTPException(status_code=404, detail="Connector connection not found")
    return {
        status: int(count)
        for status, count in db.execute(
            select(ConnectorItem.match_status, func.count())
            .where(ConnectorItem.connection_id == connection_id)
            .group_by(ConnectorItem.match_status)
        )
    }


@router.get("/connectors/{connection_id}/items/{item_id}/provider-payload", response_model=dict)
def connector_item_provider_payload(
    connection_id: int,
    item_id: int,
    db: Session = Depends(get_db_session),
) -> dict:
    item = db.get(ConnectorItem, item_id)
    if item is None or item.connection_id != connection_id:
        raise HTTPException(status_code=404, detail="Connector item not found")
    return {
        "connection_id": connection_id,
        "connector_item_id": item.id,
        "remote_id": item.remote_id,
        "core_payload": public_connector_payload(item.core_payload or {}),
        "provider_payload": public_connector_payload(item.provider_payload or {}),
    }


def _jellyfin_connection_read(
    connection: JellyfinConnection | None,
    runtime: ScanRuntimeManager | None = None,
    settings: Settings | None = None,
) -> JellyfinConnectionRead:
    if connection is None:
        return JellyfinConnectionRead()
    next_run = None
    if runtime is not None:
        job = runtime.scheduler.get_job("jellyfin-sync")
        next_run = job.next_run_time if job else None
    return JellyfinConnectionRead(
        base_url=connection.base_url,
        enabled=connection.enabled,
        sync_interval_minutes=connection.sync_interval_minutes,
        api_key_configured=bool(
            read_jellyfin_api_key(connection, settings.jellyfin_api_key_file if settings else None)
        ),
        server_name=connection.server_name,
        server_version=connection.server_version,
        last_status=connection.last_status,
        last_error=connection.last_error,
        last_sync_started_at=connection.last_sync_started_at,
        last_sync_finished_at=connection.last_sync_finished_at,
        last_successful_sync_at=connection.last_successful_sync_at,
        next_scheduled_sync_at=next_run,
    )


def _jellyfin_item_read(item: JellyfinItem) -> JellyfinItemRead:
    return JellyfinItemRead(
        id=item.id,
        jellyfin_item_id=item.jellyfin_item_id,
        item_type=item.item_type,
        path=item.path,
        title=item.title,
        original_title=item.original_title,
        series_name=item.series_name,
        season_name=item.season_name,
        index_number=item.index_number,
        parent_index_number=item.parent_index_number,
        date_created=item.date_created,
        premiere_date=item.premiere_date,
        production_year=item.production_year,
        overview=item.overview,
        provider_ids=item.provider_ids or {},
        image_tags=item.image_tags or {},
        backdrop_image_tags=item.backdrop_image_tags or [],
        match_status=item.match_status,
        mismatch_reason=item.mismatch_reason,
    )


@router.get("/jellyfin/connection", response_model=JellyfinConnectionRead)
def jellyfin_connection_get(
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
    settings: Settings = Depends(get_app_settings),
) -> JellyfinConnectionRead:
    return _jellyfin_connection_read(db.get(JellyfinConnection, 1), runtime, settings)


@router.patch("/jellyfin/connection", response_model=JellyfinConnectionRead)
def jellyfin_connection_update(
    payload: JellyfinConnectionUpdate,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
    settings: Settings = Depends(get_app_settings),
) -> JellyfinConnectionRead:
    connection = get_or_create_jellyfin_connection(db)
    previous_base_url = connection.base_url
    previous_api_key = connection.api_key
    if payload.base_url is not None:
        connection.base_url = payload.base_url
    if payload.clear_api_key:
        connection.api_key = ""
    elif payload.api_key is not None and payload.api_key.strip():
        connection.api_key = payload.api_key.strip()
    if payload.enabled is not None:
        connection.enabled = payload.enabled
    if payload.sync_interval_minutes is not None:
        connection.sync_interval_minutes = payload.sync_interval_minutes
    if connection.enabled and (
        not connection.base_url
        or not read_jellyfin_api_key(connection, settings.jellyfin_api_key_file)
    ):
        db.rollback()
        raise HTTPException(status_code=400, detail="Jellyfin URL and API key are required before enabling sync")
    db.commit()
    db.refresh(connection)
    mirror_legacy_jellyfin_connection(
        db,
        connection,
        connection.api_key,
    )
    if connection.base_url != previous_base_url or connection.api_key != previous_api_key:
        JELLYFIN_IMAGE_CACHE.clear()
    runtime.refresh_jellyfin_schedule()
    refresh_connector_schedules = getattr(runtime, "refresh_connector_schedules", None)
    if callable(refresh_connector_schedules):
        refresh_connector_schedules()
    return _jellyfin_connection_read(connection, runtime, settings)


@router.delete("/jellyfin/connection", status_code=204)
def jellyfin_connection_delete(
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> None:
    if get_active_jellyfin_sync_job(db) is not None:
        raise HTTPException(status_code=409, detail="Cancel the active Jellyfin sync before disconnecting")
    generic_connection = db.scalar(
        select(ConnectorConnection).where(
            ConnectorConnection.provider == "jellyfin",
            ConnectorConnection.name == "Jellyfin",
        )
    )
    if generic_connection is not None:
        generic_active = db.scalar(
            select(ConnectorSyncJob.id).where(
                ConnectorSyncJob.connection_id == generic_connection.id,
                ConnectorSyncJob.status.in_([JobStatus.queued, JobStatus.running]),
            )
        )
        if generic_active is not None:
            raise HTTPException(status_code=409, detail="Cancel the active connector sync before disconnecting")
    _clear_jellyfin_connection_state(db, generic_connection)
    JELLYFIN_IMAGE_CACHE.clear()
    runtime.refresh_jellyfin_schedule()
    refresh_connector_schedules = getattr(runtime, "refresh_connector_schedules", None)
    if callable(refresh_connector_schedules):
        refresh_connector_schedules()


@router.post("/jellyfin/test", response_model=JellyfinTestRead)
def jellyfin_test(
    payload: JellyfinTestRequest,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> JellyfinTestRead:
    stored = db.get(JellyfinConnection, 1)
    base_url = payload.base_url or (stored.base_url if stored else "")
    api_key = payload.api_key or read_jellyfin_api_key(stored, settings.jellyfin_api_key_file)
    try:
        with JellyfinClient(base_url, api_key) as jellyfin_client:
            info = jellyfin_client.get_system_info()
    except JellyfinError as exc:
        return JellyfinTestRead(
            ok=False,
            error=redact_connector_error(exc, secrets=(api_key,)),
        )
    return JellyfinTestRead(
        ok=True,
        server_name=info.get("ServerName"),
        server_version=info.get("Version"),
    )


@router.post("/jellyfin/sync", response_model=JellyfinSyncStartRead, status_code=202)
def jellyfin_sync(
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> JellyfinSyncStartRead:
    try:
        return JellyfinSyncStartRead.model_validate(runtime.request_jellyfin_sync())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/jellyfin/sync/cancel", response_model=JellyfinSyncCancelRead)
def jellyfin_sync_cancel(
    job_id: int | None = Query(default=None, ge=1),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> JellyfinSyncCancelRead:
    return JellyfinSyncCancelRead.model_validate(runtime.cancel_jellyfin_sync(job_id))


@router.get("/jellyfin/sync/status", response_model=JellyfinSyncStatusRead)
def jellyfin_sync_status(
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
    settings: Settings = Depends(get_app_settings),
) -> JellyfinSyncStatusRead:
    connection = _jellyfin_connection_read(db.get(JellyfinConnection, 1), runtime, settings)
    progress = get_jellyfin_progress()
    job = get_active_jellyfin_sync_job(db) or get_latest_jellyfin_sync_job(db)
    job_active = bool(job and job.active_lock == 1 and job.status in {JobStatus.queued, JobStatus.running})
    persisted_progress = bool(job and job.progress_phase is not None)
    return JellyfinSyncStatusRead(
        **connection.model_dump(),
        sync_job_id=job.id if job else None,
        sync_job_status=job.status.value if job else None,
        sync_trigger_source=job.trigger_source.value if job else None,
        sync_job_active=job_active,
        sync_job_error=job.error if job else None,
        sync_heartbeat_at=job.heartbeat_at if job else None,
        sync_summary=dict(job.sync_summary or {}) if job else {},
        sync_phase=job.progress_phase if persisted_progress else progress["phase"],
        sync_phase_detail=job.progress_detail if persisted_progress else progress["detail"],
        sync_current=int(job.progress_current or 0) if persisted_progress else int(progress["current"] or 0),
        sync_total=(
            int(job.progress_total) if persisted_progress and job.progress_total is not None
            else int(progress["total"]) if not persisted_progress and progress["total"] is not None
            else None
        ),
        sync_progress_tracks=(
            progress["tracks"]
            if (job is None and progress["job_id"] is None)
            or (job is not None and progress["job_id"] == job.id)
            else []
        ),
        cancellation_requested=bool(
            (job.cancellation_requested if job else False)
            or progress["cancellation_requested"]
        ),
        item_count=db.scalar(select(func.count(JellyfinItem.id))) or 0,
        matched_item_count=db.scalar(
            select(func.count(JellyfinItem.id)).where(JellyfinItem.match_status == "matched")
        ) or 0,
        unmatched_item_count=db.scalar(
            select(func.count(JellyfinItem.id)).where(JellyfinItem.match_status != "matched")
        ) or 0,
        library_count=db.scalar(select(func.count(JellyfinLibrary.id))) or 0,
        user_count=db.scalar(select(func.count(JellyfinUser.jellyfin_user_id))) or 0,
    )


@router.get("/jellyfin/users", response_model=list[JellyfinUserRead])
def jellyfin_users(db: Session = Depends(get_db_session)) -> list[JellyfinUser]:
    return list(db.scalars(select(JellyfinUser).order_by(JellyfinUser.name.asc())))


@router.patch("/jellyfin/users", response_model=list[JellyfinUserRead])
def jellyfin_users_update(
    payload: JellyfinUsersUpdate,
    db: Session = Depends(get_db_session),
) -> list[JellyfinUser]:
    enabled_ids = set(payload.enabled_user_ids)
    users = list(db.scalars(select(JellyfinUser).order_by(JellyfinUser.name.asc())))
    known_ids = {user.jellyfin_user_id for user in users}
    if enabled_ids - known_ids:
        raise HTTPException(status_code=400, detail="Unknown Jellyfin user id")
    for user in users:
        user.enabled_for_sync = user.jellyfin_user_id in enabled_ids
    disabled_ids = [user.jellyfin_user_id for user in users if not user.enabled_for_sync]
    if disabled_ids:
        db.execute(
            delete(JellyfinUserItemData).where(
                JellyfinUserItemData.jellyfin_user_id.in_(disabled_ids)
            )
        )
    standard_connection = next(
        (
            connection
            for connection in db.scalars(
                select(ConnectorConnection).where(ConnectorConnection.provider == "jellyfin")
            )
            if is_legacy_default_connection(connection)
        ),
        None,
    )
    if standard_connection is not None:
        connector_users = list(
            db.scalars(
                select(ConnectorUser).where(
                    ConnectorUser.connection_id == standard_connection.id
                )
            )
        )
        for user in connector_users:
            user.enabled_for_sync = user.remote_id in enabled_ids
        disabled_connector_ids = [
            user.id for user in connector_users if not user.enabled_for_sync
        ]
        if disabled_connector_ids:
            db.execute(
                delete(ConnectorUserItemData).where(
                    ConnectorUserItemData.connector_user_id.in_(disabled_connector_ids)
                )
            )
    db.commit()
    stats_cache.invalidate(str(id(db.get_bind())))
    return users


@router.get("/jellyfin/path-mappings", response_model=list[JellyfinPathMappingRead])
def jellyfin_path_mappings(db: Session = Depends(get_db_session)) -> list[JellyfinPathMapping]:
    return list(db.scalars(select(JellyfinPathMapping).order_by(JellyfinPathMapping.id.asc())))


def _require_manual_legacy_path_mapping(db: Session) -> ConnectorConnection:
    connection = next(
        (
            candidate
            for candidate in db.scalars(select(ConnectorConnection))
            if is_legacy_default_connection(candidate)
        ),
        None,
    )
    if connection is None:
        raise HTTPException(status_code=404, detail="Standard Jellyfin connector not found")
    mode = str(getattr(connection.path_mapping_mode, "value", connection.path_mapping_mode))
    if mode != "manual":
        raise HTTPException(
            status_code=409,
            detail="Path mappings are read-only while automatic mapping is enabled",
        )
    return connection


def _queue_jellyfin_mapping_refresh(
    db: Session,
    runtime: ScanRuntimeManager,
) -> None:
    for library in db.scalars(
        select(JellyfinLibrary).where(JellyfinLibrary.linked_library_id.is_(None))
    ):
        library.mapped_status = "updating"
    db.commit()
    runtime.request_jellyfin_match_recompute()


@router.put("/jellyfin/path-mappings/batch", response_model=list[JellyfinPathMappingRead])
def jellyfin_path_mappings_batch_update(
    payload: JellyfinPathMappingBatchUpdate,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> list[JellyfinPathMapping]:
    _require_manual_legacy_path_mapping(db)
    update_ids = {item.id for item in payload.mappings if item.id is not None}
    requested_ids = update_ids | set(payload.delete_ids)
    existing_by_id = {
        mapping.id: mapping
        for mapping in db.scalars(
            select(JellyfinPathMapping).where(JellyfinPathMapping.id.in_(requested_ids))
        )
    } if requested_ids else {}
    missing_ids = sorted(requested_ids - set(existing_by_id))
    if missing_ids:
        raise HTTPException(
            status_code=404,
            detail=f"Path mapping not found: {missing_ids[0]}",
        )

    updated_mappings: list[JellyfinPathMapping] = []
    try:
        for item in payload.mappings:
            mapping = existing_by_id.get(item.id) if item.id is not None else JellyfinPathMapping()
            mapping.jellyfin_path_prefix = item.jellyfin_path_prefix
            mapping.medialyze_path_prefix = item.medialyze_path_prefix
            mapping.enabled = item.enabled
            if item.id is None:
                db.add(mapping)
            updated_mappings.append(mapping)
        for mapping_id in payload.delete_ids:
            db.delete(existing_by_id[mapping_id])

        for library in db.scalars(
            select(JellyfinLibrary).where(JellyfinLibrary.linked_library_id.is_(None))
        ):
            library.mapped_status = "updating"
        db.commit()
    except Exception:
        db.rollback()
        raise

    runtime.request_jellyfin_match_recompute()
    for mapping in updated_mappings:
        db.refresh(mapping)
    return updated_mappings


@router.post("/jellyfin/path-mappings", response_model=JellyfinPathMappingRead, status_code=201)
def jellyfin_path_mapping_create(
    payload: JellyfinPathMappingCreate,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> JellyfinPathMapping:
    _require_manual_legacy_path_mapping(db)
    mapping = JellyfinPathMapping(**payload.model_dump())
    db.add(mapping)
    _queue_jellyfin_mapping_refresh(db, runtime)
    db.refresh(mapping)
    return mapping


@router.patch("/jellyfin/path-mappings/{mapping_id}", response_model=JellyfinPathMappingRead)
def jellyfin_path_mapping_update(
    mapping_id: int,
    payload: JellyfinPathMappingUpdate,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> JellyfinPathMapping:
    _require_manual_legacy_path_mapping(db)
    mapping = db.get(JellyfinPathMapping, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="Path mapping not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(mapping, key, value)
    _queue_jellyfin_mapping_refresh(db, runtime)
    db.refresh(mapping)
    return mapping


@router.delete("/jellyfin/path-mappings/{mapping_id}", status_code=204)
def jellyfin_path_mapping_delete(
    mapping_id: int,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> None:
    _require_manual_legacy_path_mapping(db)
    mapping = db.get(JellyfinPathMapping, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=404, detail="Path mapping not found")
    db.delete(mapping)
    _queue_jellyfin_mapping_refresh(db, runtime)


@router.get(
    "/jellyfin/matches/recompute/status",
    response_model=JellyfinMatchRecomputeStatusRead,
)
def jellyfin_match_recompute_status(
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> JellyfinMatchRecomputeStatusRead:
    return JellyfinMatchRecomputeStatusRead.model_validate(
        runtime.get_jellyfin_match_recompute_status()
    )


@router.get("/jellyfin/libraries", response_model=list[JellyfinLibraryRead])
def jellyfin_libraries(db: Session = Depends(get_db_session)) -> list[JellyfinLibraryRead]:
    return [
        get_jellyfin_library_read(db, library)
        for library in db.scalars(select(JellyfinLibrary).order_by(JellyfinLibrary.name.asc()))
    ]


@router.patch(
    "/jellyfin/libraries/{jellyfin_library_id}/link",
    response_model=JellyfinLibraryRead,
)
def jellyfin_library_link_update(
    jellyfin_library_id: int,
    payload: JellyfinLibraryLinkUpdate,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> JellyfinLibraryRead:
    source = _jellyfin_library_or_404(db, jellyfin_library_id)
    if payload.linked_library_id is not None and db.get(Library, payload.linked_library_id) is None:
        raise HTTPException(status_code=404, detail="MediaLyze library not found")

    if payload.linked_library_id is not None:
        for other in db.scalars(
            select(JellyfinLibrary).where(
                JellyfinLibrary.id != source.id,
                JellyfinLibrary.linked_library_id == payload.linked_library_id,
            )
        ):
            other.linked_library_id = None
            other.link_method = "manual"
            other.mapped_status = "updating"

    source.linked_library_id = payload.linked_library_id
    source.link_method = "manual"
    if payload.linked_library_id is not None:
        source.mapped_status = "linked"
    else:
        source.mapped_status = "updating"
    db.commit()
    stats_cache.invalidate(str(id(db.get_bind())))
    runtime.request_jellyfin_match_recompute()
    db.refresh(source)
    return get_jellyfin_library_read(db, source)


@router.get("/jellyfin/catalog/summary", response_model=JellyfinCatalogSummaryRead)
def jellyfin_catalog_summary(db: Session = Depends(get_db_session)) -> JellyfinCatalogSummaryRead:
    return get_jellyfin_catalog_summary(db)


def _jellyfin_library_or_404(db: Session, library_id: int) -> JellyfinLibrary:
    library = db.get(JellyfinLibrary, library_id)
    if library is None:
        raise HTTPException(status_code=404, detail="Jellyfin library not found")
    return library


def _validate_jellyfin_user(db: Session, user_id: str | None) -> None:
    if user_id is None:
        return
    user = db.get(JellyfinUser, user_id)
    if user is None or not user.enabled_for_sync:
        raise HTTPException(status_code=400, detail="Unknown or disabled Jellyfin user")


@router.get(
    "/jellyfin/libraries/{jellyfin_library_id}/overview",
    response_model=JellyfinLibraryOverviewRead,
)
def jellyfin_library_overview(
    jellyfin_library_id: int,
    user_id: str | None = Query(default=None),
    db: Session = Depends(get_db_session),
) -> JellyfinLibraryOverviewRead:
    library = _jellyfin_library_or_404(db, jellyfin_library_id)
    _validate_jellyfin_user(db, user_id)
    return get_jellyfin_library_overview(db, library, user_id)


@router.get(
    "/jellyfin/libraries/{jellyfin_library_id}/items",
    response_model=JellyfinLibraryItemPageRead,
)
def jellyfin_library_items(
    jellyfin_library_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    search: str | None = Query(default=None, max_length=512),
    item_type: str | None = Query(default=None, max_length=64),
    production_year: int | None = Query(default=None, ge=0, le=9999),
    played: bool | None = Query(default=None),
    user_id: str | None = Query(default=None),
    sort_key: Literal["title", "year", "added", "duration", "size", "play_count"] = "title",
    sort_direction: Literal["asc", "desc"] = "asc",
    db: Session = Depends(get_db_session),
) -> JellyfinLibraryItemPageRead:
    library = _jellyfin_library_or_404(db, jellyfin_library_id)
    _validate_jellyfin_user(db, user_id)
    return get_jellyfin_library_items(
        db,
        library,
        offset=offset,
        limit=limit,
        search=search,
        item_type=item_type,
        production_year=production_year,
        played=played,
        user_id=user_id,
        sort_key=sort_key,
        sort_direction=sort_direction,
    )


def _jellyfin_library_type(collection_type: str | None) -> LibraryType:
    return {
        "movies": LibraryType.movies,
        "tvshows": LibraryType.series,
        "music": LibraryType.music,
        "books": LibraryType.audiobooks,
        "mixed": LibraryType.mixed,
    }.get((collection_type or "").casefold(), LibraryType.other)


@router.post(
    "/jellyfin/libraries/{jellyfin_library_id}/create-medialyze-library",
    response_model=LibrarySummary,
    status_code=201,
)
def jellyfin_library_create_medialyze(
    jellyfin_library_id: int,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> LibrarySummary:
    source = db.get(JellyfinLibrary, jellyfin_library_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Jellyfin library not found")
    if source.linked_library_id is not None:
        raise HTTPException(status_code=409, detail="Jellyfin library is already linked")
    if source.mapped_status != "accessible" or not source.mapped_locations:
        raise HTTPException(status_code=400, detail="Mapped Jellyfin library path is not accessible")
    if db.scalar(select(Library.id).where(Library.name == source.name)) is not None:
        raise HTTPException(status_code=409, detail="A MediaLyze library with this name already exists")
    paths = list(source.mapped_locations)
    if not settings.is_desktop:
        try:
            paths = [str(Path(path).resolve().relative_to(settings.media_root.resolve())) for path in paths]
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Mapped path must be below MEDIA_ROOT") from exc
    try:
        library = create_library(
            db,
            settings,
            LibraryCreate(
                name=source.name,
                path=paths[0],
                paths=paths,
                type=_jellyfin_library_type(source.collection_type),
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    source.linked_library_id = library.id
    source.link_method = "manual"
    source.mapped_status = "linked"
    db.commit()
    stats_cache.invalidate(str(id(db.get_bind())))
    runtime.sync_library(library.id)
    result = get_library_summary(db, library.id)
    if result is None:
        raise HTTPException(status_code=500, detail="Failed to load created library")
    return result


@router.get("/jellyfin/unmatched", response_model=list[JellyfinUnmatchedRead])
def jellyfin_unmatched(
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db_session),
) -> list[JellyfinUnmatchedRead]:
    items = list(
        db.scalars(
            select(JellyfinItem)
            .where(JellyfinItem.match_status != "matched")
            .order_by(JellyfinItem.title.asc())
            .limit(limit)
        )
    )
    return [
        JellyfinUnmatchedRead(item=_jellyfin_item_read(item))
        for item in items
    ]


@router.get("/libraries", response_model=list[LibrarySummary])
def libraries(db: Session = Depends(get_db_session)) -> list[LibrarySummary]:
    return list_libraries(db)


@router.post("/libraries", response_model=LibrarySummary, status_code=201)
def libraries_create(
    payload: LibraryCreate,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> LibrarySummary:
    try:
        library = create_library(db, settings, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    runtime.sync_library(library.id)
    for item in list_libraries(db):
        if item.id == library.id:
            return item
    raise HTTPException(status_code=500, detail="Failed to load created library")


@router.get("/libraries/{library_id}/summary", response_model=LibrarySummary)
def library_summary(library_id: int, db: Session = Depends(get_db_session)) -> LibrarySummary:
    library = get_library_summary(db, library_id)
    if not library:
        raise HTTPException(status_code=404, detail="Library not found")
    return library


@router.get("/libraries/{library_id}/statistics", response_model=LibraryStatistics)
def library_statistics(
    library_id: int,
    panels: list[str] | None = Query(default=None),
    db: Session = Depends(get_db_session),
) -> LibraryStatistics:
    statistics = get_library_statistics(db, library_id, requested_panels=_normalize_panel_query(panels))
    if not statistics:
        raise HTTPException(status_code=404, detail="Library not found")
    return statistics


@router.get("/libraries/{library_id}/statistics/comparison", response_model=ComparisonResponse)
def library_statistics_comparison(
    library_id: int,
    x_field: ComparisonFieldId = Query(...),
    y_field: ComparisonFieldId = Query(...),
    renderer: ComparisonRendererId | None = Query(default=None),
    db: Session = Depends(get_db_session),
) -> ComparisonResponse:
    if x_field == y_field:
        raise HTTPException(status_code=400, detail="Comparison axes must use different fields")
    payload = get_library_comparison(
        db,
        library_id=library_id,
        x_field=x_field,
        y_field=y_field,
        renderer=renderer,
    )
    if payload is None:
        raise HTTPException(status_code=404, detail="Library not found")
    return payload


@router.get("/libraries/{library_id}/duplicates", response_model=DuplicateGroupPageRead)
def library_duplicates(
    library_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=200),
    include_suppressed: bool = Query(default=False),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> DuplicateGroupPageRead:
    try:
        return list_library_duplicate_groups(
            db,
            library_id,
            offset=offset,
            limit=limit,
            include_suppressed=include_suppressed,
            duplicate_matching_settings=load_app_settings(db, settings).pattern_recognition.duplicate_matching,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Library not found") from exc


@router.post(
    "/libraries/{library_id}/duplicates/suppressions",
    response_model=DuplicateSuppressionRead,
    status_code=201,
)
def library_duplicate_suppression_create(
    library_id: int,
    payload: DuplicateSuppressionCreate,
    db: Session = Depends(get_db_session),
) -> DuplicateSuppressionRead:
    try:
        suppression = suppress_duplicate_group(db, library_id, payload.mode, payload.signature)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if suppression is None:
        raise HTTPException(status_code=404, detail="Library not found")
    return suppression


@router.delete("/libraries/{library_id}/duplicates/suppressions", status_code=204)
def library_duplicate_suppression_delete(
    library_id: int,
    mode: DuplicateDetectionMode = Query(...),
    signature: str = Query(...),
    db: Session = Depends(get_db_session),
) -> None:
    try:
        deleted = unsuppress_duplicate_group(db, library_id, mode, signature)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Library not found")


@router.get("/libraries/{library_id}/history", response_model=LibraryHistoryResponse)
def library_history(library_id: int, db: Session = Depends(get_db_session)) -> LibraryHistoryResponse:
    payload = get_library_history(db, library_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Library not found")
    return payload


@router.get("/libraries/{library_id}/scan-jobs", response_model=list[ScanJobRead])
def library_scan_jobs(
    library_id: int,
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db_session),
) -> list[ScanJobRead]:
    if not library_exists(db, library_id):
        raise HTTPException(status_code=404, detail="Library not found")
    return list_library_scan_jobs(db, library_id, limit)


@router.get("/libraries/{library_id}/series", response_model=list[MediaSeriesSummaryRead])
def library_series(library_id: int, db: Session = Depends(get_db_session)) -> list[MediaSeriesSummaryRead]:
    if not library_exists(db, library_id):
        raise HTTPException(status_code=404, detail="Library not found")
    return list_library_series(db, library_id)


@router.get("/libraries/{library_id}/series/{series_id}", response_model=MediaSeriesDetailRead)
def library_series_detail(
    library_id: int,
    series_id: int,
    db: Session = Depends(get_db_session),
) -> MediaSeriesDetailRead:
    payload = get_library_series_detail(db, library_id, series_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Series not found")
    return payload


@router.get("/libraries/{library_id}/series/{series_id}/grouped-detail", response_model=MediaSeriesGroupedDetailRead)
def library_series_grouped_detail(
    library_id: int,
    series_id: int,
    search: str = Query(default="", max_length=200),
    file_search: str = Query(default="", max_length=200),
    search_container: str = Query(default="", max_length=64),
    search_size: str = Query(default="", max_length=64),
    search_quality_score: str = Query(default="", max_length=32),
    search_bitrate: str = Query(default="", max_length=64),
    search_audio_bitrate: str = Query(default="", max_length=64),
    search_bit_depth: str = Query(default="", max_length=32),
    search_video_codec: str = Query(default="", max_length=200),
    search_resolution: str = Query(default="", max_length=64),
    search_hdr_type: str = Query(default="", max_length=200),
    search_duration: str = Query(default="", max_length=64),
    search_audio_codecs: str = Query(default="", max_length=200),
    search_audio_spatial_profiles: str = Query(default="", max_length=200),
    search_audio_languages: str = Query(default="", max_length=200),
    search_jellyfin_name: str = Query(default="", max_length=512),
    search_audio_title: str = Query(default="", max_length=512),
    search_audio_artist: str = Query(default="", max_length=512),
    search_audio_album: str = Query(default="", max_length=512),
    search_audio_album_artist: str = Query(default="", max_length=512),
    search_audio_genre: str = Query(default="", max_length=256),
    search_audio_date: str = Query(default="", max_length=32),
    search_audio_disc: str = Query(default="", max_length=32),
    search_audio_composer: str = Query(default="", max_length=512),
    search_audio_channels: str = Query(default="", max_length=32),
    search_sample_rate: str = Query(default="", max_length=32),
    search_track_number: str = Query(default="", max_length=32),
    search_bit_rate_mode: str = Query(default="", max_length=32),
    search_has_embedded_cover: str = Query(default="", max_length=16),
    search_chapter_count: str = Query(default="", max_length=32),
    search_chapter_titles: str = Query(default="", max_length=512),
    search_audiobook_narrator: str = Query(default="", max_length=512),
    search_audiobook_author: str = Query(default="", max_length=512),
    search_audiobook_publisher: str = Query(default="", max_length=512),
    search_audiobook_series: str = Query(default="", max_length=512),
    search_audiobook_series_part: str = Query(default="", max_length=64),
    search_audiobook_description: str = Query(default="", max_length=512),
    search_audiobook_copyright: str = Query(default="", max_length=512),
    search_audiobook_asin: str = Query(default="", max_length=64),
    search_audiobook_isbn: str = Query(default="", max_length=64),
    search_audiobook_language: str = Query(default="", max_length=64),
    search_audiobook_abridged: str = Query(default="", max_length=32),
    search_subtitle_languages: str = Query(default="", max_length=200),
    search_subtitle_codecs: str = Query(default="", max_length=200),
    search_subtitle_sources: str = Query(default="", max_length=64),
    db: Session = Depends(get_db_session),
) -> MediaSeriesGroupedDetailRead:
    try:
        payload = get_grouped_library_series_detail(
            db,
            library_id,
            series_id,
            search=search,
            search_filters=_library_file_search_filters(
                file_search=file_search,
                search_container=search_container,
                search_size=search_size,
                search_quality_score=search_quality_score,
                search_bitrate=search_bitrate,
                search_audio_bitrate=search_audio_bitrate,
                search_bit_depth=search_bit_depth,
                search_video_codec=search_video_codec,
                search_resolution=search_resolution,
                search_hdr_type=search_hdr_type,
                search_duration=search_duration,
                search_audio_codecs=search_audio_codecs,
                search_audio_spatial_profiles=search_audio_spatial_profiles,
                search_audio_languages=search_audio_languages,
                search_jellyfin_name=search_jellyfin_name,
        search_audio_title=search_audio_title,
        search_audio_artist=search_audio_artist,
        search_audio_album=search_audio_album,
        search_audio_album_artist=search_audio_album_artist,
        search_audio_genre=search_audio_genre,
        search_audio_date=search_audio_date,
        search_audio_disc=search_audio_disc,
        search_audio_composer=search_audio_composer,
        search_audio_channels=search_audio_channels,
        search_sample_rate=search_sample_rate,
        search_track_number=search_track_number,
        search_bit_rate_mode=search_bit_rate_mode,
        search_has_embedded_cover=search_has_embedded_cover,
                search_chapter_count=search_chapter_count,
                search_chapter_titles=search_chapter_titles,
                search_audiobook_narrator=search_audiobook_narrator,
                search_audiobook_author=search_audiobook_author,
                search_audiobook_publisher=search_audiobook_publisher,
                search_audiobook_series=search_audiobook_series,
                search_audiobook_series_part=search_audiobook_series_part,
                search_audiobook_description=search_audiobook_description,
                search_audiobook_copyright=search_audiobook_copyright,
                search_audiobook_asin=search_audiobook_asin,
                search_audiobook_isbn=search_audiobook_isbn,
                search_audiobook_language=search_audiobook_language,
                search_audiobook_abridged=search_audiobook_abridged,
                search_subtitle_languages=search_subtitle_languages,
                search_subtitle_codecs=search_subtitle_codecs,
                search_subtitle_sources=search_subtitle_sources,
            ),
        )
    except SearchValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if payload is None:
        raise HTTPException(status_code=404, detail="Series not found")
    return payload


@router.patch("/libraries/{library_id}", response_model=LibrarySummary)
def library_update(
    library_id: int,
    payload: LibraryUpdate,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> LibrarySummary:
    path_update_requested = (
        "path" in payload.model_fields_set
        or "paths" in payload.model_fields_set
        or "roots" in payload.model_fields_set
    )
    if path_update_requested and _library_has_active_scan_job(db, library_id):
        raise HTTPException(
            status_code=409,
            detail="Library path cannot be changed while a scan is active",
        )

    try:
        library, quality_profile_changed = update_library_settings(db, settings, library_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if library is None:
        raise HTTPException(status_code=404, detail="Library not found")

    runtime.sync_library(library.id)
    if path_update_requested:
        request_recompute = getattr(runtime, "request_connector_recompute", None)
        if callable(request_recompute):
            for connection_id in db.scalars(
                select(ConnectorConnection.id).where(ConnectorConnection.enabled.is_(True))
            ):
                request_recompute(connection_id, trigger_source="library_roots_changed")
    if quality_profile_changed:
        runtime.request_quality_recompute(library.id)
    for item in list_libraries(db):
        if item.id == library.id:
            return item
    raise HTTPException(status_code=500, detail="Failed to load updated library")


@router.delete("/libraries/{library_id}", status_code=204)
def library_delete(
    library_id: int,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> None:
    if not library_exists(db, library_id):
        raise HTTPException(status_code=404, detail="Library not found")

    try:
        runtime.cancel_library_jobs(library_id)
    except ScanCancelPersistenceError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Library deletion requested scan cancellation for {len(exc.canceled_job_ids)} active job(s), "
                "but the database is still busy. Try again shortly."
            ),
        ) from exc
    deleted = delete_library(db, library_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Library not found")
    runtime.sync_library(library_id, library=None)


@router.get("/libraries/{library_id}/files", response_model=MediaFileTablePage)
def library_files(
    library_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=0, le=200),
    cursor: str | None = Query(default=None, max_length=512),
    include_total: bool = Query(default=True),
    search: str = Query(default="", max_length=200),
    file_search: str = Query(default="", max_length=200),
    search_container: str = Query(default="", max_length=64),
    search_size: str = Query(default="", max_length=64),
    search_quality_score: str = Query(default="", max_length=32),
    search_bitrate: str = Query(default="", max_length=64),
    search_audio_bitrate: str = Query(default="", max_length=64),
    search_bit_depth: str = Query(default="", max_length=32),
    search_video_codec: str = Query(default="", max_length=200),
    search_resolution: str = Query(default="", max_length=64),
    search_hdr_type: str = Query(default="", max_length=200),
    search_duration: str = Query(default="", max_length=64),
    search_audio_codecs: str = Query(default="", max_length=200),
    search_audio_spatial_profiles: str = Query(default="", max_length=200),
    search_audio_languages: str = Query(default="", max_length=200),
    search_jellyfin_name: str = Query(default="", max_length=512),
    search_audio_title: str = Query(default="", max_length=512),
    search_audio_artist: str = Query(default="", max_length=512),
    search_audio_album: str = Query(default="", max_length=512),
    search_audio_album_artist: str = Query(default="", max_length=512),
    search_audio_genre: str = Query(default="", max_length=256),
    search_audio_date: str = Query(default="", max_length=32),
    search_audio_disc: str = Query(default="", max_length=32),
    search_audio_composer: str = Query(default="", max_length=512),
    search_audio_channels: str = Query(default="", max_length=32),
    search_sample_rate: str = Query(default="", max_length=32),
    search_track_number: str = Query(default="", max_length=32),
    search_bit_rate_mode: str = Query(default="", max_length=32),
    search_has_embedded_cover: str = Query(default="", max_length=16),
    search_chapter_count: str = Query(default="", max_length=32),
    search_chapter_titles: str = Query(default="", max_length=512),
    search_audiobook_narrator: str = Query(default="", max_length=512),
    search_audiobook_author: str = Query(default="", max_length=512),
    search_audiobook_publisher: str = Query(default="", max_length=512),
    search_audiobook_series: str = Query(default="", max_length=512),
    search_audiobook_series_part: str = Query(default="", max_length=64),
    search_audiobook_description: str = Query(default="", max_length=512),
    search_audiobook_copyright: str = Query(default="", max_length=512),
    search_audiobook_asin: str = Query(default="", max_length=64),
    search_audiobook_isbn: str = Query(default="", max_length=64),
    search_audiobook_language: str = Query(default="", max_length=64),
    search_audiobook_abridged: str = Query(default="", max_length=32),
    search_subtitle_languages: str = Query(default="", max_length=200),
    search_subtitle_codecs: str = Query(default="", max_length=200),
    search_subtitle_sources: str = Query(default="", max_length=64),
    sort_key: Literal[
        "file",
        "container",
        "size",
        "bitrate",
        "audio_bitrate",
        "play_count",
        "bit_depth",
        "audio_title",
        "audio_artist",
        "audio_album",
        "audio_album_artist",
        "audio_genre",
        "audio_date",
        "audio_disc",
        "audio_composer",
        "audio_channels",
        "sample_rate",
        "track_number",
        "bit_rate_mode",
        "has_embedded_cover",
        "chapter_count",
        "audiobook_narrator",
        "audiobook_author",
        "audiobook_publisher",
        "audiobook_series",
        "audiobook_series_part",
        "audiobook_description",
        "audiobook_copyright",
        "audiobook_language",
        "audiobook_abridged",
        "audiobook_asin",
        "audiobook_isbn",
        "video_codec",
        "resolution",
        "hdr_type",
        "duration",
        "audio_codecs",
        "audio_spatial_profiles",
        "audio_languages",
        "subtitle_languages",
        "subtitle_codecs",
        "subtitle_sources",
        "mtime",
        "last_analyzed_at",
        "quality_score",
    ] = Query(default="file"),
    sort_direction: Literal["asc", "desc"] = Query(default="asc"),
    db: Session = Depends(get_db_session),
) -> MediaFileTablePage:
    if not library_exists(db, library_id):
        raise HTTPException(status_code=404, detail="Library not found")
    try:
        return list_library_files(
            db,
            library_id,
            offset=offset,
            limit=limit,
            search=search,
            search_filters=_library_file_search_filters(
                file_search=file_search,
                search_container=search_container,
                search_size=search_size,
                search_quality_score=search_quality_score,
                search_bitrate=search_bitrate,
                search_audio_bitrate=search_audio_bitrate,
                search_bit_depth=search_bit_depth,
                search_video_codec=search_video_codec,
                search_resolution=search_resolution,
                search_hdr_type=search_hdr_type,
                search_duration=search_duration,
                search_audio_codecs=search_audio_codecs,
                search_audio_spatial_profiles=search_audio_spatial_profiles,
                search_audio_languages=search_audio_languages,
                search_jellyfin_name=search_jellyfin_name,
        search_audio_title=search_audio_title,
        search_audio_artist=search_audio_artist,
        search_audio_album=search_audio_album,
        search_audio_album_artist=search_audio_album_artist,
        search_audio_genre=search_audio_genre,
        search_audio_date=search_audio_date,
        search_audio_disc=search_audio_disc,
        search_audio_composer=search_audio_composer,
        search_audio_channels=search_audio_channels,
        search_sample_rate=search_sample_rate,
        search_track_number=search_track_number,
        search_bit_rate_mode=search_bit_rate_mode,
        search_has_embedded_cover=search_has_embedded_cover,
                search_chapter_count=search_chapter_count,
                search_chapter_titles=search_chapter_titles,
                search_audiobook_narrator=search_audiobook_narrator,
                search_audiobook_author=search_audiobook_author,
                search_audiobook_publisher=search_audiobook_publisher,
                search_audiobook_series=search_audiobook_series,
                search_audiobook_series_part=search_audiobook_series_part,
                search_audiobook_description=search_audiobook_description,
                search_audiobook_copyright=search_audiobook_copyright,
                search_audiobook_asin=search_audiobook_asin,
                search_audiobook_isbn=search_audiobook_isbn,
                search_audiobook_language=search_audiobook_language,
                search_audiobook_abridged=search_audiobook_abridged,
                search_subtitle_languages=search_subtitle_languages,
                search_subtitle_codecs=search_subtitle_codecs,
                search_subtitle_sources=search_subtitle_sources,
            ),
            sort_key=sort_key,
            sort_direction=sort_direction,
            cursor=cursor,
            include_total=include_total,
        )
    except SearchValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/libraries/{library_id}/storage-map", response_model=LibraryStorageMapRead)
def library_storage_map(
    library_id: int,
    path: str = Query(default="", max_length=2048),
    db: Session = Depends(get_db_session),
) -> LibraryStorageMapRead:
    try:
        result = get_library_storage_map(db, library_id, path=path)
    except StorageMapPathError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Library not found")
    return result


@router.get("/libraries/{library_id}/files/grouped", response_model=GroupedMediaTablePageRead)
def library_grouped_files(
    library_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None, max_length=512),
    include_total: bool = Query(default=True),
    search: str = Query(default="", max_length=200),
    file_search: str = Query(default="", max_length=200),
    search_container: str = Query(default="", max_length=64),
    search_size: str = Query(default="", max_length=64),
    search_quality_score: str = Query(default="", max_length=32),
    search_bitrate: str = Query(default="", max_length=64),
    search_audio_bitrate: str = Query(default="", max_length=64),
    search_bit_depth: str = Query(default="", max_length=32),
    search_video_codec: str = Query(default="", max_length=200),
    search_resolution: str = Query(default="", max_length=64),
    search_hdr_type: str = Query(default="", max_length=200),
    search_duration: str = Query(default="", max_length=64),
    search_audio_codecs: str = Query(default="", max_length=200),
    search_audio_spatial_profiles: str = Query(default="", max_length=200),
    search_audio_languages: str = Query(default="", max_length=200),
    search_jellyfin_name: str = Query(default="", max_length=512),
    search_audio_title: str = Query(default="", max_length=512),
    search_audio_artist: str = Query(default="", max_length=512),
    search_audio_album: str = Query(default="", max_length=512),
    search_audio_album_artist: str = Query(default="", max_length=512),
    search_audio_genre: str = Query(default="", max_length=256),
    search_audio_date: str = Query(default="", max_length=32),
    search_audio_disc: str = Query(default="", max_length=32),
    search_audio_composer: str = Query(default="", max_length=512),
    search_audio_channels: str = Query(default="", max_length=32),
    search_sample_rate: str = Query(default="", max_length=32),
    search_track_number: str = Query(default="", max_length=32),
    search_bit_rate_mode: str = Query(default="", max_length=32),
    search_has_embedded_cover: str = Query(default="", max_length=16),
    search_chapter_count: str = Query(default="", max_length=32),
    search_chapter_titles: str = Query(default="", max_length=512),
    search_audiobook_narrator: str = Query(default="", max_length=512),
    search_audiobook_author: str = Query(default="", max_length=512),
    search_audiobook_publisher: str = Query(default="", max_length=512),
    search_audiobook_series: str = Query(default="", max_length=512),
    search_audiobook_series_part: str = Query(default="", max_length=64),
    search_audiobook_description: str = Query(default="", max_length=512),
    search_audiobook_copyright: str = Query(default="", max_length=512),
    search_audiobook_asin: str = Query(default="", max_length=64),
    search_audiobook_isbn: str = Query(default="", max_length=64),
    search_audiobook_language: str = Query(default="", max_length=64),
    search_audiobook_abridged: str = Query(default="", max_length=32),
    search_subtitle_languages: str = Query(default="", max_length=200),
    search_subtitle_codecs: str = Query(default="", max_length=200),
    search_subtitle_sources: str = Query(default="", max_length=64),
    sort_key: Literal[
        "file",
        "container",
        "size",
        "bitrate",
        "audio_bitrate",
        "play_count",
        "bit_depth",
        "audio_title",
        "audio_artist",
        "audio_album",
        "audio_album_artist",
        "audio_genre",
        "audio_date",
        "audio_disc",
        "audio_composer",
        "audio_channels",
        "sample_rate",
        "track_number",
        "bit_rate_mode",
        "has_embedded_cover",
        "chapter_count",
        "audiobook_narrator",
        "audiobook_author",
        "audiobook_publisher",
        "audiobook_series",
        "audiobook_series_part",
        "audiobook_description",
        "audiobook_copyright",
        "audiobook_language",
        "audiobook_abridged",
        "audiobook_asin",
        "audiobook_isbn",
        "video_codec",
        "resolution",
        "hdr_type",
        "duration",
        "audio_codecs",
        "audio_spatial_profiles",
        "audio_languages",
        "subtitle_languages",
        "subtitle_codecs",
        "subtitle_sources",
        "mtime",
        "last_analyzed_at",
        "quality_score",
    ] = Query(default="file"),
    sort_direction: Literal["asc", "desc"] = Query(default="asc"),
    db: Session = Depends(get_db_session),
) -> GroupedMediaTablePageRead:
    if not library_exists(db, library_id):
        raise HTTPException(status_code=404, detail="Library not found")
    if sort_key != "file":
        raise HTTPException(status_code=400, detail="Grouped table view only supports file sorting")
    try:
        return list_grouped_library_files(
            db,
            library_id,
            offset=offset,
            limit=limit,
            search=search,
            search_filters=_library_file_search_filters(
                file_search=file_search,
                search_container=search_container,
                search_size=search_size,
                search_quality_score=search_quality_score,
                search_bitrate=search_bitrate,
                search_audio_bitrate=search_audio_bitrate,
                search_bit_depth=search_bit_depth,
                search_video_codec=search_video_codec,
                search_resolution=search_resolution,
                search_hdr_type=search_hdr_type,
                search_duration=search_duration,
                search_audio_codecs=search_audio_codecs,
                search_audio_spatial_profiles=search_audio_spatial_profiles,
                search_audio_languages=search_audio_languages,
                search_jellyfin_name=search_jellyfin_name,
        search_audio_title=search_audio_title,
        search_audio_artist=search_audio_artist,
        search_audio_album=search_audio_album,
        search_audio_album_artist=search_audio_album_artist,
        search_audio_genre=search_audio_genre,
        search_audio_date=search_audio_date,
        search_audio_disc=search_audio_disc,
        search_audio_composer=search_audio_composer,
        search_audio_channels=search_audio_channels,
        search_sample_rate=search_sample_rate,
        search_track_number=search_track_number,
        search_bit_rate_mode=search_bit_rate_mode,
        search_has_embedded_cover=search_has_embedded_cover,
                search_chapter_count=search_chapter_count,
                search_chapter_titles=search_chapter_titles,
                search_audiobook_narrator=search_audiobook_narrator,
                search_audiobook_author=search_audiobook_author,
                search_audiobook_publisher=search_audiobook_publisher,
                search_audiobook_series=search_audiobook_series,
                search_audiobook_series_part=search_audiobook_series_part,
                search_audiobook_description=search_audiobook_description,
                search_audiobook_copyright=search_audiobook_copyright,
                search_audiobook_asin=search_audiobook_asin,
                search_audiobook_isbn=search_audiobook_isbn,
                search_audiobook_language=search_audiobook_language,
                search_audiobook_abridged=search_audiobook_abridged,
                search_subtitle_languages=search_subtitle_languages,
                search_subtitle_codecs=search_subtitle_codecs,
                search_subtitle_sources=search_subtitle_sources,
            ),
            sort_direction=sort_direction,
            cursor=cursor,
            include_total=include_total,
        )
    except SearchValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/libraries/{library_id}/files/export.csv")
def library_files_export_csv(
    library_id: int,
    search: str = Query(default="", max_length=200),
    file_search: str = Query(default="", max_length=200),
    search_container: str = Query(default="", max_length=64),
    search_size: str = Query(default="", max_length=64),
    search_quality_score: str = Query(default="", max_length=32),
    search_bitrate: str = Query(default="", max_length=64),
    search_audio_bitrate: str = Query(default="", max_length=64),
    search_bit_depth: str = Query(default="", max_length=32),
    search_video_codec: str = Query(default="", max_length=200),
    search_resolution: str = Query(default="", max_length=64),
    search_hdr_type: str = Query(default="", max_length=200),
    search_duration: str = Query(default="", max_length=64),
    search_audio_codecs: str = Query(default="", max_length=200),
    search_audio_spatial_profiles: str = Query(default="", max_length=200),
    search_audio_languages: str = Query(default="", max_length=200),
    search_jellyfin_name: str = Query(default="", max_length=512),
    search_audio_title: str = Query(default="", max_length=512),
    search_audio_artist: str = Query(default="", max_length=512),
    search_audio_album: str = Query(default="", max_length=512),
    search_audio_album_artist: str = Query(default="", max_length=512),
    search_audio_genre: str = Query(default="", max_length=256),
    search_audio_date: str = Query(default="", max_length=32),
    search_audio_disc: str = Query(default="", max_length=32),
    search_audio_composer: str = Query(default="", max_length=512),
    search_audio_channels: str = Query(default="", max_length=32),
    search_sample_rate: str = Query(default="", max_length=32),
    search_track_number: str = Query(default="", max_length=32),
    search_bit_rate_mode: str = Query(default="", max_length=32),
    search_has_embedded_cover: str = Query(default="", max_length=16),
    search_chapter_count: str = Query(default="", max_length=32),
    search_chapter_titles: str = Query(default="", max_length=512),
    search_audiobook_narrator: str = Query(default="", max_length=512),
    search_audiobook_author: str = Query(default="", max_length=512),
    search_audiobook_publisher: str = Query(default="", max_length=512),
    search_audiobook_series: str = Query(default="", max_length=512),
    search_audiobook_series_part: str = Query(default="", max_length=64),
    search_audiobook_description: str = Query(default="", max_length=512),
    search_audiobook_copyright: str = Query(default="", max_length=512),
    search_audiobook_asin: str = Query(default="", max_length=64),
    search_audiobook_isbn: str = Query(default="", max_length=64),
    search_audiobook_language: str = Query(default="", max_length=64),
    search_audiobook_abridged: str = Query(default="", max_length=32),
    search_subtitle_languages: str = Query(default="", max_length=200),
    search_subtitle_codecs: str = Query(default="", max_length=200),
    search_subtitle_sources: str = Query(default="", max_length=64),
    sort_key: Literal[
        "file",
        "container",
        "size",
        "bitrate",
        "audio_bitrate",
        "play_count",
        "bit_depth",
        "audio_title",
        "audio_artist",
        "audio_album",
        "audio_album_artist",
        "audio_genre",
        "audio_date",
        "audio_disc",
        "audio_composer",
        "audio_channels",
        "sample_rate",
        "track_number",
        "bit_rate_mode",
        "has_embedded_cover",
        "chapter_count",
        "audiobook_narrator",
        "audiobook_author",
        "audiobook_publisher",
        "audiobook_series",
        "audiobook_series_part",
        "audiobook_description",
        "audiobook_copyright",
        "audiobook_language",
        "audiobook_abridged",
        "audiobook_asin",
        "audiobook_isbn",
        "video_codec",
        "resolution",
        "hdr_type",
        "duration",
        "audio_codecs",
        "audio_spatial_profiles",
        "audio_languages",
        "subtitle_languages",
        "subtitle_codecs",
        "subtitle_sources",
        "mtime",
        "last_analyzed_at",
        "quality_score",
    ] = Query(default="file"),
    sort_direction: Literal["asc", "desc"] = Query(default="asc"),
    db: Session = Depends(get_db_session),
) -> StreamingResponse:
    library = db.get(Library, library_id)
    if library is None:
        raise HTTPException(status_code=404, detail="Library not found")

    try:
        filename, content = generate_library_files_csv_export(
            db,
            library_id,
            library_name=library.name,
            search=search,
            search_filters=_library_file_search_filters(
                file_search=file_search,
                search_container=search_container,
                search_size=search_size,
                search_quality_score=search_quality_score,
                search_bitrate=search_bitrate,
                search_audio_bitrate=search_audio_bitrate,
                search_bit_depth=search_bit_depth,
                search_video_codec=search_video_codec,
                search_resolution=search_resolution,
                search_hdr_type=search_hdr_type,
                search_duration=search_duration,
                search_audio_codecs=search_audio_codecs,
                search_audio_spatial_profiles=search_audio_spatial_profiles,
                search_audio_languages=search_audio_languages,
                search_jellyfin_name=search_jellyfin_name,
        search_audio_title=search_audio_title,
        search_audio_artist=search_audio_artist,
        search_audio_album=search_audio_album,
        search_audio_album_artist=search_audio_album_artist,
        search_audio_genre=search_audio_genre,
        search_audio_date=search_audio_date,
        search_audio_disc=search_audio_disc,
        search_audio_composer=search_audio_composer,
        search_audio_channels=search_audio_channels,
        search_sample_rate=search_sample_rate,
        search_track_number=search_track_number,
        search_bit_rate_mode=search_bit_rate_mode,
        search_has_embedded_cover=search_has_embedded_cover,
                search_chapter_count=search_chapter_count,
                search_chapter_titles=search_chapter_titles,
                search_audiobook_narrator=search_audiobook_narrator,
                search_audiobook_author=search_audiobook_author,
                search_audiobook_publisher=search_audiobook_publisher,
                search_audiobook_series=search_audiobook_series,
                search_audiobook_series_part=search_audiobook_series_part,
                search_audiobook_description=search_audiobook_description,
                search_audiobook_copyright=search_audiobook_copyright,
                search_audiobook_asin=search_audiobook_asin,
                search_audiobook_isbn=search_audiobook_isbn,
                search_audiobook_language=search_audiobook_language,
                search_audiobook_abridged=search_audiobook_abridged,
                search_subtitle_languages=search_subtitle_languages,
                search_subtitle_codecs=search_subtitle_codecs,
                search_subtitle_sources=search_subtitle_sources,
            ),
            sort_key=sort_key,
            sort_direction=sort_direction,
        )
    except SearchValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return StreamingResponse(
        content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/libraries/{library_id}/scan/cancel", response_model=ScanCancelResponse)
def library_scan_cancel(
    library_id: int,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> ScanCancelResponse:
    if not library_exists(db, library_id):
        raise HTTPException(status_code=404, detail="Library not found")
    try:
        canceled_ids = runtime.cancel_library_jobs(library_id)
    except ScanCancelPersistenceError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Scan cancellation was requested for {len(exc.canceled_job_ids)} active job(s), "
                "but the database is still busy. Try again shortly."
            ),
        ) from exc
    return ScanCancelResponse(canceled_jobs=len(canceled_ids))


@router.post("/libraries/{library_id}/scan", response_model=ScanJobRead, status_code=202)
def library_scan(
    library_id: int,
    payload: ScanRequest,
    db: Session = Depends(get_db_session),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> ScanJobRead:
    if not library_exists(db, library_id):
        raise HTTPException(status_code=404, detail="Library not found")

    job_id, _created = runtime.request_scan(
        library_id,
        payload.scan_type,
        trigger_source=ScanTriggerSource.manual,
        trigger_details={"reason": "user_requested"},
    )
    job = db.get(ScanJob, job_id)
    if job is None:
        raise HTTPException(status_code=500, detail="Failed to load scan job")
    return serialize_scan_job(job)


@router.get("/files/search", response_model=MediaFileSearchResponse)
def file_search(
    query: str = Query(default="", max_length=200),
    library_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db_session),
) -> MediaFileSearchResponse:
    if library_id is not None and not library_exists(db, library_id):
        raise HTTPException(status_code=404, detail="Library not found")
    return search_media_files(db, query=query, library_id=library_id, limit=limit)


@router.get("/transcoding/capabilities", response_model=TranscodeCapabilitiesRead)
def transcoding_capabilities(
    refresh: bool = Query(default=False),
    settings: Settings = Depends(get_app_settings),
) -> TranscodeCapabilitiesRead:
    return get_transcode_capabilities(settings, refresh=refresh)


@router.get("/transcoding/capability-matrix", response_model=TranscodeCapabilityMatrixRead)
def transcoding_capability_matrix(
    settings: Settings = Depends(get_app_settings),
) -> TranscodeCapabilityMatrixRead:
    return load_transcode_matrix(settings)


@router.post("/transcoding/capability-matrix/test", response_model=TranscodeCapabilityMatrixRead)
def transcoding_capability_matrix_test(
    settings: Settings = Depends(get_app_settings),
) -> TranscodeCapabilityMatrixRead:
    try:
        return run_transcode_matrix_test(settings)
    except TranscodeMatrixBusyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/files/{file_id}/transcode", response_model=FileTranscodeRead)
def file_transcode_detail(
    file_id: int,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> FileTranscodeRead:
    media_file = db.get(MediaFile, file_id)
    if media_file is None:
        raise HTTPException(status_code=404, detail="Media file not found")
    if not media_file.video_streams:
        raise HTTPException(status_code=409, detail="Transcoding requires a regular video stream")
    return get_file_transcode(db, settings, media_file)


@router.post("/files/{file_id}/transcode/validate", response_model=TranscodeValidationRead)
def file_transcode_validate(
    file_id: int,
    payload: TranscodePlan,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> TranscodeValidationRead:
    media_file = db.get(MediaFile, file_id)
    if media_file is None:
        raise HTTPException(status_code=404, detail="Media file not found")
    return validate_transcode_plan(db, settings, media_file, payload)


@router.post("/files/{file_id}/transcode", response_model=TranscodeJobRead, status_code=202)
def file_transcode_start(
    file_id: int,
    payload: TranscodePlan,
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> TranscodeJobRead:
    try:
        job, _validation = runtime.request_transcode(file_id, payload)
    except TranscodeValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.validation.model_dump(mode="json")) from exc
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if message == "Media file not found" else 400
        raise HTTPException(status_code=status_code, detail=message) from exc
    return serialize_transcode_job(job)


@router.get("/transcode-jobs/active", response_model=TranscodeJobPageRead)
def transcode_jobs_active(db: Session = Depends(get_db_session)) -> TranscodeJobPageRead:
    return list_transcode_jobs(db, active_only=True, limit=200)


@router.get("/transcode-jobs", response_model=TranscodeJobPageRead)
def transcode_jobs_list(
    library_id: int | None = Query(default=None, ge=1),
    status: JobStatus | None = Query(default=None),
    started_after: datetime | None = Query(default=None),
    started_before: datetime | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db_session),
) -> TranscodeJobPageRead:
    return list_transcode_jobs(
        db,
        library_id=library_id,
        status=status,
        started_after=started_after,
        started_before=started_before,
        limit=limit,
        offset=offset,
    )


@router.get("/transcode-jobs/{job_id}", response_model=TranscodeJobRead)
def transcode_job_detail(
    job_id: int,
    db: Session = Depends(get_db_session),
) -> TranscodeJobRead:
    job = db.get(TranscodeJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Transcoding job not found")
    return serialize_transcode_job(job)


@router.post("/transcode-jobs/{job_id}/cancel", response_model=TranscodeJobRead)
def transcode_job_cancel(
    job_id: int,
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> TranscodeJobRead:
    try:
        return serialize_transcode_job(runtime.cancel_transcode(job_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/files/{file_id}", response_model=MediaFileDetail)
def file_detail(
    file_id: int,
    include_raw_ffprobe: bool = Query(default=True),
    db: Session = Depends(get_db_session),
) -> MediaFileDetail:
    media_file = get_media_file_detail(db, file_id, include_raw_ffprobe=include_raw_ffprobe)
    if not media_file:
        raise HTTPException(status_code=404, detail="Media file not found")
    return media_file


@router.get("/files/{file_id}/connectors", response_model=list[FileConnectorSourceRead])
def file_connector_sources(
    file_id: int,
    db: Session = Depends(get_db_session),
) -> list[FileConnectorSourceRead]:
    media_file = db.get(MediaFile, file_id)
    if media_file is None:
        raise HTTPException(status_code=404, detail="Media file not found")
    rows = db.execute(
        select(ConnectorMediaMatch, ConnectorItem, ConnectorConnection)
        .join(ConnectorItem, ConnectorItem.id == ConnectorMediaMatch.connector_item_id)
        .join(ConnectorConnection, ConnectorConnection.id == ConnectorItem.connection_id)
        .where(ConnectorMediaMatch.media_file_id == file_id)
        .order_by(
            ConnectorConnection.provider,
            ConnectorConnection.name,
            ConnectorItem.title,
            ConnectorItem.id,
        )
    ).all()
    preferred_candidates = [
        (match, item, connection)
        for match, item, connection in rows
        if connection.id == media_file.library.preferred_connector_connection_id
    ]
    preferred_item_id = min(
        (item.id for _match, item, _connection in preferred_candidates),
        default=None,
    )
    return [
        FileConnectorSourceRead(
            connection_id=connection.id,
            connection_name=connection.name,
            provider=connection.provider,
            connector_item_id=item.id,
            remote_id=item.remote_id,
            title=item.title,
            item_type=item.item_type,
            remote_path=item.remote_path,
            match_method=match.match_method,
            preferred=item.id == preferred_item_id,
            original_title=item.original_title,
            series_name=item.series_name,
            season_name=item.season_name,
            date_created=item.date_created,
            premiere_date=item.premiere_date,
            production_year=item.production_year,
            overview=item.overview,
            provider_ids=public_connector_payload(item.provider_ids or {}),
            provider_payload={},
        )
        for match, item, connection in rows
    ]


@router.get(
    "/files/{file_id}/connector-playback",
    response_model=list[ConnectorPlaybackSourceRead],
)
def file_connector_playback(
    file_id: int,
    db: Session = Depends(get_db_session),
) -> list[ConnectorPlaybackSourceRead]:
    if db.get(MediaFile, file_id) is None:
        raise HTTPException(status_code=404, detail="Media file not found")
    sources = db.execute(
        select(ConnectorItem, ConnectorConnection)
        .join(ConnectorMediaMatch, ConnectorMediaMatch.connector_item_id == ConnectorItem.id)
        .join(ConnectorConnection, ConnectorConnection.id == ConnectorItem.connection_id)
        .where(
            ConnectorMediaMatch.media_file_id == file_id,
            ConnectorMediaMatch.status == "matched",
        )
        .order_by(ConnectorConnection.provider, ConnectorConnection.name, ConnectorItem.id)
    ).all()
    result: list[ConnectorPlaybackSourceRead] = []
    for item, connection in sources:
        if not bool((connection.capabilities or {}).get("users")):
            continue
        user_rows = db.execute(
            select(ConnectorUserItemData, ConnectorUser)
            .join(ConnectorUser, ConnectorUser.id == ConnectorUserItemData.connector_user_id)
            .where(
                ConnectorUserItemData.connector_item_id == item.id,
                ConnectorUser.enabled_for_sync.is_(True),
            )
            .order_by(ConnectorUser.name, ConnectorUser.remote_id)
        ).all()
        event_rows = db.execute(
            select(ConnectorPlaybackEvent, ConnectorUser)
            .join(ConnectorUser, ConnectorUser.id == ConnectorPlaybackEvent.connector_user_id)
            .where(
                ConnectorPlaybackEvent.connector_item_id == item.id,
                ConnectorUser.enabled_for_sync.is_(True),
            )
            .order_by(ConnectorPlaybackEvent.played_at.desc(), ConnectorPlaybackEvent.id.desc())
        ).all()
        history_start = db.scalar(
            select(func.min(ConnectorPlaybackEvent.played_at))
            .join(ConnectorUser, ConnectorUser.id == ConnectorPlaybackEvent.connector_user_id)
            .where(
                ConnectorPlaybackEvent.connection_id == connection.id,
                ConnectorUser.enabled_for_sync.is_(True),
            )
        )
        result.append(
            ConnectorPlaybackSourceRead(
                connection_id=connection.id,
                connection_name=connection.name,
                provider=connection.provider,
                connector_item_id=item.id,
                user_data=[
                    ConnectorPlaybackUserDataRead(
                        remote_user_id=user.remote_id,
                        user_name=user.name,
                        play_count=data.play_count,
                        played=data.played,
                        playback_position_ticks=data.playback_position_ticks,
                        last_played_date=data.last_played_date,
                        is_favorite=data.is_favorite,
                    )
                    for data, user in user_rows
                ],
                playback_events=[
                    ConnectorPlaybackEventRead(
                        remote_event_id=event.remote_event_id,
                        remote_user_id=user.remote_id,
                        user_name=user.name,
                        played_at=event.played_at,
                    )
                    for event, user in event_rows
                ],
                individual_playback_history_start_at=history_start,
            )
        )
    return result


@router.get("/files/{file_id}/raw-ffprobe", response_model=MediaFileRawProbeRead)
def file_raw_ffprobe(
    file_id: int,
    db: Session = Depends(get_db_session),
) -> MediaFileRawProbeRead:
    payload = get_media_file_raw_ffprobe(db, file_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Media file not found")
    return payload


@router.get("/files/{file_id}/jellyfin", response_model=JellyfinFileOverlayRead)
def file_jellyfin_overlay(
    file_id: int,
    db: Session = Depends(get_db_session),
) -> JellyfinFileOverlayRead:
    media_file = db.get(MediaFile, file_id)
    if media_file is None:
        raise HTTPException(status_code=404, detail="Media file not found")
    preferred_connection_id = media_file.library.preferred_connector_connection_id
    preferred_connector_item: ConnectorItem | None = None
    preferred_connection: ConnectorConnection | None = None
    if preferred_connection_id is not None:
        preferred_connection = db.get(ConnectorConnection, preferred_connection_id)
        if preferred_connection is None or preferred_connection.provider != "jellyfin":
            return JellyfinFileOverlayRead()
        preferred_connector_item = db.scalar(
            select(ConnectorItem)
            .join(
                ConnectorMediaMatch,
                ConnectorMediaMatch.connector_item_id == ConnectorItem.id,
            )
            .where(
                ConnectorItem.connection_id == preferred_connection_id,
                ConnectorMediaMatch.media_file_id == file_id,
                ConnectorMediaMatch.status == "matched",
                )
                .order_by(
                    ConnectorItem.id,
                )
        )
        if preferred_connector_item is None:
            return JellyfinFileOverlayRead()
        item = db.scalar(
            select(JellyfinItem).where(
                JellyfinItem.jellyfin_item_id == preferred_connector_item.remote_id
            )
        ) if is_legacy_default_connection(preferred_connection) else None
        if item is None:
            payload = preferred_connector_item.provider_payload or {}
            return JellyfinFileOverlayRead(
                item=JellyfinItemRead(
                    id=preferred_connector_item.id,
                    jellyfin_item_id=preferred_connector_item.remote_id,
                    item_type=preferred_connector_item.item_type,
                    path=preferred_connector_item.remote_path,
                    title=preferred_connector_item.title,
                    original_title=preferred_connector_item.original_title,
                    series_name=preferred_connector_item.series_name,
                    season_name=preferred_connector_item.season_name,
                    index_number=preferred_connector_item.index_number,
                    parent_index_number=preferred_connector_item.parent_index_number,
                    date_created=preferred_connector_item.date_created,
                    premiere_date=preferred_connector_item.premiere_date,
                    production_year=preferred_connector_item.production_year,
                    overview=preferred_connector_item.overview,
                    provider_ids=public_connector_payload(
                        preferred_connector_item.provider_ids or {}
                    ),
                    image_tags={},
                    backdrop_image_tags=[],
                    match_status=preferred_connector_item.match_status,
                    mismatch_reason=preferred_connector_item.mismatch_reason,
                )
            )
        match = db.scalar(
            select(JellyfinMediaMatch).where(
                JellyfinMediaMatch.media_file_id == file_id,
                JellyfinMediaMatch.jellyfin_item_id == item.id,
                JellyfinMediaMatch.status == "matched",
            )
        )
    else:
        match = db.scalar(
            select(JellyfinMediaMatch).where(
                JellyfinMediaMatch.media_file_id == file_id,
                JellyfinMediaMatch.status == "matched",
            )
        )
        if match is None:
            return JellyfinFileOverlayRead()
        item = db.get(JellyfinItem, match.jellyfin_item_id)
        if item is None:
            return JellyfinFileOverlayRead()
    user_rows = db.execute(
        select(JellyfinUserItemData, JellyfinUser.name)
        .join(JellyfinUser, JellyfinUser.jellyfin_user_id == JellyfinUserItemData.jellyfin_user_id)
        .where(
            JellyfinUserItemData.jellyfin_item_id == item.id,
            JellyfinUser.enabled_for_sync.is_(True),
        )
        .order_by(JellyfinUser.name.asc())
    ).all()
    playback_event_rows = db.execute(
        select(JellyfinPlaybackEvent, JellyfinUser.name)
        .join(JellyfinUser, JellyfinUser.jellyfin_user_id == JellyfinPlaybackEvent.jellyfin_user_id)
        .where(
            JellyfinPlaybackEvent.jellyfin_item_id == item.id,
            JellyfinUser.enabled_for_sync.is_(True),
        )
        .order_by(JellyfinPlaybackEvent.played_at.desc())
    ).all()
    individual_playback_history_start_at = db.scalar(
        select(func.min(JellyfinPlaybackEvent.played_at))
        .join(JellyfinUser, JellyfinUser.jellyfin_user_id == JellyfinPlaybackEvent.jellyfin_user_id)
        .where(JellyfinUser.enabled_for_sync.is_(True))
    )
    return JellyfinFileOverlayRead(
        match=JellyfinMatchRead(
            id=match.id,
            media_file_id=match.media_file_id,
            jellyfin_item_id=match.jellyfin_item_id,
            match_method=match.match_method,
            confidence=match.confidence,
            status=match.status,
            mismatch_reason=match.mismatch_reason,
        ) if match is not None else None,
        item=_jellyfin_item_read(item),
        user_data=[
            JellyfinUserItemDataRead(
                jellyfin_user_id=data.jellyfin_user_id,
                user_name=user_name,
                play_count=data.play_count,
                played=data.played,
                playback_position_ticks=data.playback_position_ticks,
                last_played_date=data.last_played_date,
                is_favorite=data.is_favorite,
            )
            for data, user_name in user_rows
        ],
        playback_events=[
            JellyfinPlaybackEventRead(
                jellyfin_activity_id=event.jellyfin_activity_id,
                jellyfin_user_id=event.jellyfin_user_id,
                user_name=user_name,
                played_at=event.played_at,
            )
            for event, user_name in playback_event_rows
        ],
        individual_playback_history_start_at=individual_playback_history_start_at,
    )


@router.get("/jellyfin/items/{item_id}", response_model=JellyfinItemDetailRead)
def jellyfin_item_detail(
    item_id: int,
    db: Session = Depends(get_db_session),
) -> JellyfinItemDetailRead:
    item = db.get(JellyfinItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Jellyfin item not found")
    library = (
        db.get(JellyfinLibrary, item.library_id)
        if item.library_id is not None
        else db.scalar(select(JellyfinLibrary).where(JellyfinLibrary.name == item.library_name))
    )
    match = db.scalar(
        select(JellyfinMediaMatch).where(JellyfinMediaMatch.jellyfin_item_id == item.id)
    )
    user_rows = list(
        db.execute(
            select(JellyfinUserItemData, JellyfinUser.name)
            .join(JellyfinUser, JellyfinUser.jellyfin_user_id == JellyfinUserItemData.jellyfin_user_id)
            .where(
                JellyfinUserItemData.jellyfin_item_id == item.id,
                JellyfinUser.enabled_for_sync.is_(True),
            )
            .order_by(JellyfinUser.name.asc())
        )
    )
    return JellyfinItemDetailRead(
        item=_jellyfin_item_read(item),
        library_id=library.id if library else None,
        library_name=item.library_name,
        size_bytes=get_jellyfin_item_size(item),
        duration_seconds=get_jellyfin_item_duration(item),
        match=(
            JellyfinMatchRead(
                id=match.id,
                media_file_id=match.media_file_id,
                jellyfin_item_id=match.jellyfin_item_id,
                match_method=match.match_method,
                confidence=match.confidence,
                status=match.status,
                mismatch_reason=match.mismatch_reason,
            )
            if match
            else None
        ),
        user_data=[
            JellyfinUserItemDataRead(
                jellyfin_user_id=data.jellyfin_user_id,
                user_name=user_name,
                play_count=data.play_count,
                played=data.played,
                playback_position_ticks=data.playback_position_ticks,
                last_played_date=data.last_played_date,
                is_favorite=data.is_favorite,
            )
            for data, user_name in user_rows
        ],
    )


@router.get("/jellyfin/images/{item_id}/{image_type}")
def jellyfin_image(
    item_id: int,
    image_type: Literal["Primary", "Backdrop", "Thumb"],
    request: Request,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> Response:
    item = db.get(JellyfinItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Jellyfin item not found")
    connection = db.get(JellyfinConnection, 1)
    api_key = read_jellyfin_api_key(connection, settings.jellyfin_api_key_file)
    if connection is None or not connection.base_url or not api_key:
        raise HTTPException(status_code=503, detail="Jellyfin connection is not configured")
    if image_type == "Backdrop":
        tag = next(iter(item.backdrop_image_tags or []), None)
    else:
        tag = (item.image_tags or {}).get(image_type)
    if not tag:
        raise HTTPException(status_code=404, detail="Jellyfin image is not available")
    etag = f'"{tag}"'
    if request.headers.get("if-none-match") == etag:
        return Response(
            status_code=304,
            headers={"ETag": etag, "Cache-Control": "private, max-age=3600"},
        )
    try:
        with JellyfinClient(connection.base_url, api_key) as jellyfin_client:
            image = JELLYFIN_IMAGE_CACHE.get(
                jellyfin_client,
                item.jellyfin_item_id,
                image_type,
                tag,
            )
    except JellyfinError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return StreamingResponse(
        io.BytesIO(image.content),
        media_type=image.content_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "ETag": etag,
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/compatibility/hardware-profiles", response_model=list[HardwareProfile])
def compatibility_hardware_profiles(settings: Settings = Depends(get_app_settings)):
    try:
        return list_profiles(settings, "hardware")
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc


@router.post("/compatibility/hardware-profiles", response_model=HardwareProfile, status_code=201)
def create_compatibility_hardware_profile(
    payload: HardwareProfile,
    settings: Settings = Depends(get_app_settings),
):
    try:
        return create_local_profile(settings, "hardware", payload.model_dump(mode="json"))
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc


@router.patch("/compatibility/hardware-profiles/{profile_id}", response_model=HardwareProfile)
def update_compatibility_hardware_profile(
    profile_id: str,
    payload: dict,
    settings: Settings = Depends(get_app_settings),
):
    try:
        profile = update_local_profile(settings, "hardware", profile_id, payload)
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc
    if profile is None:
        raise HTTPException(status_code=404, detail="Hardware profile not found")
    return profile


@router.delete("/compatibility/hardware-profiles/{profile_id}", status_code=204)
def delete_compatibility_hardware_profile(
    profile_id: str,
    settings: Settings = Depends(get_app_settings),
):
    try:
        deleted = delete_local_profile(settings, "hardware", profile_id)
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Hardware profile not found")


@router.get("/compatibility/software-profiles", response_model=list[SoftwareProfile])
def compatibility_software_profiles(settings: Settings = Depends(get_app_settings)):
    try:
        return list_profiles(settings, "software")
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc


@router.post("/compatibility/software-profiles", response_model=SoftwareProfile, status_code=201)
def create_compatibility_software_profile(
    payload: SoftwareProfile,
    settings: Settings = Depends(get_app_settings),
):
    try:
        return create_local_profile(settings, "software", payload.model_dump(mode="json"))
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc


@router.patch("/compatibility/software-profiles/{profile_id}", response_model=SoftwareProfile)
def update_compatibility_software_profile(
    profile_id: str,
    payload: dict,
    settings: Settings = Depends(get_app_settings),
):
    try:
        profile = update_local_profile(settings, "software", profile_id, payload)
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc
    if profile is None:
        raise HTTPException(status_code=404, detail="Software profile not found")
    return profile


@router.delete("/compatibility/software-profiles/{profile_id}", status_code=204)
def delete_compatibility_software_profile(
    profile_id: str,
    settings: Settings = Depends(get_app_settings),
):
    try:
        deleted = delete_local_profile(settings, "software", profile_id)
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Software profile not found")


@router.get("/compatibility/profiles", response_model=list[CompatibilityProfile])
def compatibility_profiles(settings: Settings = Depends(get_app_settings)):
    try:
        return list_profiles(settings, "compatibility")
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc


@router.post("/compatibility/profiles", response_model=CompatibilityProfile, status_code=201)
def create_compatibility_profile(
    payload: CompatibilityProfile,
    settings: Settings = Depends(get_app_settings),
):
    try:
        return create_local_profile(settings, "compatibility", payload.model_dump(mode="json"))
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc


@router.patch("/compatibility/profiles/{profile_id}", response_model=CompatibilityProfile)
def update_compatibility_profile(
    profile_id: str,
    payload: dict,
    settings: Settings = Depends(get_app_settings),
):
    try:
        profile = update_local_profile(settings, "compatibility", profile_id, payload)
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc
    if profile is None:
        raise HTTPException(status_code=404, detail="Compatibility profile not found")
    return profile


@router.delete("/compatibility/profiles/{profile_id}", status_code=204)
def delete_compatibility_profile(
    profile_id: str,
    settings: Settings = Depends(get_app_settings),
):
    try:
        deleted = delete_local_profile(settings, "compatibility", profile_id)
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Compatibility profile not found")


def _evaluate_saved_compatibility_profile(
    profile_id: str,
    file_id: int,
    db: Session,
    settings: Settings,
) -> CompatibilityEvaluation:
    try:
        profile = get_profile(settings, "compatibility", profile_id)
        if profile is None:
            raise HTTPException(status_code=404, detail="Compatibility profile not found")
        hardware = get_profile(settings, "hardware", profile.hardware_profile_id)
        software = get_profile(settings, "software", profile.software_profile_id)
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc
    media_file = get_media_file_detail(db, file_id)
    if media_file is None:
        raise HTTPException(status_code=404, detail="Media file not found")
    if hardware is None or software is None:
        raise HTTPException(status_code=400, detail="Compatibility profile references missing profiles")
    return evaluate_compatibility(media_file, profile, hardware, software)


@router.post(
    "/compatibility/profiles/{profile_id}/evaluate",
    response_model=CompatibilityEvaluation,
)
def evaluate_saved_compatibility_profile(
    profile_id: str,
    payload: CompatibilityEvaluateRequest,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
):
    return _evaluate_saved_compatibility_profile(profile_id, payload.file_id, db, settings)


@router.get("/files/{file_id}/compatibility", response_model=list[CompatibilityEvaluation])
def file_compatibility(
    file_id: int,
    profile_ids: list[str] | None = Query(default=None),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
):
    try:
        profiles = list_profiles(settings, "compatibility")
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc
    selected_ids = set(profile_ids or [])
    return [
        _evaluate_saved_compatibility_profile(profile.id, file_id, db, settings)
        for profile in profiles
        if not selected_ids or profile.id in selected_ids
    ]


@router.get(
    "/files/{file_id}/hardware-compatibility",
    response_model=list[ProfileEvaluation],
)
def file_hardware_compatibility(
    file_id: int,
    profile_ids: list[str] | None = Query(default=None),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
):
    media_file = get_media_file_detail(db, file_id)
    if media_file is None:
        raise HTTPException(status_code=404, detail="Media file not found")
    try:
        profiles = list_profiles(settings, "hardware")
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc
    selected_ids = set(profile_ids or [])
    return [
        evaluate_hardware_profile(media_file, profile)
        for profile in profiles
        if not selected_ids or profile.id in selected_ids
    ]


@router.get(
    "/files/{file_id}/software-compatibility",
    response_model=list[ProfileEvaluation],
)
def file_software_compatibility(
    file_id: int,
    profile_ids: list[str] | None = Query(default=None),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
):
    media_file = get_media_file_detail(db, file_id)
    if media_file is None:
        raise HTTPException(status_code=404, detail="Media file not found")
    try:
        profiles = list_profiles(settings, "software")
    except ProfileCatalogError as exc:
        raise _profile_error(exc) from exc
    selected_ids = set(profile_ids or [])
    return [
        evaluate_software_profile(media_file, profile)
        for profile in profiles
        if not selected_ids or profile.id in selected_ids
    ]


@router.get("/files/{file_id}/chapters/export.csv")
def file_chapters_export(file_id: int, db: Session = Depends(get_db_session)) -> StreamingResponse:
    export = generate_media_chapters_csv_export(db, file_id)
    if not export:
        raise HTTPException(status_code=404, detail="Media file not found")
    filename, content = export
    return StreamingResponse(
        content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/files/{file_id}/cover")
def file_cover(
    file_id: int,
    download: bool = Query(default=False),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> StreamingResponse:
    try:
        export = generate_media_cover_png(db, file_id, ffmpeg_path=settings.ffmpeg_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if not export:
        raise HTTPException(status_code=404, detail="Embedded cover not found")
    filename, content = export
    headers = {"Cache-Control": "no-store"}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return StreamingResponse(io.BytesIO(content), media_type="image/png", headers=headers)


@router.get("/files/{file_id}/media")
def file_media(
    file_id: int,
    download: bool = Query(default=False),
    db: Session = Depends(get_db_session),
) -> FileResponse:
    try:
        source = get_media_file_source(db, file_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not source:
        raise HTTPException(status_code=404, detail="Media file not found")

    file_path, filename, media_type = source
    response = FileResponse(
        path=Path(file_path),
        media_type=media_type,
        filename=filename if download else None,
        content_disposition_type="attachment" if download else "inline",
        headers={"Cache-Control": "no-store"},
    )
    return response


@router.get("/files/{file_id}/streams", response_model=MediaFileStreamDetails)
def file_stream_details(file_id: int, db: Session = Depends(get_db_session)) -> MediaFileStreamDetails:
    payload = get_media_file_stream_details(db, file_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Media file not found")
    return payload


@router.get("/files/{file_id}/quality-score", response_model=MediaFileQualityScoreDetail)
def file_quality_score(file_id: int, db: Session = Depends(get_db_session)) -> MediaFileQualityScoreDetail:
    payload = get_media_file_quality_score_detail(db, file_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Media file not found")
    return payload


@router.get("/files/{file_id}/history", response_model=MediaFileHistoryRead)
def file_history(
    file_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db_session),
) -> MediaFileHistoryRead:
    payload = get_media_file_history(db, file_id, limit=limit)
    if not payload:
        raise HTTPException(status_code=404, detail="Media file not found")
    return payload
