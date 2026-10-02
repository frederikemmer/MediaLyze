"""Opt-in, bounded performance observations without URLs, SQL text or media paths."""
from collections import OrderedDict, deque
from contextvars import ContextVar
from dataclasses import dataclass
from math import ceil
from threading import Lock
from time import perf_counter


@dataclass
class SqlObservation:
    count: int = 0
    seconds: float = 0.0


request_sql: ContextVar[SqlObservation | None] = ContextVar("performance_sql", default=None)


class PerformanceMetrics:
    def __init__(self, limit=64, samples=256):
        self.limit, self.samples = limit, samples
        self.lock = Lock()
        self.enabled = False
        self.counters = OrderedDict()
        self.routes = OrderedDict()
        self.queues = OrderedDict()

    def record(self, cache, key, sample):
        with self.lock:
            if key not in cache:
                cache[key] = {"count": 0, "samples": deque(maxlen=self.samples)}
            cache[key]["count"] += 1
            cache[key]["samples"].append(sample)
            cache.move_to_end(key)
            while len(cache) > self.limit:
                cache.popitem(last=False)

    def increment(self, name):
        with self.lock:
            self.counters[name] = self.counters.get(name, 0) + 1
            while len(self.counters) > self.limit:
                self.counters.popitem(last=False)

    def snapshot(self):
        def summarize(cache):
            result = {}
            for key, entry in cache.items():
                samples = list(entry["samples"])
                durations = sorted(row[0] for row in samples)
                result[key] = {
                    "count": entry["count"], "retained_samples": len(samples),
                    "median_ms": durations[len(durations)//2] * 1000,
                    "p95_ms": durations[ceil(len(durations)*0.95)-1] * 1000,
                    "sql_count": sum(row[1] for row in samples),
                    "sql_ms": sum(row[2] for row in samples)*1000,
                    "response_bytes": sum(row[3] for row in samples),
                }
            return result
        with self.lock:
            return {"routes": summarize(self.routes), "queues": summarize(self.queues), "counters": dict(self.counters)}


performance_metrics = PerformanceMetrics()


class PerformanceMiddleware:
    def __init__(self, app, metrics=performance_metrics):
        self.app, self.metrics = app, metrics

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        observation = SqlObservation()
        token = request_sql.set(observation)
        started, byte_count = perf_counter(), 0
        async def measured_send(message):
            nonlocal byte_count
            if message["type"] == "http.response.body":
                byte_count += len(message.get("body", b""))
            await send(message)
        try:
            await self.app(scope, receive, measured_send)
        finally:
            route = scope.get("route")
            label = f"{scope['method']} {getattr(route, 'path', '<unmatched>')}"
            self.metrics.record(self.metrics.routes, label, (perf_counter()-started, observation.count, observation.seconds, byte_count))
            request_sql.reset(token)


def install_sql_observations(engine):
    from sqlalchemy import event
    @event.listens_for(engine, "before_cursor_execute")
    def before(_conn, _cursor, _statement, _parameters, context, _executemany):
        if request_sql.get() is not None:
            context._performance_started = perf_counter()
    @event.listens_for(engine, "after_cursor_execute")
    def after(_conn, _cursor, _statement, _parameters, context, _executemany):
        observation = request_sql.get()
        if observation is not None and hasattr(context, "_performance_started"):
            observation.count += 1
            observation.seconds += perf_counter() - context._performance_started


class ObservedExecutor:
    def __init__(self, executor, label):
        self.executor, self.label = executor, label

    def submit(self, fn, *args, **kwargs):
        queued_at = perf_counter()
        def run():
            performance_metrics.record(performance_metrics.queues, self.label, (perf_counter()-queued_at, 0, 0.0, 0))
            return fn(*args, **kwargs)
        return self.executor.submit(run)

    def shutdown(self, **kwargs):
        return self.executor.shutdown(**kwargs)


def observe_executor(executor, label):
    return ObservedExecutor(executor, label) if performance_metrics.enabled else executor
