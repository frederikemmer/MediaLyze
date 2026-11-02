"""Execution authority and resource validation regressions through the app gate."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from test_access import env, library, post, setup, user
from backend.app.models.access import JobAuthority
from backend.app.models.entities import JobStatus, ScanJob
from backend.app.services.access import EMPTY_POLICY
from backend.app.services.access_jobs import admit_job, job_allowed
from backend.app.services import runtime as runtime_module


@pytest.mark.parametrize("kind", ["account", "guest"])
@pytest.mark.parametrize("lost_right", ["library.read", "library.scan"])
@pytest.mark.parametrize("legacy_authority", [False, True])
def test_waiting_scan_rechecks_every_prerequisite(
    env, monkeypatch, kind, lost_right, legacy_authority
):
    app, factory, settings = env
    library_id = library(factory, "scan-rights")
    owner = setup(app)
    policy = {**EMPTY_POLICY, "libraries": {str(library_id): ["library.read", "library.scan"]}}
    if kind == "account":
        client, account = user(owner, app, policy)
    else:
        assert (
            post(owner, "/api/access/guest", {"enabled": True, "policy": policy}, "put").status_code
            == 200
        )
        client = TestClient(app)
        assert post(client, "/api/auth/guest").status_code == 200
    monkeypatch.setattr(runtime_module, "SessionLocal", factory)
    runtime = runtime_module.ScanRuntimeManager(settings)
    runtime.executor.shutdown(wait=False)
    runtime.executor = SimpleNamespace(submit=lambda *args, **kwargs: None)
    app.state.scan_runtime = runtime
    queued = post(client, f"/api/libraries/{library_id}/scan", {"scan_type": "incremental"})
    assert queued.status_code == 202, queued.text
    job_id = queued.json()["id"]
    with factory() as db:
        authority = db.get(JobAuthority, f"scan:{job_id}")
        assert {tuple(value) for value in authority.requirements} == {
            ("library.read", library_id),
            ("library.scan", library_id),
        }
        if legacy_authority:
            authority.requirements = [["library.scan", library_id]]
            db.commit()
    reduced = {
        **policy,
        "libraries": {
            str(library_id): [
                right for right in policy["libraries"][str(library_id)] if right != lost_right
            ]
        },
    }
    if kind == "account":
        response = post(owner, f"/api/users/{account['id']}", {"policy": reduced}, "patch")
    else:
        response = post(owner, "/api/access/guest", {"enabled": True, "policy": reduced}, "put")
    assert response.status_code == 200, response.text
    with factory() as db:
        assert admit_job(db, "scan", job_id) is False
        job = db.get(ScanJob, job_id)
        assert job.status == JobStatus.canceled
        assert job.trigger_details["authorization_canceled"] is True


def test_legacy_connector_authority_requires_view_as_well_as_manage(env):
    app, factory, _ = env
    owner = setup(app)
    _, account = user(owner, app, {**EMPTY_POLICY, "global": ["connector.manage"]})
    authority = JobAuthority(
        key="connector:1",
        actor_kind="account",
        actor_id=account["id"],
        actor_name="reader",
        requirements=[["connector.manage", None]],
    )
    with factory() as db:
        assert job_allowed(db, authority) is False
    assert (
        post(
            owner,
            f"/api/users/{account['id']}",
            {"policy": {**EMPTY_POLICY, "global": ["connector.manage", "connector.view"]}},
            "patch",
        ).status_code
        == 200
    )
    with factory() as db:
        assert job_allowed(db, authority) is True


@pytest.mark.parametrize("kind", ["owner", "account"])
def test_invalid_resource_ids_return_controlled_validation_errors(env, kind):
    app, _, _ = env
    owner = setup(app)
    client = owner if kind == "owner" else user(owner, app)[0]
    paths = [
        "/api/files/{id}",
        "/api/libraries/{id}/summary",
        "/api/scan-jobs/{id}",
        "/api/transcode-jobs/{id}",
        "/api/transcode-variants/{id}/media",
        "/api/transcoding/rules/{id}",
        "/api/jellyfin/items/{id}",
    ]
    # Include SQLite overflow and Python's large-integer conversion limit.
    for value in ("not-a-number", "-1", "0", "9223372036854775808", "9" * 4500):
        for template in paths:
            response = client.get(template.format(id=value))
            assert response.status_code == 422, (template, value[:30], response.text)


def test_own_account_profile_autosave_is_private_and_keeps_session(env):
    app, _, _ = env
    owner = setup(app)
    reader, account = user(owner, app)
    changed = post(reader, "/api/me/account", {"username": "newreader", "email": "new@example.com"}, "patch")
    assert changed.status_code == 200, changed.text
    assert changed.json()["email"] == "new@example.com"
    assert reader.get("/api/auth/status").json()["identity"]["username"] == "newreader"
    assert reader.get("/api/auth/status").json()["identity"]["email"] == "new@example.com"
    assert post(reader, "/api/me/account", {"email": "invalid"}, "patch").status_code == 422
    assert owner.get("/api/users").json()[1]["email"] is None
    assert post(reader, "/api/me/account", {"email": ""}, "patch").json()["email"] is None


def test_existing_accounts_gain_email_column_without_losing_login(env):
    from sqlalchemy import text
    from backend.app.db.session import init_db

    app, factory, _ = env
    owner = setup(app)
    engine = factory.kw["bind"]
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE local_accounts DROP COLUMN email"))
    init_db(engine)
    result = owner.get("/api/auth/status")
    assert result.status_code == 200
    assert result.json()["identity"]["username"] == "owner"
    assert result.json()["identity"]["email"] is None


def test_profile_rename_rejects_duplicates_even_with_owner_environment(env):
    app, _, settings = env
    owner = setup(app)
    reader, _ = user(owner, app)
    assert post(reader, "/api/me/account", {"username": "owner"}, "patch").status_code == 409
    assert reader.get("/api/auth/status").json()["identity"]["username"] == "reader"
    settings.owner_username = "owner"
    assert post(owner, "/api/me/account", {"username": "renamed"}, "patch").status_code == 200
    assert post(owner, "/api/me/account", {"email": "owner@example.com"}, "patch").status_code == 200


@pytest.mark.parametrize("configured_username,configured_password", [(False, False), (True, False), (False, True), (True, True)])
def test_owner_environment_warnings_and_restart_reconcile_independently(env, configured_username, configured_password):
    from pydantic import SecretStr
    from test_access import SECRET, NEW_SECRET
    from backend.app.services.access import initialize_owner, verify
    from backend.app.models.access import LocalAccount
    from sqlalchemy import select

    app, factory, settings = env
    owner = setup(app)
    settings.owner_username = "owner" if configured_username else None
    settings.owner_password = SecretStr(SECRET) if configured_password else None
    identity = owner.get("/api/auth/status").json()["identity"]
    assert identity["username_env_configured"] is configured_username
    assert identity["password_env_configured"] is configured_password
    assert identity["username_locked"] is False and identity["password_locked"] is False
    assert post(owner, "/api/me/account", {"username": "renamed"}, "patch").status_code == 200
    assert post(owner, "/api/auth/password", {"current_password": SECRET, "password": NEW_SECRET}).status_code == 200
    initialize_owner(factory, settings)
    with factory() as db:
        account = db.scalar(select(LocalAccount).where(LocalAccount.owner_slot == 1))
        assert account.username == ("owner" if configured_username else "renamed")
        assert verify(account.password_hash, SECRET if configured_password else NEW_SECRET)


def test_configured_owner_username_stays_reserved_while_owner_renamed(env):
    from test_access import SECRET
    from backend.app.services.access import initialize_owner

    app, factory, settings = env
    owner = setup(app)
    settings.owner_username = "owner"
    assert post(owner, "/api/me/account", {"username": "renamed"}, "patch").status_code == 200
    reader, account = user(owner, app)
    assert post(owner, "/api/users", {"username": "OWNER", "password": SECRET}, "post").status_code == 409
    assert post(owner, f"/api/users/{account['id']}", {"username": "OWNER"}, "patch").status_code == 409
    assert post(reader, "/api/me/account", {"username": "OWNER"}, "patch").status_code == 409
    initialize_owner(factory, settings)
    assert post(TestClient(app), "/api/auth/login", {"username": "owner", "password": SECRET}).status_code == 200
