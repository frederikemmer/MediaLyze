from fastapi import Depends, Request
from sqlalchemy.orm import Session

from backend.app.core.config import Settings, get_settings
from backend.app.db.session import get_db
from backend.app.services.runtime import ScanRuntimeManager


def get_db_session(request: Request, db: Session = Depends(get_db)) -> Session:
    scope = getattr(request.state, "access_scope", None)
    if scope is not None:
        db.info["access_scope"] = scope
        db.info["access_principal"] = request.state.principal
        db.info["access_external_catalog"] = getattr(request.state, "access_external_catalog", False)
    return db


def get_app_settings() -> Settings:
    return get_settings()


def get_scan_runtime(request: Request) -> ScanRuntimeManager:
    return request.app.state.scan_runtime
