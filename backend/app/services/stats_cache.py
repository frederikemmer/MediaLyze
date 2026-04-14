from __future__ import annotations

from copy import deepcopy
from threading import Lock

from backend.app.schemas.comparison import ComparisonFieldId, ComparisonResponse
from backend.app.schemas.library import LibraryStatistics, LibrarySummary
from backend.app.schemas.media import DashboardResponse


class StatsCache:
    def __init__(self) -> None:
        self._lock = Lock()
        self._dashboard: dict[str, DashboardResponse] = {}
        self._dashboard_comparisons: dict[str, dict[tuple[ComparisonFieldId, ComparisonFieldId], ComparisonResponse]] = {}
        self._libraries: dict[str, list[LibrarySummary]] = {}
        self._library_summaries: dict[str, dict[int, LibrarySummary]] = {}
        self._library_statistics: dict[str, dict[int, LibraryStatistics]] = {}
        self._library_comparisons: dict[
            str,
            dict[int, dict[tuple[ComparisonFieldId, ComparisonFieldId], ComparisonResponse]],
        ] = {}

    def get_dashboard(self, cache_key: str) -> DashboardResponse | None:
        with self._lock:
            return deepcopy(self._dashboard.get(cache_key))

    def set_dashboard(self, cache_key: str, payload: DashboardResponse) -> None:
        with self._lock:
            self._dashboard[cache_key] = deepcopy(payload)

    def get_dashboard_comparison(
        self,
        cache_key: str,
        x_field: ComparisonFieldId,
        y_field: ComparisonFieldId,
    ) -> ComparisonResponse | None:
        with self._lock:
            return deepcopy(self._dashboard_comparisons.get(cache_key, {}).get((x_field, y_field)))

    def set_dashboard_comparison(
        self,
        cache_key: str,
        x_field: ComparisonFieldId,
        y_field: ComparisonFieldId,
        payload: ComparisonResponse,
    ) -> None:
        with self._lock:
            self._dashboard_comparisons.setdefault(cache_key, {})[(x_field, y_field)] = deepcopy(payload)

    def get_libraries(self, cache_key: str) -> list[LibrarySummary] | None:
        with self._lock:
            return deepcopy(self._libraries.get(cache_key))

    def set_libraries(self, cache_key: str, payload: list[LibrarySummary]) -> None:
        with self._lock:
            self._libraries[cache_key] = deepcopy(payload)

    def get_library_summary(self, cache_key: str, library_id: int) -> LibrarySummary | None:
        with self._lock:
            return deepcopy(self._library_summaries.get(cache_key, {}).get(library_id))

    def set_library_summary(self, cache_key: str, library_id: int, payload: LibrarySummary) -> None:
        with self._lock:
            self._library_summaries.setdefault(cache_key, {})[library_id] = deepcopy(payload)

    def get_library_statistics(self, cache_key: str, library_id: int) -> LibraryStatistics | None:
        with self._lock:
            return deepcopy(self._library_statistics.get(cache_key, {}).get(library_id))

    def set_library_statistics(self, cache_key: str, library_id: int, payload: LibraryStatistics) -> None:
        with self._lock:
            self._library_statistics.setdefault(cache_key, {})[library_id] = deepcopy(payload)

    def get_library_comparison(
        self,
        cache_key: str,
        library_id: int,
        x_field: ComparisonFieldId,
        y_field: ComparisonFieldId,
    ) -> ComparisonResponse | None:
        with self._lock:
            return deepcopy(
                self._library_comparisons.get(cache_key, {}).get(library_id, {}).get((x_field, y_field))
            )

    def set_library_comparison(
        self,
        cache_key: str,
        library_id: int,
        x_field: ComparisonFieldId,
        y_field: ComparisonFieldId,
        payload: ComparisonResponse,
    ) -> None:
        with self._lock:
            self._library_comparisons.setdefault(cache_key, {}).setdefault(library_id, {})[(x_field, y_field)] = deepcopy(payload)

    def invalidate(self, cache_key: str, library_id: int | None = None) -> None:
        with self._lock:
            self._dashboard.pop(cache_key, None)
            self._dashboard_comparisons.pop(cache_key, None)
            self._libraries.pop(cache_key, None)
            if library_id is None:
                self._library_summaries.pop(cache_key, None)
                self._library_statistics.pop(cache_key, None)
                self._library_comparisons.pop(cache_key, None)
            else:
                self._library_summaries.setdefault(cache_key, {}).pop(library_id, None)
                self._library_statistics.setdefault(cache_key, {}).pop(library_id, None)
                self._library_comparisons.setdefault(cache_key, {}).pop(library_id, None)


stats_cache = StatsCache()
