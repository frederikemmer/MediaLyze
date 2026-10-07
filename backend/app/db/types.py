from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime, JSON
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    """Persist datetimes as naive UTC and restore them as aware UTC values."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC).replace(tzinfo=None)
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class CompressedHistoryJSON(TypeDecorator):
    """Read legacy JSON and new compressed envelopes as the same dict contract."""

    impl = JSON
    cache_ok = True

    def process_bind_param(self, value, dialect):
        import json
        from backend.app.services.history_compression import encode_snapshot_text
        if value is None:
            return None
        return encode_snapshot_text(json.dumps(value)) or value

    def process_result_value(self, value, dialect):
        from backend.app.services.history_compression import decode_snapshot
        return decode_snapshot(value)
