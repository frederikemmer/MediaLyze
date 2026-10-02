from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from threading import Event, Lock
from time import monotonic
from typing import Generic, TypeVar

from backend.app.services.performance import performance_metrics
from backend.app.schemas.comparison import ComparisonFieldId, ComparisonRendererId, ComparisonResponse
from backend.app.schemas.library import LibraryStatistics, LibrarySummary
from backend.app.schemas.library_history import DashboardHistoryResponse, LibraryHistoryResponse
from backend.app.schemas.media import DashboardResponse
from backend.app.schemas.storage_map import LibraryStorageMapRead

CacheValue = TypeVar("CacheValue")
PanelCacheKey = tuple[str, ...] | None


@dataclass
class _InFlight(Generic[CacheValue]):
    event: Event
    result: CacheValue | None = None
    error: BaseException | None = None


@dataclass(frozen=True)
class _CacheEntry(Generic[CacheValue]):
    value: CacheValue
    expires_at: float


def _get_cached(cache: OrderedDict, key):
    entry = cache.get(key)
    if entry is None:
        if performance_metrics.enabled:
            performance_metrics.increment("cache.lookup.miss")
        return None
    if entry.expires_at <= monotonic():
        cache.pop(key, None)
        if performance_metrics.enabled:
            performance_metrics.increment("cache.lookup.expired")
        return None
    if performance_metrics.enabled:
        performance_metrics.increment("cache.lookup.hit")
    cache.move_to_end(key)
    return entry.value


def _set_cached(cache: OrderedDict, key, value, *, limit: int, ttl_seconds: float) -> None:
    now = monotonic()
    for expired_key, entry in list(cache.items()):
        if entry.expires_at <= now:
            cache.pop(expired_key, None)
    cache[key] = _CacheEntry(value=value, expires_at=now + ttl_seconds)
    cache.move_to_end(key)
    while len(cache) > limit:
        cache.popitem(last=False)


def _delete_matching(cache: OrderedDict, predicate) -> None:
    for key in list(cache):
        if predicate(key):
            cache.pop(key, None)


class StatsCache:
    _DASHBOARD_TTL_SECONDS = 300.0
    _HISTORY_TTL_SECONDS = 300.0
    _COMPARISON_TTL_SECONDS = 300.0
    _LIBRARY_LIST_TTL_SECONDS = 120.0
    _LIBRARY_SUMMARY_TTL_SECONDS = 120.0
    _LIBRARY_FILE_COUNT_TTL_SECONDS = 60.0
    _STORAGE_MAP_TTL_SECONDS = 120.0
    _DASHBOARD_LIMIT = 32
    _DASHBOARD_HISTORY_LIMIT = 4
    _DASHBOARD_COMPARISON_LIMIT = 24
    _LIBRARIES_LIMIT = 4
    _LIBRARY_SUMMARY_LIMIT = 64
    _LIBRARY_HISTORY_LIMIT = 64
    _LIBRARY_STATISTICS_LIMIT = 64
    _LIBRARY_COMPARISON_LIMIT = 64
    _LIBRARY_FILE_COUNT_LIMIT = 256
    _STORAGE_MAP_LIMIT = 128

    def __init__(self) -> None:
        self._lock = Lock()
        self._dashboard: OrderedDict[tuple[str, PanelCacheKey], DashboardResponse] = OrderedDict()
        self._dashboard_history: OrderedDict[str, DashboardHistoryResponse] = OrderedDict()
        self._dashboard_comparisons: OrderedDict[
            tuple[str, ComparisonFieldId, ComparisonFieldId, ComparisonRendererId | None],
            ComparisonResponse,
        ] = OrderedDict()
        self._libraries: OrderedDict[str, list[LibrarySummary]] = OrderedDict()
        self._library_summaries: OrderedDict[tuple[str, int], LibrarySummary] = OrderedDict()
        self._library_history: OrderedDict[tuple[str, int], LibraryHistoryResponse] = OrderedDict()
        self._library_statistics: OrderedDict[tuple[str, int, PanelCacheKey], LibraryStatistics] = OrderedDict()
        self._library_comparisons: OrderedDict[
            tuple[str, int, ComparisonFieldId, ComparisonFieldId, ComparisonRendererId | None],
            ComparisonResponse,
        ] = OrderedDict()
        self._library_file_counts: OrderedDict[tuple[str, int, tuple[str, ...]], int] = OrderedDict()
        self._storage_maps: OrderedDict[tuple[str, int, str], LibraryStorageMapRead] = OrderedDict()
        self._inflight: dict[tuple[str, object], _InFlight] = {}
        self._epochs: dict[str, int] = {}

    def _get_or_compute(
        self,
        *,
        namespace: str,
        cache: OrderedDict,
        key,
        limit: int,
        ttl_seconds: float,
        epoch_key: str,
        compute: Callable[[], CacheValue],
    ) -> CacheValue:
        with self._lock:
            cached = _get_cached(cache, key)
            if cached is not None:
                return cached
            epoch = self._epochs.get(epoch_key, 0)
            inflight_key = (namespace, (epoch, key))
            state = self._inflight.get(inflight_key)
            leader = state is None
            if state is None:
                state = _InFlight(event=Event())
                self._inflight[inflight_key] = state

        if not leader:
            state.event.wait()
            if state.error is not None:
                raise state.error
            return state.result  # type: ignore[return-value]

        try:
            result = compute()
        except BaseException as exc:
            with self._lock:
                state.error = exc
                self._inflight.pop(inflight_key, None)
                state.event.set()
            raise

        with self._lock:
            if self._epochs.get(epoch_key, 0) == epoch:
                _set_cached(cache, key, result, limit=limit, ttl_seconds=ttl_seconds)
            state.result = result
            self._inflight.pop(inflight_key, None)
            state.event.set()
        return result

    def get_dashboard(
        self,
        cache_key: str,
        panel_key: PanelCacheKey = None,
    ) -> DashboardResponse | None:
        with self._lock:
            return _get_cached(self._dashboard, (cache_key, panel_key))

    def set_dashboard(
        self,
        cache_key: str,
        payload: DashboardResponse,
        panel_key: PanelCacheKey = None,
    ) -> None:
        with self._lock:
            _set_cached(
                self._dashboard,
                (cache_key, panel_key),
                payload,
                limit=self._DASHBOARD_LIMIT,
                ttl_seconds=self._DASHBOARD_TTL_SECONDS,
            )

    def get_or_compute_dashboard(
        self,
        cache_key: str,
        panel_key: PanelCacheKey,
        compute: Callable[[], DashboardResponse],
    ) -> DashboardResponse:
        return self._get_or_compute(
            namespace="dashboard",
            cache=self._dashboard,
            key=(cache_key, panel_key),
            limit=self._DASHBOARD_LIMIT,
            ttl_seconds=self._DASHBOARD_TTL_SECONDS,
            epoch_key=cache_key,
            compute=compute,
        )

    def get_dashboard_history(self, cache_key: str) -> DashboardHistoryResponse | None:
        with self._lock:
            return _get_cached(self._dashboard_history, cache_key)

    def set_dashboard_history(self, cache_key: str, payload: DashboardHistoryResponse) -> None:
        with self._lock:
            _set_cached(
                self._dashboard_history,
                cache_key,
                payload,
                limit=self._DASHBOARD_HISTORY_LIMIT,
                ttl_seconds=self._HISTORY_TTL_SECONDS,
            )

    def get_or_compute_dashboard_history(
        self,
        cache_key: str,
        compute: Callable[[], DashboardHistoryResponse],
    ) -> DashboardHistoryResponse:
        return self._get_or_compute(
            namespace="dashboard_history",
            cache=self._dashboard_history,
            key=cache_key,
            limit=self._DASHBOARD_HISTORY_LIMIT,
            ttl_seconds=self._HISTORY_TTL_SECONDS,
            epoch_key=f"{cache_key}:connectors",
            compute=compute,
        )

    def get_dashboard_comparison(
        self,
        cache_key: str,
        x_field: ComparisonFieldId,
        y_field: ComparisonFieldId,
        renderer: ComparisonRendererId | None = None,
    ) -> ComparisonResponse | None:
        with self._lock:
            return _get_cached(self._dashboard_comparisons, (cache_key, x_field, y_field, renderer))

    def set_dashboard_comparison(
        self,
        cache_key: str,
        x_field: ComparisonFieldId,
        y_field: ComparisonFieldId,
        payload: ComparisonResponse,
        renderer: ComparisonRendererId | None = None,
    ) -> None:
        with self._lock:
            _set_cached(
                self._dashboard_comparisons,
                (cache_key, x_field, y_field, renderer),
                payload,
                limit=self._DASHBOARD_COMPARISON_LIMIT,
                ttl_seconds=self._COMPARISON_TTL_SECONDS,
            )

    def get_libraries(self, cache_key: str) -> list[LibrarySummary] | None:
        with self._lock:
            return _get_cached(self._libraries, cache_key)

    def set_libraries(self, cache_key: str, payload: list[LibrarySummary]) -> None:
        with self._lock:
            _set_cached(
                self._libraries,
                cache_key,
                payload,
                limit=self._LIBRARIES_LIMIT,
                ttl_seconds=self._LIBRARY_LIST_TTL_SECONDS,
            )

    def get_library_summary(self, cache_key: str, library_id: int) -> LibrarySummary | None:
        with self._lock:
            return _get_cached(self._library_summaries, (cache_key, library_id))

    def get_library_history(self, cache_key: str, library_id: int) -> LibraryHistoryResponse | None:
        with self._lock:
            return _get_cached(self._library_history, (cache_key, library_id))

    def set_library_summary(self, cache_key: str, library_id: int, payload: LibrarySummary) -> None:
        with self._lock:
            _set_cached(
                self._library_summaries,
                (cache_key, library_id),
                payload,
                limit=self._LIBRARY_SUMMARY_LIMIT,
                ttl_seconds=self._LIBRARY_SUMMARY_TTL_SECONDS,
            )

    def set_library_history(self, cache_key: str, library_id: int, payload: LibraryHistoryResponse) -> None:
        with self._lock:
            _set_cached(
                self._library_history,
                (cache_key, library_id),
                payload,
                limit=self._LIBRARY_HISTORY_LIMIT,
                ttl_seconds=self._HISTORY_TTL_SECONDS,
            )

    def get_or_compute_library_history(
        self,
        cache_key: str,
        library_id: int,
        compute: Callable[[], LibraryHistoryResponse],
    ) -> LibraryHistoryResponse:
        return self._get_or_compute(
            namespace="library_history",
            cache=self._library_history,
            key=(cache_key, library_id),
            limit=self._LIBRARY_HISTORY_LIMIT,
            ttl_seconds=self._HISTORY_TTL_SECONDS,
            epoch_key=f"{cache_key}:connectors",
            compute=compute,
        )

    def get_library_statistics(
        self,
        cache_key: str,
        library_id: int,
        panel_key: PanelCacheKey = None,
    ) -> LibraryStatistics | None:
        with self._lock:
            return _get_cached(self._library_statistics, (cache_key, library_id, panel_key))

    def set_library_statistics(
        self,
        cache_key: str,
        library_id: int,
        payload: LibraryStatistics,
        panel_key: PanelCacheKey = None,
    ) -> None:
        with self._lock:
            _set_cached(
                self._library_statistics,
                (cache_key, library_id, panel_key),
                payload,
                limit=self._LIBRARY_STATISTICS_LIMIT,
                ttl_seconds=self._DASHBOARD_TTL_SECONDS,
            )

    def get_or_compute_library_statistics(
        self,
        cache_key: str,
        library_id: int,
        panel_key: PanelCacheKey,
        compute: Callable[[], LibraryStatistics],
    ) -> LibraryStatistics:
        return self._get_or_compute(
            namespace="library_statistics",
            cache=self._library_statistics,
            key=(cache_key, library_id, panel_key),
            limit=self._LIBRARY_STATISTICS_LIMIT,
            ttl_seconds=self._DASHBOARD_TTL_SECONDS,
            epoch_key=(f"{cache_key}:connectors" if panel_key is None or "user_plays" in panel_key else cache_key),
            compute=compute,
        )

    def get_library_comparison(
        self,
        cache_key: str,
        library_id: int,
        x_field: ComparisonFieldId,
        y_field: ComparisonFieldId,
        renderer: ComparisonRendererId | None = None,
    ) -> ComparisonResponse | None:
        with self._lock:
            return _get_cached(
                self._library_comparisons,
                (cache_key, library_id, x_field, y_field, renderer),
            )

    def set_library_comparison(
        self,
        cache_key: str,
        library_id: int,
        x_field: ComparisonFieldId,
        y_field: ComparisonFieldId,
        payload: ComparisonResponse,
        renderer: ComparisonRendererId | None = None,
    ) -> None:
        with self._lock:
            _set_cached(
                self._library_comparisons,
                (cache_key, library_id, x_field, y_field, renderer),
                payload,
                limit=self._LIBRARY_COMPARISON_LIMIT,
                ttl_seconds=self._COMPARISON_TTL_SECONDS,
            )

    def get_or_compute_library_file_count(
        self,
        cache_key: str,
        library_id: int,
        query_key: tuple[str, ...],
        compute: Callable[[], int],
    ) -> int:
        return self._get_or_compute(
            namespace="library_file_count",
            cache=self._library_file_counts,
            key=(cache_key, library_id, query_key),
            limit=self._LIBRARY_FILE_COUNT_LIMIT,
            ttl_seconds=self._LIBRARY_FILE_COUNT_TTL_SECONDS,
            epoch_key=cache_key,
            compute=compute,
        )

    def get_or_compute_storage_map(
        self,
        cache_key: str,
        library_id: int,
        path: str,
        compute: Callable[[], LibraryStorageMapRead],
    ) -> LibraryStorageMapRead:
        return self._get_or_compute(
            namespace="storage_map",
            cache=self._storage_maps,
            key=(cache_key, library_id, path),
            limit=self._STORAGE_MAP_LIMIT,
            ttl_seconds=self._STORAGE_MAP_TTL_SECONDS,
            epoch_key=f"{cache_key}:connectors",
            compute=compute,
        )

    def invalidate_connectors(self, cache_key: str) -> None:
        """Drop connector/playback views while preserving technical aggregates."""
        with self._lock:
            domain = f"{cache_key}:connectors"
            self._epochs[domain] = self._epochs.get(domain, 0) + 1
            self._libraries.pop(cache_key, None)
            self._dashboard_history.pop(cache_key, None)
            for cache in (self._library_summaries, self._library_history, self._library_file_counts, self._storage_maps):
                _delete_matching(cache, lambda key: key[0] == cache_key)
            _delete_matching(
                self._library_statistics,
                lambda key: key[0] == cache_key and (key[2] is None or "user_plays" in key[2]),
            )
            for cache in (self._dashboard_comparisons, self._library_comparisons):
                _delete_matching(cache, lambda key: key[0] == cache_key and bool(set(key) & {"play_count", "users_played"}))

    def invalidate(self, cache_key: str, library_id: int | None = None) -> None:
        with self._lock:
            self._epochs[cache_key] = self._epochs.get(cache_key, 0) + 1
            domain = f"{cache_key}:connectors"
            self._epochs[domain] = self._epochs.get(domain, 0) + 1
            _delete_matching(self._dashboard, lambda key: key[0] == cache_key)
            self._dashboard_history.pop(cache_key, None)
            _delete_matching(self._dashboard_comparisons, lambda key: key[0] == cache_key)
            self._libraries.pop(cache_key, None)
            if library_id is None:
                _delete_matching(self._library_summaries, lambda key: key[0] == cache_key)
                _delete_matching(self._library_history, lambda key: key[0] == cache_key)
                _delete_matching(self._library_statistics, lambda key: key[0] == cache_key)
                _delete_matching(self._library_comparisons, lambda key: key[0] == cache_key)
                _delete_matching(self._library_file_counts, lambda key: key[0] == cache_key)
                _delete_matching(self._storage_maps, lambda key: key[0] == cache_key)
            else:
                _delete_matching(
                    self._library_summaries,
                    lambda key: key[0] == cache_key and key[1] == library_id,
                )
                self._library_history.pop((cache_key, library_id), None)
                _delete_matching(
                    self._library_statistics,
                    lambda key: key[0] == cache_key and key[1] == library_id,
                )
                _delete_matching(
                    self._library_comparisons,
                    lambda key: key[0] == cache_key and key[1] == library_id,
                )
                _delete_matching(
                    self._library_file_counts,
                    lambda key: key[0] == cache_key and key[1] == library_id,
                )
                _delete_matching(
                    self._storage_maps,
                    lambda key: key[0] == cache_key and key[1] == library_id,
                )


stats_cache = StatsCache()
