"""Passkey configuration and short-lived, browser-bound, single-use ceremonies."""
import secrets
import time
import ipaddress
import re
from urllib.parse import urlsplit

from sqlalchemy import delete, text
from backend.app.models.access import PasskeyChallenge
from backend.app.services.access import COOKIE, digest, fail
from backend.app.services.request_origin import browser_origin, secure_cookie

CHALLENGE_COOKIE = "medialyze_passkey_challenge"
CHALLENGE_TTL = 300
MAX_PASSKEYS = 20


def passkey_origin(value):
    parsed = urlsplit(value)
    host = (parsed.hostname or "").encode("idna").decode("ascii").lower()
    if not host or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError("Invalid passkey origin")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and host == "localhost"):
        raise ValueError("Passkeys require HTTPS")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("Passkeys require a hostname")
    if not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.split(".")):
        raise ValueError("Invalid passkey hostname")
    port = parsed.port
    suffix = f":{port}" if port and port != (443 if parsed.scheme == "https" else 80) else ""
    return f"{parsed.scheme}://{host}{suffix}"


def availability(settings, request):
    reason = "ready"
    if settings.is_desktop or settings.no_users:
        reason = "accounts_disabled"
    else:
        try:
            origin = passkey_origin(browser_origin(request))
        except (ValueError, UnicodeError):
            origin = None
        if not origin:
            reason = "not_configured"
    return {"enabled": reason == "ready", "reason": reason}


def require_origin(settings, request):
    if not availability(settings, request)["enabled"]:
        fail(403, "Passkeys require a valid HTTPS origin")
    origin = passkey_origin(browser_origin(request))
    return urlsplit(origin).hostname, origin


def issue(db, request, response, *, challenge, ceremony, rp_id, origin, account=None, name=None):
    now = int(time.time())
    db.execute(delete(PasskeyChallenge).where(PasskeyChallenge.expires_at <= now))
    # The cookie is also bound to a server-side challenge; caller-supplied IDs alone are insufficient.
    token, binding = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    db.add(PasskeyChallenge(
        id=digest(token), challenge=challenge, ceremony=ceremony, binding=digest(binding),
        account_id=account.id if account else None,
        account_revision=account.revision if account else None,
        session_hash=digest(request.cookies.get(COOKIE, "")) if account else None,
        name=name, rp_id=rp_id, origin=origin, expires_at=now + CHALLENGE_TTL,
    ))
    db.commit()
    response.set_cookie(CHALLENGE_COOKIE, binding, httponly=True,
                        secure=secure_cookie(request), samesite="strict",
                        max_age=CHALLENGE_TTL, path="/")
    return token


def consume(db, request, response, token, ceremony):
    row = db.get(PasskeyChallenge, digest(token))
    if row is None:
        fail(400, "Invalid or expired passkey challenge")
    # Commit consumption before verification so failed or concurrent requests cannot replay it.
    values = {column.name: getattr(row, column.name) for column in row.__table__.columns}
    db.delete(row)
    db.commit()
    response.delete_cookie(CHALLENGE_COOKIE, path="/")
    if (values["ceremony"] != ceremony or values["expires_at"] <= int(time.time()) or
            not secrets.compare_digest(values["binding"], digest(request.cookies.get(CHALLENGE_COOKIE, "")))):
        fail(400, "Invalid or expired passkey challenge")
    # Serialize account/counter checks and persistence against credential deletion and login/reset.
    db.execute(text("BEGIN IMMEDIATE"))
    db.expire_all()
    return values
