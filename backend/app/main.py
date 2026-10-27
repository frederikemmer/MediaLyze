from contextlib import asynccontextmanager
from pathlib import Path
import mimetypes
import stat as file_stat
from starlette.concurrency import run_in_threadpool
import logging

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from backend.app.api.access_routes import router as access_router
from backend.app.api.access_middleware import AccessMiddleware
from backend.app.services.access import initialize_owner
from backend.app.db.session import SessionLocal
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
        if message["type"] == "http.response.start":
            content_type = Headers(raw=message["headers"]).get("content-type", "")
            self.content_type_is_excluded = not content_type.startswith("application/json")
        if self.content_type_is_excluded:
            await self.send(message)
            return
        await super().send_with_compression(message)


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
        if Path(path).suffix.lower() not in {".js", ".css", ".svg", ".png", ".ico", ".woff", ".woff2"}:
            from starlette.exceptions import HTTPException
            raise HTTPException(404)
        # Resolve through StaticFiles first, retaining its traversal/symlink checks.
        response = await super().get_response(path, scope)
        if response.status_code in (200, 304) and path.endswith((".js", ".css")) and not Headers(scope=scope).get("range"):
            qualities = {}
            for token in Headers(scope=scope).get("accept-encoding", "").lower().split(","):
                parts = token.strip().split(";")
                try:
                    qualities[parts[0]] = float(next((p.strip()[2:] for p in parts[1:] if p.strip().startswith("q=")), "1"))
                except ValueError:
                    qualities[parts[0]] = 0
            for encoding, suffix in sorted((("br", ".br"), ("gzip", ".gz")),
                                            key=lambda item: qualities.get(item[0], qualities.get("*", 0)), reverse=True):
                if qualities.get(encoding, qualities.get("*", 0)) <= 0:
                    continue
                full_path, stat = await run_in_threadpool(self.lookup_path, path + suffix)
                if stat is not None and file_stat.S_ISREG(stat.st_mode):
                    response = self.file_response(full_path, stat, scope)
                    response.headers["Content-Encoding"] = encoding
                    response.headers["Content-Type"] = mimetypes.guess_type(path)[0] or "application/octet-stream"
                    break
        if path.endswith((".js", ".css")):
            response.headers["Vary"] = "Accept-Encoding"
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
        initialize_owner(_app.state.auth_session_factory, active_settings)
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
    if active_settings.performance_metrics:
        from backend.app.services.performance import PerformanceMiddleware, performance_metrics
        performance_metrics.enabled = True
        app.add_middleware(PerformanceMiddleware)

        @app.get(f"{active_settings.api_prefix}/performance", include_in_schema=False)
        def performance_snapshot():
            return performance_metrics.snapshot()

    app.state.auth_session_factory = SessionLocal
    app.state.access_settings = active_settings
    app.add_middleware(AccessMiddleware, settings=active_settings)

    @app.exception_handler(RequestValidationError)
    async def safe_validation_error(request, exc):
        return JSONResponse({"detail": "Invalid request"}, status_code=422)

    app.include_router(access_router, prefix=active_settings.api_prefix)
    app.add_middleware(JsonGZipMiddleware, minimum_size=1024, compresslevel=5)
    app.include_router(router, prefix=active_settings.api_prefix)

    frontend_dist = Path(active_settings.frontend_dist_path)
    if frontend_dist.exists():
        assets_dir = frontend_dist / "assets"
        if assets_dir.exists():
            app.mount("/assets", ImmutableAssetStaticFiles(directory=assets_dir), name="assets")

        @app.get("/{path:path}")
        def serve_frontend(path: str) -> FileResponse:
            from fastapi import HTTPException
            root = frontend_dist.resolve()
            candidate = (root / path).resolve()
            if not candidate.is_relative_to(root) or path.startswith(active_settings.api_prefix.lstrip("/") + "/"):
                raise HTTPException(404, "Not found")
            if path and candidate.is_file():
                if candidate.suffix not in {".js", ".css", ".svg", ".png", ".ico", ".woff", ".woff2"}:
                    raise HTTPException(404, "Not found")
                return _frontend_file_response(candidate)
            return _frontend_file_response(root / "index.html")

    return app


app = create_app()
