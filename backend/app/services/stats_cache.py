from __future__ import annotations

from collections import OrderedDict
from threading import Lock

from backend.app.schemas.comparison import ComparisonFieldId, ComparisonResponse
from backend.app.schemas.library import LibraryStatistics, LibrarySummary
from backend.app.schemas.library_history import DashboardHistoryResponse
from backend.app.schemas.media import DashboardResponse


def _get_cached(cache: OrderedDict, key):
    value = cache.get(key)
    if value is not None:
        cache.move_to_end(key)
    return value


def _set_cached(cache: OrderedDict, key, value, *, limit: int) -> None:
    cache[key] = value
    cache.move_to_end(key)
    while len(cache) > limit:
        cache.popitem(last=False)


def _delete_matching(cache: OrderedDict, predicate) -> None:
    for key in list(cache):
        if predicate(key):
            cache.pop(key, None)


class StatsCache:
    _DASHBOARD_LIMIT = 4
    _DASHBOARD_HISTORY_LIMIT = 4
    _DASHBOARD_COMPARISON_LIMIT = 24
    _LIBRARIES_LIMIT = 4
    _LIBRARY_SUMMARY_LIMIT = 64
    _LIBRARY_STATISTICS_LIMIT = 32
    _LIBRARY_COMPARISON_LIMIT = 64

    def __init__(self) -> None:
        self._lock = Lock()
        self._dashboard: OrderedDict[str, DashboardResponse] = OrderedDict()
        self._dashboard_history: OrderedDict[str, DashboardHistoryResponse] = OrderedDict()
        self._dashboard_comparisons: OrderedDict[
            tuple[str, ComparisonFieldId, ComparisonFieldId],
            ComparisonResponse,
        ] = OrderedDict()
        self._libraries: OrderedDict[str, list[LibrarySummary]] = OrderedDict()
        self._library_summaries: OrderedDict[tuple[str, int], LibrarySummary] = OrderedDict()
        self._library_statistics: OrderedDict[tuple[str, int], LibraryStatistics] = OrderedDict()
        self._library_comparisons: OrderedDict[
            tuple[str, int, ComparisonFieldId, ComparisonFieldId],
            ComparisonResponse,
        ] = OrderedDict()

    def get_dashboard(self, cache_key: str) -> DashboardResponse | None:
        with self._lock:
            return _get_cached(self._dashboard, cache_key)

    def set_dashboard(self, cache_key: str, payload: DashboardResponse) -> None:
        with self._lock:
            _set_cached(self._dashboard, cache_key, payload, limit=self._DASHBOARD_LIMIT)

    def get_dashboard_history(self, cache_key: str) -> DashboardHistoryResponse | None:
        with self._lock:
            return _get_cached(self._dashboard_history, cache_key)

    def set_dashboard_history(self, cache_key: str, payload: DashboardHistoryResponse) -> None:
        with self._lock:
            _set_cached(self._dashboard_history, cache_key, payload, limit=self._DASHBOARD_HISTORY_LIMIT)

    def get_dashboard_comparison(
        self,
        cache_key: str,
        x_field: ComparisonFieldId,
        y_field: ComparisonFieldId,
    ) -> ComparisonResponse | None:
        with self._lock:
            return _get_cached(self._dashboard_comparisons, (cache_key, x_field, y_field))

    def set_dashboard_comparison(
        self,
        cache_key: str,
        x_field: ComparisonFieldId,
        y_field: ComparisonFieldId,
        payload: ComparisonResponse,
    ) -> None:
        with self._lock:
            _set_cached(
                self._dashboard_comparisons,
                (cache_key, x_field, y_field),
                payload,
                limit=self._DASHBOARD_COMPARISON_LIMIT,
            )

    def get_libraries(self, cache_key: str) -> list[LibrarySummary] | None:
        with self._lock:
            return _get_cached(self._libraries, cache_key)

    def set_libraries(self, cache_key: str, payload: list[LibrarySummary]) -> None:
        with self._lock:
            _set_cached(self._libraries, cache_key, payload, limit=self._LIBRARIES_LIMIT)

    def get_library_summary(self, cache_key: str, library_id: int) -> LibrarySummary | None:
        with self._lock:
            return _get_cached(self._library_summaries, (cache_key, library_id))

    def set_library_summary(self, cache_key: str, library_id: int, payload: LibrarySummary) -> None:
        with self._lock:
            _set_cached(self._library_summaries, (cache_key, library_id), payload, limit=self._LIBRARY_SUMMARY_LIMIT)

    def get_library_statistics(self, cache_key: str, library_id: int) -> LibraryStatistics | None:
        with self._lock:
            return _get_cached(self._library_statistics, (cache_key, library_id))

    def set_library_statistics(self, cache_key: str, library_id: int, payload: LibraryStatistics) -> None:
        with self._lock:
            _set_cached(
                self._library_statistics,
                (cache_key, library_id),
                payload,
                limit=self._LIBRARY_STATISTICS_LIMIT,
            )

    def get_library_comparison(
        self,
        cache_key: str,
        library_id: int,
        x_field: ComparisonFieldId,
        y_field: ComparisonFieldId,
    ) -> ComparisonResponse | None:
        with self._lock:
            return _get_cached(self._library_comparisons, (cache_key, library_id, x_field, y_field))

    def set_library_comparison(
        self,
        cache_key: str,
        library_id: int,
        x_field: ComparisonFieldId,
        y_field: ComparisonFieldId,
        payload: ComparisonResponse,
    ) -> None:
        with self._lock:
            _set_cached(
                self._library_comparisons,
                (cache_key, library_id, x_field, y_field),
                payload,
                limit=self._LIBRARY_COMPARISON_LIMIT,
            )

    def invalidate(self, cache_key: str, library_id: int | None = None) -> None:
        with self._lock:
            self._dashboard.pop(cache_key, None)
            self._dashboard_history.pop(cache_key, None)
            _delete_matching(self._dashboard_comparisons, lambda key: key[0] == cache_key)
            self._libraries.pop(cache_key, None)
            if library_id is None:
                _delete_matching(self._library_summaries, lambda key: key[0] == cache_key)
                _delete_matching(self._library_statistics, lambda key: key[0] == cache_key)
                _delete_matching(self._library_comparisons, lambda key: key[0] == cache_key)
            else:
                _delete_matching(
                    self._library_summaries,
                    lambda key: key[0] == cache_key and key[1] == library_id,
                )
                _delete_matching(
                    self._library_statistics,
                    lambda key: key[0] == cache_key and key[1] == library_id,
                )
                _delete_matching(
                    self._library_comparisons,
                    lambda key: key[0] == cache_key and key[1] == library_id,
                )


stats_cache = StatsCache()
