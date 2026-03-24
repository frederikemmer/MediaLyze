from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from pydantic import BeforeValidator, PlainSerializer


def normalize_utc_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def serialize_utc_datetime(value: datetime) -> str:
    return normalize_utc_datetime(value).isoformat().replace("+00:00", "Z")


UtcDateTime = Annotated[
    datetime,
    BeforeValidator(normalize_utc_datetime),
    PlainSerializer(serialize_utc_datetime, return_type=str, when_used="json"),
]
