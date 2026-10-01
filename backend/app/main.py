from contextlib import asynccontextmanager
from pathlib import Path
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import Headers
from starlette.middleware.gzip import GZipResponder
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend.app.api.routes import router
from backend.app.core.config import get_settings
from backend.app.db.session import init_db
from backend.app.services.runtime import ScanRuntimeManager

HTML_CACHE_CONTROL = "no-cache"
ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"
logger = logging.getLogger("uvicorn.error")


class JsonGZipResponder(GZipResponder):
    async def send_with_compression(self, message: Message) -> None:
        await super().send_with_compression(message)
        if message["type"] != "http.response.start":
            return
        content_type = Headers(raw=message["headers"]).get("content-type", "")
        if not content_type.startswith("application/json"):
            self.content_type_is_excluded = True


class JsonGZipMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        minimum_size: int = 1024,
        compresslevel: int = 5,
    ) -> None:
        self.app = app
        self.minimum_size = minimum_size
        self.compresslevel = compresslevel

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        if "gzip" not in headers.get("Accept-Encoding", ""):
            await self.app(scope, receive, send)
            return
        responder = JsonGZipResponder(
            self.app,
            self.minimum_size,
            compresslevel=self.compresslevel,
        )
        await responder(scope, receive, send)


class ImmutableAssetStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = ASSET_CACHE_CONTROL
        return response


def _frontend_file_response(path: Path) -> FileResponse:
    headers = {"Cache-Control": HTML_CACHE_CONTROL} if path.suffix == ".html" else None
    return FileResponse(path, headers=headers)


def create_app(settings=None) -> FastAPI:
    active_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        init_db()
        runtime = ScanRuntimeManager(active_settings)
        _app.state.scan_runtime = runtime
        logger.info("Application startup: starting runtime and history maintenance")
        runtime.start()
        logger.info("Application startup: runtime ready")
        yield
        runtime.stop()

    app = FastAPI(
        title=active_settings.app_name,
        version=active_settings.app_version,
        lifespan=lifespan,
    )
    app.add_middleware(JsonGZipMiddleware, minimum_size=1024, compresslevel=5)
    if not active_settings.is_desktop:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    app.include_router(router, prefix=active_settings.api_prefix)

    frontend_dist = Path(active_settings.frontend_dist_path)
    if frontend_dist.exists():
        assets_dir = frontend_dist / "assets"
        if assets_dir.exists():
            app.mount("/assets", ImmutableAssetStaticFiles(directory=assets_dir), name="assets")

        @app.get("/{path:path}")
        def serve_frontend(path: str) -> FileResponse:
            candidate = frontend_dist / path
            if path and candidate.exists() and candidate.is_file():
                return _frontend_file_response(candidate)
            return _frontend_file_response(frontend_dist / "index.html")

    return app


app = create_app()
