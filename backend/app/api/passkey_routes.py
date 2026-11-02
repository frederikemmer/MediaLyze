"""Own-account passkey management and discoverable-credential authentication."""
import json
import secrets
import time
from uuid import uuid4

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from webauthn import (
    generate_registration_options, generate_authentication_options,
    verify_registration_response, verify_authentication_response,
)
from webauthn.helpers import bytes_to_base64url, base64url_to_bytes, options_to_json
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor,
    ResidentKeyRequirement, UserVerificationRequirement,
)
from backend.app.api.access_routes import cookie, current_actor, db_session, factory
from backend.app.models.access import AccountPasskey, LocalAccount, LoginSession
from backend.app.services.access import COOKIE, digest, fail, new_session, rate_limit, verify
from backend.app.services.passkeys import MAX_PASSKEYS, availability, consume, issue, require_origin

router = APIRouter()


class PasskeyName(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=64)


class RegistrationStart(PasskeyName):
    password: SecretStr


class CeremonyResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    challenge_id: str = Field(min_length=20, max_length=128)
    credential: dict


def own_account(request, db):
    principal = current_actor(request, db)
    if principal.kind != "account" or principal.must_change_password:
        fail()
    return db.get(LocalAccount, principal.id)


def display_name(value):
    value = value.strip()
    if not value or any(ord(char) < 32 for char in value):
        fail(422, "Invalid passkey name")
    return value


def require_top_level(credential):
    try:
        data = json.loads(base64url_to_bytes(credential["response"]["clientDataJSON"]))
    except (KeyError, TypeError, ValueError):
        fail(400, "Invalid passkey response")
    if not isinstance(data, dict) or data.get("crossOrigin", False) is not False or "topOrigin" in data:
        fail(400, "Cross-origin passkey ceremonies are not supported")


def read_passkey(item):
    return {"id": item.id, "name": item.name, "created_at": item.created_at,
            "last_used_at": item.last_used_at, "rp_id": item.rp_id}


def owned_passkey(db, account, passkey_id):
    item = db.scalar(select(AccountPasskey).where(AccountPasskey.id == passkey_id,
                                                 AccountPasskey.account_id == account.id))
    if item is None:
        fail(404, "Passkey not found")
    return item


@router.get("/me/passkeys")
def list_passkeys(request: Request, db=Depends(db_session)):
    account = own_account(request, db)
    return {**availability(request.app.state.access_settings, request), "items": [
        read_passkey(item) for item in db.scalars(select(AccountPasskey).where(
            AccountPasskey.account_id == account.id).order_by(AccountPasskey.created_at, AccountPasskey.id))
    ]}


@router.post("/me/passkeys/options")
def registration_options(payload: RegistrationStart, request: Request, response: Response):
    settings = request.app.state.access_settings
    rp_id, origin = require_origin(settings, request)
    rate_limit(factory(request), request.client.host if request.client else "unknown", "passkey-register")
    with factory(request)() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        account = own_account(request, db)
        if not verify(account.password_hash, payload.password.get_secret_value()):
            fail(403, "Invalid current password")
        name = display_name(payload.name)
        if db.scalar(select(func.count()).select_from(AccountPasskey).where(AccountPasskey.account_id == account.id)) >= MAX_PASSKEYS:
            fail(409, "Passkey limit reached")
        credentials = db.scalars(select(AccountPasskey).where(AccountPasskey.account_id == account.id,
                                                             AccountPasskey.rp_id == rp_id))
        options = generate_registration_options(
            rp_id=rp_id, rp_name="MediaLyze", user_id=account.id.encode(),
            user_name=account.username, user_display_name=account.username,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
            exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(item.credential_id)) for item in credentials],
        )
        token = issue(db, request, response, challenge=options.challenge, ceremony="register",
                      rp_id=rp_id, origin=origin, account=account, name=name)
        return {"challenge_id": token, "options": json.loads(options_to_json(options))}


@router.post("/me/passkeys/verify", status_code=201)
def registration_verify(payload: CeremonyResponse, request: Request, response: Response, db=Depends(db_session)):
    rp_id, origin = require_origin(request.app.state.access_settings, request)
    challenge = consume(db, request, response, payload.challenge_id, "register")
    account = own_account(request, db)
    if (challenge["account_id"] != account.id or challenge["account_revision"] != account.revision or
            challenge["session_hash"] != digest(request.cookies.get(COOKIE, "")) or
            challenge["rp_id"] != rp_id or challenge["origin"] != origin):
        fail(400, "Invalid passkey registration")
    require_top_level(payload.credential)
    try:
        verified = verify_registration_response(credential=payload.credential,
            expected_challenge=challenge["challenge"], expected_rp_id=rp_id,
            expected_origin=origin, require_user_verification=True)
    except Exception:
        fail(400, "Invalid passkey registration")
    if db.scalar(select(func.count()).select_from(AccountPasskey).where(AccountPasskey.account_id == account.id)) >= MAX_PASSKEYS:
        fail(409, "Passkey limit reached")
    transports = payload.credential.get("response", {}).get("transports", [])
    if not isinstance(transports, list):
        transports = []
    item = AccountPasskey(id=str(uuid4()), account_id=account.id, name=challenge["name"], rp_id=rp_id,
        credential_id=bytes_to_base64url(verified.credential_id), public_key=verified.credential_public_key,
        sign_count=verified.sign_count, backed_up=verified.credential_backed_up,
        transports=[value for value in transports if isinstance(value, str) and value in {"usb", "nfc", "ble", "internal", "hybrid", "smart-card"}],
        created_at=int(time.time()))
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        fail(409, "Passkey already registered")
    return read_passkey(item)


@router.patch("/me/passkeys/{passkey_id}")
def rename_passkey(passkey_id: str, payload: PasskeyName, request: Request, db=Depends(db_session)):
    require_origin(request.app.state.access_settings, request)
    item = owned_passkey(db, own_account(request, db), passkey_id)
    item.name = display_name(payload.name)
    db.commit()
    return read_passkey(item)


@router.delete("/me/passkeys/{passkey_id}", status_code=204)
def delete_passkey(passkey_id: str, request: Request, db=Depends(db_session)):
    require_origin(request.app.state.access_settings, request)
    item = owned_passkey(db, own_account(request, db), passkey_id)
    db.execute(delete(LoginSession).where(LoginSession.passkey_id == item.id))
    db.delete(item)
    db.commit()
    return Response(status_code=204)


@router.post("/auth/passkeys/options")
def authentication_options(request: Request, response: Response):
    rp_id, origin = require_origin(request.app.state.access_settings, request)
    client = request.client.host if request.client else "unknown"
    rate_limit(factory(request), client, "passkey-login:" + client)
    with factory(request)() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        options = generate_authentication_options(rp_id=rp_id, user_verification=UserVerificationRequirement.REQUIRED)
        token = issue(db, request, response, challenge=options.challenge, ceremony="authenticate", rp_id=rp_id, origin=origin)
        return {"challenge_id": token, "options": json.loads(options_to_json(options))}


@router.post("/auth/passkeys/verify")
def authentication_verify(payload: CeremonyResponse, request: Request, response: Response, db=Depends(db_session)):
    rp_id, origin = require_origin(request.app.state.access_settings, request)
    challenge = consume(db, request, response, payload.challenge_id, "authenticate")
    if challenge["rp_id"] != rp_id or challenge["origin"] != origin:
        fail(400, "Invalid passkey authentication")
    credential_id = payload.credential.get("id")
    if not isinstance(credential_id, str):
        fail(400, "Invalid passkey authentication")
    item = db.scalar(select(AccountPasskey).where(AccountPasskey.credential_id == credential_id,
                                                 AccountPasskey.rp_id == rp_id))
    account = db.get(LocalAccount, item.account_id) if item else None
    if account is None or not account.active or account.must_change_password:
        fail(400, "Invalid passkey authentication")
    require_top_level(payload.credential)
    try:
        handle = payload.credential.get("response", {}).get("userHandle")
        if not isinstance(handle, str) or not secrets.compare_digest(base64url_to_bytes(handle), account.id.encode()):
            fail(400, "Invalid passkey authentication")
        verified = verify_authentication_response(credential=payload.credential,
            expected_challenge=challenge["challenge"], expected_rp_id=rp_id, expected_origin=origin,
            credential_public_key=item.public_key, credential_current_sign_count=item.sign_count,
            require_user_verification=True)
    except Exception:
        fail(400, "Invalid passkey authentication")
    item.sign_count = verified.new_sign_count
    item.backed_up = verified.credential_backed_up
    item.last_used_at = int(time.time())
    db.execute(delete(LoginSession).where(LoginSession.token_hash == digest(request.cookies.get(COOKIE, ""))))
    token = new_session(db, account, passkey_id=item.id)
    db.commit()
    cookie(response, request, token)
    return {"ok": True}
