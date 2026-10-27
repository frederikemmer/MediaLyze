"""Access checks and irreversible pruning for personal notification history."""

from urllib.parse import parse_qs, urlsplit

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.app.models.entities import (
    ConnectorConnection,
    Library,
    NotificationHistoryEntry,
    TranscodeJob,
)
from backend.app.services.access import Principal


def _positive_int(value: str | None) -> int | None:
    try:
        parsed = int(value or "")
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def notification_source_allowed(db: Session, principal: Principal, source: dict) -> bool:
    """Resolve access from the saved internal target, never client-supplied rights."""
    area = source.get("area")
    href = source.get("href")
    if not isinstance(href, str):
        return False
    target = urlsplit(href)
    query = parse_qs(target.query)

    if area == "connectors":
        if not principal.has("connector.view"):
            return False
        if target.fragment.startswith("connector-"):
            connection_id = _positive_int(target.fragment.removeprefix("connector-"))
            return connection_id is not None and db.get(ConnectorConnection, connection_id) is not None
        return True

    if area == "settings":
        personal_notification_settings = (
            target.path == "/settings"
            and query.get("section") == ["application"]
            and target.fragment == "notification-settings"
        )
        return personal_notification_settings or principal.has("settings.app.view")

    if area == "library":
        parts = target.path.strip("/").split("/")
        library_id = _positive_int(parts[1] if len(parts) > 1 and parts[0] == "libraries" else None)
        library_id = library_id or _positive_int((query.get("library_id") or [None])[0])
        if library_id is None:
            return False
        return bool(
            db.get(Library, library_id) is not None
            and principal.has("library.read", library_id)
        )

    if area == "transcoding":
        job_id = _positive_int((query.get("job") or query.get("job_id") or [None])[0])
        if job_id is None:
            return principal.owner
        job = db.get(TranscodeJob, job_id)
        return bool(
            job
            and principal.has("library.read", job.library_id)
            and principal.has("transcode.view", job.library_id)
        )

    return False


def prune_notification_history(db: Session, owner_key: str, principal: Principal) -> int:
    """Delete records whose target is gone or no longer readable by this owner."""
    cursor = 0
    removed = 0
    while True:
        rows = db.execute(
            select(NotificationHistoryEntry.id, NotificationHistoryEntry.source)
            .where(
                NotificationHistoryEntry.owner_key == owner_key,
                NotificationHistoryEntry.id > cursor,
            )
            .order_by(NotificationHistoryEntry.id)
            .limit(500)
        ).all()
        if not rows:
            break
        cursor = rows[-1].id
        stale_ids = [
            entry_id
            for entry_id, source in rows
            if not notification_source_allowed(db, principal, source or {})
        ]
        if stale_ids:
            db.execute(
                delete(NotificationHistoryEntry).where(
                    NotificationHistoryEntry.id.in_(stale_ids)
                )
            )
            removed += len(stale_ids)
    return removed


def prune_guest_notification_history(db: Session, policy: dict, revision: int) -> int:
    """Apply the shared Guest policy to every isolated Guest-session history."""
    principal = Principal("guest", "guest", "Guest", False, policy, revision)
    owners = list(db.scalars(
        select(NotificationHistoryEntry.owner_key)
        .where(NotificationHistoryEntry.owner_key.like("guest:%"))
        .distinct()
    ))
    return sum(prune_notification_history(db, owner, principal) for owner in owners)
