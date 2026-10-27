"""Real CBOR/ES256 ceremonies against the application's session and origin boundary."""
import hashlib
import json
import secrets
import time
from dataclasses import dataclass

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker
from webauthn.helpers import bytes_to_base64url as b64, base64url_to_bytes

from backend.app.core.config import Settings, RuntimeMode
from backend.app.db.session import create_engine_for_settings, init_db
from backend.app.main import create_app
from backend.app.models.access import AccountPasskey, LocalAccount, LoginSession, PasskeyChallenge
from backend.app.services.access import COOKIE, EMPTY_POLICY, digest

ORIGIN = "https://medialyze.test"
PASSWORD = "Test-secret-123!"


@pytest.fixture
def env(tmp_path):
    settings = Settings(_env_file=None, config_path=tmp_path / "config", media_root=tmp_path / "media",
                        public_url=ORIGIN, no_users=False, owner_username=None, owner_password=None)
    settings.config_path.mkdir(); settings.media_root.mkdir()
    engine = create_engine_for_settings(settings)
    init_db(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    app = create_app(settings)
    app.state.auth_session_factory = factory
    owner = TestClient(app, base_url=ORIGIN)
    assert write(owner, "/auth/setup", {"username": "owner", "password": PASSWORD}).status_code == 201
    yield app, factory, owner, settings
    engine.dispose()


def write(client, path, payload=None, method="POST"):
    status = client.get("/api/auth/status")
    assert status.status_code == 200
    return client.request(method, "/api" + path, json=payload,
                          headers={"Origin": str(client.base_url).rstrip("/"), "X-CSRF-Token": status.json()["csrf"]})


@dataclass
class Authenticator:
    credential_id: bytes
    key: object
    account_id: str

    def registration(self, options, *, origin=ORIGIN, flags=0x45, rp_id=None, challenge=None):
        public = self.key.public_key().public_numbers()
        cose = {1: 2, 3: -7, -1: 1, -2: public.x.to_bytes(32, "big"), -3: public.y.to_bytes(32, "big")}
        auth_data = (hashlib.sha256((rp_id or options["rp"]["id"]).encode()).digest() + bytes([flags]) + bytes(4)
                     + bytes(16) + len(self.credential_id).to_bytes(2, "big") + self.credential_id + cbor2.dumps(cose))
        client_data = json.dumps({"type": "webauthn.create", "origin": origin,
                                  "challenge": challenge or options["challenge"], "crossOrigin": False}).encode()
        return {"id": b64(self.credential_id), "rawId": b64(self.credential_id), "type": "public-key",
                "clientExtensionResults": {}, "response": {"attestationObject": b64(cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})),
                "clientDataJSON": b64(client_data), "transports": ["internal"]}}

    def assertion(self, options, *, origin=ORIGIN, flags=5, counter=1, challenge=None, handle=None, signer=None):
        client_data = json.dumps({"type": "webauthn.get", "origin": origin,
                                  "challenge": challenge or options["challenge"], "crossOrigin": False}).encode()
        auth_data = hashlib.sha256(options["rpId"].encode()).digest() + bytes([flags]) + counter.to_bytes(4, "big")
        signature = (signer or self.key).sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
        return {"id": b64(self.credential_id), "rawId": b64(self.credential_id), "type": "public-key",
                "clientExtensionResults": {}, "response": {"clientDataJSON": b64(client_data),
                "authenticatorData": b64(auth_data), "signature": b64(signature),
                "userHandle": b64((handle or self.account_id).encode())}}


def registration_start(client, name="My laptop"):
    response = write(client, "/me/passkeys/options", {"name": name, "password": PASSWORD})
    assert response.status_code == 200, response.text
    options = response.json()
    device = Authenticator(secrets.token_bytes(32), ec.generate_private_key(ec.SECP256R1()),
                           base64url_to_bytes(options["options"]["user"]["id"]).decode())
    return options, device


def register(client, name="My laptop"):
    options, device = registration_start(client, name)
    result = write(client, "/me/passkeys/verify", {"challenge_id": options["challenge_id"],
                   "credential": device.registration(options["options"])})
    assert result.status_code == 201, result.text
    return result.json(), device


def authentication_start(app):
    client = TestClient(app, base_url=ORIGIN)
    response = write(client, "/auth/passkeys/options")
    assert response.status_code == 200, response.text
    return client, response.json()


def test_registration_login_rename_delete_and_session_revocation(env):
    app, factory, owner, _ = env
    saved, device = register(owner)
    assert saved["name"] == "My laptop"
    listing = owner.get("/api/me/passkeys").json()
    assert listing["enabled"] is True and listing["items"] == [saved]
    assert "public_key" not in listing["items"][0] and "credential_id" not in listing["items"][0]
    renamed = write(owner, f'/me/passkeys/{saved["id"]}', {"name": "Travel laptop"}, "PATCH")
    assert renamed.json()["name"] == "Travel laptop"
    browser, options = authentication_start(app)
    credential = device.assertion(options["options"])
    response = write(browser, "/auth/passkeys/verify", {"challenge_id": options["challenge_id"], "credential": credential})
    assert response.status_code == 200, response.text
    assert browser.get("/api/auth/status").json()["identity"]["id"] == device.account_id
    with factory() as db:
        item = db.get(AccountPasskey, saved["id"])
        assert item.sign_count == 1 and item.last_used_at is not None
        session = db.get(LoginSession, digest(browser.cookies.get(COOKIE)))
        assert session.passkey_id == saved["id"]
    assert write(owner, f'/me/passkeys/{saved["id"]}', method="DELETE").status_code == 204
    assert browser.get("/api/auth/status").json()["identity"] is None
    assert owner.get("/api/auth/status").json()["identity"] is not None
    assert owner.get("/api/me/passkeys").json()["items"] == []


@pytest.mark.parametrize("mutation", ["origin", "challenge", "uv", "rp"])
def test_registration_rejects_invalid_proofs_and_consumes_challenge(env, mutation):
    _, _, owner, _ = env
    options, device = registration_start(owner)
    overrides = {"origin": {"origin": "https://evil.test"}, "challenge": {"challenge": b64(b"wrong")},
                 "uv": {"flags": 0x41}, "rp": {"rp_id": "evil.test"}}[mutation]
    credential = device.registration(options["options"], **overrides)
    payload = {"challenge_id": options["challenge_id"], "credential": credential}
    assert write(owner, "/me/passkeys/verify", payload).status_code == 400
    payload["credential"] = device.registration(options["options"])
    assert write(owner, "/me/passkeys/verify", payload).status_code == 400
    assert owner.get("/api/me/passkeys").json()["items"] == []


@pytest.mark.parametrize("mutation", ["origin", "challenge", "uv", "signature", "handle"])
def test_login_checks_signature_origin_challenge_verification_and_handle(env, mutation):
    app, _, owner, _ = env
    _, device = register(owner)
    browser, options = authentication_start(app)
    overrides = {"origin": {"origin": "https://evil.test"}, "challenge": {"challenge": b64(b"wrong")},
                 "uv": {"flags": 1}, "signature": {"signer": ec.generate_private_key(ec.SECP256R1())},
                 "handle": {"handle": "another-account"}}[mutation]
    payload = {"challenge_id": options["challenge_id"], "credential": device.assertion(options["options"], **overrides)}
    assert write(browser, "/auth/passkeys/verify", payload).status_code == 400
    assert browser.get("/api/auth/status").json()["identity"] is None


def test_counter_and_single_use_challenges(env):
    app, _, owner, _ = env
    _, device = register(owner)
    browser, options = authentication_start(app)
    payload = {"challenge_id": options["challenge_id"], "credential": device.assertion(options["options"], counter=2)}
    assert write(browser, "/auth/passkeys/verify", payload).status_code == 200
    assert write(browser, "/auth/passkeys/verify", payload).status_code == 400
    browser2, options2 = authentication_start(app)
    assert write(browser2, "/auth/passkeys/verify", {"challenge_id": options2["challenge_id"],
                 "credential": device.assertion(options2["options"], counter=1)}).status_code == 400


def test_challenges_expire_and_are_browser_and_session_bound(env):
    app, factory, owner, _ = env
    options, device = registration_start(owner)
    other = TestClient(app, base_url=ORIGIN)
    assert write(other, "/auth/login", {"username": "owner", "password": PASSWORD}).status_code == 200
    assert write(other, "/me/passkeys/verify", {"challenge_id": options["challenge_id"],
                 "credential": device.registration(options["options"])}).status_code == 400
    options, device = registration_start(owner)
    with factory() as db:
        db.get(PasskeyChallenge, digest(options["challenge_id"])).expires_at = int(time.time()) - 1
        db.commit()
    assert write(owner, "/me/passkeys/verify", {"challenge_id": options["challenge_id"],
                 "credential": device.registration(options["options"])}).status_code == 400


def test_own_account_isolation_and_registration_requires_password(env):
    app, _, owner, _ = env
    assert write(owner, "/me/passkeys/options", {"name": "key", "password": "wrong"}).status_code == 403
    saved, _ = register(owner)
    user = write(owner, "/users", {"username": "user", "password": PASSWORD, "policy": EMPTY_POLICY}).json()
    browser = TestClient(app, base_url=ORIGIN)
    assert write(browser, "/auth/login", {"username": "user", "password": PASSWORD}).status_code == 200
    # Temporary-password sessions cannot enroll credentials or evade the required password change.
    assert browser.get("/api/me/passkeys").status_code == 403
    with app.state.auth_session_factory() as db:
        db.get(LocalAccount, user["id"]).must_change_password = False
        db.commit()
    assert browser.get("/api/me/passkeys").json()["items"] == []
    assert write(browser, f'/me/passkeys/{saved["id"]}', {"name": "stolen"}, "PATCH").status_code == 404
    assert write(browser, f'/me/passkeys/{saved["id"]}', method="DELETE").status_code == 404
    assert write(owner, "/access/guest", {"enabled": True, "policy": EMPTY_POLICY}, "PUT").status_code == 200
    guest = TestClient(app, base_url=ORIGIN)
    assert write(guest, "/auth/guest").status_code == 200
    assert guest.get("/api/me/passkeys").status_code == 403
    assert write(guest, "/me/passkeys/options", {"name": "key", "password": PASSWORD}).status_code == 403


@pytest.mark.parametrize("change", ["disabled", "temporary", "deleted"])
def test_unusable_accounts_cannot_login_via_passkeys(env, change):
    app, factory, owner, _ = env
    _, device = register(owner)
    browser, options = authentication_start(app)
    with factory() as db:
        account = db.get(LocalAccount, device.account_id)
        if change == "disabled": account.active = False
        if change == "temporary": account.must_change_password = True
        if change == "deleted": db.execute(text("DELETE FROM access_state")); db.delete(account)
        db.commit()
    assert write(browser, "/auth/passkeys/verify", {"challenge_id": options["challenge_id"],
                 "credential": device.assertion(options["options"])}).status_code == 400


def test_unconfigured_and_mismatched_public_url_are_disabled(env):
    app, _, owner, settings = env
    settings.public_url = None
    assert owner.get("/api/me/passkeys").json()["reason"] == "not_configured"
    assert owner.get("/api/auth/status").json()["passkeys"]["enabled"] is False
    assert write(owner, "/me/passkeys/options", {"name": "key", "password": PASSWORD}).status_code == 403
    settings.public_url = "https://another.test"
    assert owner.get("/api/me/passkeys").json()["reason"] == "wrong_origin"
    assert write(owner, "/auth/passkeys/options").status_code == 403


@pytest.mark.parametrize("url", ["example.com", "http://example.com", "https://192.168.1.1", "https://example.com/path", "https://user:secret@example.com", "https://example.com?q=1"])
def test_invalid_public_urls_fail_configuration(url):
    with pytest.raises(ValidationError): Settings(_env_file=None, public_url=url)


def test_public_url_normalization():
    assert Settings(_env_file=None, public_url="https://MediaLyze.Test:443/").public_url == ORIGIN
    assert Settings(_env_file=None, public_url="").public_url is None
    assert Settings(_env_file=None, public_url="http://localhost:8080").public_url == "http://localhost:8080"


def test_session_schema_upgrade_preserves_existing_sessions(tmp_path):
    settings = Settings(_env_file=None, config_path=tmp_path, media_root=tmp_path, public_url=None)
    engine = create_engine_for_settings(settings)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE login_sessions (token_hash VARCHAR(64) PRIMARY KEY, account_id VARCHAR(36), kind VARCHAR(16) NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)"))
        connection.execute(text("INSERT INTO login_sessions VALUES ('old', NULL, 'guest', 1, 1)"))
    init_db(engine)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT token_hash, passkey_id FROM login_sessions")).one() == ("old", None)
    engine.dispose()


@pytest.mark.parametrize("ceremony", ["registration", "authentication"])
def test_cross_origin_iframe_ceremonies_are_rejected(env, ceremony):
    app, _, owner, _ = env
    if ceremony == "registration":
        client = owner
        options, device = registration_start(owner)
        credential = device.registration(options["options"])
        path = "/me/passkeys/verify"
    else:
        _, device = register(owner)
        client, options = authentication_start(app)
        credential = device.assertion(options["options"])
        path = "/auth/passkeys/verify"
    data = json.loads(base64url_to_bytes(credential["response"]["clientDataJSON"]))
    data["crossOrigin"] = True
    data["topOrigin"] = "https://evil.test"
    credential["response"]["clientDataJSON"] = b64(json.dumps(data).encode())
    assert write(client, path, {"challenge_id": options["challenge_id"], "credential": credential}).status_code == 400


def test_registration_is_bound_to_account_revision_and_exact_session(env):
    app, factory, owner, _ = env
    options, device = registration_start(owner)
    other = TestClient(app, base_url=ORIGIN)
    assert write(other, "/auth/login", {"username": "owner", "password": PASSWORD}).status_code == 200
    from backend.app.services.passkeys import CHALLENGE_COOKIE
    other.cookies.set(CHALLENGE_COOKIE, owner.cookies.get(CHALLENGE_COOKIE))
    assert write(other, "/me/passkeys/verify", {"challenge_id": options["challenge_id"],
                 "credential": device.registration(options["options"])}).status_code == 400
    options, device = registration_start(owner)
    with factory() as db:
        db.get(LocalAccount, device.account_id).revision += 1
        db.commit()
    assert write(owner, "/me/passkeys/verify", {"challenge_id": options["challenge_id"],
                 "credential": device.registration(options["options"])}).status_code == 400


def test_passkey_endpoints_keep_origin_and_csrf_protection(env):
    _, _, owner, _ = env
    csrf = owner.get("/api/auth/status").json()["csrf"]
    for headers in [{"Origin": "https://evil.test", "X-CSRF-Token": csrf}, {"Origin": ORIGIN, "X-CSRF-Token": "wrong"}]:
        assert owner.post("/api/auth/passkeys/options", json={}, headers=headers).status_code == 403
        assert owner.post("/api/me/passkeys/options", json={"name": "key", "password": PASSWORD}, headers=headers).status_code == 403


@pytest.mark.parametrize("mode", ["desktop", "no_users"])
def test_passkeys_are_disabled_without_local_accounts(env, mode):
    _, factory, _, settings = env
    changed = settings.model_copy(update={"runtime_mode": RuntimeMode.desktop} if mode == "desktop" else {"no_users": True})
    app = create_app(changed)
    app.state.auth_session_factory = factory
    client = TestClient(app, base_url=ORIGIN)
    assert client.get("/api/auth/status").json()["passkeys"]["enabled"] is False
    assert client.get("/api/me/passkeys").status_code == 404
    assert write(client, "/auth/passkeys/options").status_code == 404
