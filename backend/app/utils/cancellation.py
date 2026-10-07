"""Thread-local cooperative cancellation for probe and hashing workers."""
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Event


class WorkCanceled(Exception):
    pass


_event: ContextVar[Event | None] = ContextVar('media_work_cancel', default=None)


def check_canceled() -> None:
    event = _event.get()
    if event is not None and event.is_set():
        raise WorkCanceled()


@contextmanager
def cancellation_scope(event: Event):
    token = _event.set(event)
    try:
        check_canceled()
        yield
    finally:
        _event.reset(token)


@contextmanager
def cancel_workers_on_exit(event: Event):
    try:
        yield
    except BaseException:
        event.set()
        raise
