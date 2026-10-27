"""Durable job provenance with execution-time checks; no account FK/tombstone loss."""

from sqlalchemy import select
from backend.app.models.access import AccessState, JobAuthority, LocalAccount
from backend.app.models.entities import (
    JobStatus,
    ScanJob,
    TranscodeJob,
    ConnectorSyncJob,
    JellyfinSyncJob,
    TranscodeAutomationRun,
)
from backend.app.services.access import Principal, principal_for
from backend.app.services.access_context import principal_context
from backend.app.utils.time import utc_now


def history_target_ids(db, requested=None):
    """Resolve a bounded snapshot of scan-authorized libraries; never expand in the worker."""
    from backend.app.models.entities import Library
    from backend.app.services.access import fail

    actor = principal_context.get()
    available = tuple(db.scalars(select(Library.id).order_by(Library.id)))
    allowed = {i for i in available if actor is None or (
        actor.has("library.read", i) and actor.has("library.scan", i)
    )}
    if requested is None:
        result = allowed
    else:
        if not isinstance(requested, (list, tuple)) or any(
            not isinstance(i, int) or isinstance(i, bool) or i <= 0 for i in requested
        ):
            fail(422, "Invalid library scope")
        result = set(requested)
        if not result <= allowed:
            fail(404, "Not found")
    if not result:
        fail(403, "No scan-authorized libraries selected")
    return tuple(sorted(result))


def record_job(db, kind, job_id, requirements, *, system=False):
    actor = None if system else principal_context.get()
    item = JobAuthority(
        key=f"{kind}:{job_id}",
        actor_kind=actor.kind if actor else "system",
        actor_id=actor.id if actor else "system",
        actor_name=actor.name if actor else "",
        requirements=requirements,
    )
    db.merge(item)
    db.commit()
    return {"kind": item.actor_kind, "id": item.actor_id, "name": item.actor_name}


def job_allowed(db, item):
    if item.actor_kind in {"system", "desktop", "machine"}:
        return True
    if item.actor_kind == "account":
        account = db.get(LocalAccount, item.actor_id)
        if account is None or not account.active or account.must_change_password:
            return False
        actor = principal_for(account)
    elif item.actor_kind == "guest":
        state = db.get(AccessState, 1)
        if not state or not state.guest_enabled:
            return False
        actor = Principal("guest", "guest", "", False, state.guest_policy)
    else:
        return False
    return all(actor.has(right, library_id) for right, library_id in item.requirements)


def admit_job(db, kind, job_id):
    authority = db.get(JobAuthority, f"{kind}:{job_id}")
    # Pre-migration jobs remain their original legacy/system work, never relabeled as users.
    if authority is None or job_allowed(db, authority):
        return True
    model = {
        "scan": ScanJob,
        "transcode": TranscodeJob,
        "connector": ConnectorSyncJob,
        "jellyfin": JellyfinSyncJob,
        "automation": TranscodeAutomationRun,
    }[kind]
    job = db.get(model, job_id)
    if job is not None and job.status == JobStatus.queued:
        job.status = JobStatus.canceled
        job.finished_at = utc_now()
        if kind == "scan":
            job.trigger_details = {**(job.trigger_details or {}), "authorization_canceled": True}
        elif hasattr(job, "error"):
            job.error = "Canceled because the initiating account no longer has permission"
        db.commit()
    return False


def cancel_waiting_account_jobs(db, account_id):
    for item in db.scalars(
        select(JobAuthority).where(
            JobAuthority.actor_id == account_id, JobAuthority.actor_kind == "account"
        )
    ):
        kind, job_id = item.key.split(":", 1)
        if kind in {"scan", "transcode", "connector", "jellyfin", "automation"}:
            admit_job(db, kind, int(job_id))


def origin_for(job, kind):
    if getattr(job, "_access_origin", None) is not None:
        return job._access_origin
    from sqlalchemy.orm import object_session

    db = object_session(job)
    item = db.get(JobAuthority, f"{kind}:{job.id}") if db is not None else None
    if item is not None:
        return {"kind": item.actor_kind, "id": item.actor_id, "name": item.actor_name}
    trigger = str(getattr(job, "trigger_source", "manual"))
    return {
        "kind": "system"
        if any(s in trigger for s in ("scheduled", "watchdog", "transcode"))
        else "legacy",
        "id": "",
        "name": "",
    }


def cancel_waiting_guest_jobs(db):
    for item in db.scalars(select(JobAuthority).where(JobAuthority.actor_kind == "guest")):
        kind, job_id = item.key.split(":", 1)
        if kind in {"scan", "transcode", "connector", "jellyfin", "automation"}:
            admit_job(db, kind, int(job_id))
