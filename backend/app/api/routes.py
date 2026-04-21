from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.app.api.deps import get_app_settings, get_db_session, get_scan_runtime
from backend.app.core.config import Settings
from backend.app.schemas.app_settings import AppSettingsRead, AppSettingsUpdate
from backend.app.schemas.browse import BrowseResponse
from backend.app.schemas.comparison import ComparisonFieldId, ComparisonResponse
from backend.app.schemas.duplicates import DuplicateGroupPageRead
from backend.app.schemas.history import HistoryReconstructionStatusRead, HistoryStorageRead
from backend.app.schemas.library import LibraryCreate, LibraryStatistics, LibrarySummary, LibraryUpdate
from backend.app.schemas.library_history import DashboardHistoryResponse, LibraryHistoryResponse
from backend.app.schemas.media import (
    DashboardResponse,
    MediaFileDetail,
    MediaFileHistoryRead,
    MediaFileQualityScoreDetail,
    MediaFileStreamDetails,
    MediaFileTablePage,
)
from backend.app.schemas.path_access import PathInspectRequest, PathInspectResponse
from backend.app.schemas.scan import (
    RecentScanJobPageRead,
    RecentScanJobRead,
    ScanCancelResponse,
    ScanJobDetailRead,
    ScanJobRead,
    ScanRequest,
)
from backend.app.models.entities import Library, ScanJob, ScanTriggerSource
from backend.app.services.app_settings import get_app_settings as load_app_settings
from backend.app.services.app_settings import update_app_settings
from backend.app.services.browse import browse_media_root
from backend.app.services.duplicates import list_library_duplicate_groups
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
from backend.app.services.media_search import LibraryFileSearchFilters, SearchValidationError
from backend.app.services.media_service import (
    generate_library_files_csv_export,
    get_media_file_detail,
    get_media_file_history,
    get_media_file_quality_score_detail,
    get_media_file_stream_details,
    list_library_files,
)
from backend.app.services.path_access import inspect_desktop_path
from backend.app.services.runtime import ScanRuntimeManager
from backend.app.services.scan_jobs import (
    get_scan_job_detail,
    list_active_scan_jobs,
    list_library_scan_jobs,
    list_recent_scan_jobs,
    serialize_scan_job,
)
from backend.app.services.stat_comparisons import get_dashboard_comparison, get_library_comparison
from backend.app.services.stats import build_dashboard

router = APIRouter()


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
    search_video_codec: str = "",
    search_resolution: str = "",
    search_hdr_type: str = "",
    search_duration: str = "",
    search_audio_codecs: str = "",
    search_audio_spatial_profiles: str = "",
    search_audio_languages: str = "",
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
        search_video_codec=search_video_codec,
        search_resolution=search_resolution,
        search_hdr_type=search_hdr_type,
        search_duration=search_duration,
        search_audio_codecs=search_audio_codecs,
        search_audio_spatial_profiles=search_audio_spatial_profiles,
        search_audio_languages=search_audio_languages,
        search_subtitle_languages=search_subtitle_languages,
        search_subtitle_codecs=search_subtitle_codecs,
        search_subtitle_sources=search_subtitle_sources,
    )


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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
    db: Session = Depends(get_db_session),
) -> ComparisonResponse:
    if x_field == y_field:
        raise HTTPException(status_code=400, detail="Comparison axes must use different fields")
    return get_dashboard_comparison(db, x_field=x_field, y_field=y_field)


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
    for library_id in recompute_library_ids:
        runtime.request_quality_recompute(library_id)
    return updated_settings


@router.post("/scan-jobs/active/cancel", response_model=ScanCancelResponse)
def cancel_active_scan_jobs(
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> ScanCancelResponse:
    canceled_ids = runtime.cancel_active_jobs()
    return ScanCancelResponse(canceled_jobs=len(canceled_ids))


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
    db: Session = Depends(get_db_session),
) -> ComparisonResponse:
    if x_field == y_field:
        raise HTTPException(status_code=400, detail="Comparison axes must use different fields")
    payload = get_library_comparison(db, library_id=library_id, x_field=x_field, y_field=y_field)
    if payload is None:
        raise HTTPException(status_code=404, detail="Library not found")
    return payload


@router.get("/libraries/{library_id}/duplicates", response_model=DuplicateGroupPageRead)
def library_duplicates(
    library_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=200),
    db: Session = Depends(get_db_session),
) -> DuplicateGroupPageRead:
    try:
        return list_library_duplicate_groups(db, library_id, offset=offset, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Library not found") from exc


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


@router.patch("/libraries/{library_id}", response_model=LibrarySummary)
def library_update(
    library_id: int,
    payload: LibraryUpdate,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> LibrarySummary:
    try:
        library, quality_profile_changed = update_library_settings(db, settings, library_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if library is None:
        raise HTTPException(status_code=404, detail="Library not found")

    runtime.sync_library(library.id)
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

    runtime.cancel_library_jobs(library_id)
    deleted = delete_library(db, library_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Library not found")
    runtime.sync_library(library_id, library=None)


@router.get("/libraries/{library_id}/files", response_model=MediaFileTablePage)
def library_files(
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
    search_video_codec: str = Query(default="", max_length=200),
    search_resolution: str = Query(default="", max_length=64),
    search_hdr_type: str = Query(default="", max_length=200),
    search_duration: str = Query(default="", max_length=64),
    search_audio_codecs: str = Query(default="", max_length=200),
    search_audio_spatial_profiles: str = Query(default="", max_length=200),
    search_audio_languages: str = Query(default="", max_length=200),
    search_subtitle_languages: str = Query(default="", max_length=200),
    search_subtitle_codecs: str = Query(default="", max_length=200),
    search_subtitle_sources: str = Query(default="", max_length=64),
    sort_key: Literal[
        "file",
        "container",
        "size",
        "bitrate",
        "audio_bitrate",
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
                search_video_codec=search_video_codec,
                search_resolution=search_resolution,
                search_hdr_type=search_hdr_type,
                search_duration=search_duration,
                search_audio_codecs=search_audio_codecs,
                search_audio_spatial_profiles=search_audio_spatial_profiles,
                search_audio_languages=search_audio_languages,
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
    search_video_codec: str = Query(default="", max_length=200),
    search_resolution: str = Query(default="", max_length=64),
    search_hdr_type: str = Query(default="", max_length=200),
    search_duration: str = Query(default="", max_length=64),
    search_audio_codecs: str = Query(default="", max_length=200),
    search_audio_spatial_profiles: str = Query(default="", max_length=200),
    search_audio_languages: str = Query(default="", max_length=200),
    search_subtitle_languages: str = Query(default="", max_length=200),
    search_subtitle_codecs: str = Query(default="", max_length=200),
    search_subtitle_sources: str = Query(default="", max_length=64),
    sort_key: Literal[
        "file",
        "container",
        "size",
        "bitrate",
        "audio_bitrate",
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
                search_video_codec=search_video_codec,
                search_resolution=search_resolution,
                search_hdr_type=search_hdr_type,
                search_duration=search_duration,
                search_audio_codecs=search_audio_codecs,
                search_audio_spatial_profiles=search_audio_spatial_profiles,
                search_audio_languages=search_audio_languages,
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


@router.get("/files/{file_id}", response_model=MediaFileDetail)
def file_detail(file_id: int, db: Session = Depends(get_db_session)) -> MediaFileDetail:
    media_file = get_media_file_detail(db, file_id)
    if not media_file:
        raise HTTPException(status_code=404, detail="Media file not found")
    return media_file


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
