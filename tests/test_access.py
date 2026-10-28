"""Integration tests use the real application gate and isolated SQLite files."""

from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from backend.app.api.deps import get_app_settings
from backend.app.api.access_middleware import effective_routes
from backend.app.api.access_policy import INVENTORY, AUTH_PATHS
from backend.app.core.config import Settings
from backend.app.db.session import create_engine_for_settings, init_db, get_db
from backend.app.main import create_app
from backend.app.models.access import AccessState, LocalAccount, LoginSession
from backend.app.models.entities import Library, LibraryType, MediaFile
from backend.app.services.access import (
    initialize_owner,
    EMPTY_POLICY,
    digest,
    contains,
    Principal,
)

SECRET = "test-password-with-entropy"
NEW_SECRET = "changed-password-with-entropy"


def test_access_environment_names(monkeypatch):
    for name in ("OWNER_USERNAME", "OWNER_PASSWORD", "GUEST_ENABLED", "NO_USERS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OWNER_USERNAME", "current")
    monkeypatch.setenv("OWNER_PASSWORD", NEW_SECRET)
    monkeypatch.setenv("GUEST_ENABLED", "false")
    monkeypatch.setenv("NO_USERS", "false")
    current = Settings(_env_file=None)
    assert (current.owner_username, current.owner_password.get_secret_value(), current.guest_enabled, current.no_users) == ("current", NEW_SECRET, False, False)


@pytest.fixture
def env(tmp_path):
    config = tmp_path / "config"
    media = tmp_path / "media"
    config.mkdir()
    media.mkdir()
    settings = Settings(config_path=config, media_root=media, frontend_dist_path=tmp_path / "dist")
    engine = create_engine_for_settings(settings)
    init_db(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    app = create_app(settings)
    app.state.auth_session_factory = factory

    def database():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_app_settings] = lambda: settings
    yield app, factory, settings
    engine.dispose()


def headers(client):
    r = client.get("/api/auth/status")
    assert r.status_code == 200, r.text
    return {"Origin": "http://testserver", "X-CSRF-Token": r.json()["csrf"]}


def post(client, path, payload=None, method="post"):
    return client.request(method, path, json=payload, headers=headers(client))


def setup(app):
    client = TestClient(app)
    assert (
        post(client, "/api/auth/setup", {"username": "owner", "password": SECRET}).status_code
        == 201
    )
    return client


def library(factory, name):
    with factory() as db:
        item = Library(name=name, path="/media/" + name, type=LibraryType.movies)
        db.add(item)
        db.flush()
        db.add(
            MediaFile(
                library_id=item.id,
                relative_path=name + ".mp4",
                filename=name + ".mp4",
                extension=".mp4",
                size_bytes=100,
                mtime=0,
            )
        )
        db.commit()
        return item.id


def user(owner, app, policy=None):
    payload = {"username": "reader", "password": SECRET, "policy": policy or EMPTY_POLICY}
    response = post(owner, "/api/users", payload)
    assert response.status_code == 201, response.text
    account = response.json()
    client = TestClient(app)
    assert (
        post(client, "/api/auth/login", {"username": "reader", "password": SECRET}).status_code
        == 200
    )
    assert client.get("/api/libraries").status_code == 403
    assert (
        post(
            client, "/api/auth/password", {"current_password": SECRET, "password": NEW_SECRET}
        ).status_code
        == 200
    )
    assert (
        post(client, "/api/auth/login", {"username": "reader", "password": NEW_SECRET}).status_code
        == 200
    )
    return client, account


def test_bootstrap_closed_generic_health_and_session_hash(env):
    app, factory, _ = env
    anonymous = TestClient(app)
    assert anonymous.get("/api/health").json() == {"status": "ok"}
    assert anonymous.get("/api/libraries").status_code == 401
    owner = setup(app)
    assert (
        post(anonymous, "/api/auth/setup", {"username": "second", "password": SECRET}).status_code
        == 409
    )
    with factory() as db:
        assert len(db.scalars(select(LocalAccount)).all()) == 1
        row = db.scalar(select(LocalAccount))
        assert row.password_hash.startswith("$argon2id$")
        sessions = db.scalars(select(LoginSession)).all()
        assert sessions[0].token_hash == digest(owner.cookies["medialyze_session"])
        assert SECRET not in str(row.__dict__)
    assert "HttpOnly" in owner.cookies.__repr__() or owner.cookies.get("medialyze_session")


def test_setup_race_has_single_winner(env):
    app, factory, _ = env

    def attempt(i):
        return post(
            TestClient(app), "/api/auth/setup", {"username": f"owner{i}", "password": SECRET}
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        codes = sorted(executor.map(attempt, range(2)))
    assert codes == [201, 409]
    with factory() as db:
        assert len(db.scalars(select(LocalAccount)).all()) == 1


def test_origin_csrf_unknown_and_framework_gate(env):
    app, _, _ = env
    owner = setup(app)
    for extra in (
        {},
        {"Origin": "http://evil.example"},
        {"Origin": "http://testserver", "X-CSRF-Token": "wrong"},
    ):
        assert (
            owner.post(
                "/api/users", json={"username": "x", "password": SECRET}, headers=extra
            ).status_code
            == 403
        )
    assert TestClient(app).get("/docs").status_code == 401
    assert owner.get("/docs").status_code == 200

    @app.get("/api/accidentally-public")
    def accidental():
        return {"secret": True}

    assert owner.get("/api/accidentally-public").status_code == 404
    assert owner.get("/api/libraries/").status_code == 404
    assert owner.get("/api/performance").status_code == 404


def test_https_proxy_origin_without_forwarded_header_trust(env):
    app, _, _ = env
    client = TestClient(app)
    csrf = client.get("/api/auth/status").json()["csrf"]
    payload = {"username": "owner", "password": SECRET}
    for origin, token, fetch_site in (
        ("https://evil.example", csrf, "same-origin"),
        ("https://testserver:8443", csrf, "same-origin"),
        ("https://testserver", "wrong", "same-origin"),
        ("https://testserver", csrf, "cross-site"),
    ):
        response = client.post("/api/auth/setup", json=payload, headers={
            "Origin": origin, "X-CSRF-Token": token, "Sec-Fetch-Site": fetch_site,
        })
        assert response.status_code == 403
    response = client.post("/api/auth/setup", json=payload, headers={
        "Origin": "https://testserver", "X-CSRF-Token": csrf, "Sec-Fetch-Site": "same-origin",
    })
    assert response.status_code == 201


def test_invalid_password_validation_does_not_echo_input(env):
    app, _, _ = env
    client = TestClient(app)
    secret = "onlyletters" * 30
    response = post(client, "/api/auth/setup", {"username": "x", "password": secret})
    assert response.status_code == 422
    assert secret not in response.text


def test_setup_password_length_and_comma(env):
    app, _, _ = env
    client = TestClient(app)
    rejected = post(client, "/api/auth/setup", {"username": "fixture-owner", "password": "abc1"})
    assert rejected.status_code == 422
    assert client.get("/api/auth/status").json()["setup_required"] is True
    accepted = post(client, "/api/auth/setup", {"username": "fixture-owner", "password": "abcd,"})
    assert accepted.status_code == 201


def test_owner_is_immutable_and_reset_revokes(env):
    app, _, _ = env
    owner = setup(app)
    oid = owner.get("/api/auth/status").json()["identity"]["id"]
    assert post(owner, f"/api/users/{oid}", {"active": False}, "patch").status_code == 403
    client, account = user(owner, app)
    assert client.get("/api/me/preferences").status_code == 200
    assert (
        post(owner, f"/api/users/{account['id']}", {"password": SECRET}, "patch").status_code == 200
    )
    assert client.get("/api/me/preferences").status_code == 401


def test_scoped_counts_pagination_and_cached_owner_response(env):
    app, factory, _ = env
    a, b = library(factory, "allowed"), library(factory, "hidden")
    owner = setup(app)
    assert len(owner.get("/api/libraries").json()) == 2
    assert owner.get("/api/dashboard").json()["totals"]["files"] == 2
    policy = {
        **EMPTY_POLICY,
        "global": ["overview.dashboard", "overview.compare", "overview.storage"],
        "libraries": {str(a): ["library.read", "library.export"]},
    }
    client, _ = user(owner, app, policy)
    response = client.get("/api/libraries")
    assert response.status_code == 200, response.text
    assert [x["id"] for x in response.json()] == [a]
    assert client.get(f"/api/libraries/{b}/files").status_code == 404
    assert client.get("/api/files/2").status_code == 404
    dashboard = client.get("/api/dashboard")
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["totals"]["files"] == 1
    page = client.get(f"/api/libraries/{a}/files?limit=1")
    assert page.status_code == 200, page.text
    assert page.json()["total"] == 1
    assert "jellyfin_play_count" not in page.text
    assert client.get(f"/api/libraries/{a}/files?sort_key=play_count").status_code == 403
    assert client.get(f"/api/libraries/{a}/files/export.csv").status_code == 200
    assert "hidden" not in client.get("/api/files/search?q=hidden").text
    assert client.get("/api/scan-jobs/active").json() == []


def test_future_scope_and_target_containment(env):
    app, factory, _ = env
    a = library(factory, "a")
    owner = setup(app)
    actor_policy = {
        **EMPTY_POLICY,
        "global": ["access.users"],
        "libraries": {str(a): ["library.read"]},
    }
    client, account = user(owner, app, actor_policy)
    beyond = post(
        client,
        "/api/users",
        {
            "username": "beyond",
            "password": SECRET,
            "policy": {**EMPTY_POLICY, "mode": "future", "shared": ["library.read"]},
        },
    )
    assert beyond.status_code == 403
    assert (
        post(
            client,
            "/api/users",
            {
                "username": "same",
                "password": SECRET,
                "policy": {**EMPTY_POLICY, "libraries": {str(a): ["library.read"]}},
            },
        ).status_code
        == 201
    )
    assert (
        post(
            client,
            f"/api/users/{account['id']}",
            {"policy": {**EMPTY_POLICY, "libraries": {str(a): ["library.scan"]}}},
            "patch",
        ).status_code
        == 403
    )
    assert not contains(
        Principal("account", "a", "", False, actor_policy),
        {**EMPTY_POLICY, "mode": "future", "shared": ["library.read"]},
    )


def test_guest_explicit_no_libraries_and_no_access_management(env):
    app, factory, _ = env
    library(factory, "private")
    owner = setup(app)
    guest = TestClient(app)
    assert post(guest, "/api/auth/guest").status_code == 403
    assert post(owner, "/access/guest", {}, "put").status_code == 404
    assert (
        post(
            owner,
            "/api/access/guest",
            {"enabled": True, "policy": {**EMPTY_POLICY, "global": ["overview.dashboard"]}},
            "put",
        ).status_code
        == 200
    )
    assert guest.get("/api/libraries").status_code == 401
    assert post(guest, "/api/auth/guest").status_code == 200
    assert guest.get("/api/libraries").json() == []
    assert guest.get("/api/users").status_code == 403
    assert guest.get("/api/me/preferences").status_code == 403
    assert (
        guest.post("/api/auth/logout", headers={"Origin": "http://evil.example"}).status_code == 403
    )


def test_owner_environment_change_and_collision(env):
    app, factory, settings = env
    owner = setup(app)
    initialize_owner(
        factory, settings.model_copy(update={"owner_username": "owner", "owner_password": None})
    )
    assert owner.get("/api/users").status_code == 200
    initialize_owner(factory, settings.model_copy(update={"owner_username": "renamed"}))
    assert owner.get("/api/users").status_code == 401
    with factory() as db:
        assert db.get(AccessState, 1)
        assert db.scalar(select(LocalAccount)).username == "renamed"
    with pytest.raises(RuntimeError, match="Invalid or conflicting"):
        initialize_owner(
            factory,
            settings.model_copy(
                update={
                    "owner_password": type(settings).model_fields["owner_password"].annotation
                    if False
                    else __import__("pydantic").SecretStr("short")
                }
            ),
        )


def test_idle_and_absolute_expiry_and_poll_activity(env):
    app, factory, _ = env
    owner = setup(app)
    with factory() as db:
        session = db.get(LoginSession, digest(owner.cookies["medialyze_session"]))
        session.last_seen_at -= 86401
        db.commit()
    assert owner.get("/api/users").status_code == 401
    assert (
        post(owner, "/api/auth/login", {"username": "owner", "password": SECRET}).status_code == 200
    )
    with factory() as db:
        session = db.get(LoginSession, digest(owner.cookies["medialyze_session"]))
        session.created_at -= 7 * 86400
        db.commit()
    assert owner.get("/api/users").status_code == 401


def test_route_inventory_matches_actual_registered_routes(env):
    app, _, _ = env
    actual = {
        (method, r.path.removeprefix("/api"))
        for r in effective_routes(app.routes)
        if getattr(r, "path", "").startswith("/api/")
        for method in r.methods
    }
    expected = {tuple(key.split(" ", 1)) for key in INVENTORY} | AUTH_PATHS
    assert actual == expected


def test_desktop_has_no_local_account_or_rights_apis_and_browser_credentials_do_not_authorize_protocol(env):
    app, factory, settings = env
    from pydantic import SecretStr

    owner = setup(app)
    with factory() as db:
        db.get(AccessState, 1).guest_enabled = True
        db.commit()
    desktop = create_app(
        settings.model_copy(
            update={
                "runtime_mode": __import__(
                    "backend.app.core.config", fromlist=["RuntimeMode"]
                ).RuntimeMode.desktop,
                "desktop_token": SecretStr("a" * 64),
            }
        )
    )
    desktop.state.auth_session_factory = factory
    client = TestClient(desktop)
    assert client.get("/api/users").status_code == 404
    for method, path in [
        ("GET", "/api/users"),
        ("POST", "/api/users"),
        ("GET", "/api/access/libraries"),
        ("GET", "/api/access/guest"),
        ("GET", "/api/me/preferences"),
        ("POST", "/api/auth/login"),
        ("POST", "/api/auth/guest"),
        ("POST", "/api/auth/password"),
    ]:
        assert client.request(method, path, json={}).status_code == 404
    desktop_status = client.get(
        "/api/auth/status", headers={"X-MediaLyze-Desktop": "a" * 64}
    ).json()
    assert desktop_status["identity"]["kind"] == "desktop"
    assert desktop_status["guest_enabled"] is False
    assert desktop_status["permissions"] == []
    assert desktop_status["library_permissions"] == []
    stale_browser_session_status = client.get(
        "/api/auth/status",
        headers={"Cookie": f"medialyze_session={owner.cookies['medialyze_session']}"},
    ).json()
    assert stale_browser_session_status["identity"] is None
    assert stale_browser_session_status["guest_enabled"] is False
    assert post(owner, "/api/transcoding/federation/protocol/hello").status_code == 403


def test_media_range_download_aliases_and_no_unauthorized_416(env):
    app, factory, settings = env
    from backend.app.models.entities import LibraryRoot

    root_path = settings.media_root / "allowed"
    root_path.mkdir()
    path = root_path / "movie.mp4"
    path.write_bytes(b"0123456789")
    with factory() as db:
        lib = Library(name="range", path=str(root_path), type=LibraryType.movies)
        db.add(lib)
        db.flush()
        root = LibraryRoot(
            library_id=lib.id, path=str(root_path), path_key=str(root_path), display_name="Range"
        )
        db.add(root)
        db.flush()
        file = MediaFile(
            library_id=lib.id,
            library_root_id=root.id,
            relative_path="movie.mp4",
            filename="movie.mp4",
            extension=".mp4",
            size_bytes=10,
            mtime=path.stat().st_mtime,
        )
        db.add(file)
        db.commit()
        fid = file.id
        lid = lib.id
    owner = setup(app)
    client, account = user(
        owner, app, {**EMPTY_POLICY, "libraries": {str(lid): ["library.read", "library.preview"]}}
    )
    response = client.get(f"/api/files/{fid}/media", headers={"Range": "bytes=0-3"})
    assert response.status_code == 206, response.text
    assert response.content == b"0123"
    assert response.headers["cache-control"] == "no-store"
    for alias in ("true", "t", "yes", "y", "on", "1"):
        assert client.get(f"/api/files/{fid}/media?download={alias}").status_code == 404
    assert (
        post(owner, f"/api/users/{account['id']}", {"policy": EMPTY_POLICY}, "patch").status_code
        == 200
    )
    assert (
        client.get(f"/api/files/{fid}/media", headers={"Range": "bytes=999-1000"}).status_code
        == 404
    )


def test_login_throttle_is_shared_and_errors_are_generic(env):
    app, factory, _ = env
    setup(app)
    client = TestClient(app)
    responses = [
        post(client, "/api/auth/login", {"username": "missing", "password": SECRET})
        for _ in range(21)
    ]
    assert responses[0].status_code == 401
    assert responses[-1].status_code == 429
    assert responses[0].json()["detail"] == "Invalid username or password"
    assert SECRET not in "".join(r.text for r in responses)


def test_all_scope_snapshot_and_future_scope_do_not_expand_each_other(env):
    app, factory, _ = env
    a = library(factory, "a")
    owner = setup(app)
    snapshot = {
        **EMPTY_POLICY,
        "mode": "all",
        "libraries": {str(a): []},
        "shared": ["library.read"],
    }
    client, account = user(owner, app, snapshot)
    b = library(factory, "b")
    assert [r["id"] for r in client.get("/api/libraries").json()] == [a]
    assert (
        post(owner, f"/api/users/{account['id']}", {"policy": snapshot}, "patch").status_code == 409
    )
    future = {**EMPTY_POLICY, "mode": "future", "shared": ["library.read"]}
    assert (
        post(owner, f"/api/users/{account['id']}", {"policy": future}, "patch").status_code == 200
    )
    assert {r["id"] for r in client.get("/api/libraries").json()} == {a, b}


def test_migration_preserves_existing_libraries_and_jobs_and_owner_singleton(env):
    app, factory, settings = env
    from backend.app.models.entities import ScanJob, JobStatus

    a = library(factory, "old")
    with factory() as db:
        job = ScanJob(library_id=a, job_type="incremental", status=JobStatus.queued)
        db.add(job)
        db.commit()
        jid = job.id
    init_db(factory.kw["bind"])
    initialize_owner(factory, settings)
    owner = setup(app)
    with factory() as db:
        assert db.get(Library, a).name == "old"
        assert db.get(ScanJob, jid).status == JobStatus.queued
        duplicate = LocalAccount(
            id="duplicate",
            username="another",
            username_key="another",
            password_hash="x",
            owner_slot=1,
        )
        db.add(duplicate)
        from sqlalchemy.exc import IntegrityError

        with pytest.raises(IntegrityError):
            db.commit()


def test_waiting_jobs_revoked_but_running_jobs_and_provenance_survive_deletion(env):
    app, factory, _ = env
    from backend.app.models.entities import ScanJob, JobStatus
    from backend.app.models.access import JobAuthority

    a = library(factory, "a")
    owner = setup(app)
    client, account = user(
        owner, app, {**EMPTY_POLICY, "libraries": {str(a): ["library.read", "library.scan"]}}
    )
    with factory() as db:
        for status in (JobStatus.queued, JobStatus.running):
            job = ScanJob(library_id=a, job_type="incremental", status=status)
            db.add(job)
            db.flush()
            db.add(
                JobAuthority(
                    key=f"scan:{job.id}",
                    actor_kind="account",
                    actor_id=account["id"],
                    actor_name="reader",
                    requirements=[["library.scan", a]],
                )
            )
        db.commit()
    response = owner.delete(f"/api/users/{account['id']}", headers=headers(owner))
    assert response.status_code == 204, response.text
    with factory() as db:
        assert [j.status for j in db.scalars(select(ScanJob).order_by(ScanJob.id))] == [
            JobStatus.canceled,
            JobStatus.running,
        ]
        assert len(db.scalars(select(JobAuthority)).all()) == 2


def test_split_listener_rejects_framework_routes_and_browser_trust(env):
    app, factory, settings = env
    from backend.app.api.federation_app import create_federation_app

    protocol = create_federation_app(settings)
    protocol.state.auth_session_factory = factory
    client = TestClient(protocol)
    assert client.get("/docs").status_code == 404
    assert client.post("/api/transcoding/federation/protocol/hello", json={}).status_code == 401
    setup(app)
    assert (
        client.post(
            "/api/transcoding/federation/protocol/hello",
            json={},
            headers={"Origin": "http://testserver"},
        ).status_code
        == 403
    )


def test_history_bounds_and_playback_metrics_do_not_include_hidden_resources(env):
    app, factory, _ = env
    from backend.app.models.entities import (
        LibraryHistory,
        JellyfinLibrary,
        JellyfinItem,
        JellyfinUser,
        JellyfinUserItemData,
        JellyfinMediaMatch,
    )

    a = library(factory, "allowed")
    b = library(factory, "hidden")
    owner = setup(app)
    with factory() as db:
        db.add_all(
            [
                LibraryHistory(
                    library_id=a,
                    snapshot_day="2026-10-20",
                    snapshot={"trend_metrics": {"total_files": 1}},
                ),
                LibraryHistory(
                    library_id=b,
                    snapshot_day="2020-01-01",
                    snapshot={"trend_metrics": {"total_files": 99}},
                ),
            ]
        )
        remote = JellyfinLibrary(
            remote_item_id="remote", name="Remote", collection_type="movies", linked_library_id=a
        )
        db.add(remote)
        db.flush()
        matched = JellyfinItem(
            jellyfin_item_id="visible", library_id=remote.id, item_type="Movie", title="visible"
        )
        unmatched = JellyfinItem(
            jellyfin_item_id="hidden", library_id=remote.id, item_type="Movie", title="hidden"
        )
        db.add_all([matched, unmatched])
        db.flush()
        db.add(
            JellyfinMediaMatch(
                media_file_id=1,
                jellyfin_item_id=matched.id,
                status="matched",
                match_method="exact_path",
                confidence=1,
            )
        )
        db.add(JellyfinUser(jellyfin_user_id="user", name="Viewer", enabled_for_sync=True))
        db.add_all(
            [
                JellyfinUserItemData(
                    jellyfin_item_id=matched.id, jellyfin_user_id="user", play_count=2
                ),
                JellyfinUserItemData(
                    jellyfin_item_id=unmatched.id, jellyfin_user_id="user", play_count=99
                ),
            ]
        )
        db.commit()
    client, account = user(
        owner,
        app,
        {
            **EMPTY_POLICY,
            "global": ["overview.dashboard", "connector.playback"],
            "libraries": {str(a): ["library.read"]},
        },
    )
    stats = client.get(f"/api/libraries/{a}/statistics?panels=user_plays")
    assert stats.status_code == 200, stats.text
    assert stats.json()["user_play_count_distribution"] == [
        {"label": "Viewer", "value": 2, "filter_value": None}
    ]
    response = client.get("/api/dashboard/history")
    assert response.status_code == 200, response.text
    assert "2020-01-01" not in response.text
    assert (
        post(
            owner,
            f"/api/users/{account['id']}",
            {
                "policy": {
                    **EMPTY_POLICY,
                    "global": ["overview.dashboard"],
                    "libraries": {str(a): ["library.read"]},
                }
            },
            "patch",
        ).status_code
        == 200
    )
    assert "user_play_count" not in client.get(f"/api/libraries/{a}/statistics").text


def test_transcode_rule_list_filters_entire_hidden_scopes_before_response(env):
    app, factory, _ = env
    from backend.app.models.entities import TranscodeRule, TranscodePreset

    a = library(factory, "a")
    b = library(factory, "b")
    owner = setup(app)
    with factory() as db:
        preset = TranscodePreset(name="test", definition={}, version=1)
        db.add(preset)
        db.flush()
        db.add_all(
            [
                TranscodeRule(
                    name="visible rule",
                    profile_id=preset.id,
                    library_ids=[a],
                    output_mode="transcode_output",
                ),
                TranscodeRule(
                    name="hidden rule",
                    profile_id=preset.id,
                    library_ids=[a, b],
                    output_mode="transcode_output",
                ),
            ]
        )
        db.commit()
    client, _ = user(
        owner,
        app,
        {
            **EMPTY_POLICY,
            "global": ["settings.app.view"],
            "libraries": {str(a): ["library.read", "transcode.view"]},
        },
    )
    response = client.get("/api/transcoding/rules")
    assert response.status_code == 200, response.text
    assert [r["name"] for r in response.json()] == ["visible rule"]
    assert client.get("/api/transcoding/rules/2").status_code == 404


def test_unsupported_product_mappings_stay_restricted_even_when_all_current_rights_are_assigned(
    env,
):
    app, factory, _ = env
    from backend.app.services.access import GLOBAL_RIGHTS, LIBRARY_RIGHTS

    a = library(factory, "a")
    owner = setup(app)
    client, _ = user(
        owner,
        app,
        {
            **EMPTY_POLICY,
            "global": list(GLOBAL_RIGHTS),
            "mode": "future",
            "shared": list(LIBRARY_RIGHTS),
        },
    )
    for path in (
        "/api/transcoding/federation",
    ):
        assert client.get(path).status_code == 403, path


def test_shared_quality_change_keeps_installation_wide_system_effects_without_media_response(env):
    app, factory, _ = env
    a = library(factory, "allowed")
    b = library(factory, "hidden")
    owner = setup(app)

    class Runtime:
        def __init__(self):
            self.recomputed = []

        def request_quality_recompute(self, library_id):
            self.recomputed.append(library_id)

    runtime = Runtime()
    app.state.scan_runtime = runtime
    client, _ = user(
        owner,
        app,
        {
            **EMPTY_POLICY,
            "global": ["settings.quality.view", "settings.quality.edit"],
            "libraries": {str(a): ["library.read"]},
        },
    )
    response = post(
        client,
        "/api/quality-profiles",
        {"name": "Shared profile", "media_type": "video", "is_default": True, "profile": {}},
    )
    assert response.status_code == 200, response.text
    assert set(runtime.recomputed) == {a, b}
    assert "hidden" not in response.text


def test_distribution_assets_do_not_serve_private_files_or_symlink_escapes(env):
    app, factory, settings = env
    dist = settings.frontend_dist_path
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html></html>")
    (dist / "assets" / "index-test.js").write_text("window.ready=true")
    (dist / "assets" / "private.db").write_text("not public")
    outside = dist.parent / "outside.js"
    outside.write_text("not public")
    (dist / "assets" / "escape.js").symlink_to(outside)
    application = create_app(settings)
    application.state.auth_session_factory = factory
    client = TestClient(application)
    assert client.get("/").status_code == 200
    login_page = client.get("/login")
    assert login_page.status_code == 200
    assert login_page.content == (dist / "index.html").read_bytes()
    assert client.post("/login").status_code == 404
    assert client.get("/api/libraries").status_code == 401
    assert client.get("/assets/index-test.js").status_code == 200
    assert client.get("/assets/private.db").status_code == 404
    assert client.get("/assets/escape.js").status_code == 404
    assert client.get("/assets/%2e%2e/outside.js").status_code == 404


def test_all_websocket_upgrades_and_framework_aliases_are_gated(env):
    app, _, _ = env
    from starlette.websockets import WebSocketDisconnect

    anonymous = TestClient(app)
    for path in ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"):
        assert anonymous.get(path).status_code == 401, path
    with pytest.raises(WebSocketDisconnect) as rejection:
        with anonymous.websocket_connect("/api/arbitrary-websocket"):
            pass
    assert rejection.value.code == 1008


def test_conditional_performance_route_requires_global_view_and_registered_names_match(env, monkeypatch):
    app, factory, settings = env
    from backend.app.services.performance import performance_metrics

    monkeypatch.setattr(performance_metrics, "enabled", False)
    from collections import OrderedDict
    monkeypatch.setattr(performance_metrics, "counters", OrderedDict({"playback_observation": 1}))
    owner = setup(app)
    on = create_app(settings.model_copy(update={"performance_metrics": True}))
    on.state.auth_session_factory = factory
    client = TestClient(on)
    assert client.get("/api/performance").status_code == 401
    client.cookies.update(owner.cookies)
    assert client.get("/api/performance").status_code == 200
    reader, account = user(owner, app, {**EMPTY_POLICY, "global": ["settings.app.view"]})
    client.cookies.update(reader.cookies)
    assert client.get("/api/performance").status_code == 200
    assert client.get("/api/performance").json()["counters"]["playback_observation"] == 1
    assert reader.get("/api/performance").status_code == 404  # Disabled listener stays absent.
    assert post(owner, f"/api/users/{account['id']}", {"policy": EMPTY_POLICY}, "patch").status_code == 200
    assert client.get("/api/performance").status_code == 403
    assert post(owner, "/api/access/guest", {"enabled": True, "policy": {
        **EMPTY_POLICY, "global": ["settings.app.view"],
    }}, "put").status_code == 200
    guest = TestClient(on)
    assert post(guest, "/api/auth/guest").status_code == 200
    assert guest.get("/api/performance").status_code == 200
    actual = {
        (method, r.path.removeprefix("/api")): r.endpoint.__name__
        for r in effective_routes(app.routes)
        if getattr(r, "path", "").startswith("/api/")
        for method in r.methods
    }
    assert all(actual[tuple(key.split(" ", 1))] == name for key, name in INVENTORY.items())


@pytest.mark.parametrize("kind", ["account", "guest"])
@pytest.mark.parametrize("rights", [[], ["settings.app.edit"], ["settings.app.view"],
                                     ["settings.app.view", "settings.app.edit"]])
def test_operational_diagnostics_are_global_but_do_not_grant_media_access(env, monkeypatch, kind, rights):
    from backend.app.api import routes
    from backend.app.models.entities import LibraryHistory
    from backend.app.services.history_storage import history_storage_cache
    from backend.app.services.app_settings import update_app_settings
    from backend.app.schemas.app_settings import AppSettingsUpdate
    from backend.app.services.telemetry import build_telemetry_payload, mark_telemetry_sent
    from backend.app.utils.time import utc_now

    app, factory, settings = env
    settings.telemetry_disabled = False
    owner = setup(app)
    a, b = library(factory, "hidden-a"), library(factory, "hidden-b")
    with factory() as db:
        db.add_all([LibraryHistory(library_id=i, snapshot_day="2026-10-23", captured_at=utc_now(), snapshot={"files": 1}) for i in (a, b)])
        db.commit()
        update_app_settings(db, AppSettingsUpdate(telemetry={"mode": "enabled"}), settings)
        mark_telemetry_sent(db, utc_now(), {"test_operational_payload": True})
    history_storage_cache.clear()
    sent = []

    def send(db, active_settings, *, force=False):
        assert "access_scope" not in db.info
        sent.append(build_telemetry_payload(db, active_settings, routes.load_app_settings(db, active_settings), mode="enabled"))
        return True

    monkeypatch.setattr(routes, "send_current_telemetry_snapshot", send)
    policy = {**EMPTY_POLICY, "global": rights}
    if kind == "account":
        client, account = user(owner, app, policy)
    else:
        assert post(owner, "/api/access/guest", {"enabled": True, "policy": policy}, "put").status_code == 200
        client = TestClient(app)
        assert post(client, "/api/auth/guest").status_code == 200
    view = "settings.app.view" in rights
    telemetry_config = client.get("/api/app-settings").json()["telemetry"]
    if view:
        assert telemetry_config["installation_id"]
        assert telemetry_config["last_user_visible_payload"] == {"test_operational_payload": True}
    else:
        assert telemetry_config["installation_id"] is None
        assert telemetry_config["last_user_visible_payload"] is None
    for path in ("/api/history-storage", "/api/telemetry/preview?mode=enabled"):
        expected = owner.get(path).json()  # Prime the shared installation cache.
        if path == "/api/history-storage":
            expected = owner.get(path).json()
        response = client.get(path)
        assert response.status_code == (200 if view else 403), response.text
        if view:
            actual = response.json()
            if "payload" in actual:
                assert actual["payload"].pop("sent_at")
                expected["payload"].pop("sent_at")
            assert actual == expected
    if view:
        assert client.get("/api/telemetry/preview?mode=enabled").json()["payload"]["usage"]["library_count"] == 2
        assert client.get("/api/history-storage").json()["categories"]["library_history"]["entry_count"] == 2
        assert client.get("/api/libraries").json() == []
        assert client.get(f"/api/libraries/{a}").status_code == 404
    allowed_send = view and "settings.app.edit" in rights
    response = post(client, "/api/telemetry/send-now")
    assert response.status_code == (200 if allowed_send else 403), response.text
    assert len(sent) == int(allowed_send)
    if sent:
        assert sent[0]["usage"]["library_count"] == 2
    assert client.post("/api/telemetry/send-now").status_code == 403  # CSRF remains mandatory.
    if kind == "account":
        assert post(owner, f"/api/users/{account['id']}", {"policy": EMPTY_POLICY}, "patch").status_code == 200
    else:
        assert post(owner, "/api/access/guest", {"enabled": True, "policy": EMPTY_POLICY}, "put").status_code == 200
    assert client.get("/api/history-storage").status_code == 403
    assert client.get("/api/telemetry/preview").status_code == 403
    assert post(client, "/api/telemetry/send-now").status_code == 403
    assert len(sent) == int(allowed_send)


@pytest.mark.parametrize("value,accepted", [("abcd1", True), ("abcd!", True), ("12345", True), ("abcde", False), ("abc1", False), ("abcd ", False), ("äöüß1", True), ("a" * 300 + "1", True)])
def test_new_password_minimum_requirements(value, accepted):
    from fastapi import HTTPException
    from backend.app.services.access import password
    if accepted:
        assert password(value) == value
    else:
        with pytest.raises(HTTPException) as error:
            password(value)
        assert error.value.status_code == 422


@pytest.mark.parametrize("kind", ["account", "guest"])
def test_scan_and_quality_views_follow_metadata_scope_before_pagination(env, kind):
    from datetime import timedelta
    from backend.app.models.entities import ScanJob, JobStatus
    from backend.app.utils.time import utc_now

    app, factory, _ = env
    allowed, hidden = library(factory, "allowed"), library(factory, "hidden")
    owner = setup(app)
    policy = {**EMPTY_POLICY, "libraries": {str(allowed): ["library.read"]}}
    if kind == "account":
        client, _ = user(owner, app, policy)
    else:
        assert post(owner, "/api/access/guest", {"enabled": True, "policy": policy}, "put").status_code == 200
        client = TestClient(app)
        assert post(client, "/api/auth/guest").status_code == 200
    now = utc_now()
    with factory() as db:
        jobs = []
        for target in (allowed, hidden):
            for job_type in ("incremental", "quality_recompute"):
                for status in (JobStatus.running, JobStatus.completed):
                    job = ScanJob(
                        library_id=target, job_type=job_type, status=status,
                        started_at=now - timedelta(minutes=5),
                        finished_at=(now if target == hidden else now - timedelta(minutes=1))
                        if status == JobStatus.completed else None,
                        files_total=10, files_scanned=7,
                        trigger_details={"paths": ["visible.mkv" if target == allowed else "private.mkv"]},
                        scan_summary={"analysis": {"analysis_failed": 1, "failed_files": [
                            {"path": "visible.mkv" if target == allowed else "private.mkv",
                             "reason": "Invalid media", "detail": "technical probe diagnostic"}
                        ]}},
                    )
                    db.add(job)
                    db.flush()
                    jobs.append((job.id, target, job_type))
        db.commit()
    visible_ids = {jid for jid, target, _ in jobs if target == allowed}
    active = client.get("/api/scan-jobs/active")
    assert active.status_code == 200, active.text
    assert len(active.json()) == 1
    assert active.json()[0]["library_id"] == allowed
    per_library = client.get(f"/api/libraries/{allowed}/scan-jobs?limit=50")
    assert {j["id"] for j in per_library.json()} == visible_ids
    assert client.get(f"/api/libraries/{hidden}/scan-jobs").status_code == 404
    first = client.get("/api/scan-jobs/recent?limit=1").json()
    assert len(first["items"]) == 1 and first["has_more"]
    cursor = first["items"][0]
    second = client.get("/api/scan-jobs/recent", params={
        "limit": 1, "before_finished_at": cursor["finished_at"], "before_id": cursor["id"],
    }).json()
    assert len(second["items"]) == 1 and not second["has_more"]
    assert {j["job_type"] for j in first["items"] + second["items"]} == {"incremental", "quality_recompute"}
    for jid, target, job_type in jobs:
        response = client.get(f"/api/scan-jobs/{jid}")
        if target == hidden:
            assert response.status_code == 404
            continue
        assert response.status_code == 200, response.text
        detail = response.json()
        assert detail["scan_summary"]["analysis"]["failed_files"][0]["detail"] == "technical probe diagnostic"
        assert "private.mkv" not in response.text
        if job_type == "quality_recompute":
            assert detail["quality_progress"]["files_scanned"] == 7
            assert detail["quality_progress"]["files_total"] == 10
    assert client.get("/api/scan-jobs/999999").status_code == 404
    assert post(client, f"/api/libraries/{allowed}/scan").status_code == 404
    assert post(client, f"/api/libraries/{allowed}/scan/cancel").status_code == 404
    assert len(owner.get("/api/scan-jobs/recent?limit=50").json()["items"]) == 4


def test_scan_views_with_no_library_access_are_empty_and_never_fall_back_to_guest(env):
    from backend.app.models.entities import ScanJob, JobStatus

    app, factory, _ = env
    target = library(factory, "private")
    owner = setup(app)
    with factory() as db:
        job = ScanJob(library_id=target, status=JobStatus.running, job_type="full")
        db.add(job)
        db.commit()
        jid = job.id
    assert post(owner, "/api/access/guest", {"enabled": True, "policy": {
        **EMPTY_POLICY, "mode": "future", "shared": ["library.read"],
    }}, "put").status_code == 200
    client, _ = user(owner, app)
    assert client.get("/api/scan-jobs/active").json() == []
    assert client.get("/api/scan-jobs/recent").json() == {"items": [], "has_more": False}
    assert client.get(f"/api/scan-jobs/{jid}").status_code == 404
    assert TestClient(app).get("/api/scan-jobs/active").status_code == 401


def test_guest_defaults_exclude_shared_configuration_but_explicit_grants_work(env):
    app, _, _ = env
    owner = setup(app)
    initial = owner.get("/api/access/guest").json()
    assert not initial["enabled"]
    policy = initial["policy"]
    assert not any(right.startswith("settings.") or right.startswith("connector.")
                   for right in policy.get("global", []))
    assert policy.get("libraries", {}) == {}
    assert post(owner, "/api/access/guest", {"enabled": True, "policy": policy}, "put").status_code == 200
    guest = TestClient(app)
    assert post(guest, "/api/auth/guest").status_code == 200
    routes = (
        "/api/quality-profiles", "/api/compatibility/hardware-profiles",
        "/api/transcoding/presets", "/api/connectors",
    )
    for route in routes:
        assert guest.get(route).status_code == 403, route
    assert post(guest, "/api/app-settings", {}, "patch").status_code == 403
    assert set(guest.get("/api/auth/status").json()["identity"]["policy"]["global"]) == {"overview.dashboard", "overview.compare", "overview.storage"}
    permitted = {**policy, "global": ["settings.quality.view"]}
    assert post(owner, "/api/access/guest", {"enabled": True, "policy": permitted}, "put").status_code == 200
    assert guest.get("/api/quality-profiles").status_code == 200
    for route in routes[1:]:
        assert guest.get(route).status_code == 403, route


def test_guest_default_and_environment_activation(env):
    app, factory, settings = env
    owner = setup(app)
    first = library(factory, "first")
    initial = owner.get("/api/access/guest").json()
    assert not initial["enabled"]
    assert initial["policy"]["mode"] == "future"
    assert initial["policy"]["shared"] == ["library.read"]
    initialize_owner(factory, settings.model_copy(update={"guest_enabled": True}))
    guest = TestClient(app)
    assert post(guest, "/api/auth/guest").status_code == 200
    assert first in [item["id"] for item in guest.get("/api/libraries").json()]
    second = library(factory, "second")
    assert second in [item["id"] for item in guest.get("/api/libraries").json()]
    assert post(guest, f"/api/libraries/{first}/scan", {}).status_code in (403, 404)
    initialize_owner(factory, settings.model_copy(update={"guest_enabled": False}))
    assert guest.get("/api/auth/status").json()["identity"] is None
    with factory() as db:
        assert db.get(AccessState, 1).guest_policy == initial["policy"]


def test_no_users_server_has_owner_access_and_csrf(env):
    app, factory, settings = env
    settings = settings.model_copy(update={"no_users": True})
    initialize_owner(factory, settings)
    app = create_app(settings)
    app.state.auth_session_factory = factory
    def database():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_app_settings] = lambda: settings
    from backend.app.api.deps import get_scan_runtime
    app.dependency_overrides[get_scan_runtime] = lambda: None
    client = TestClient(app)
    status = client.get("/api/auth/status").json()
    assert not status["setup_required"]
    assert status["identity"]["owner"] is True
    assert client.get("/api/libraries").status_code == 200
    assert client.get("/api/users").status_code == 404
    assert client.post("/api/libraries", json={}).status_code == 403
    assert client.post("/api/libraries", json={}, headers={"Origin": "http://testserver", "X-CSRF-Token": status["csrf"]}).status_code == 422
    with factory() as db:
        assert db.get(AccessState, 1) is None
    normal = create_app(settings.model_copy(update={"no_users": False}))
    normal.state.auth_session_factory = factory
    assert TestClient(normal).get("/api/auth/status").json()["setup_required"] is True


def test_guest_environment_applies_during_interactive_setup(env):
    app, factory, settings = env
    app.state.access_settings = settings.model_copy(update={"guest_enabled": True})
    owner = setup(app)
    assert owner.get("/api/access/guest").json()["enabled"] is True
    assert post(TestClient(app), "/api/auth/guest").status_code == 200


@pytest.mark.parametrize("origin", ["guest", "account", "system", "legacy"])
def test_guest_cancellation_requires_other_right_across_sessions_and_job_origins(env, origin):
    from types import SimpleNamespace
    from backend.app.api.deps import get_scan_runtime
    from backend.app.models.access import JobAuthority
    from backend.app.models.entities import TranscodeJob, TranscodeVariantGroup, JobStatus
    from backend.app.services.transcoding import cancel_transcode_job

    app, factory, _ = env
    owner = setup(app)
    allowed, hidden = library(factory, "allowed"), library(factory, "hidden")
    ids = []
    with factory() as db:
        for target in (allowed, hidden):
            group = TranscodeVariantGroup(
                library_id=target, original_relative_path="movie.mkv", original_filename="movie.mkv",
            )
            db.add(group)
            db.flush()
            job = TranscodeJob(
                group_id=group.id, library_id=target, status=JobStatus.queued,
                profile="compatibility", source_path_snapshot=f"/media/{target}/movie.mkv",
                source_size_snapshot=100, source_mtime_snapshot=0,
                output_path_snapshot=f"/media/{target}/output.mp4", output_relative_path="output.mp4",
            )
            db.add(job)
            db.flush()
            ids.append(job.id)
            if origin != "legacy":
                db.add(JobAuthority(
                    key=f"transcode:{job.id}", actor_kind=origin,
                    actor_id="guest" if origin == "guest" else "other",
                    actor_name="", requirements=[],
                ))
        db.commit()
    calls = []

    def cancel(job_id):
        calls.append(job_id)
        with factory() as db:
            return cancel_transcode_job(db, job_id)

    app.dependency_overrides[get_scan_runtime] = lambda: SimpleNamespace(cancel_transcode=cancel)
    policy = {**EMPTY_POLICY, "libraries": {str(allowed): [
        "library.read", "transcode.view", "transcode.cancel_own",
    ]}}

    def grant():
        assert post(owner, "/api/access/guest", {"enabled": True, "policy": policy}, "put").status_code == 200

    grant()
    guests = [TestClient(app), TestClient(app)]
    for guest in guests:
        assert post(guest, "/api/auth/guest").status_code == 200
        assert guest.get(f"/api/transcode-jobs/{ids[0]}").status_code == 200
        assert post(guest, f"/api/transcode-jobs/{ids[0]}/cancel").status_code == 404
    assert calls == []
    with factory() as db:
        assert db.get(TranscodeJob, ids[0]).status == JobStatus.queued
    policy["libraries"][str(allowed)] = ["library.read", "transcode.view", "transcode.cancel_other"]
    grant()
    for guest in guests:
        assert post(guest, f"/api/transcode-jobs/{ids[1]}/cancel").status_code == 404
    for required in ("library.read", "transcode.view"):
        policy["libraries"][str(allowed)].remove(required)
        grant()
        assert post(guests[1], f"/api/transcode-jobs/{ids[0]}/cancel").status_code == 404
        policy["libraries"][str(allowed)].append(required)
    assert calls == []
    grant()
    response = post(guests[1], f"/api/transcode-jobs/{ids[0]}/cancel")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "canceled"
    assert calls == [ids[0]]
    policy["libraries"][str(allowed)].remove("transcode.cancel_other")
    grant()
    assert post(guests[0], f"/api/transcode-jobs/{ids[0]}/cancel").status_code == 404
    assert calls == [ids[0]]
    with factory() as db:
        assert db.get(TranscodeJob, ids[1]).status == JobStatus.queued


def test_guest_transcode_visibility_requires_explicit_per_library_grant(env):
    from backend.app.models.entities import TranscodeJob, TranscodeVariantGroup, JobStatus

    app, factory, _ = env
    owner = setup(app)
    allowed, hidden = library(factory, "allowed"), library(factory, "hidden")
    ids = []
    with factory() as db:
        for target in (allowed, hidden):
            group = TranscodeVariantGroup(
                library_id=target, original_relative_path="movie.mkv", original_filename="movie.mkv",
            )
            db.add(group)
            db.flush()
            job = TranscodeJob(
                group_id=group.id, library_id=target, status=JobStatus.running,
                profile="compatibility", source_path_snapshot=f"/media/{target}/movie.mkv",
                source_size_snapshot=100, source_mtime_snapshot=0,
                output_path_snapshot=f"/media/{target}/output.mp4", output_relative_path="output.mp4",
            )
            db.add(job)
            db.flush()
            ids.append(job.id)
        db.commit()
    initial = owner.get("/api/access/guest").json()["policy"]
    assert not any(right.startswith("transcode.") for right in initial.get("shared", []))
    assert initial.get("libraries", {}) == {}
    policy = {**initial, "mode": "per_library", "shared": [], "libraries": {str(allowed): ["library.read"], str(hidden): ["library.read"]}}
    assert post(owner, "/api/access/guest", {"enabled": True, "policy": policy}, "put").status_code == 200
    guest = TestClient(app)
    assert post(guest, "/api/auth/guest").status_code == 200
    for route in ("/api/transcode-jobs", "/api/transcode-jobs/active"):
        response = guest.get(route)
        assert response.status_code == 200, response.text
        assert response.json() == {"items": [], "total": 0}
    assert guest.get(f"/api/transcode-jobs/{ids[0]}").status_code == 404
    policy["libraries"][str(allowed)] = ["library.read", "transcode.view"]
    assert post(owner, "/api/access/guest", {"enabled": True, "policy": policy}, "put").status_code == 200
    for route in ("/api/transcode-jobs?limit=1", "/api/transcode-jobs/active"):
        page = guest.get(route)
        assert page.status_code == 200, page.text
        assert page.json()["total"] == 1
        assert [job["id"] for job in page.json()["items"]] == ids[:1]
    assert guest.get(f"/api/transcode-jobs/{ids[0]}").status_code == 200
    assert guest.get(f"/api/transcode-jobs/{ids[1]}").status_code == 404
    assert post(guest, f"/api/transcode-jobs/{ids[0]}/cancel").status_code == 404
    with factory() as db:
        assert db.get(TranscodeJob, ids[0]).status == JobStatus.running


@pytest.mark.parametrize("playback", [False, True])
@pytest.mark.parametrize("kind", ["account", "guest"])
def test_global_external_catalog_keeps_local_matches_and_playback_scoped(env, playback, kind):
    from backend.app.models.entities import (
        JellyfinLibrary, JellyfinItem, JellyfinMediaMatch, JellyfinUser, JellyfinUserItemData,
        ConnectorConnection, ConnectorLibrary, ConnectorLibraryLink, ConnectorLibraryLocation,
        ConnectorRootBinding, ConnectorItem, LibraryRoot,
        ConnectorMediaMatch,
    )
    app, factory, _ = env
    a, b = library(factory, "allowed"), library(factory, "hidden")
    owner = setup(app)
    with factory() as db:
        remote = JellyfinLibrary(name="External", remote_item_id="external", linked_library_id=b,
            locations=["/remote/all"], mapped_locations=["/media/private-root"])
        db.add(remote)
        db.flush()
        remote_id = remote.id
        item_ids = []
        for n in range(3):
            item = JellyfinItem(jellyfin_item_id=f"remote-{n}", library_id=remote.id,
                library_name="External", item_type="Movie", title=f"Remote title {n}",
                path=f"/remote/all/{n}.mkv", match_status="matched" if n < 2 else "unmatched")
            db.add(item)
            db.flush()
            item_ids.append(item.id)
            if n < 2:
                db.add(JellyfinMediaMatch(media_file_id=n+1, jellyfin_item_id=item.id, match_method="exact_path"))
        db.add(JellyfinUser(jellyfin_user_id="viewer", name="Viewer", enabled_for_sync=True))
        db.flush()
        for i, jid in enumerate(item_ids):
            db.add(JellyfinUserItemData(jellyfin_item_id=jid, jellyfin_user_id="viewer",
                play_count=(2 if i == 0 else 99), played=True))
        connection = ConnectorConnection(provider="jellyfin", name="Catalog fixture", capabilities={"users": True})
        db.add(connection)
        db.flush()
        connection_id = connection.id
        source = ConnectorLibrary(connection_id=connection.id, remote_id="lib", name="External generic",
            provider_payload={"Name": "External", "ApiKey": "never-expose", "UserData": {"PlayCount": 999}})
        db.add(source)
        db.flush()
        location = ConnectorLibraryLocation(connector_library_id=source.id, remote_path="/remote/all", normalized_path="/remote/all")
        db.add(location)
        db.flush()
        root_ids = []
        for target in (a,b):
            root = LibraryRoot(library_id=target, path=f"/media/{target}",
                path_key=f"/media/{target}", display_name=f"root-{target}")
            db.add(root)
            db.flush()
            root_ids.append(root.id)
            db.add(ConnectorLibraryLink(connector_library_id=source.id, library_id=target))
            db.add(ConnectorRootBinding(location_id=location.id, library_root_id=root.id,
                source_prefix="/remote/all", normalized_source_prefix="/remote/all"))
        raw_item = ConnectorItem(connection_id=connection.id, connector_library_id=source.id,
            remote_id="unmatched", item_type="Movie", title="Unmatched generic", remote_path="/remote/all/free.mkv",
            provider_payload={"Name": "Unmatched generic", "ApiKey": "never-expose",
                "UserData": {"Played": True, "PlayCount": 999}, "message": "token=never-expose"})
        db.add(raw_item)
        hidden_item = ConnectorItem(connection_id=connection.id, connector_library_id=source.id,
            remote_id="hidden-local-match", item_type="Movie", title="Also externally visible",
            match_status="matched")
        db.add(hidden_item)
        db.flush()
        db.add(ConnectorMediaMatch(connector_item_id=hidden_item.id, media_file_id=2,
            match_method="exact_path"))
        db.commit()
        raw_id = raw_item.id
    policy = {**EMPTY_POLICY,
        "global": ["connector.view"] + (["connector.playback"] if playback else []),
        "libraries": {str(a): ["library.read"]}}
    if kind == "account":
        client, account = user(owner, app, policy)
    else:
        assert post(owner, "/api/access/guest", {"enabled": True, "policy": policy}, "put").status_code == 200
        client = TestClient(app)
        assert post(client, "/api/auth/guest").status_code == 200
    catalog = client.get("/api/jellyfin/catalog/summary")
    assert catalog.status_code == 200, catalog.text
    # Existing summary describes unlinked external libraries only; preserve that contract.
    assert catalog.json()["item_count"] == owner.get("/api/jellyfin/catalog/summary").json()["item_count"]
    libraries = client.get("/api/jellyfin/libraries").json()
    external = next(row for row in libraries if row["id"] == remote_id)
    assert external["item_count"] == 3
    assert external["linked_library_id"] is None and external["linked_library_name"] is None
    assert external["mapped_locations"] == []
    items = client.get(f"/api/jellyfin/libraries/{remote_id}/items?limit=1").json()
    assert items["total"] == 3 and len(items["items"]) == 1
    for i, jid in enumerate(item_ids):
        detail = client.get(f"/api/jellyfin/items/{jid}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["item"]["title"] == f"Remote title {i}"
        assert (detail.json()["match"] is not None) == (i == 0)
        assert detail.json()["item"]["match_status"] == ("matched" if i == 0 else "unmatched")
        if not playback or i != 0:
            assert "user_data" not in detail.json()
        else:
            assert detail.json()["user_data"][0]["play_count"] == 2
    overview = client.get(f"/api/jellyfin/libraries/{remote_id}/overview").json()
    assert overview["item_count"] == 3
    if playback:
        assert overview["playback_distribution"] == [{"label": "played", "value": 1}, {"label": "unplayed", "value": 0}]
    else:
        assert "playback_distribution" not in overview
        for query in ("played=false", "user_id=viewer", "sort_key=play_count"):
            assert client.get(f"/api/jellyfin/libraries/{remote_id}/items?{query}").status_code == 403
    assert len(client.get("/api/jellyfin/unmatched").json()) == 2
    generic = client.get(f"/api/connectors/{connection_id}/libraries")
    assert generic.status_code == 200, generic.text
    assert generic.json()[0]["linked_library_ids"] == [a]
    assert "never-expose" not in generic.text and "UserData" not in generic.text
    assert client.get(f"/api/connectors/{connection_id}/items").json()["total"] == 2
    assert client.get(f"/api/connectors/{connection_id}/items?attention_only=true").json()["total"] == 2
    assert client.get(f"/api/connectors/{connection_id}/items?status=matched").json()["total"] == 0
    assert client.get(f"/api/connectors/{connection_id}/item-status-summary").json() == {"unmatched": 2}
    bindings = client.get(f"/api/connectors/{connection_id}/bindings").json()
    assert [row["library_root_id"] for row in bindings] == root_ids[:1]
    mapping = client.get(f"/api/connectors/{connection_id}/mapping-overview")
    assert mapping.status_code == 200, mapping.text
    assert mapping.json()["libraries"][0]["linked_library_ids"] == [a]
    assert mapping.json()["coverage"]["matched_items"] == 0
    raw = client.get(f"/api/connectors/{connection_id}/items/{raw_id}/provider-payload")
    assert raw.status_code == 200, raw.text
    assert "never-expose" not in raw.text and "PlayCount" not in raw.text
    assert raw.json()["core_payload"]["title"] == "Unmatched generic"
    assert post(client, f"/api/connectors/{connection_id}", {}, "patch").status_code == 403
    assert client.get("/api/files/2/connectors").status_code == 404
    assert client.get("/api/files/1/connectors").status_code == 200
    assert client.get("/api/files/2/jellyfin").status_code == 404
    no_local = {**policy, "libraries": {}}
    if kind == "account":
        assert post(owner, f"/api/users/{account['id']}", {"policy": no_local}, "patch").status_code == 200
    else:
        assert post(owner, "/api/access/guest", {"enabled": True, "policy": no_local}, "put").status_code == 200
    external_only = client.get(f"/api/jellyfin/libraries/{remote_id}/items").json()
    assert external_only["total"] == 3
    assert all(row["media_file_id"] is None and "play_count" not in row for row in external_only["items"])
    assert client.get(f"/api/connectors/{connection_id}/bindings").json() == []


def test_legacy_jellyfin_path_mappings_follow_local_roots_and_global_management_rights(env):
    from backend.app.models.entities import JellyfinPathMapping

    app, factory, _ = env
    allowed, hidden = library(factory, "allowed"), library(factory, "hidden")
    owner = setup(app)
    with factory() as db:
        rows = [
            JellyfinPathMapping(jellyfin_path_prefix="/remote/allowed", medialyze_path_prefix="/media/allowed/sub"),
            JellyfinPathMapping(jellyfin_path_prefix="/remote/hidden", medialyze_path_prefix="/media/hidden/sub"),
            JellyfinPathMapping(jellyfin_path_prefix="/remote/mixed", medialyze_path_prefix="/media"),
            JellyfinPathMapping(jellyfin_path_prefix="/remote/outside", medialyze_path_prefix="/other"),
        ]
        db.add_all(rows)
        db.commit()
    policy = {**EMPTY_POLICY, "global": ["connector.view"],
        "libraries": {str(allowed): ["library.read"]}}
    client, _ = user(owner, app, policy)
    response = client.get("/api/jellyfin/path-mappings")
    assert response.status_code == 200, response.text
    assert [row["jellyfin_path_prefix"] for row in response.json()] == ["/remote/allowed"]
    assert client.get("/api/jellyfin/libraries").status_code == 200
    assert client.get("/api/jellyfin/sync/status").status_code == 403
    change = {"jellyfin_path_prefix": "/remote/new", "medialyze_path_prefix": "/media/allowed/new"}
    assert post(client, "/api/jellyfin/path-mappings", change).status_code == 403
    policy["global"].append("connector.manage")
    assert post(owner, f"/api/users/{client.get('/api/auth/status').json()['identity']['id']}",
        {"policy": policy}, "patch").status_code == 200
    assert post(client, "/api/jellyfin/path-mappings", change).status_code == 403
    policy["libraries"][str(allowed)].append("library.paths")
    assert post(owner, f"/api/users/{client.get('/api/auth/status').json()['identity']['id']}",
        {"policy": policy}, "patch").status_code == 200
    # Although this mapping targets the visible root, it is a global rewrite and
    # remains blocked while another installed library is outside the path scope.
    assert post(client, "/api/jellyfin/path-mappings", change).status_code == 403
    assert owner.get("/api/jellyfin/path-mappings").json().__len__() == 4


def test_shared_compatibility_profile_rights_cover_all_kinds_without_hidden_file_access(env):
    app, factory, _ = env
    allowed, hidden = library(factory, "allowed"), library(factory, "hidden")
    owner = setup(app)
    policy = {**EMPTY_POLICY, "global": ["settings.hardware.view"],
        "libraries": {str(allowed): ["library.read"]}}
    client, account = user(owner, app, policy)
    base = {"schema_version": 1, "profile_version": 1, "status": "local",
        "added": "2026-10-22", "last_modified": "2026-10-22"}
    fixtures = (
        ("hardware-profiles", {**base, "id": "local-hardware", "name": "Hardware fixture", "category": "computer", "manufacturer": "Fixture"}),
        ("software-profiles", {**base, "id": "local-player", "name": "Player fixture", "developer": "Fixture"}),
        ("profiles", {**base, "id": "local-combination", "name": "Combination fixture", "hardware_profile_id": "local-hardware", "software_profile_id": "local-player"}),
    )
    for route, payload in fixtures:
        path = f"/api/compatibility/{route}"
        response = client.get(path)
        assert response.status_code == 200, response.text
        assert post(client, path, payload).status_code == 403
        assert post(client, f"{path}/{payload['id']}", {"notes": "unauthorized"}, "patch").status_code == 403
        assert post(client, f"{path}/{payload['id']}", method="delete").status_code == 403
    for suffix in ("compatibility", "hardware-compatibility", "software-compatibility"):
        assert client.get(f"/api/files/1/{suffix}").status_code == 200
        assert client.get(f"/api/files/2/{suffix}").status_code == 404
    policy["global"] = ["settings.hardware.view", "settings.hardware.edit"]
    assert post(owner, f"/api/users/{account['id']}", {"policy": policy}, "patch").status_code == 200
    for route, payload in fixtures:
        path = f"/api/compatibility/{route}"
        created = post(client, path, payload)
        assert created.status_code == 201, created.text
        changed = post(client, f"{path}/{payload['id']}", {"notes": "shared configuration change"}, "patch")
        assert changed.status_code == 200, changed.text
    evaluation = "/api/compatibility/profiles/local-combination/evaluate"
    response = post(client, evaluation, {"file_id": 1})
    assert response.status_code == 200, response.text
    assert post(client, evaluation, {"file_id": 2}).status_code == 404
    assert post(client, evaluation, {"file_id": 999999}).status_code == 404
    for route, payload in reversed(fixtures):
        assert post(client, f"/api/compatibility/{route}/{payload['id']}", method="delete").status_code == 204
    policy["global"] = []
    assert post(owner, f"/api/users/{account['id']}", {"policy": policy}, "patch").status_code == 200
    for route, _ in fixtures:
        assert client.get(f"/api/compatibility/{route}").status_code == 403
    assert client.get("/api/files/1/hardware-compatibility").status_code == 403


@pytest.mark.parametrize("kind", ["account", "guest"])
@pytest.mark.parametrize("mode", ["filename", "filehash"])
def test_duplicate_suppression_requires_edit_on_its_own_readable_library(env, kind, mode):
    from backend.app.models.entities import DuplicateGroupSuppression, DuplicateDetectionMode

    app, factory, _ = env
    owner = setup(app)
    allowed, hidden = library(factory, "allowed"), library(factory, "hidden")
    signature = "same movie" if mode == "filename" else "a" * 64
    with factory() as db:
        for lid in (allowed, hidden):
            db.get(Library, lid).duplicate_detection_mode = DuplicateDetectionMode(mode)
            original = db.scalar(select(MediaFile).where(MediaFile.library_id == lid))
            original.duration_seconds = 3600
            original.filename_signature = original.filename_pattern_signature = "same movie"
            original.content_hash, original.content_hash_algorithm = "a" * 64, "sha256"
            db.add(MediaFile(library_id=lid, relative_path="copy.mp4", filename="copy.mp4", extension="mp4",
                size_bytes=100, mtime=0, duration_seconds=3600, filename_signature="same movie",
                filename_pattern_signature="same movie", content_hash="a" * 64, content_hash_algorithm="sha256"))
        db.add(DuplicateGroupSuppression(library_id=hidden, mode=DuplicateDetectionMode(mode), signature=signature))
        db.commit()
    policy = {**EMPTY_POLICY, "libraries": {str(allowed): ["library.read"]}}
    def configure(policy):
        if kind == "account":
            assert post(owner, f"/api/users/{account['id']}", {"policy": policy}, "patch").status_code == 200
        else:
            assert post(owner, "/api/access/guest", {"enabled": True, "policy": policy}, "put").status_code == 200
    if kind == "account":
        client, account = user(owner, app, policy)
    else:
        configure(policy)
        client = TestClient(app)
        assert post(client, "/api/auth/guest").status_code == 200
    path = f"/api/libraries/{allowed}/duplicates/suppressions"
    hidden_path = f"/api/libraries/{hidden}/duplicates/suppressions"
    payload = {"mode": mode, "signature": signature}
    assert client.get(f"/api/libraries/{allowed}/duplicates").json()["total_groups"] == 1
    assert post(client, path, payload).status_code == 404
    assert client.request("DELETE", path, params=payload, headers=headers(client)).status_code == 404
    policy["libraries"][str(allowed)] = ["library.read", "library.edit"]
    configure(policy)
    created = post(client, path, payload)
    assert created.status_code == 201, created.text
    page = client.get(f"/api/libraries/{allowed}/duplicates").json()
    assert page["total_groups"] == 0 and page["suppressed_group_count"] == 1
    all_groups = client.get(f"/api/libraries/{allowed}/duplicates?include_suppressed=true").json()
    assert len(all_groups["items"]) == 1 and all_groups["items"][0]["suppressed"]
    assert post(client, hidden_path, payload).status_code == 404
    assert client.request("DELETE", hidden_path, params=payload, headers=headers(client)).status_code == 404
    assert client.get(f"/api/libraries/{hidden}/duplicates?include_suppressed=true").status_code == 404
    restored = client.request("DELETE", path, params=payload, headers=headers(client))
    assert restored.status_code == 204 and restored.content == b""
    assert client.get(f"/api/libraries/{allowed}/duplicates").json()["total_groups"] == 1
    policy["libraries"][str(allowed)] = ["library.read"]
    configure(policy)
    assert post(client, path, payload).status_code == 404
    with factory() as db:
        remaining = list(db.scalars(select(DuplicateGroupSuppression)))
        assert len(remaining) == 1 and remaining[0].library_id == hidden


@pytest.mark.parametrize("kind", ["account", "guest"])
def test_cover_display_and_download_are_scoped_metadata_not_media_actions(env, monkeypatch, kind):
    from backend.app.api import routes

    app, factory, _ = env
    owner = setup(app)
    allowed, hidden = library(factory, "allowed"), library(factory, "hidden")
    calls = []
    png = b"\x89PNG\r\n\x1a\nfixture"
    def generate(db, file_id, **kwargs):
        calls.append(file_id)
        assert db.info["access_scope"][0] == (allowed,)
        assert db.scalar(select(MediaFile.id).where(MediaFile.id == file_id)) == file_id
        return "fixture-cover.png", png
    monkeypatch.setattr(routes, "generate_media_cover_png", generate)
    policy = {**EMPTY_POLICY, "libraries": {str(allowed): ["library.read"]}}
    if kind == "account":
        client, account = user(owner, app, policy)
    else:
        assert post(owner, "/api/access/guest", {"enabled": True, "policy": policy}, "put").status_code == 200
        client = TestClient(app)
        assert post(client, "/api/auth/guest").status_code == 200
    for option in (None, "false", "0", "off", "no", "true", "1", "on", "yes"):
        response = client.get("/api/files/1/cover", params={} if option is None else {"download": option})
        assert response.status_code == 200, response.text
        assert response.content == png
        assert response.headers["content-type"] == "image/png"
        assert response.headers["cache-control"] == "no-store"
        assert ("content-disposition" in response.headers) == (option in {"true", "1", "on", "yes"})
    before = len(calls)
    assert client.get("/api/files/1/cover?download=invalid").status_code == 422
    for path in ("/api/files/2/cover", "/api/files/2/cover?download=1", "/api/files/999999/cover"):
        assert client.get(path, headers={"Range": "bytes=0-3"}).status_code == 404
    assert TestClient(app).get("/api/files/1/cover?download=1").status_code == 401
    assert len(calls) == before  # No extraction for hidden, invalid or unauthenticated requests.
    assert client.get("/api/files/1/media").status_code == 404
    assert client.get("/api/files/1/media?download=true").status_code == 404
    empty = {**EMPTY_POLICY}
    if kind == "account":
        assert post(owner, f"/api/users/{account['id']}", {"policy": empty}, "patch").status_code == 200
    else:
        assert post(owner, "/api/access/guest", {"enabled": True, "policy": empty}, "put").status_code == 200
    assert client.get("/api/files/1/cover?download=1").status_code == 404
    assert len(calls) == before


@pytest.fixture
def history_runtime(env, monkeypatch):
    from backend.app.services import runtime as runtime_module
    from backend.app.api.deps import get_scan_runtime
    from concurrent.futures import Future

    app, factory, settings = env
    monkeypatch.setattr(runtime_module, "SessionLocal", factory)
    runtime = runtime_module.ScanRuntimeManager(settings)
    runtime.executor.shutdown(wait=True)
    runtime.history_executor.shutdown(wait=True)
    class Deferred:
        def __init__(self):
            self.tasks = []
        def submit(self, fn, *args):
            self.tasks.append((fn, args))
            return Future()
        def run(self, index=0):
            fn, args = self.tasks[index]
            return fn(*args)
    executor = Deferred()
    runtime.executor = executor
    runtime.history_executor = executor
    monkeypatch.setattr(runtime, "request_history_storage_refresh", lambda: False)
    app.dependency_overrides[get_scan_runtime] = lambda: runtime
    yield runtime, executor
    runtime.connector_executor.shutdown(wait=True)
    runtime.maintenance_executor.shutdown(wait=True)
    if runtime.transcode_executor:
        runtime.transcode_executor.shutdown(wait=True)


@pytest.mark.parametrize("kind", ["account", "guest"])
def test_history_reconstruction_freezes_scan_scope_and_filters_entire_status(env, history_runtime, kind):
    from backend.app.models.entities import LibraryHistory, MediaFileHistory, ScanStatus
    from backend.app.utils.time import utc_now
    from datetime import timedelta
    from backend.app.models.access import JobAuthority

    app, factory, _ = env
    runtime, executor = history_runtime
    a, b, c = [library(factory, name) for name in ("scan-allowed", "read-only", "hidden")]
    owner = setup(app)
    with factory() as db:
        for media in db.scalars(select(MediaFile)):
            media.scan_status = ScanStatus.ready
            media.mtime = (utc_now() - timedelta(days=2)).timestamp()
            media.last_analyzed_at = utc_now()
        db.commit()
    policy = {**EMPTY_POLICY, "libraries": {str(a): ["library.read", "library.scan"], str(b): ["library.read"]}}
    if kind == "account":
        client, account = user(owner, app, policy)
    else:
        assert post(owner, "/api/access/guest", {"enabled": True, "policy": policy}, "put").status_code == 200
        client = TestClient(app)
        assert post(client, "/api/auth/guest").status_code == 200
    def configure(value):
        if kind == "account":
            return post(owner, f"/api/users/{account['id']}", {"policy": value}, "patch")
        return post(owner, "/api/access/guest", {"enabled": True, "policy": value}, "put")
    for target in (b, c, 999999):
        assert post(client, f"/api/libraries/{target}/history/reconstruct").status_code == 404
        assert post(client, "/api/history/reconstruct", {"library_ids": [a, target]}).status_code == 404
    assert post(client, "/api/history/reconstruct", {"library_ids": [str(a)]}).status_code == 422
    assert executor.tasks == []
    queued = post(client, "/api/history/reconstruct")
    assert queued.status_code == 200, queued.text
    assert queued.json()["library_ids"] == [a] and queued.json()["libraries_total"] == 1
    assert queued.json()["origin"]["kind"] == kind
    with factory() as db:
        authority = db.scalar(select(JobAuthority).where(JobAuthority.key.like("history:%")))
        assert authority.requirements == [["library.read", a], ["library.scan", a]]
    assert client.get(f"/api/libraries/{b}/history/reconstruct").json()["status"] == "idle"
    # New grants/libraries after enqueue cannot widen the already admitted job.
    extra = library(factory, "created-later")
    broader = {**policy, "libraries": {str(i): ["library.read", "library.scan"] for i in (a,b,extra)}}
    assert configure(broader).status_code == 200
    executor.run()
    finished = client.get("/api/history/reconstruct")
    assert finished.json()["status"] == "completed", finished.text
    assert finished.json()["result"]["libraries_processed"] == 1
    with factory() as db:
        assert set(db.scalars(select(LibraryHistory.library_id))) == {a}
        assert set(db.scalars(select(MediaFileHistory.library_id))) == {a}
    no_scan = {**EMPTY_POLICY, "global": ["settings.app.view", "settings.app.edit"],
        "libraries": {str(b): ["library.read"]}}
    assert configure(no_scan).status_code == 200
    hidden_status = client.get("/api/history/reconstruct").json()
    assert hidden_status["status"] == "idle" and hidden_status["library_ids"] == []
    assert hidden_status["result"] is None and hidden_status["origin"] is None
    assert post(client, "/api/history/reconstruct").status_code == 403
    assert client.get(f"/api/libraries/{c}/history/reconstruct").status_code == 404


@pytest.mark.parametrize("revoke", ["rights", "disabled", "deleted", "reset"])
def test_queued_history_reconstruction_cancels_when_initiator_loses_authority(env, history_runtime, revoke):
    from backend.app.models.entities import LibraryHistory
    app, factory, _ = env
    runtime, executor = history_runtime
    a = library(factory, "allowed")
    owner = setup(app)
    client, account = user(owner, app, {**EMPTY_POLICY, "libraries": {str(a): ["library.read", "library.scan"]}})
    response = post(client, f"/api/libraries/{a}/history/reconstruct")
    assert response.status_code == 200, response.text
    if revoke == "deleted":
        assert post(owner, f"/api/users/{account['id']}", method="delete").status_code == 204
    else:
        payload = {"policy": {**EMPTY_POLICY, "libraries": {str(a): ["library.read"]}}} if revoke == "rights" else (
            {"active": False} if revoke == "disabled" else {"password": "reset-password-1"}
        )
        response = post(owner, f"/api/users/{account['id']}", payload, "patch")
        assert response.status_code == 200, response.text
    executor.run()
    state = runtime.get_history_reconstruction_status()
    assert state.status.value == "canceled" and state.result is None
    with factory() as db:
        assert list(db.scalars(select(LibraryHistory))) == []


def test_history_reconstruction_defers_new_selected_scans_but_preserves_other_work(env, history_runtime, monkeypatch):
    from backend.app.services import runtime as runtime_module
    from backend.app.schemas.history import HistoryReconstructionRead
    from backend.app.utils.time import utc_now
    from backend.app.models.entities import ScanJob, JobStatus
    app, factory, _ = env
    runtime, executor = history_runtime
    a, b = library(factory, "selected"), library(factory, "other")
    owner = setup(app)
    client, _ = user(owner, app, {**EMPTY_POLICY, "libraries": {str(a): ["library.read", "library.scan"]}})
    assert post(client, f"/api/libraries/{a}/history/reconstruct").status_code == 200
    def reconstruct(db, *, library_ids, progress_callback):
        assert library_ids == (a,)
        runtime.request_scan(a)
        assert len(executor.tasks) == 1  # The selected scan is retained but not dispatched yet.
        runtime.request_scan(b)
        assert len(executor.tasks) == 2
        return HistoryReconstructionRead(generated_at=utc_now(), libraries_processed=1)
    monkeypatch.setattr(runtime_module, "reconstruct_history_from_media_files", reconstruct)
    executor.run()
    assert len(executor.tasks) == 3
    with factory() as db:
        assert {job.library_id for job in db.scalars(select(ScanJob)) if job.status == JobStatus.queued} == {a,b}


def test_history_queue_failure_does_not_leave_selected_libraries_blocked(env, history_runtime, monkeypatch):
    app, factory, _ = env
    runtime, executor = history_runtime
    a = library(factory, "allowed")
    owner = setup(app)
    client, _ = user(owner, app, {**EMPTY_POLICY, "libraries": {str(a): ["library.read", "library.scan"]}})
    def unavailable(*args, **kwargs):
        raise RuntimeError("executor closed")
    monkeypatch.setattr(executor, "submit", unavailable)
    response = post(client, f"/api/libraries/{a}/history/reconstruct")
    assert response.status_code == 503
    assert runtime.get_history_reconstruction_status().status.value == "failed"
    with runtime.lock:
        assert not runtime._history_blocks_library_locked(a)


def test_reconstruction_checks_only_selected_scan_conflicts_and_hides_other_job_scope(env, history_runtime):
    app, factory, _ = env
    runtime, executor = history_runtime
    a, b = library(factory, "allowed"), library(factory, "other")
    owner = setup(app)
    client, _ = user(owner, app, {**EMPTY_POLICY, "libraries": {str(a): ["library.read", "library.scan"]}})
    runtime.request_scan(b)
    assert post(client, f"/api/libraries/{a}/history/reconstruct").status_code == 200
    # A caller with a different scope gets only a generic busy conflict, never the first status.
    response = post(owner, f"/api/libraries/{b}/history/reconstruct")
    assert response.status_code == 409
    assert "allowed" not in response.text and "other" not in response.text
    assert client.get(f"/api/libraries/{b}/history/reconstruct").status_code == 404
    assert len(executor.tasks) == 2
