"""Local identities, transactional bootstrap and action/library set containment."""

from __future__ import annotations
from dataclasses import dataclass
import hashlib
import re
import secrets
import time
from uuid import uuid4
from argon2 import PasswordHasher, Type
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
from backend.app.models.access import AccessState, LocalAccount, LoginSession, LoginThrottle
from backend.app.models.entities import Library

PASSWORDS = PasswordHasher(type=Type.ID)
DUMMY_HASH = PASSWORDS.hash(secrets.token_urlsafe(32))
COOKIE = "medialyze_session"
CSRF_COOKIE = "medialyze_csrf"
GLOBAL_RIGHTS = frozenset(
    (
        "overview.dashboard",
        "overview.compare",
        "overview.storage",
        "settings.quality.view",
        "settings.quality.edit",
        "settings.hardware.view",
        "settings.hardware.edit",
        "settings.presets.view",
        "settings.presets.edit",
        "settings.app.view",
        "settings.app.edit",
        "connector.view",
        "connector.manage",
        "connector.playback",
        "access.users",
        "access.guest",
    )
)
LIBRARY_RIGHTS = frozenset(
    (
        "library.read",
        "library.preview",
        "library.download",
        "library.export",
        "library.scan",
        "library.edit",
        "library.paths",
        "library.delete",
        "transcode.view",
        "transcode.run",
        "transcode.cancel_own",
        "transcode.cancel_other",
        "transcode.clean",
        "transcode.replace",
    )
)
CREATE_REQUIRES = frozenset(("library.read", "library.edit", "library.paths"))
EMPTY_POLICY = {"global": [], "mode": "per_library", "libraries": {}, "shared": [], "create": False}
GUEST_DEFAULT_POLICY = {"global": ["overview.dashboard", "overview.compare", "overview.storage"], "mode": "future", "libraries": {}, "shared": ["library.read"], "create": False}


def fail(code=403, detail="Forbidden"):
    raise HTTPException(code, detail)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def csrf_token(token: str) -> str:
    return digest("medialyze-csrf:" + token)


def username(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}", value):
        fail(422, "Invalid username")
    return value


def password(value: str) -> str:
    if len(value) < 5 or not any(
        char.isdecimal() or (not char.isalnum() and not char.isspace()) for char in value
    ):
        fail(422, "Password must contain at least 5 characters and a number or special character")
    return value


def verify(encoded: str, value: str) -> bool:
    try:
        return PASSWORDS.verify(encoded, value)
    except (VerificationError, InvalidHashError):
        return False


def revoke(db, account_id: str):
    db.execute(delete(LoginSession).where(LoginSession.account_id == account_id))


def initialize_owner(factory, settings):
    """BEGIN IMMEDIATE serializes setup with other processes and environment startup."""
    if settings.is_desktop:
        if not settings.desktop_token or len(settings.desktop_token.get_secret_value()) < 32:
            raise RuntimeError("Desktop requires a process credential from Electron")
        return
    if settings.no_users:
        return
    name = settings.owner_username
    secret = (
        settings.owner_password.get_secret_value() if settings.owner_password is not None else None
    )
    with factory() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        state = db.get(AccessState, 1)
        try:
            if state is None:
                if name is None and secret is None:
                    return
                if name is None or secret is None:
                    raise ValueError()
                create_owner(db, name, secret, guest_enabled=settings.guest_enabled or False)
            else:
                owner = db.get(LocalAccount, state.owner_id)
                changed = False
                if name is not None:
                    username(name)
                    if db.scalar(
                        select(LocalAccount.id).where(
                            LocalAccount.username_key == name.casefold(),
                            LocalAccount.id != owner.id,
                        )
                    ):
                        raise ValueError()
                    changed = owner.username != name
                    owner.username, owner.username_key = name, name.casefold()
                if secret is not None:
                    password(secret)
                    if not verify(owner.password_hash, secret):
                        owner.password_hash = PASSWORDS.hash(secret)
                        changed = True
                if changed:
                    owner.revision += 1
                    revoke(db, owner.id)
                if settings.guest_enabled is not None and state.guest_enabled != settings.guest_enabled:
                    state.guest_enabled = settings.guest_enabled
                    state.revision += 1
                    if not state.guest_enabled:
                        from backend.app.models.entities import NotificationHistoryEntry
                        db.execute(delete(LoginSession).where(LoginSession.kind == "guest"))
                        db.execute(delete(NotificationHistoryEntry).where(NotificationHistoryEntry.owner_key.like("guest:%")))
            db.commit()
        except (HTTPException, ValueError, IntegrityError):
            raise RuntimeError("Invalid or conflicting owner environment configuration") from None


def create_owner(db, name: str, secret: str, *, guest_enabled: bool = False):
    if db.get(AccessState, 1) is not None:
        fail(409, "Setup already completed")
    username(name)
    if (
        db.scalar(select(LocalAccount.id).where(LocalAccount.username_key == name.casefold()))
        is not None
    ):
        fail(409, "Username already in use")
    account = LocalAccount(
        id=str(uuid4()),
        username=username(name),
        username_key=name.casefold(),
        password_hash=PASSWORDS.hash(password(secret)),
        owner_slot=1,
        active=True,
        must_change_password=False,
        policy=dict(EMPTY_POLICY),
    )
    db.add(account)
    db.flush()
    db.add(
        AccessState(id=1, owner_id=account.id, guest_enabled=guest_enabled, guest_policy=dict(GUEST_DEFAULT_POLICY))
    )
    db.flush()
    return account


@dataclass(frozen=True)
class Principal:
    kind: str
    id: str
    name: str
    owner: bool
    policy: dict
    revision: int = 0
    must_change_password: bool = False

    def has(self, right: str, library_id: int | None = None) -> bool:
        if self.owner:
            return True
        if right.startswith("access.") and self.kind != "account":
            return False
        if library_id is None:
            return right in self.policy.get("global", [])
        return right in self.actions(library_id)

    def actions(self, library_id: int) -> set[str]:
        if self.owner:
            return set(LIBRARY_RIGHTS)
        if self.policy.get("mode") == "future":
            return set(self.policy.get("shared", []))
        return set(self.policy.get("libraries", {}).get(str(library_id), []))

    def can_create(self) -> bool:
        return self.owner or (
            self.policy.get("mode") == "future"
            and self.policy.get("create", False)
            and CREATE_REQUIRES <= set(self.policy.get("shared", []))
        )


def principal_for(account):
    return Principal(
        "account",
        account.id,
        account.username,
        account.owner_slot == 1,
        account.policy,
        account.revision,
        account.must_change_password,
    )


def authenticate(db, raw: str | None):
    if not raw or len(raw) > 256:
        return None
    session = db.get(LoginSession, digest(raw))
    if session is None:
        return None
    now = int(time.time())
    if now - session.created_at >= 7 * 86400 or now - session.last_seen_at >= 86400:
        db.delete(session)
        db.commit()
        return None
    if session.kind == "guest":
        state = db.get(AccessState, 1)
        if not state or not state.guest_enabled:
            return None
        result = Principal("guest", "guest", "", False, state.guest_policy, state.revision)
    else:
        account = db.get(LocalAccount, session.account_id)
        if not account or not account.active:
            return None
        result = principal_for(account)
    session.last_seen_at = now
    db.commit()
    return result


def new_session(db, account=None, *, passkey_id=None):
    token = secrets.token_urlsafe(48)
    now = int(time.time())
    # Expired sessions never accumulate indefinitely.
    db.execute(
        delete(LoginSession).where(
            (LoginSession.created_at <= now - 7 * 86400)
            | (LoginSession.last_seen_at <= now - 86400)
        )
    )
    db.add(
        LoginSession(
            token_hash=digest(token),
            account_id=account.id if account else None,
            kind="account" if account else "guest",
            passkey_id=passkey_id,
            created_at=now,
            last_seen_at=now,
        )
    )
    return token


def rate_limit(factory, client: str, name: str):
    now = int(time.time())
    with factory() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        db.execute(delete(LoginThrottle).where(LoginThrottle.started_at <= now - 900))
        limited = False
        for key, maximum in (("ip:" + client, 40), ("name:" + name.casefold(), 20), ("all", 500)):
            key = digest(key)
            item = db.get(LoginThrottle, key)
            if item is None:
                item = LoginThrottle(key=key, started_at=now, attempts=0)
                db.add(item)
            item.attempts += 1
            limited |= item.attempts > maximum
        db.commit()
    if limited:
        fail(429, "Too many attempts; try again later")


def normalize_policy(db, raw: dict, *, guest=False):
    if not isinstance(raw, dict) or set(raw) - set(EMPTY_POLICY):
        fail(422, "Invalid permission policy")
    policy = {**EMPTY_POLICY, **raw}
    if policy["mode"] not in {"per_library", "all", "future"}:
        fail(422, "Invalid library scope")

    def rights(values, allowed):
        if not isinstance(values, list) or any(
            not isinstance(v, str) or v not in allowed for v in values
        ):
            fail(422, "Unknown permission")
        return sorted(set(values))

    policy["global"] = rights(policy["global"], GLOBAL_RIGHTS)
    if guest and any(r.startswith("access.") for r in policy["global"]):
        fail()
    policy["shared"] = rights(policy["shared"], LIBRARY_RIGHTS)
    if not isinstance(policy["libraries"], dict) or len(policy["libraries"]) > 10000:
        fail(422, "Invalid library scope")
    ids = {str(i) for i in db.scalars(select(Library.id))}
    libraries = {}
    for key, values in policy["libraries"].items():
        if key not in ids:
            fail(404, "Library not found")
        libraries[key] = rights(values, LIBRARY_RIGHTS)
    if policy["mode"] == "all":
        # Client supplies the exact reviewed set; concurrent additions must not extend it.
        if set(libraries) != ids:
            fail(409, "Library inventory changed; review scope again")
        libraries = {key: policy["shared"] for key in ids}
    if policy["mode"] == "future":
        libraries = {}
    elif policy["mode"] == "per_library":
        policy["shared"] = []
    policy["libraries"] = libraries
    if not isinstance(policy["create"], bool):
        fail(422, "Invalid create permission")
    if policy["create"] and not (
        policy["mode"] == "future" and CREATE_REQUIRES <= set(policy["shared"])
    ):
        fail(422, "Creating libraries requires future scope, editing and paths")
    return policy


def contains(actor: Principal, policy: dict) -> bool:
    if actor.owner:
        return True
    if not set(policy.get("global", [])) <= set(actor.policy.get("global", [])):
        return False
    if policy.get("mode") == "all" and any(
        not actor.actions(int(key)) for key in policy.get("libraries", {})
    ):
        return False
    if policy.get("mode") == "future":
        if actor.policy.get("mode") != "future" or not set(policy.get("shared", [])) <= set(
            actor.policy.get("shared", [])
        ):
            return False
    if policy.get("create") and not actor.can_create():
        return False
    return all(
        set(actions) <= actor.actions(int(key))
        for key, actions in policy.get("libraries", {}).items()
    )


def require_manage(actor, target, right="access.users"):
    if actor.kind not in {"account", "desktop"} or not actor.has(right):
        fail()
    if target is not None and (target.owner_slot == 1 or not contains(actor, target.policy)):
        fail()
