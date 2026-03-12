from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.app.api.deps import get_app_settings, get_db_session, get_scan_runtime
from backend.app.core.config import Settings
from backend.app.schemas.app_settings import AppSettingsRead, AppSettingsUpdate
from backend.app.schemas.browse import BrowseResponse
from backend.app.schemas.library import LibraryCreate, LibraryStatistics, LibrarySummary, LibraryUpdate
from backend.app.schemas.media import DashboardResponse, MediaFileDetail, MediaFileTablePage
from backend.app.schemas.scan import ScanCancelResponse, ScanJobRead, ScanRequest
from backend.app.models.entities import ScanJob
from backend.app.services.app_settings import get_app_settings as load_app_settings
from backend.app.services.app_settings import update_app_settings
from backend.app.services.browse import browse_media_root
from backend.app.services.library_service import (
    create_library,
    delete_library,
    get_library_statistics,
    get_library_summary,
    library_exists,
    list_libraries,
    update_library_settings,
)
from backend.app.services.media_service import get_media_file_detail, list_library_files
from backend.app.services.runtime import ScanRuntimeManager
from backend.app.services.scan_jobs import list_active_scan_jobs, list_library_scan_jobs, serialize_scan_job
from backend.app.services.stats import build_dashboard

router = APIRouter()


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


@router.get("/dashboard", response_model=DashboardResponse)
def dashboard(db: Session = Depends(get_db_session)) -> DashboardResponse:
    return build_dashboard(db)


@router.get("/scan-jobs/active", response_model=list[ScanJobRead])
def active_scan_jobs(db: Session = Depends(get_db_session)) -> list[ScanJobRead]:
    return list_active_scan_jobs(db)


@router.get("/app-settings", response_model=AppSettingsRead)
def app_settings(db: Session = Depends(get_db_session)) -> AppSettingsRead:
    return load_app_settings(db)


@router.patch("/app-settings", response_model=AppSettingsRead)
def app_settings_update(
    payload: AppSettingsUpdate,
    db: Session = Depends(get_db_session),
) -> AppSettingsRead:
    try:
        return update_app_settings(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
def library_statistics(library_id: int, db: Session = Depends(get_db_session)) -> LibraryStatistics:
    statistics = get_library_statistics(db, library_id)
    if not statistics:
        raise HTTPException(status_code=404, detail="Library not found")
    return statistics


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
    runtime: ScanRuntimeManager = Depends(get_scan_runtime),
) -> LibrarySummary:
    try:
        library = update_library_settings(db, library_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if library is None:
        raise HTTPException(status_code=404, detail="Library not found")

    runtime.sync_library(library.id)
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
    search: str = Query(default="", max_length=200),
    sort_key: Literal[
        "file",
        "size",
        "video_codec",
        "resolution",
        "hdr_type",
        "duration",
        "audio_codecs",
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
    return list_library_files(
        db,
        library_id,
        offset=offset,
        limit=limit,
        search=search,
        sort_key=sort_key,
        sort_direction=sort_direction,
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

    job_id, _created = runtime.request_scan(library_id, payload.scan_type)
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
