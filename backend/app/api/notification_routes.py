"""Personal UI notification history; client supplied feedback, not an audit log."""
from datetime import timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, func, not_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.api.deps import get_db_session
from backend.app.models.entities import NotificationHistoryEntry
from backend.app.services.access import COOKIE, digest
from backend.app.services.app_settings import get_app_settings
from backend.app.services.notification_access import (
    notification_source_allowed,
    prune_notification_history,
)
from backend.app.utils.time import utc_now

router = APIRouter()


class ReferencePart(BaseModel):
    reference: str = Field(max_length=256)


class NotificationSource(BaseModel):
    area: Literal["connectors", "transcoding", "library", "settings"]
    href: str = Field(max_length=2048)
    label: str = Field(max_length=256)

    @field_validator("href")
    @classmethod
    def internal_route(cls, value):
        if not value.startswith("/") or value.startswith("//") or any(ord(char) <= 32 or char == "\\" for char in value):
            raise ValueError("Internal app route required")
        return value


class NotificationWrite(BaseModel):
    preview: bool = False
    event_id: UUID
    type: Literal["success", "info", "warning", "error"]
    message: str | list[str | ReferencePart]
    source: NotificationSource

    @field_validator("message")
    @classmethod
    def bounded_message(cls, value):
        parts = [value] if isinstance(value, str) else value
        if len(parts) > 32 or sum(len(part if isinstance(part, str) else part.reference) for part in parts) > 4096:
            raise ValueError("Notification message too long")
        return value


def owner_key(request: Request) -> str:
    principal = getattr(request.state, "principal", None)
    if principal is None:
        raise HTTPException(401, "Authentication required")
    if principal.kind == "guest":
        token = request.cookies.get(COOKIE)
        if not token:
            raise HTTPException(401, "Authentication required")
        return f"guest:{digest(token)}"
    return f"{principal.kind}:{principal.id}"


PREVIEW_PREFIXES = ("Preview: ", "Vorschau: ", "Vista previa: ", "Приклад: ")
PREVIEW_TARGETS = (
    "/settings?section=application#notification-settings", "/settings?section=libraries",
    "/settings?section=jellyfin", "/transcoding",
)


def legacy_preview_filter():
    """Recognize only former settings-demo prefixes at their exact demo destinations.

    Old records did not store a preview flag. Keep this narrow filter before
    counting/paging so those test messages no longer appear in personal history.
    """
    scalar = func.json_extract(NotificationHistoryEntry.message, "$")
    first_part = func.json_extract(NotificationHistoryEntry.message, "$[0]")
    return and_(
        NotificationHistoryEntry.source["href"].as_string().in_(PREVIEW_TARGETS),
        or_(*(scalar.startswith(prefix, autoescape=True) for prefix in PREVIEW_PREFIXES), first_part.in_(PREVIEW_PREFIXES)),
    )


def filters_for(request, db):
    filters = [NotificationHistoryEntry.owner_key == owner_key(request), not_(func.coalesce(legacy_preview_filter(), False))]
    days = get_app_settings(db).history_retention.notification_history_days
    if days:
        filters.append(NotificationHistoryEntry.created_at >= utc_now() - timedelta(days=days))
    return filters


def serialize(entry):
    return {"id": entry.id, "created_at": entry.created_at, "type": entry.notification_type,
            "message": entry.message, "source": entry.source}


@router.post("/notification-history")
def notification_history_create(payload: NotificationWrite, request: Request, db: Session = Depends(get_db_session)):
    owner = owner_key(request)
    first_text = payload.message if isinstance(payload.message, str) else (payload.message[0] if payload.message else "")
    legacy_preview = payload.source.href in PREVIEW_TARGETS and isinstance(first_text, str) and first_text.startswith(PREVIEW_PREFIXES)
    if payload.preview or legacy_preview:
        return Response(status_code=204)
    principal = getattr(request.state, "principal", None)
    if principal is None:
        raise HTTPException(401, "Authentication required")
    source = payload.source.model_dump()
    if not notification_source_allowed(db, principal, source):
        return Response(status_code=204)
    # Retry IDs are scoped to the caller; a unique index also guards concurrent retries.
    existing = db.scalar(select(NotificationHistoryEntry).where(
        NotificationHistoryEntry.owner_key == owner, NotificationHistoryEntry.event_id == str(payload.event_id)))
    if existing:
        if not notification_source_allowed(db, principal, existing.source or {}):
            db.delete(existing)
            db.commit()
            return Response(status_code=204)
        return serialize(existing)
    message = payload.model_dump(mode="json")["message"]
    text = message if isinstance(message, str) else "".join(part if isinstance(part, str) else part["reference"] for part in message)
    entry = NotificationHistoryEntry(owner_key=owner, event_id=str(payload.event_id),
        notification_type=payload.type, message=message, source=source,
        search_text=f"{text} {payload.source.label}".casefold())
    db.add(entry)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(NotificationHistoryEntry).where(
            NotificationHistoryEntry.owner_key == owner, NotificationHistoryEntry.event_id == str(payload.event_id)))
        if existing is None:
            raise
        return serialize(existing)
    db.refresh(entry)
    return serialize(entry)


@router.get("/notification-history")
def notification_history_list(request: Request, db: Session = Depends(get_db_session),
    q: str = Query(default="", max_length=200), before_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=100)):
    owner = owner_key(request)
    principal = getattr(request.state, "principal", None)
    if principal is None:
        raise HTTPException(401, "Authentication required")
    prune_notification_history(db, owner, principal)
    db.commit()
    filters = filters_for(request, db)
    if q.strip():
        filters.append(NotificationHistoryEntry.search_text.contains(q.strip().casefold(), autoescape=True))
    total = db.scalar(select(func.count()).select_from(NotificationHistoryEntry).where(*filters)) or 0
    if before_id is not None:
        filters.append(NotificationHistoryEntry.id < before_id)
    entries = list(db.scalars(select(NotificationHistoryEntry).where(*filters).order_by(NotificationHistoryEntry.id.desc()).limit(limit + 1)))
    more = len(entries) > limit
    return {"items": [serialize(entry) for entry in entries[:limit]], "total": total,
            "next_before_id": entries[limit - 1].id if more else None}
