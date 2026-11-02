"""Preference updates preserve independent editors and survive Desktop restarts."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from test_access import env, post, setup, user
from backend.app.core.config import RuntimeMode
from backend.app.api.deps import get_app_settings
from backend.app.db.session import get_db
from backend.app.main import create_app
from backend.app.models.access import LocalAccount
from backend.app.schemas.app_settings import AppSettingsUpdate
from backend.app.services.access import principal_for
from backend.app.services.app_settings import update_app_settings
from backend.app.services.personal_preferences import patch_preferences

CUSTOM = {"palette": "contrast", "style": "tint", "duration_seconds": 9, "grouping": "type"}


@pytest.mark.parametrize("mode", ["account", "desktop", "no_users"])
def test_partial_notification_updates_preserve_independent_tabs_and_legacy_settings(env, mode):
    app, factory, settings = env
    app.state.scan_runtime = SimpleNamespace(refresh_worker_settings=lambda: None)
    if mode == "account":
        first = setup(app)
        second = TestClient(app)
        second.cookies.update(first.cookies)
        assert (
            post(
                first, "/api/app-settings", {"ui_preferences": {"notifications": CUSTOM}}, "patch"
            ).status_code
            == 200
        )
    else:
        with factory() as db:
            update_app_settings(
                db, AppSettingsUpdate(ui_preferences={"notifications": CUSTOM}), settings
            )
        configured = settings.model_copy(
            update=(
                {"runtime_mode": RuntimeMode.desktop, "desktop_token": SecretStr("a" * 64)}
                if mode == "desktop"
                else {"no_users": True}
            )
        )
        app = create_app(configured)
        app.state.auth_session_factory = factory
        app.state.scan_runtime = SimpleNamespace(refresh_worker_settings=lambda: None)

        def database():
            with factory() as db:
                yield db

        app.dependency_overrides[get_db] = database
        app.dependency_overrides[get_app_settings] = lambda: configured
        first, second = TestClient(app), TestClient(app)
        if mode == "desktop":
            first.headers["X-MediaLyze-Desktop"] = "a" * 64
            second.headers["X-MediaLyze-Desktop"] = "a" * 64

    # Both tabs start from the same snapshot, then save distinct changed fields.
    assert first.get("/api/app-settings").json()["ui_preferences"]["notifications"] == CUSTOM
    assert second.get("/api/app-settings").json()["ui_preferences"]["notifications"] == CUSTOM
    palette = post(
        first,
        "/api/app-settings",
        {"ui_preferences": {"notifications": {"palette": "soft"}}},
        "patch",
    )
    duration = post(
        second,
        "/api/app-settings",
        {"ui_preferences": {"notifications": {"duration_seconds": 4}}},
        "patch",
    )
    assert palette.status_code == duration.status_code == 200
    expected = {**CUSTOM, "palette": "soft", "duration_seconds": 4}
    assert duration.json()["ui_preferences"]["notifications"] == expected
    assert first.get("/api/app-settings").json()["ui_preferences"]["notifications"] == expected
    invalid = post(
        second,
        "/api/app-settings",
        {"ui_preferences": {"notifications": {"duration_seconds": 11}}},
        "patch",
    )
    assert invalid.status_code == 422
    assert first.get("/api/app-settings").json()["ui_preferences"]["notifications"] == expected
    direct = post(
        first,
        "/api/me/preferences",
        {"ui_preferences": {"notifications": {"style": "rail"}}},
        "patch",
    )
    assert direct.status_code == 200
    assert direct.json()["ui_preferences"]["notifications"] == {**expected, "style": "rail"}


def test_layout_updates_preserve_latest_notifications_and_unrelated_preferences(env):
    app, factory, _ = env
    app.state.scan_runtime = SimpleNamespace(refresh_worker_settings=lambda: None)
    owner = setup(app)
    reader, _ = user(owner, app)
    assert post(reader, "/api/me/preferences", {"custom": "keep"}, "put").status_code == 200
    assert (
        post(
            reader, "/api/app-settings", {"ui_preferences": {"notifications": CUSTOM}}, "patch"
        ).status_code
        == 200
    )
    layout = {
        "storage": {"medialyze-settings-active-panel": "logs"},
        "ui_preferences": {"interface_language": "de", "color_theme": "dark"},
    }
    saved = post(reader, "/api/me/preferences", layout, "patch")
    assert saved.status_code == 200, saved.text
    assert saved.json() == {
        **layout,
        "custom": "keep",
        "ui_preferences": {**layout["ui_preferences"], "notifications": CUSTOM},
    }
    assert reader.get("/api/app-settings").json()["ui_preferences"]["notifications"] == CUSTOM
    assert owner.get("/api/me/preferences").json() == {}
    # Replacing the storage snapshot must also remove obsolete layout keys.
    assert post(reader, "/api/me/preferences", {"storage": {}}, "patch").json()["storage"] == {}
    assert reader.get("/api/me/preferences").json()["ui_preferences"]["notifications"] == CUSTOM
    partial = post(
        reader,
        "/api/app-settings",
        {"ui_preferences": {"notifications": {"duration_seconds": 4}}},
        "patch",
    )
    assert partial.status_code == 200
    assert partial.json()["ui_preferences"]["notifications"] == {**CUSTOM, "duration_seconds": 4}


def test_stale_orm_reader_cannot_overwrite_newer_notification_settings(env):
    app, factory, _ = env
    owner = setup(app)
    account_id = owner.get("/api/auth/status").json()["identity"]["id"]
    with factory() as stale:
        account = stale.get(LocalAccount, account_id)
        actor = principal_for(account)
        with factory() as other:
            patch_preferences(other, actor, {"ui_preferences": {"notifications": CUSTOM}})
        # The account was loaded before the other editor committed.
        patch_preferences(
            stale,
            actor,
            {"storage": {"medialyze-layout": "new"}, "ui_preferences": {"color_theme": "dark"}},
        )
    saved = owner.get("/api/me/preferences").json()
    assert saved["ui_preferences"] == {"color_theme": "dark", "notifications": CUSTOM}


@pytest.mark.parametrize("mode", ["desktop", "no_users"])
def test_local_preferences_survive_new_process_credentials_and_browser_storage(env, mode):
    _, factory, settings = env
    with factory() as db:
        update_app_settings(
            db,
            AppSettingsUpdate(ui_preferences={"color_theme": "dark", "notifications": CUSTOM}),
            settings,
        )

    def client(token):
        configured = settings.model_copy(
            update=(
                {"runtime_mode": RuntimeMode.desktop, "desktop_token": SecretStr(token)}
                if mode == "desktop"
                else {"no_users": True}
            )
        )
        app = create_app(configured)
        app.state.auth_session_factory = factory
        browser = TestClient(app)
        if mode == "desktop":
            browser.headers["X-MediaLyze-Desktop"] = token
        return browser

    first = client("a" * 64)
    initial = first.get("/api/me/preferences").json()
    assert initial["ui_preferences"]["notifications"] == CUSTOM
    assert initial["ui_preferences"]["color_theme"] == "dark"
    layout = {
        "storage": {"medialyze-file-table-widths": "saved"},
        "ui_preferences": {"interface_language": "de"},
    }
    saved = post(first, "/api/me/preferences", layout, "patch")
    assert saved.status_code == 200, saved.text
    restarted = client("b" * 64)
    assert restarted.get("/api/me/preferences").json() == saved.json()
    if mode == "desktop":
        assert TestClient(restarted.app).get("/api/me/preferences").status_code == 401
        assert restarted.get("/api/users").status_code == 404


def test_guest_preferences_remain_browser_local(env):
    app, _, _ = env
    owner = setup(app)
    guest_policy = owner.get("/api/access/guest").json()["policy"]
    assert (
        post(
            owner, "/api/access/guest", {"enabled": True, "policy": guest_policy}, "put"
        ).status_code
        == 200
    )
    guest = TestClient(app)
    assert post(guest, "/api/auth/guest").status_code == 200
    assert guest.get("/api/me/preferences").status_code == 403
    assert post(guest, "/api/me/preferences", {"storage": {}}, "patch").status_code == 403


def test_partial_preferences_keep_size_limit(env):
    app, _, _ = env
    owner = setup(app)
    assert (
        post(
            owner, "/api/me/preferences", {"storage": {"large": "x" * 262144}}, "patch"
        ).status_code
        == 413
    )
    assert owner.get("/api/me/preferences").json() == {}
