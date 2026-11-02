"""Personal Notification history contracts against real isolated app sessions."""

from uuid import uuid4
from datetime import timedelta
from sqlalchemy import select, func
from test_access import env, setup, user, library, post
from backend.app.services.access import EMPTY_POLICY
from backend.app.models.entities import NotificationHistoryEntry
from backend.app.utils.time import utc_now
from fastapi.testclient import TestClient
import pytest


def payload(
    message="audit message",
    href="/settings?section=application#notification-settings",
    area="settings",
):
    return {
        "event_id": str(uuid4()),
        "type": "success",
        "message": message,
        "source": {"area": area, "href": href, "label": "Audit"},
    }


def test_account_ownership_and_idempotency(env):
    app, _, _ = env
    owner = setup(app)
    reader, _ = user(owner, app)
    body = payload()
    first = post(owner, "/api/notification-history", body)
    assert first.status_code == 200, first.text
    again = post(owner, "/api/notification-history", body)
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"]
    assert owner.get("/api/notification-history").json()["total"] == 1
    assert reader.get("/api/notification-history").json()["total"] == 0
    other = post(reader, "/api/notification-history", body)
    assert other.status_code == 200, other.text
    assert other.json()["id"] != first.json()["id"]


def test_guest_histories_are_isolated_by_session(env):
    app, _, _ = env
    owner = setup(app)
    assert (
        post(
            owner, "/api/access/guest", {"enabled": True, "policy": EMPTY_POLICY}, "put"
        ).status_code
        == 200
    )
    a, b = TestClient(app), TestClient(app)
    for c in (a, b):
        assert post(c, "/api/auth/guest").status_code == 200
    assert post(a, "/api/notification-history", payload()).status_code == 200
    assert a.get("/api/notification-history").json()["total"] == 1
    assert b.get("/api/notification-history").json()["total"] == 0


def test_library_revocation_prunes_history(env):
    app, factory, _ = env
    lib = library(factory, "notification-library")
    owner = setup(app)
    reader, account = user(owner, app, {**EMPTY_POLICY, "libraries": {str(lib): ["library.read"]}})
    assert (
        post(
            reader, "/api/notification-history", payload(href=f"/libraries/{lib}", area="library")
        ).status_code
        == 200
    )
    assert reader.get("/api/notification-history").json()["total"] == 1
    assert (
        post(owner, f"/api/users/{account['id']}", {"policy": EMPTY_POLICY}, "patch").status_code
        == 200
    )
    assert reader.get("/api/notification-history").json()["total"] == 0
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(NotificationHistoryEntry)) == 0


def test_expired_entries_are_filtered(env):
    app, factory, _ = env
    owner = setup(app)
    assert post(owner, "/api/notification-history", payload()).status_code == 200
    with factory() as db:
        db.scalar(select(NotificationHistoryEntry)).created_at = utc_now() - timedelta(days=31)
        db.commit()
    assert owner.get("/api/notification-history").json()["total"] == 0


def test_previews_are_excluded(env):
    app, _, _ = env
    owner = setup(app)
    body = payload()
    body["preview"] = True
    assert post(owner, "/api/notification-history", body).status_code == 204
    assert owner.get("/api/notification-history").json()["total"] == 0


@pytest.mark.parametrize(
    "href", ["https://evil.example/", "//evil.example/", "/\\evil.example/", "/settings\n"]
)
def test_external_targets_rejected(env, href):
    app, _, _ = env
    owner = setup(app)
    assert post(owner, "/api/notification-history", payload(href=href)).status_code == 422


def test_unicode_search_and_cursor_paging(env):
    app, _, _ = env
    owner = setup(app)
    for msg in ("Straße one", "STRASSE two", "unrelated"):
        assert post(owner, "/api/notification-history", payload(message=msg)).status_code == 200
    first = owner.get("/api/notification-history", params={"q": "strasse", "limit": 1}).json()
    assert first["total"] == 2 and len(first["items"]) == 1 and first["next_before_id"]
    second = owner.get(
        "/api/notification-history",
        params={"q": "strasse", "limit": 1, "before_id": first["next_before_id"]},
    ).json()
    assert (
        len(second["items"]) == 1
        and second["items"][0]["id"] != first["items"][0]["id"]
        and not second["next_before_id"]
    )
