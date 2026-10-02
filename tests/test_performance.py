import asyncio
from sqlalchemy import text
from backend.app.services.performance import PerformanceMetrics, PerformanceMiddleware, performance_metrics, observe_executor
from backend.app.core.config import Settings
from backend.app.db.session import create_engine_for_settings


def test_observations_are_bounded_and_group_requests_by_route_template():
    metrics = PerformanceMetrics(limit=2, samples=3)
    async def app(scope, _receive, send):
        scope["route"] = type("Route", (), {"path": "/files/{file_id}"})()
        await send({"type": "http.response.body", "body": b"payload"})
    middleware = PerformanceMiddleware(app, metrics)
    async def send(_message):
        pass
    for i in range(10):
        asyncio.run(middleware({"type": "http", "method": "GET", "path": f"/files/{i}"}, None, send))
    route = metrics.snapshot()["routes"]["GET /files/{file_id}"]
    assert route["count"] == 10
    assert route["retained_samples"] == 3
    assert route["response_bytes"] == 21
    assert "file_id" not in str(route)
    for label in ["a", "b", "c"]:
        metrics.record(metrics.queues, label, (0.01, 0, 0, 0))
    assert set(metrics.snapshot()["queues"]) == {"b", "c"}


def test_sql_observations_follow_the_request_context(tmp_path):
    settings = Settings(config_path=tmp_path, media_root=tmp_path, performance_metrics=True)
    engine = create_engine_for_settings(settings)
    metrics = PerformanceMetrics()
    async def app(scope, _receive, send):
        scope["route"] = type("Route", (), {"path": "/example"})()
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        await send({"type": "http.response.body", "body": b"ok"})
    async def send(_message):
        pass
    asyncio.run(PerformanceMiddleware(app, metrics)({"type": "http", "method": "GET"}, None, send))
    assert metrics.snapshot()["routes"]["GET /example"]["sql_count"] == 1
    engine.dispose()


def test_disabled_observations_preserve_the_original_executor():
    previous = performance_metrics.enabled
    try:
        performance_metrics.enabled = False
        executor = object()
        assert observe_executor(executor, "scan") is executor
    finally:
        performance_metrics.enabled = previous


def test_diagnostics_are_opt_in_and_queue_waits_are_observed(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from fastapi.testclient import TestClient
    from backend.app.main import create_app
    previous = performance_metrics.enabled
    try:
        off = create_app(Settings(config_path=tmp_path / "off", media_root=tmp_path, performance_metrics=False, frontend_dist_path=tmp_path / "absent"))
        assert TestClient(off).get("/api/performance").status_code == 404
        on = create_app(Settings(config_path=tmp_path / "on", media_root=tmp_path, performance_metrics=True, frontend_dist_path=tmp_path / "absent"))
        assert TestClient(on).get("/api/performance").status_code == 200
        started, release = Event(), Event()
        executor = observe_executor(ThreadPoolExecutor(max_workers=1), "test_queue")
        def occupied():
            started.set()
            release.wait(2)
        first = executor.submit(occupied)
        assert started.wait(1)
        second = executor.submit(lambda: 42)
        release.set()
        assert first.result(timeout=2) is None
        assert second.result(timeout=2) == 42
        executor.shutdown(wait=True)
        assert performance_metrics.snapshot()["queues"]["test_queue"]["count"] == 2
    finally:
        performance_metrics.enabled = previous
