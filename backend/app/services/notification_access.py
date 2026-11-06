"""Access checks and irreversible pruning for personal notification history."""

from urllib.parse import parse_qs, urlsplit

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.app.models.entities import (
    ConnectorConnection,
    Library,
    MediaFile,
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
    if target.scheme or target.netloc or not href.startswith("/") or href.startswith("//"):
        return False
    query = parse_qs(target.query)

    if area == "connectors":
        if not principal.has("connector.view"):
            return False
        if target.fragment.startswith("connector-"):
            connection_id = _positive_int(target.fragment.removeprefix("connector-"))
            return connection_id is not None and db.get(ConnectorConnection, connection_id) is not None
        return True

    if area == "settings":
        if target.path != "/settings":
            return False
        section = (query.get("section") or ["libraries"])[0]
        if section in {"application", "logs"}:
            # Both pages contain personal settings/history available without global rights.
            return True
        if section == "accounts":
            return (
                query.get("account") == ["me"]
                or principal.has("access.users")
                or principal.has("access.guest")
            )
        rights = {
            "quality-profiles": "settings.quality.view",
            "compatibility-profiles": "settings.hardware.view",
            "transcoding-presets": "settings.presets.view",
            "transcoding": "settings.app.view",
            "pattern-recognition": "settings.app.view",
            "history-retention": "settings.app.view",
            "telemetry": "settings.app.view",
            "jellyfin": "connector.view",
        }
        if section in rights:
            return principal.has(rights[section])
        if section == "libraries":
            return principal.owner or principal.can_create() or any(
                principal.has("library.read", library_id)
                for library_id in db.scalars(select(Library.id))
            )
        return False

    if area == "library":
        overview = {"/": "overview.dashboard", "/storage-map": "overview.storage", "/files/compare": "overview.compare"}
        if target.path in overview:
            return principal.has(overview[target.path])
        parts = target.path.strip("/").split("/")
        if len(parts) >= 2 and parts[0] == "files":
            file = db.get(MediaFile, _positive_int(parts[1])) if _positive_int(parts[1]) else None
            return bool(file and principal.has("library.read", file.library_id))
        library_id = _positive_int(parts[1] if len(parts) > 1 and parts[0] == "libraries" else None)
        library_id = library_id or _positive_int((query.get("library_id") or [None])[0])
        if library_id is None:
            return False
        return bool(
            db.get(Library, library_id) is not None
            and principal.has("library.read", library_id)
        )

    if area == "transcoding":
        if target.path == "/settings":
            return notification_source_allowed(db, principal, {**source, "area": "settings"})
        parts = target.path.strip("/").split("/")
        if len(parts) >= 2 and parts[0] == "files":
            file = db.get(MediaFile, _positive_int(parts[1])) if _positive_int(parts[1]) else None
            return bool(file and principal.has("library.read", file.library_id)
                        and principal.has("transcode.view", file.library_id))
        if target.path != "/transcoding":
            return False
        job_id = _positive_int((query.get("job") or query.get("job_id") or [None])[0])
        if job_id is None:
            return principal.owner or any(
                principal.has("library.read", library_id)
                and principal.has("transcode.view", library_id)
                for library_id in db.scalars(select(Library.id))
            )
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
