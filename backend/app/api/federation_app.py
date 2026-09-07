"""Optional protocol-only ASGI application for desktop and split deployments."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.app.api.deps import get_app_settings
from backend.app.api.federation_routes import federation_protocol_router
from backend.app.core.config import Settings
from backend.app.db.session import init_db


def create_federation_app(settings: Settings | None = None, runtime=None) -> FastAPI:
    active_settings = settings

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        init_db()
        yield

    app = FastAPI(
        title="MediaLyze Transcode Federation Protocol",
        version=(active_settings.app_version if active_settings else "0.0.0"),
        lifespan=lifespan,
    )
    if active_settings is not None:
        app.dependency_overrides[get_app_settings] = lambda: active_settings
    app.state.scan_runtime = runtime
    app.include_router(federation_protocol_router, prefix=(active_settings.api_prefix if active_settings else "/api"))
    return app
