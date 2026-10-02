from __future__ import annotations

from datetime import UTC, datetime
from threading import Lock, Thread
from time import sleep

from backend.app.schemas.library_history import DashboardHistoryResponse
import backend.app.services.stats_cache as stats_cache_module
from backend.app.services.stats_cache import StatsCache


def test_dashboard_history_cache_coalesces_concurrent_misses() -> None:
    cache = StatsCache()
    compute_count = 0
    compute_lock = Lock()
    results: list[DashboardHistoryResponse] = []

    def compute() -> DashboardHistoryResponse:
        nonlocal compute_count
        with compute_lock:
            compute_count += 1
        sleep(0.05)
        return DashboardHistoryResponse(generated_at=datetime.now(UTC))

    def load() -> None:
        results.append(cache.get_or_compute_dashboard_history("engine", compute))

    threads = [Thread(target=load) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert compute_count == 1
    assert len(results) == 4
    assert all(result is results[0] for result in results)


def test_dashboard_statistics_cache_coalesces_concurrent_panel_misses() -> None:
    cache = StatsCache()
    compute_count = 0
    compute_lock = Lock()
    result = object()
    results: list[object] = []

    def compute():
        nonlocal compute_count
        with compute_lock:
            compute_count += 1
        sleep(0.05)
        return result

    def load() -> None:
        results.append(cache.get_or_compute_dashboard("engine", ("container",), compute))

    threads = [Thread(target=load) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert compute_count == 1
    assert results == [result] * 4


def test_invalidate_removes_all_dashboard_and_target_library_panel_variants() -> None:
    cache = StatsCache()
    dashboard_container = object()
    dashboard_video = object()
    library_container = object()
    library_video = object()
    other_library = object()

    cache.set_dashboard("engine", dashboard_container, ("container",))
    cache.set_dashboard("engine", dashboard_video, ("video_codec",))
    cache.set_library_statistics("engine", 1, library_container, ("container",))
    cache.set_library_statistics("engine", 1, library_video, ("video_codec",))
    cache.set_library_statistics("engine", 2, other_library, ("container",))

    cache.invalidate("engine", 1)

    assert cache.get_dashboard("engine", ("container",)) is None
    assert cache.get_dashboard("engine", ("video_codec",)) is None
    assert cache.get_library_statistics("engine", 1, ("container",)) is None
    assert cache.get_library_statistics("engine", 1, ("video_codec",)) is None
    assert cache.get_library_statistics("engine", 2, ("container",)) is other_library


def test_cache_entries_expire_without_explicit_invalidation(monkeypatch) -> None:
    clock = [100.0]
    monkeypatch.setattr(stats_cache_module, "monotonic", lambda: clock[0])
    cache = StatsCache()
    payload = object()

    cache.set_dashboard("engine", payload, ("container",))
    assert cache.get_dashboard("engine", ("container",)) is payload

    clock[0] += cache._DASHBOARD_TTL_SECONDS + 1
    assert cache.get_dashboard("engine", ("container",)) is None


def test_connector_invalidation_preserves_technical_panels_and_drops_playback_views():
    cache = StatsCache()
    technical, playback, summary, comparison = object(), object(), object(), object()
    cache.set_dashboard("engine", technical, ("container",))
    cache.set_library_statistics("engine", 1, technical, ("container",))
    cache.set_library_statistics("engine", 1, playback, ("user_plays",))
    cache.set_library_summary("engine", 1, summary)
    cache.set_library_comparison("engine", 1, "size", "duration", comparison)
    cache.set_library_comparison("engine", 1, "size", "play_count", playback)
    cache.invalidate_connectors("engine")
    assert cache.get_dashboard("engine", ("container",)) is technical
    assert cache.get_library_statistics("engine", 1, ("container",)) is technical
    assert cache.get_library_statistics("engine", 1, ("user_plays",)) is None
    assert cache.get_library_summary("engine", 1) is None
    assert cache.get_library_comparison("engine", 1, "size", "duration") is comparison
    assert cache.get_library_comparison("engine", 1, "size", "play_count") is None
    cache.invalidate("engine", 1)
    assert cache.get_dashboard("engine", ("container",)) is None
    assert cache.get_library_statistics("engine", 1, ("container",)) is None


def test_connector_invalidation_does_not_discard_an_inflight_technical_result():
    from threading import Event
    cache = StatsCache()
    entered, release = Event(), Event()
    payload = object()
    def compute():
        entered.set()
        assert release.wait(2)
        return payload
    thread = Thread(target=lambda: cache.get_or_compute_library_statistics("engine", 1, ("container",), compute))
    thread.start()
    assert entered.wait(2)
    cache.invalidate_connectors("engine")
    release.set()
    thread.join(2)
    assert cache.get_library_statistics("engine", 1, ("container",)) is payload
