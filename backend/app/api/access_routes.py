"""Local account endpoints. Request bodies and errors never return credentials."""

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError
import json
import secrets
from uuid import uuid4
from backend.app.models.access import AccessState, LocalAccount, LoginSession
from backend.app.models.entities import Library, NotificationHistoryEntry
from backend.app.services.access import (
    COOKIE,
    CSRF_COOKIE,
    EMPTY_POLICY,
    GLOBAL_RIGHTS,
    LIBRARY_RIGHTS,
    PASSWORDS,
    DUMMY_HASH,
    contains,
    create_owner,
    csrf_token,
    digest,
    fail,
    new_session,
    normalize_policy,
    password,
    principal_for,
    rate_limit,
    require_manage,
    revoke,
    username,
    verify,
)
from backend.app.services.notification_access import (
    prune_guest_notification_history,
    prune_notification_history,
)

router = APIRouter()


def factory(request: Request):
    return request.app.state.auth_session_factory


def db_session(request: Request):
    with factory(request)() as db:
        # Writes serialize scope validation with account/revision changes.
        if request.method not in {"GET", "HEAD"}:
            db.execute(text("BEGIN IMMEDIATE"))
        yield db


def actor(request: Request):
    result = getattr(request.state, "principal", None)
    if result is None:
        fail(401, "Authentication required")
    return result


def current_actor(request, db):
    value = actor(request)
    if value.kind == "account":
        account = db.get(LocalAccount, value.id)
        if not account or not account.active or account.revision != value.revision:
            fail(401, "Authentication required")
        return principal_for(account)
    return value


def cookie(response, request, token):
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
        max_age=7 * 86400,
        path="/",
    )
    response.delete_cookie(CSRF_COOKIE, path="/")


def account_read(account, viewer, settings):
    return {
        "id": account.id,
        "username": account.username,
        "owner": account.owner_slot == 1,
        "active": account.active,
        "must_change_password": account.must_change_password,
        "revision": account.revision,
        "policy": account.policy
        if account.owner_slot != 1 and contains(viewer, account.policy)
        else dict(EMPTY_POLICY),
        "editable": account.owner_slot != 1 and contains(viewer, account.policy),
        "username_locked": account.owner_slot == 1 and settings.owner_username is not None,
        "password_locked": account.owner_slot == 1 and settings.owner_password is not None,
    }


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=64)
    password: SecretStr


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: SecretStr
    password: SecretStr


class AccountCreate(Credentials):
    policy: dict = Field(default_factory=lambda: dict(EMPTY_POLICY))


class AccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str | None = Field(default=None, max_length=64)
    active: bool | None = None
    policy: dict | None = None
    password: SecretStr | None = None


class GuestUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    policy: dict


@router.get("/auth/status")
def auth_status(request: Request, response: Response, db=Depends(db_session)):
    settings = request.app.state.access_settings
    principal = getattr(request.state, "principal", None)
    state = db.get(AccessState, 1)
    raw = request.cookies.get(COOKIE)
    csrf = csrf_token(raw) if principal and raw else secrets.token_urlsafe(32)
    if not principal:
        response.set_cookie(
            CSRF_COOKIE,
            csrf,
            httponly=True,
            secure=request.url.scheme == "https",
            samesite="strict",
            path="/",
        )
    result = {
        "setup_required": state is None and not settings.is_desktop,
        "guest_enabled": False if settings.is_desktop else bool(state and state.guest_enabled),
        "csrf": csrf,
        "identity": None,
        # The desktop bridge is not a local account or rights-bearing identity.
        "permissions": [] if settings.is_desktop else sorted(GLOBAL_RIGHTS),
        "library_permissions": [] if settings.is_desktop else sorted(LIBRARY_RIGHTS),
    }
    if principal:
        result["identity"] = {
            "id": principal.id,
            "kind": principal.kind,
            "username": principal.name,
            "owner": principal.owner,
            "revision": principal.revision,
            "must_change_password": principal.must_change_password,
            "policy": principal.policy,
            "all_scope_available": principal.owner
            or all(bool(principal.actions(i)) for i in db.scalars(select(Library.id))),
        }
        if principal.kind == "account":
            result["identity"].update(
                account_read(db.get(LocalAccount, principal.id), principal, settings)
            )
    return result


@router.post("/auth/setup", status_code=201)
def setup(payload: Credentials, request: Request, response: Response, db=Depends(db_session)):
    settings = request.app.state.access_settings
    if (
        settings.is_desktop
        or settings.owner_username is not None
        or settings.owner_password is not None
    ):
        fail(403)
    account = create_owner(db, payload.username, payload.password.get_secret_value())
    token = new_session(db, account)
    db.commit()
    cookie(response, request, token)
    return {"ok": True}


@router.post("/auth/login")
def login(payload: Credentials, request: Request, response: Response):
    rate_limit(
        factory(request), request.client.host if request.client else "unknown", payload.username
    )
    with factory(request)() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        if db.get(AccessState, 1) is None:
            fail(401, "Invalid username or password")
        account = db.scalar(
            select(LocalAccount).where(LocalAccount.username_key == payload.username.casefold())
        )
        valid = verify(
            account.password_hash if account else DUMMY_HASH, payload.password.get_secret_value()
        )
        if not valid or not account or not account.active:
            fail(401, "Invalid username or password")
        if PASSWORDS.check_needs_rehash(account.password_hash):
            account.password_hash = PASSWORDS.hash(payload.password.get_secret_value())
        # Rotate rather than retaining a previous account/guest session.
        db.execute(
            delete(LoginSession).where(
                LoginSession.token_hash == digest(request.cookies.get(COOKIE, ""))
            )
        )
        token = new_session(db, account)
        db.commit()
    cookie(response, request, token)
    return {"ok": True}


@router.post("/auth/guest")
def guest_login(request: Request, response: Response, db=Depends(db_session)):
    state = db.get(AccessState, 1)
    if not state or not state.guest_enabled:
        fail(403)
    db.execute(
        delete(LoginSession).where(
            LoginSession.token_hash == digest(request.cookies.get(COOKIE, ""))
        )
    )
    token = new_session(db)
    db.commit()
    cookie(response, request, token)
    return {"ok": True}


@router.post("/auth/logout")
def logout(request: Request, response: Response, db=Depends(db_session)):
    db.execute(
        delete(LoginSession).where(
            LoginSession.token_hash == digest(request.cookies.get(COOKIE, ""))
        )
    )
    db.commit()
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.post("/auth/password")
def change_password(
    payload: PasswordChange, request: Request, response: Response, db=Depends(db_session)
):
    current = current_actor(request, db)
    if current.kind != "account":
        fail()
    account = db.get(LocalAccount, current.id)
    if account.owner_slot == 1 and request.app.state.access_settings.owner_password is not None:
        fail(403, "Remove owner password from the startup configuration and restart first")
    if not verify(account.password_hash, payload.current_password.get_secret_value()):
        fail(403, "Invalid current password")
    secret = password(payload.password.get_secret_value())
    if verify(account.password_hash, secret):
        fail(422, "Choose a different password")
    account.password_hash = PASSWORDS.hash(secret)
    account.must_change_password = False
    account.revision += 1
    revoke(db, account.id)
    db.commit()
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/users")
def users(request: Request, db=Depends(db_session)):
    current = actor(request)
    require_manage(current, None)
    return [
        account_read(a, current, request.app.state.access_settings)
        for a in db.scalars(
            select(LocalAccount).order_by(LocalAccount.owner_slot.desc(), LocalAccount.username_key)
        )
    ]


@router.post("/users", status_code=201)
def create_account(payload: AccountCreate, request: Request, db=Depends(db_session)):
    current = current_actor(request, db)
    require_manage(current, None)
    policy = normalize_policy(db, payload.policy)
    if not contains(current, policy):
        fail()
    account = LocalAccount(
        id=str(uuid4()),
        username=username(payload.username),
        username_key=payload.username.casefold(),
        password_hash=PASSWORDS.hash(password(payload.password.get_secret_value())),
        policy=policy,
        active=True,
        must_change_password=True,
    )
    db.add(account)
    try:
        db.commit()
    except IntegrityError:
        fail(409, "Username already in use")
    return account_read(account, current, request.app.state.access_settings)


@router.patch("/users/{account_id}")
def update_account(
    account_id: str, payload: AccountUpdate, request: Request, db=Depends(db_session)
):
    current = current_actor(request, db)
    target = db.get(LocalAccount, account_id)
    if not target:
        fail(404, "Account not found")
    require_manage(current, target)
    if payload.policy is not None:
        policy = normalize_policy(db, payload.policy)
        if not contains(current, policy):
            fail()
        target.policy = policy
    if payload.username is not None:
        target.username = username(payload.username)
        target.username_key = target.username.casefold()
    if payload.active is not None:
        target.active = payload.active
    if payload.password is not None:
        target.password_hash = PASSWORDS.hash(password(payload.password.get_secret_value()))
        target.must_change_password = True
    target.revision += 1
    if payload.password is not None or payload.active is False:
        revoke(db, target.id)
    if payload.active is False:
        db.execute(
            delete(NotificationHistoryEntry).where(
                NotificationHistoryEntry.owner_key == f"account:{target.id}"
            )
        )
    else:
        prune_notification_history(db, f"account:{target.id}", principal_for(target))
    try:
        db.commit()
    except IntegrityError:
        fail(409, "Username already in use")
    from backend.app.services.access_jobs import cancel_waiting_account_jobs

    cancel_waiting_account_jobs(db, target.id)
    return account_read(target, current, request.app.state.access_settings)


@router.delete("/users/{account_id}", status_code=204)
def delete_account(account_id: str, request: Request, db=Depends(db_session)):
    current = current_actor(request, db)
    target = db.get(LocalAccount, account_id)
    if not target:
        fail(404, "Account not found")
    require_manage(current, target)
    revoke(db, target.id)
    db.execute(
        delete(NotificationHistoryEntry).where(
            NotificationHistoryEntry.owner_key == f"account:{target.id}"
        )
    )
    db.delete(target)
    db.commit()
    from backend.app.services.access_jobs import cancel_waiting_account_jobs

    cancel_waiting_account_jobs(db, account_id)
    return Response(status_code=204)


@router.get("/access/guest")
def guest_read(request: Request, db=Depends(db_session)):
    current = actor(request)
    require_manage(current, None, "access.guest")
    state = db.get(AccessState, 1)
    if state is None:
        fail(403)
    return {
        "enabled": state.guest_enabled,
        "policy": state.guest_policy,
        "editable": contains(current, state.guest_policy),
    }


@router.put("/access/guest")
def guest_update(payload: GuestUpdate, request: Request, db=Depends(db_session)):
    current = current_actor(request, db)
    require_manage(current, None, "access.guest")
    state = db.get(AccessState, 1)
    policy = normalize_policy(db, payload.policy, guest=True)
    if not contains(current, state.guest_policy) or not contains(current, policy):
        fail()
    state.guest_enabled, state.guest_policy = payload.enabled, policy
    state.revision += 1
    if not payload.enabled:
        db.execute(delete(LoginSession).where(LoginSession.kind == "guest"))
        db.execute(
            delete(NotificationHistoryEntry).where(
                NotificationHistoryEntry.owner_key.like("guest:%")
            )
        )
    else:
        prune_guest_notification_history(db, state.guest_policy, state.revision)
    db.commit()
    from backend.app.services.access_jobs import cancel_waiting_guest_jobs

    cancel_waiting_guest_jobs(db)
    return {"enabled": state.guest_enabled, "policy": state.guest_policy, "editable": True}


@router.get("/access/libraries")
def access_libraries(request: Request, db=Depends(db_session)):
    current = actor(request)
    if not (current.has("access.users") or current.has("access.guest")) or current.kind == "guest":
        fail()
    return [
        {"id": i, "name": name, "actions": sorted(current.actions(i))}
        for i, name in db.execute(select(Library.id, Library.name).order_by(Library.name))
        if current.owner or current.actions(i)
    ]


@router.get("/me/preferences")
def preferences_read(request: Request, db=Depends(db_session)):
    current = actor(request)
    if current.kind != "account":
        fail()
    return db.get(LocalAccount, current.id).preferences


@router.put("/me/preferences")
def preferences_update(payload: dict, request: Request, db=Depends(db_session)):
    current = current_actor(request, db)
    if current.kind != "account":
        fail()
    if len(json.dumps(payload).encode()) > 262144:
        fail(413, "Preferences too large")
    db.get(LocalAccount, current.id).preferences = payload
    db.commit()
    return payload


@router.patch("/me/account")
def self_account(payload: Credentials, request: Request, db=Depends(db_session)):
    current = current_actor(request, db)
    if current.kind != "account" or not current.owner:
        fail()
    target = db.get(LocalAccount, current.id)
    if request.app.state.access_settings.owner_username is not None:
        fail(403, "Remove owner username from startup configuration and restart first")
    if not verify(target.password_hash, payload.password.get_secret_value()):
        fail(403)
    target.username = username(payload.username)
    target.username_key = target.username.casefold()
    target.revision += 1
    revoke(db, target.id)
    try:
        db.commit()
    except IntegrityError:
        fail(409, "Username already in use")
    return {"ok": True}
