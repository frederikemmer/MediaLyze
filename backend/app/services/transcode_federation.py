"""Trust, scheduling, and transfer primitives for the transcode federation.

The federation deliberately keeps its protocol small and boring: installations
pair directly with a human supplied code, exchange signed/encrypted JSON
messages, and transfer only a structured plan plus resumable file chunks.  A
remote worker never receives a local library path and never writes to its
library database.

The application has no third-party crypto dependency.  The envelope uses a
random-nonce SHA-256 stream construction with an HMAC-SHA-256 authenticator.
It is an application-layer envelope in addition to HTTP transport security;
the protocol is still useful on plain LAN/VPN links, while deployments may
put the listener behind HTTPS for an additional transport layer.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import ipaddress
import json
import logging
import math
import os
import secrets
import shutil
import socket
import threading
import time
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path, PureWindowsPath
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import NAMESPACE_URL, uuid4, uuid5

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.core.config import Settings
from backend.app.db.session import SessionLocal
from backend.app.models.entities import (
    AppSetting,
    JobStatus,
    TranscodeFederationMember,
    TranscodeJob,
    TranscodeNetworkMetric,
    TranscodeRemoteAttempt,
    TranscodeResourceReservation,
    TranscodeTransfer,
    TranscodeTransferChunk,
)
from backend.app.schemas.transcoding import (
    TranscodeCapabilitiesRead,
    TranscodeCapabilityMatrixRead,
    TranscodeFederationMemberRead,
    TranscodeFederationPeerRead,
    TranscodeFederationProtocolPairRequest,
    TranscodeFederationProtocolSecureEnvelope,
    TranscodeFederationRead,
    TranscodeFederationSettingsRead,
    TranscodeFederationSettingsUpdate,
    TranscodePlan,
)
from backend.app.services.transcode_matrix import load_transcode_matrix
from backend.app.services.transcoding import (
    HARDWARE_ENCODER_MARKERS,
    _encoder_codec,
    get_transcode_capabilities,
    resolve_transcode_plan_encoders,
    transcode_capacity,
)
from backend.app.utils.time import utc_now

logger = logging.getLogger(__name__)

FEDERATION_STATE_KEY = "transcode_federation"
PROTOCOL_VERSION = 1
DISCOVERY_MESSAGE = "medialyze-transcode-discovery"
ENVELOPE_CONTEXT = b"medialyze-transcode-federation-envelope-v1"
PAIRING_CONTEXT = b"medialyze-transcode-federation-pairing-v1"
TIMESTAMP_TOLERANCE_SECONDS = 300
PAIRING_CODE_ROTATION_SECONDS = 30
PAIRING_CODE_LENGTH = 6
PAIRING_CODE_MODULUS = 10**PAIRING_CODE_LENGTH
PAIRING_CODE_CLOCK_SKEW_BUCKETS = 1
PAIRING_CODE_CONTEXT = PAIRING_CONTEXT + b"-rotating-code-v1"
FEDERATION_CAPABILITY_MATRIX_TIMEOUT_SECONDS = 300.0
MAX_FEDERATION_ENDPOINTS = 16
NETWORK_PROBE_ROUTE = "network/probe"
NETWORK_PROBE_BYTES = 64 * 1024
NETWORK_PROBE_MAX_BYTES = 512 * 1024
NETWORK_PROBE_TIMEOUT_SECONDS = 3.0
NETWORK_SCORE_SAMPLE_BYTES = 1_000_000
NETWORK_PROBE_FAILURE_BASE_SECONDS = 5 * 60
NETWORK_PROBE_FAILURE_MAX_SECONDS = 6 * 60 * 60


class FederationError(RuntimeError):
    """A safe, user-facing federation error."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class FederationAuthenticationError(FederationError):
    def __init__(self, message: str = "Federation authentication failed") -> None:
        super().__init__(message, status_code=401)


@dataclass(frozen=True)
class WorkerCandidate:
    """Normalized scheduling input shared by automatic and explicit selection."""

    installation_id: str
    display_name: str
    is_local: bool
    reachable: bool
    accept_jobs: bool
    capabilities: dict[str, Any]
    capability_matrix: dict[str, Any]
    resources: dict[str, Any]
    active_jobs: int = 0
    network_mbps: float = 100.0
    queue_wait_seconds: float = 0.0


@dataclass(frozen=True)
class WorkerSelection:
    candidate: WorkerCandidate
    estimated_seconds: float
    reason: str
    resolved_plan: TranscodePlan | None = None


def _canonical_json(payload: Any) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _decode_b64(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value.encode("ascii"))
    except (ValueError, UnicodeError) as exc:
        raise FederationAuthenticationError("Malformed federation envelope") from exc


def _secret_bytes(secret: str | bytes) -> bytes:
    if isinstance(secret, bytes):
        return secret
    candidate = secret.strip()
    try:
        decoded = bytes.fromhex(candidate)
    except ValueError:
        decoded = candidate.encode("utf-8")
    if len(decoded) < 16:
        raise FederationAuthenticationError("Federation secret is too short")
    return decoded


def _keystream(key: bytes, nonce: bytes, length: int) -> bytes:
    output = bytearray()
    counter = 0
    while len(output) < length:
        output.extend(
            hashlib.sha256(
                ENVELOPE_CONTEXT + key + nonce + counter.to_bytes(8, "big")
            ).digest()
        )
        counter += 1
    return bytes(output[:length])


def _xor(left: bytes, right: bytes) -> bytes:
    return bytes(a ^ b for a, b in zip(left, right, strict=True))


def encrypt_secure_payload(
    secret: str | bytes,
    payload: dict[str, Any],
    *,
    timestamp: int | None = None,
    nonce: bytes | None = None,
) -> dict[str, Any]:
    """Encrypt and authenticate one protocol payload.

    ``timestamp`` and ``nonce`` are injectable to make protocol tests
    deterministic without weakening normal operation.
    """

    key = _secret_bytes(secret)
    timestamp = int(time.time()) if timestamp is None else int(timestamp)
    nonce = secrets.token_bytes(16) if nonce is None else bytes(nonce)
    if len(nonce) < 12:
        raise ValueError("Federation envelope nonce must be at least 12 bytes")
    plaintext = _canonical_json(payload)
    ciphertext = _xor(plaintext, _keystream(key, nonce, len(plaintext)))
    signed = ENVELOPE_CONTEXT + str(timestamp).encode("ascii") + nonce + ciphertext
    tag = hmac.new(key, signed, hashlib.sha256).digest()
    return {
        "version": PROTOCOL_VERSION,
        "timestamp": timestamp,
        "nonce": base64.urlsafe_b64encode(nonce).decode("ascii"),
        "ciphertext": base64.urlsafe_b64encode(ciphertext).decode("ascii"),
        "tag": base64.urlsafe_b64encode(tag).decode("ascii"),
    }


def decrypt_secure_payload(
    secret: str | bytes,
    envelope: dict[str, Any] | TranscodeFederationProtocolSecureEnvelope,
    *,
    now: int | None = None,
    seen_nonces: set[str] | None = None,
) -> dict[str, Any]:
    """Verify, reject stale/replayed messages, and decrypt an envelope."""

    candidate = envelope.model_dump() if hasattr(envelope, "model_dump") else envelope
    if not isinstance(candidate, dict) or int(candidate.get("version", 0)) != PROTOCOL_VERSION:
        raise FederationAuthenticationError("Unsupported federation envelope version")
    try:
        timestamp = int(candidate["timestamp"])
        nonce_value = str(candidate["nonce"])
        ciphertext = _decode_b64(str(candidate["ciphertext"]))
        tag = _decode_b64(str(candidate["tag"]))
        nonce = _decode_b64(nonce_value)
    except (KeyError, TypeError, ValueError) as exc:
        raise FederationAuthenticationError("Malformed federation envelope") from exc
    current = int(time.time()) if now is None else int(now)
    if abs(current - timestamp) > TIMESTAMP_TOLERANCE_SECONDS:
        raise FederationAuthenticationError("Stale federation envelope")
    if len(nonce) < 12 or len(tag) != hashlib.sha256().digest_size:
        raise FederationAuthenticationError("Malformed federation envelope")
    if seen_nonces is not None and nonce_value in seen_nonces:
        raise FederationAuthenticationError("Federation envelope replay detected")
    key = _secret_bytes(secret)
    signed = ENVELOPE_CONTEXT + str(timestamp).encode("ascii") + nonce + ciphertext
    expected = hmac.new(key, signed, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, tag):
        raise FederationAuthenticationError()
    try:
        payload = json.loads(_xor(ciphertext, _keystream(key, nonce, len(ciphertext))).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FederationAuthenticationError("Federation payload could not be decoded") from exc
    if not isinstance(payload, dict):
        raise FederationAuthenticationError("Federation payload must be an object")
    if seen_nonces is not None:
        seen_nonces.add(nonce_value)
        if len(seen_nonces) > 2048:
            seen_nonces.difference_update(set(list(seen_nonces)[:512]))
    return payload


def derive_shared_secret(
    pairing_code: str,
    client_nonce: str,
    server_nonce: str,
    origin_installation_id: str,
    target_installation_id: str,
) -> str:
    """Derive a per-peer key without storing the pairing code as the key."""

    material = b"|".join(
        item.encode("utf-8")
        for item in (
            client_nonce,
            server_nonce,
            origin_installation_id,
            target_installation_id,
        )
    )
    return hmac.new(
        pairing_code.encode("utf-8"),
        PAIRING_CONTEXT + material,
        hashlib.sha256,
    ).hexdigest()


def _new_pairing_code() -> str:
    """Return a six-digit legacy-compatible placeholder code."""

    return f"{secrets.randbelow(PAIRING_CODE_MODULUS):0{PAIRING_CODE_LENGTH}d}"


def _new_pairing_secret() -> str:
    return secrets.token_hex(32)


def _pairing_secret_from_seed(seed: str) -> str:
    """Derive a persistent-format secret from a legacy/configured seed."""

    return hmac.new(
        PAIRING_CONTEXT,
        seed.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _pairing_bucket(now: float | None = None) -> int:
    current = time.time() if now is None else float(now)
    return int(current // PAIRING_CODE_ROTATION_SECONDS)


def pairing_code_expires_at(now: float | None = None) -> int:
    """Return the Unix timestamp at which the current displayed code expires."""

    return (_pairing_bucket(now) + 1) * PAIRING_CODE_ROTATION_SECONDS


def _pairing_code_for_bucket(secret: str, bucket: int) -> str:
    digest = hmac.new(
        _secret_bytes(secret),
        PAIRING_CODE_CONTEXT + str(bucket).encode("ascii"),
        hashlib.sha256,
    ).digest()
    value = int.from_bytes(digest[:8], "big") % PAIRING_CODE_MODULUS
    return f"{value:0{PAIRING_CODE_LENGTH}d}"


def _pairing_hash(code: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256",
        code.encode("utf-8"),
        bytes.fromhex(salt_hex),
        180_000,
    ).hex()


def _default_federation_state(settings: Settings) -> dict[str, Any]:
    installation_id = uuid4().hex
    pairing_code = _new_pairing_code()
    pairing_salt = secrets.token_bytes(16).hex()
    return {
        "version": 1,
        "installation_id": installation_id,
        "federation_id": uuid4().hex,
        "federation_name": "MediaLyze Federation",
        "display_name": f"MediaLyze {socket.gethostname() or installation_id[:8]}",
        "enabled": False,
        "discovery_enabled": True,
        "accept_jobs": True,
        "endpoint_urls": [],
        "pairing_code": pairing_code,
        "pairing_salt": pairing_salt,
        "pairing_hash": _pairing_hash(pairing_code, pairing_salt),
        "pairing_secret": _new_pairing_secret(),
        "excluded_installation_ids": [],
        # CPU is enabled by default.  An empty GPU map means every locally
        # probed GPU is enabled; explicit false entries are the per-device
        # opt-outs exposed by the settings panel.
        "resource_policy": {"cpu": True, "gpu": {}},
    }


def _normalize_excluded_installation_ids(
    state: dict[str, Any],
    values: Any = None,
    *,
    ignored_ids: Iterable[str] = (),
) -> list[str]:
    source = state.get("excluded_installation_ids", []) if values is None else values
    if not isinstance(source, (list, tuple, set)):
        return []
    ignored = {str(state.get("installation_id") or ""), *(str(item) for item in ignored_ids)}
    normalized: set[str] = set()
    for item in source:
        candidate = str(item or "").strip()
        if candidate and candidate not in ignored:
            normalized.add(candidate)
    return sorted(normalized)


def _normalize_resource_policy(value: Any) -> dict[str, Any]:
    candidate = value if isinstance(value, dict) else {}
    gpu = candidate.get("gpu") if isinstance(candidate.get("gpu"), dict) else {}
    return {
        "cpu": bool(candidate.get("cpu", True)),
        "gpu": {str(device_id): bool(enabled) for device_id, enabled in gpu.items() if str(device_id)},
    }


def get_federation_state(db: Session, settings: Settings) -> dict[str, Any]:
    setting = db.get(AppSetting, FEDERATION_STATE_KEY)
    if setting is None or not isinstance(setting.value, dict):
        state = _default_federation_state(settings)
        if setting is None:
            setting = AppSetting(key=FEDERATION_STATE_KEY, value=state)
            db.add(setting)
        else:
            setting.value = state
        db.commit()
        state["pairing_code"] = _effective_pairing_code(settings, state)
        return state
    state = dict(setting.value)
    changed = False
    if not str(state.get("pairing_secret") or "").strip():
        legacy_seed = str(settings.federation_passcode or state.get("pairing_code") or "").strip()
        state["pairing_secret"] = _pairing_secret_from_seed(legacy_seed) if legacy_seed else _new_pairing_secret()
        changed = True
    defaults = _default_federation_state(settings)
    for key, value in defaults.items():
        if key not in state:
            state[key] = value
            changed = True
    normalized_policy = _normalize_resource_policy(state.get("resource_policy"))
    if normalized_policy != state.get("resource_policy"):
        state["resource_policy"] = normalized_policy
        changed = True
    normalized_excluded = _normalize_excluded_installation_ids(state)
    if normalized_excluded != state.get("excluded_installation_ids"):
        state["excluded_installation_ids"] = normalized_excluded
        changed = True
    if changed:
        setting.value = state
        db.commit()
    # Keep this legacy field useful to callers while the actual secret remains
    # stable and the displayed/authenticated code is derived from the current
    # rotation bucket.
    state["pairing_code"] = _effective_pairing_code(settings, state)
    return state


def _effective_pairing_secret(settings: Settings, state: dict[str, Any]) -> str:
    configured_seed = str(settings.federation_passcode or "").strip()
    if configured_seed:
        return _pairing_secret_from_seed(configured_seed)
    secret = str(state.get("pairing_secret") or "").strip()
    if secret:
        return secret
    legacy_seed = str(state.get("pairing_code") or "").strip()
    return _pairing_secret_from_seed(legacy_seed) if legacy_seed else _new_pairing_secret()


def _effective_pairing_code(
    settings: Settings,
    state: dict[str, Any],
    now: float | None = None,
) -> str:
    return _pairing_code_for_bucket(
        _effective_pairing_secret(settings, state),
        _pairing_bucket(now),
    )


def verify_pairing_code(settings: Settings, state: dict[str, Any], code: str) -> bool:
    candidate = str(code or "").strip()
    if len(candidate) != PAIRING_CODE_LENGTH or not all("0" <= char <= "9" for char in candidate):
        return False
    secret = _effective_pairing_secret(settings, state)
    current_bucket = _pairing_bucket()
    return any(
        hmac.compare_digest(
            candidate,
            _pairing_code_for_bucket(secret, current_bucket + offset),
        )
        for offset in range(-PAIRING_CODE_CLOCK_SKEW_BUCKETS, PAIRING_CODE_CLOCK_SKEW_BUCKETS + 1)
    )


def reset_pairing_code(db: Session, settings: Settings) -> tuple[str, bool]:
    state = get_federation_state(db, settings)
    if settings.federation_passcode:
        return _effective_pairing_code(settings, state), True
    state["pairing_secret"] = _new_pairing_secret()
    code = _effective_pairing_code(settings, state)
    salt = secrets.token_bytes(16).hex()
    state["pairing_code"] = code
    state["pairing_salt"] = salt
    state["pairing_hash"] = _pairing_hash(code, salt)
    setting = db.get(AppSetting, FEDERATION_STATE_KEY)
    if setting is None:
        db.add(AppSetting(key=FEDERATION_STATE_KEY, value=state))
    else:
        setting.value = state
    db.commit()
    return code, False


def update_federation_settings(
    db: Session,
    settings: Settings,
    update: TranscodeFederationSettingsUpdate,
) -> TranscodeFederationSettingsRead:
    state = get_federation_state(db, settings)
    for key in ("enabled", "federation_name", "display_name", "discovery_enabled", "accept_jobs"):
        value = getattr(update, key)
        if value is not None:
            state[key] = value
    if update.endpoint_urls is not None:
        state["endpoint_urls"] = [normalize_endpoint(item) for item in update.endpoint_urls]
    if update.resource_policy is not None:
        state["resource_policy"] = _normalize_resource_policy(update.resource_policy)
    setting = db.get(AppSetting, FEDERATION_STATE_KEY)
    if setting is None:
        db.add(AppSetting(key=FEDERATION_STATE_KEY, value=state))
    else:
        setting.value = state
    db.commit()
    return federation_settings_read(db, settings)


def federation_enabled(db: Session, settings: Settings) -> bool:
    return bool(settings.federation_enabled and get_federation_state(db, settings).get("enabled"))


def normalize_endpoint(endpoint: str) -> str:
    value = str(endpoint or "").strip()
    try:
        parts = urlsplit(value)
    except ValueError as exc:
        raise FederationError("Endpoint must be an HTTP or HTTPS URL with a host") from exc
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise FederationError("Endpoint must be an HTTP or HTTPS URL with a host")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise FederationError("Endpoint must not contain credentials, query parameters, or fragments")
    path = parts.path.rstrip("/")
    if path.endswith("/api/transcoding/federation/protocol"):
        path = path[: -len("/api/transcoding/federation/protocol")].rstrip("/")
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def _normalize_endpoint_list(values: Iterable[Any], *, limit: int = MAX_FEDERATION_ENDPOINTS) -> list[str]:
    """Normalize, validate, and bound endpoint data received from a peer."""

    if values is None:
        return []
    if isinstance(values, (str, bytes)):
        values = [values]
    result: list[str] = []
    for value in values:
        try:
            normalized = normalize_endpoint(str(value))
        except (FederationError, ValueError):
            continue
        if normalized in result:
            continue
        result.append(normalized)
        if len(result) >= limit:
            break
    return result


def _merge_endpoint_urls(existing: Iterable[Any], incoming: Iterable[Any]) -> list[str]:
    """Keep old addresses as fallbacks while preferring newly advertised ones."""

    incoming_values: Iterable[Any] = [] if incoming is None else incoming
    existing_values: Iterable[Any] = [] if existing is None else existing
    if isinstance(incoming_values, (str, bytes)):
        incoming_values = [incoming_values]
    if isinstance(existing_values, (str, bytes)):
        existing_values = [existing_values]
    return _normalize_endpoint_list([*incoming_values, *existing_values])


def _protocol_url(endpoint: str, route: str = "") -> str:
    base = normalize_endpoint(endpoint).rstrip("/")
    suffix = "/transcoding/federation/protocol"
    if base.endswith("/api"):
        url = base + suffix
    else:
        url = base + "/api" + suffix
    return url + ("/" + route.lstrip("/") if route else "")


def _state_endpoints(settings: Settings, state: dict[str, Any]) -> list[str]:
    configured = [item.strip() for item in str(settings.federation_advertise_urls or "").split(",") if item.strip()]
    state_endpoints = state.get("endpoint_urls", [])
    if isinstance(state_endpoints, (list, tuple, set)):
        configured.extend(str(item) for item in state_endpoints if str(item).strip())
    return _normalize_endpoint_list(configured)


def _usable_network_ip(value: str) -> str | None:
    try:
        address = ipaddress.ip_address(str(value).strip())
    except ValueError:
        return None
    if address.is_loopback or address.is_unspecified or address.is_link_local or address.is_multicast:
        return None
    return str(address)


def _format_local_endpoint(host: str, port: int) -> str:
    normalized_host = str(host).strip().rstrip(".")
    netloc = f"[{normalized_host}]:{int(port)}" if ":" in normalized_host else f"{normalized_host}:{int(port)}"
    return f"http://{netloc}"


def _append_unique(values: list[str], value: str) -> None:
    if value and value not in values:
        values.append(value)


def _local_network_endpoints(settings: Settings, state: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Return hostname and IP URLs that can be used for direct pairing.

    Explicitly advertised endpoints are authoritative and may use a different
    scheme or externally mapped port.  Local aliases are only shown when they
    resolve to at least one non-loopback address, so the settings page does not
    present localhost or wildcard bindings as reachable peer addresses.
    """

    hostname_urls: list[str] = []
    ip_urls: list[str] = []
    for endpoint in _state_endpoints(settings, state):
        try:
            host = (urlsplit(endpoint).hostname or "").rstrip(".")
        except ValueError:
            continue
        if not host:
            continue
        try:
            ipaddress.ip_address(host)
        except ValueError:
            if host.lower() not in {"localhost", "localhost.localdomain"}:
                _append_unique(hostname_urls, endpoint)
        else:
            if _usable_network_ip(host):
                _append_unique(ip_urls, endpoint)

    local_hosts: list[str] = []
    for resolver in (socket.gethostname, socket.getfqdn):
        try:
            host = str(resolver() or "").strip().rstrip(".")
        except OSError:
            continue
        if not host or host.lower() in {"localhost", "localhost.localdomain"}:
            continue
        if host not in local_hosts:
            local_hosts.append(host)

    for host in local_hosts:
        literal_ip = _usable_network_ip(host)
        if literal_ip:
            _append_unique(ip_urls, _format_local_endpoint(literal_ip, settings.federation_port))
            continue
        try:
            resolved = socket.getaddrinfo(
                host,
                int(settings.federation_port),
                family=socket.AF_UNSPEC,
                type=socket.SOCK_STREAM,
            )
        except OSError:
            continue
        resolved_ips: list[str] = []
        for result in resolved:
            if len(result) < 5 or not result[4]:
                continue
            resolved_ip = _usable_network_ip(str(result[4][0]))
            if resolved_ip:
                _append_unique(resolved_ips, resolved_ip)
        if not resolved_ips:
            continue
        _append_unique(hostname_urls, _format_local_endpoint(host, settings.federation_port))
        for resolved_ip in resolved_ips:
            _append_unique(ip_urls, _format_local_endpoint(resolved_ip, settings.federation_port))

    return hostname_urls, ip_urls


def _local_advertised_endpoint_urls(settings: Settings, state: dict[str, Any]) -> list[str]:
    """Return configured and locally resolved addresses for peer exchange."""

    hostname_urls, ip_urls = _local_network_endpoints(settings, state)
    return _merge_endpoint_urls(
        _state_endpoints(settings, state),
        [*hostname_urls, *ip_urls],
    )


def _local_resources(db: Session, settings: Settings, capabilities: dict[str, Any]) -> dict[str, Any]:
    try:
        import psutil

        cpu_threads = int(psutil.cpu_count(logical=True) or 1)
    except Exception:
        cpu_threads = 1
    try:
        disk = shutil.disk_usage(Path(settings.config_path).resolve())
        free_bytes = int(disk.free)
    except OSError:
        free_bytes = 0
    active_jobs = int(
        db.scalar(
            select(func.count(TranscodeJob.id)).where(
                TranscodeJob.status.in_([JobStatus.queued, JobStatus.running])
            )
        )
        or 0
    )
    devices = capabilities.get("devices") if isinstance(capabilities, dict) else []
    gpu_devices = [
        {"id": item.get("id"), "status": item.get("status"), "backend": item.get("backend")}
        for item in devices
        if isinstance(item, dict) and item.get("id")
    ]
    return {
        "cpu_threads": cpu_threads,
        "parallel_jobs": max(1, int(transcode_capacity(settings)["cpu_parallel_jobs"])),
        "active_jobs": active_jobs,
        "temp_free_bytes": free_bytes,
        "gpu_devices": gpu_devices,
    }


def local_descriptor(db: Session, settings: Settings) -> dict[str, Any]:
    state = get_federation_state(db, settings)
    try:
        capabilities = get_transcode_capabilities(settings).model_dump(mode="json")
    except Exception as exc:
        logger.warning("Unable to publish local transcode capabilities to federation: %s", exc)
        capabilities = TranscodeCapabilitiesRead(
            ffmpeg_available=False,
            ffmpeg_path=settings.ffmpeg_path,
            error=str(exc),
        ).model_dump(mode="json")
    try:
        matrix = load_transcode_matrix(settings).model_dump(mode="json")
    except Exception as exc:
        matrix = TranscodeCapabilityMatrixRead(status="failed", error=str(exc)).model_dump(mode="json")
    resources = _local_resources(db, settings, capabilities)
    resources["resource_policy"] = _normalize_resource_policy(state.get("resource_policy"))
    resources["gpu_devices"] = [
        {
            **item,
            "accepted": resources["resource_policy"]["gpu"].get(str(item["id"]), True),
        }
        for item in resources.get("gpu_devices", [])
    ]
    return {
        "protocol_version": PROTOCOL_VERSION,
        "application_version": settings.app_version,
        "installation_id": state["installation_id"],
        "federation_id": state["federation_id"],
        "display_name": state["display_name"],
        "endpoint_urls": _local_advertised_endpoint_urls(settings, state),
        "accept_jobs": bool(state.get("accept_jobs", True)),
        "resources": resources,
        "capabilities": capabilities,
        "capability_matrix": matrix,
        "network_mbps": 100.0,
        "active_jobs": int(
            db.scalar(
                select(func.count(TranscodeJob.id)).where(
                    TranscodeJob.status.in_([JobStatus.queued, JobStatus.running])
                )
            )
            or 0
        ),
        "excluded_installation_ids": list(state.get("excluded_installation_ids", [])),
        "resource_policy": resources["resource_policy"],
    }


def federation_settings_read(db: Session, settings: Settings) -> TranscodeFederationSettingsRead:
    state = get_federation_state(db, settings)
    hostname_urls, ip_urls = _local_network_endpoints(settings, state)
    now = time.time()
    return TranscodeFederationSettingsRead(
        enabled=bool(settings.federation_enabled and state.get("enabled")),
        federation_id=str(state["federation_id"]),
        installation_id=str(state["installation_id"]),
        federation_name=str(state.get("federation_name") or "MediaLyze Federation"),
        display_name=str(state.get("display_name") or "MediaLyze"),
        pairing_code=_effective_pairing_code(settings, state, now),
        pairing_code_from_environment=bool(settings.federation_passcode),
        pairing_code_expires_at=pairing_code_expires_at(now),
        discovery_enabled=bool(state.get("discovery_enabled", True)),
        accept_jobs=bool(state.get("accept_jobs", True)),
        endpoint_urls=_state_endpoints(settings, state),
        hostname_urls=hostname_urls,
        ip_urls=ip_urls,
        resource_policy=_normalize_resource_policy(state.get("resource_policy")),
        protocol_version=PROTOCOL_VERSION,
        temp_budget_bytes=int(getattr(settings, "federation_temp_budget_bytes", 0)),
        result_retention_hours=int(getattr(settings, "federation_result_retention_hours", 24)),
    )


def _member_read(member: TranscodeFederationMember) -> TranscodeFederationMemberRead:
    # Discovery can persist a peer before its first authenticated heartbeat.
    # Such a row has empty JSON objects, which are not complete capability
    # payloads and must remain optional in the response schema.
    capabilities = (
        member.capabilities
        if isinstance(member.capabilities, dict) and member.capabilities
        else None
    )
    matrix = (
        member.capability_matrix
        if isinstance(member.capability_matrix, dict) and member.capability_matrix
        else None
    )
    return TranscodeFederationMemberRead.model_validate(
        {
            "id": member.id,
            "installation_id": member.installation_id,
            "federation_id": member.federation_id,
            "display_name": member.display_name,
            "endpoint_urls": member.endpoint_urls or [],
            "protocol_version": member.protocol_version,
            "application_version": member.application_version,
            "status": member.status,
            "connection_status": member.connection_status,
            "reachable": member.reachable,
            "accept_jobs": member.accept_jobs,
            "resources": member.resources or {},
            "capabilities": capabilities,
            "capability_matrix": matrix,
            "active_jobs": member.active_jobs,
            "network_mbps": member.network_mbps,
            "preferred_endpoint_url": member.preferred_endpoint_url,
            "endpoint_metrics": member.endpoint_metrics or {},
            "network_latency_ms": member.network_latency_ms,
            "network_probe_at": member.network_probe_at,
            "last_seen_at": member.last_seen_at,
            "last_sync_at": member.last_sync_at,
            "last_error": member.last_error,
        }
    )


def _member_endpoint_urls(member: TranscodeFederationMember) -> list[str]:
    return _normalize_endpoint_list(member.endpoint_urls or [])


def _endpoint_metrics_for_member(member: TranscodeFederationMember) -> dict[str, dict[str, Any]]:
    raw_metrics = member.endpoint_metrics if isinstance(member.endpoint_metrics, dict) else {}
    metrics: dict[str, dict[str, Any]] = {}
    for raw_endpoint, raw_metric in raw_metrics.items():
        if not isinstance(raw_metric, dict):
            continue
        try:
            endpoint = normalize_endpoint(str(raw_endpoint))
        except (FederationError, ValueError):
            continue
        metrics[endpoint] = dict(raw_metric)
    return metrics


def _endpoint_score_ms(latency_ms: float | None, throughput_mbps: float | None) -> float | None:
    """Rank a route by latency plus the time to transfer a representative 1 MiB."""

    try:
        latency = float(latency_ms or 0.0)
        throughput = float(throughput_mbps or 0.0)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(latency) or not math.isfinite(throughput) or latency < 0 or throughput <= 0:
        return None
    transfer_ms = NETWORK_SCORE_SAMPLE_BYTES * 8 / throughput / 1_000_000 * 1_000
    return latency + transfer_ms


def _ordered_member_endpoints(member: TranscodeFederationMember) -> list[str]:
    """Put the last measured best route first, followed by measured fallbacks."""

    endpoints = _member_endpoint_urls(member)
    metrics = _endpoint_metrics_for_member(member)
    ranked = sorted(
        (
            endpoint
            for endpoint in endpoints
            if bool(metrics.get(endpoint, {}).get("reachable", False))
            and _endpoint_score_ms(
                metrics.get(endpoint, {}).get("latency_ms"),
                metrics.get(endpoint, {}).get("throughput_mbps"),
            )
            is not None
        ),
        key=lambda endpoint: float(
            _endpoint_score_ms(
                metrics[endpoint].get("latency_ms"),
                metrics[endpoint].get("throughput_mbps"),
            )
            or float("inf")
        ),
    )
    preferred = ""
    try:
        preferred = normalize_endpoint(str(member.preferred_endpoint_url or ""))
    except (FederationError, ValueError):
        preferred = ""
    ordered: list[str] = []
    if preferred in endpoints and bool(metrics.get(preferred, {}).get("reachable", True)):
        ordered.append(preferred)
    for endpoint in ranked:
        if endpoint not in ordered:
            ordered.append(endpoint)
    for endpoint in endpoints:
        if endpoint not in ordered:
            ordered.append(endpoint)
    return ordered


def _select_best_member_endpoint(member: TranscodeFederationMember) -> str | None:
    metrics = _endpoint_metrics_for_member(member)
    candidates = [
        endpoint
        for endpoint in _member_endpoint_urls(member)
        if bool(metrics.get(endpoint, {}).get("reachable", False))
        and _endpoint_score_ms(
            metrics.get(endpoint, {}).get("latency_ms"),
            metrics.get(endpoint, {}).get("throughput_mbps"),
        )
        is not None
    ]
    if not candidates:
        return None
    best = min(
        candidates,
        key=lambda endpoint: float(
            _endpoint_score_ms(
                metrics[endpoint].get("latency_ms"),
                metrics[endpoint].get("throughput_mbps"),
            )
            or float("inf")
        ),
    )
    metric = metrics[best]
    member.preferred_endpoint_url = best
    member.network_latency_ms = float(metric.get("latency_ms") or 0.0)
    member.network_mbps = float(metric["throughput_mbps"])
    member.endpoint_metrics = metrics
    return best


def _record_endpoint_observation(
    member: TranscodeFederationMember,
    endpoint: str,
    *,
    reachable: bool,
    latency_ms: float | None = None,
    upload_mbps: float | None = None,
    download_mbps: float | None = None,
    throughput_mbps: float | None = None,
    error: str | None = None,
    probe: bool = False,
    probe_unsupported: bool = False,
) -> None:
    normalized_endpoint = normalize_endpoint(endpoint)
    known_endpoints = set(_member_endpoint_urls(member))
    metrics = _endpoint_metrics_for_member(member)
    metric = metrics.setdefault(normalized_endpoint, {})
    observed_at = utc_now()
    metric["reachable"] = bool(reachable)
    metric["last_checked_at"] = observed_at.isoformat()
    if latency_ms is not None and math.isfinite(float(latency_ms)) and float(latency_ms) >= 0:
        metric["latency_ms"] = round(float(latency_ms), 3)
    if upload_mbps is not None and math.isfinite(float(upload_mbps)) and float(upload_mbps) > 0:
        metric["upload_mbps"] = round(float(upload_mbps), 3)
    if download_mbps is not None and math.isfinite(float(download_mbps)) and float(download_mbps) > 0:
        metric["download_mbps"] = round(float(download_mbps), 3)
    if throughput_mbps is not None and math.isfinite(float(throughput_mbps)) and float(throughput_mbps) > 0:
        metric["throughput_mbps"] = round(float(throughput_mbps), 3)
    else:
        measured_directions = [
            float(metric[key])
            for key in ("upload_mbps", "download_mbps")
            if metric.get(key) is not None
        ]
        if measured_directions:
            metric["throughput_mbps"] = round(min(measured_directions), 3)
    score = _endpoint_score_ms(metric.get("latency_ms"), metric.get("throughput_mbps"))
    if score is None:
        metric.pop("score_ms", None)
    else:
        metric["score_ms"] = round(score, 3)
    if reachable:
        metric.pop("error", None)
        if probe:
            metric["failure_count"] = 0
            metric.pop("next_probe_at", None)
            metric.pop("probe_failure", None)
            metric.pop("probe_unsupported", None)
        elif not metric.get("probe_failure"):
            metric["failure_count"] = 0
            metric.pop("next_probe_at", None)
        member.reachable = True
        member.connection_status = "connected"
        member.last_error = None
    else:
        metric["error"] = str(error or "Endpoint could not be reached")[:2048]
        try:
            failure_count = max(0, int(metric.get("failure_count") or 0)) + 1
        except (TypeError, ValueError):
            failure_count = 1
        backoff_seconds = min(
            NETWORK_PROBE_FAILURE_MAX_SECONDS,
            NETWORK_PROBE_FAILURE_BASE_SECONDS * (2 ** min(failure_count - 1, 10)),
        )
        metric["failure_count"] = failure_count
        metric["next_probe_at"] = (
            observed_at + timedelta(seconds=backoff_seconds)
        ).isoformat()
        if probe:
            metric["probe_failure"] = True
            if probe_unsupported:
                metric["probe_unsupported"] = True
        member.last_error = metric["error"]
    member.endpoint_urls = _merge_endpoint_urls(member.endpoint_urls or [], metrics.keys())
    if normalized_endpoint not in known_endpoints:
        member.network_probe_at = None
    member.endpoint_metrics = metrics


def _metric_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _member_endpoint_probe_candidates(
    member: TranscodeFederationMember,
    *,
    now: datetime | None = None,
) -> list[str]:
    """Return routes that need an event-driven probe right now.

    Healthy routes are intentionally omitted.  A missing metric represents a
    newly advertised route, while a failed route becomes eligible again only
    after its exponential recovery backoff.
    """

    current = now or utc_now()
    metrics = _endpoint_metrics_for_member(member)
    candidates: list[str] = []
    for endpoint in _member_endpoint_urls(member):
        metric = metrics.get(endpoint)
        if not metric:
            candidates.append(endpoint)
            continue
        if metric.get("probe_unsupported"):
            continue
        next_probe_at = _metric_timestamp(metric.get("next_probe_at"))
        if next_probe_at is not None and next_probe_at > current:
            continue
        if next_probe_at is not None or not bool(metric.get("reachable", False)):
            candidates.append(endpoint)
    return candidates


def federation_read(
    db: Session,
    settings: Settings,
    discovered: Iterable[dict[str, Any]] = (),
) -> TranscodeFederationRead:
    state = get_federation_state(db, settings)
    excluded = set(state.get("excluded_installation_ids", []))
    members = [
        _member_read(member)
        for member in db.scalars(
            select(TranscodeFederationMember).order_by(TranscodeFederationMember.display_name.collate("NOCASE"))
        ).all()
        if member.installation_id not in excluded
    ]
    peers = []
    for peer in discovered:
        try:
            if peer.get("installation_id") in excluded:
                continue
            peers.append(TranscodeFederationPeerRead.model_validate(peer))
        except Exception:
            continue
    return TranscodeFederationRead(
        settings=federation_settings_read(db, settings),
        members=members,
        discovered=peers,
    )


def _upsert_member(
    db: Session,
    descriptor: dict[str, Any],
    *,
    shared_secret: str | None = None,
    connection_status: str = "connected",
    reachable: bool = True,
) -> TranscodeFederationMember:
    installation_id = str(descriptor.get("installation_id") or "")
    if not installation_id:
        raise FederationError("Peer descriptor has no installation id")
    member = db.scalar(
        select(TranscodeFederationMember).where(
            TranscodeFederationMember.installation_id == installation_id
        )
    )
    if member is None:
        endpoint_urls = _normalize_endpoint_list(
            descriptor.get("endpoint_urls")
            if isinstance(descriptor.get("endpoint_urls"), (list, tuple, set))
            else []
        )
        member = TranscodeFederationMember(
            installation_id=installation_id,
            federation_id=str(descriptor.get("federation_id") or ""),
            display_name=str(descriptor.get("display_name") or installation_id[:12]),
            endpoint_urls=endpoint_urls,
            protocol_version=int(descriptor.get("protocol_version") or 1),
            application_version=str(descriptor.get("application_version") or "") or None,
            status="active" if shared_secret else "discovered",
            connection_status=connection_status,
            reachable=reachable,
            accept_jobs=bool(descriptor.get("accept_jobs", False)),
            resources=descriptor.get("resources") if isinstance(descriptor.get("resources"), dict) else {},
            capabilities=descriptor.get("capabilities") if isinstance(descriptor.get("capabilities"), dict) else {},
            capability_matrix=descriptor.get("capability_matrix")
            if isinstance(descriptor.get("capability_matrix"), dict)
            else {},
            active_jobs=int(descriptor.get("active_jobs") or 0),
            network_mbps=float(descriptor.get("network_mbps") or 100.0),
            shared_secret=shared_secret,
            last_seen_at=utc_now(),
            last_sync_at=utc_now(),
        )
        db.add(member)
    else:
        member.federation_id = str(descriptor.get("federation_id") or member.federation_id)
        member.display_name = str(descriptor.get("display_name") or member.display_name)
        previous_endpoints = set(_member_endpoint_urls(member))
        incoming_endpoints = descriptor.get("endpoint_urls")
        if isinstance(incoming_endpoints, (list, tuple, set)) and incoming_endpoints:
            member.endpoint_urls = _merge_endpoint_urls(member.endpoint_urls or [], incoming_endpoints)
        else:
            member.endpoint_urls = _normalize_endpoint_list(member.endpoint_urls or [])
        if set(member.endpoint_urls) - previous_endpoints:
            member.network_probe_at = None
        member.protocol_version = int(descriptor.get("protocol_version") or member.protocol_version or 1)
        if descriptor.get("application_version"):
            member.application_version = str(descriptor["application_version"])
        member.connection_status = connection_status
        member.reachable = reachable
        member.accept_jobs = bool(descriptor.get("accept_jobs", member.accept_jobs))
        member.resources = descriptor.get("resources") if isinstance(descriptor.get("resources"), dict) else member.resources or {}
        member.capabilities = descriptor.get("capabilities") if isinstance(descriptor.get("capabilities"), dict) else member.capabilities or {}
        if isinstance(descriptor.get("capability_matrix"), dict):
            member.capability_matrix = descriptor["capability_matrix"]
        member.active_jobs = int(descriptor.get("active_jobs") or 0)
        if not member.endpoint_metrics:
            member.network_mbps = float(descriptor.get("network_mbps") or member.network_mbps or 100.0)
        member.last_seen_at = utc_now()
        member.last_sync_at = utc_now()
        if shared_secret:
            member.shared_secret = shared_secret
            member.status = "active"
    return member


def accept_pairing_request(
    db: Session,
    settings: Settings,
    request: TranscodeFederationProtocolPairRequest,
) -> dict[str, Any]:
    state = get_federation_state(db, settings)
    if not settings.federation_enabled or not state.get("enabled"):
        raise FederationError("This installation has not enabled federation", status_code=409)
    if not verify_pairing_code(settings, state, request.pairing_code):
        raise FederationAuthenticationError("Invalid federation pairing code")
    if request.installation_id == state["installation_id"]:
        raise FederationError("An installation cannot pair with itself")
    if request.protocol_version != PROTOCOL_VERSION:
        raise FederationError("Incompatible federation protocol version", status_code=426)
    server_nonce = secrets.token_urlsafe(24)
    descriptor = request.model_dump(exclude={"pairing_code", "client_nonce"})
    descriptor["active_jobs"] = int(request.resources.get("active_jobs") or 0)
    shared_secret = derive_shared_secret(
        request.pairing_code,
        request.client_nonce,
        server_nonce,
        request.installation_id,
        state["installation_id"],
    )
    incoming_federation_id = str(request.federation_id or "").strip()
    if incoming_federation_id and incoming_federation_id != state["federation_id"]:
        # A valid member introduces the shared trust-group identity.  The
        # installation ID itself remains permanent; only the group label is
        # adopted so a chain of direct pairings converges on one federation.
        state["federation_id"] = incoming_federation_id
        setting = db.get(AppSetting, FEDERATION_STATE_KEY)
        if setting is not None:
            setting.value = state
    if request.installation_id in set(state.get("excluded_installation_ids", [])):
        # Exclusion blocks existing authenticated traffic.  A fresh pairing
        # with the current code is the explicit re-admission path.
        state["excluded_installation_ids"] = [
            item for item in state.get("excluded_installation_ids", [])
            if item != request.installation_id
        ]
        setting = db.get(AppSetting, FEDERATION_STATE_KEY)
        if setting is not None:
            setting.value = state
    member = _upsert_member(db, descriptor, shared_secret=shared_secret)
    db.commit()
    known_members = [
        {
            "installation_id": item.installation_id,
            "federation_id": item.federation_id,
            "display_name": item.display_name,
            "endpoint_urls": item.endpoint_urls or [],
            "protocol_version": item.protocol_version,
            "application_version": item.application_version,
            "reachable": item.reachable,
            "accept_jobs": item.accept_jobs,
        }
        for item in db.scalars(
            select(TranscodeFederationMember).where(
                TranscodeFederationMember.installation_id != request.installation_id,
                TranscodeFederationMember.status == "active",
            )
        ).all()
    ]
    return {
        "protocol_version": PROTOCOL_VERSION,
        "server_nonce": server_nonce,
        "target": local_descriptor(db, settings),
        "known_members": known_members,
        "member_id": member.installation_id,
    }


def _http_json(
    settings: Settings,
    endpoint: str,
    route: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    try:
        with httpx.Client(timeout=float(settings.federation_request_timeout_seconds)) as client:
            response = client.post(_protocol_url(endpoint, route), json=payload)
            response.raise_for_status()
            result = response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:500]
        raise FederationError(f"Peer rejected federation request: {detail}", status_code=exc.response.status_code) from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise FederationError(f"Peer could not be reached: {exc}", status_code=503) from exc
    if not isinstance(result, dict):
        raise FederationError("Peer returned an invalid federation response", status_code=502)
    return result


def _network_probe_payload(request_bytes: int, response_bytes: int) -> dict[str, Any]:
    return {
        "kind": "network_probe",
        "probe_id": uuid4().hex,
        "request_bytes": request_bytes,
        "response_bytes": response_bytes,
        "payload": base64.urlsafe_b64encode(secrets.token_bytes(request_bytes)).decode("ascii"),
    }


def network_probe_response(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate an authenticated probe and return a bounded response sample."""

    if payload.get("kind") != "network_probe":
        raise FederationError("Unsupported federation network probe")
    try:
        request_bytes = int(payload.get("request_bytes") or 0)
        response_bytes = int(payload.get("response_bytes") or 0)
    except (TypeError, ValueError) as exc:
        raise FederationError("Invalid federation network probe size", status_code=422) from exc
    if not 0 <= request_bytes <= NETWORK_PROBE_MAX_BYTES or not 0 <= response_bytes <= NETWORK_PROBE_MAX_BYTES:
        raise FederationError("Federation network probe is too large", status_code=422)
    encoded_request = str(payload.get("payload") or "")
    try:
        received = base64.urlsafe_b64decode(encoded_request.encode("ascii"))
    except (binascii.Error, UnicodeError, ValueError) as exc:
        raise FederationError("Invalid federation network probe payload", status_code=422) from exc
    if len(received) != request_bytes:
        raise FederationError("Federation network probe payload size mismatch", status_code=422)
    return {
        "kind": "network_probe_response",
        "probe_id": str(payload.get("probe_id") or ""),
        "request_bytes": request_bytes,
        "response_bytes": response_bytes,
        "payload": base64.urlsafe_b64encode(secrets.token_bytes(response_bytes)).decode("ascii"),
    }


def _probe_endpoint(
    settings: Settings,
    shared_secret: str,
    endpoint: str,
    *,
    origin_installation_id: str,
    timeout_seconds: float | None = None,
) -> dict[str, float]:
    """Measure latency and both transfer directions for one authenticated route."""

    if not shared_secret:
        raise FederationError("Federation member has no shared secret", status_code=503)
    request_timeout = (
        NETWORK_PROBE_TIMEOUT_SECONDS
        if timeout_seconds is None
        else max(0.1, float(timeout_seconds))
    )
    normalized_endpoint = normalize_endpoint(endpoint)

    def send_probe(request_bytes: int, response_bytes: int) -> tuple[dict[str, Any], float]:
        payload = _network_probe_payload(request_bytes, response_bytes)
        started = time.monotonic()
        try:
            with httpx.Client(timeout=request_timeout) as client:
                response = client.post(
                    _protocol_url(normalized_endpoint, NETWORK_PROBE_ROUTE),
                    json=encrypt_secure_payload(shared_secret, payload),
                    headers={"X-MediaLyze-Installation-ID": origin_installation_id},
                )
                response.raise_for_status()
                remote_envelope = response.json()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            raise FederationError(
                f"Peer rejected federation network probe: {detail}",
                status_code=exc.response.status_code,
            ) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise FederationError(f"Peer could not be reached: {exc}", status_code=503) from exc
        if not isinstance(remote_envelope, dict):
            raise FederationError("Peer returned an invalid federation probe response", status_code=502)
        with _REPLAY_LOCK:
            result = decrypt_secure_payload(
                shared_secret,
                remote_envelope,
                seen_nonces=_REPLAY_NONCES,
            )
        if result.get("kind") != "network_probe_response" or result.get("probe_id") != payload["probe_id"]:
            raise FederationError("Peer returned an invalid federation probe response", status_code=502)
        try:
            result_request_bytes = int(result.get("request_bytes"))
            result_response_bytes = int(result.get("response_bytes"))
        except (TypeError, ValueError) as exc:
            raise FederationError("Peer returned an incomplete federation probe response", status_code=502) from exc
        if result_request_bytes != request_bytes or result_response_bytes != response_bytes:
            raise FederationError("Peer returned an incomplete federation probe response", status_code=502)
        try:
            received_response = base64.urlsafe_b64decode(str(result.get("payload") or "").encode("ascii"))
        except (binascii.Error, UnicodeError, ValueError) as exc:
            raise FederationError("Peer returned an invalid federation probe payload", status_code=502) from exc
        if len(received_response) != response_bytes:
            raise FederationError("Peer returned a federation probe payload size mismatch", status_code=502)
        return result, max(0.001, time.monotonic() - started)

    _, latency_seconds = send_probe(0, 0)
    _, upload_seconds = send_probe(NETWORK_PROBE_BYTES, 0)
    _, download_seconds = send_probe(0, NETWORK_PROBE_BYTES)
    upload_mbps = NETWORK_PROBE_BYTES * 8 / max(0.001, upload_seconds - latency_seconds) / 1_000_000
    download_mbps = NETWORK_PROBE_BYTES * 8 / max(0.001, download_seconds - latency_seconds) / 1_000_000
    throughput_mbps = min(upload_mbps, download_mbps)
    return {
        "latency_ms": latency_seconds * 1_000,
        "upload_mbps": upload_mbps,
        "download_mbps": download_mbps,
        "throughput_mbps": throughput_mbps,
        "score_ms": _endpoint_score_ms(latency_seconds * 1_000, throughput_mbps) or 0.0,
    }


def probe_member_endpoints(
    db: Session,
    settings: Settings,
    member: TranscodeFederationMember,
    *,
    force: bool = False,
    timeout_seconds: float | None = None,
    endpoints: Iterable[str] | None = None,
) -> dict[str, dict[str, Any]]:
    """Probe selected known endpoints and persist the best route for future traffic.

    A forced probe checks the complete endpoint set.  Automatic maintenance
    only checks routes that have no observation yet or whose failure backoff
    has elapsed, so healthy routes are not retested on a fixed timer.
    """

    if not member.shared_secret or not member.endpoint_urls:
        raise FederationError("Federation member is not ready for endpoint probes", status_code=503)
    all_endpoints = _member_endpoint_urls(member)
    if not all_endpoints:
        raise FederationError("Federation member has no valid endpoint URL", status_code=503)
    if endpoints is None:
        probe_endpoints = all_endpoints if force else _member_endpoint_probe_candidates(member)
    else:
        requested_endpoints = _normalize_endpoint_list(endpoints)
        probe_endpoints = [endpoint for endpoint in requested_endpoints if endpoint in all_endpoints]
    if not probe_endpoints:
        return _endpoint_metrics_for_member(member)
    state = get_federation_state(db, settings)
    observations: dict[str, dict[str, Any]] = {}
    successful = False
    unsupported_only = True
    probe_results: dict[str, dict[str, float] | FederationError] = {}
    with ThreadPoolExecutor(max_workers=min(4, len(probe_endpoints))) as executor:
        futures = {
            executor.submit(
                _probe_endpoint,
                settings,
                str(member.shared_secret),
                endpoint,
                origin_installation_id=str(state["installation_id"]),
                timeout_seconds=timeout_seconds,
            ): endpoint
            for endpoint in probe_endpoints
        }
        for future in as_completed(futures):
            endpoint = futures[future]
            try:
                probe_results[endpoint] = future.result()
            except FederationError as exc:
                probe_results[endpoint] = exc
            except Exception as exc:
                probe_results[endpoint] = FederationError(
                    f"Peer could not be reached: {exc}",
                    status_code=503,
                )
    for endpoint in probe_endpoints:
        observation_or_error = probe_results[endpoint]
        if isinstance(observation_or_error, FederationError):
            status_code = getattr(observation_or_error, "status_code", 503)
            unsupported_only = unsupported_only and status_code in {404, 405}
            observations[endpoint] = {
                "reachable": False,
                "error": str(observation_or_error)[:2048],
                "status_code": status_code,
            }
            _record_endpoint_observation(
                member,
                endpoint,
                reachable=False,
                error=str(observation_or_error),
                probe=True,
                probe_unsupported=status_code in {404, 405},
            )
        else:
            successful = True
            unsupported_only = False
            observation = observation_or_error
            observations[endpoint] = {"reachable": True, **observation}
            _record_endpoint_observation(
                member,
                endpoint,
                reachable=True,
                latency_ms=observation["latency_ms"],
                upload_mbps=observation["upload_mbps"],
                download_mbps=observation["download_mbps"],
                throughput_mbps=observation["throughput_mbps"],
                probe=True,
            )
    member.network_probe_at = utc_now()
    known_reachable = any(
        bool(_endpoint_metrics_for_member(member).get(endpoint, {}).get("reachable", False))
        for endpoint in all_endpoints
    )
    if successful or known_reachable:
        _select_best_member_endpoint(member)
        member.reachable = True
        member.connection_status = "connected"
        member.last_error = None
    elif unsupported_only:
        # Older peers can still use the heartbeat/fallback path even before
        # they implement the optional probe endpoint.
        member.last_error = None
    elif not unsupported_only:
        member.reachable = False
        member.connection_status = "offline"
        member.last_error = "No known federation endpoint completed an authenticated network probe"
    db.commit()
    return observations


def _post_member_envelope(
    db: Session,
    settings: Settings,
    member: TranscodeFederationMember,
    route: str,
    payload: dict[str, Any],
    *,
    timeout_seconds: float | None = None,
) -> dict[str, Any]:
    """Post one idempotent secure request, falling back across known endpoints."""

    state = get_federation_state(db, settings)
    request_timeout = (
        float(settings.federation_request_timeout_seconds)
        if timeout_seconds is None
        else max(0.1, float(timeout_seconds))
    )
    failures: list[str] = []
    peer_responded = False
    for endpoint in _ordered_member_endpoints(member):
        started = time.monotonic()
        # A fresh nonce makes a retry through another interface valid even if
        # the first request reached the peer but its response was lost.
        envelope = encrypt_member_response(member, payload)
        try:
            with httpx.Client(timeout=request_timeout) as client:
                response = client.post(
                    _protocol_url(endpoint, route),
                    json=envelope,
                    headers={"X-MediaLyze-Installation-ID": state["installation_id"]},
                )
                response.raise_for_status()
                remote_envelope = response.json()
        except httpx.HTTPStatusError as exc:
            peer_responded = True
            detail = exc.response.text[:500]
            _record_endpoint_observation(
                member,
                endpoint,
                reachable=exc.response.status_code not in {404, 405},
                latency_ms=(time.monotonic() - started) * 1_000,
                error=detail,
            )
            if exc.response.status_code not in {404, 405} and exc.response.status_code < 500:
                db.commit()
                raise FederationError(
                    "Peer rejected the secure federation request",
                    status_code=exc.response.status_code,
                ) from exc
            failures.append(f"{endpoint}: HTTP {exc.response.status_code}")
            continue
        except (httpx.HTTPError, ValueError) as exc:
            _record_endpoint_observation(
                member,
                endpoint,
                reachable=False,
                latency_ms=(time.monotonic() - started) * 1_000,
                error=str(exc),
            )
            failures.append(f"{endpoint}: {exc}")
            continue
        if not isinstance(remote_envelope, dict):
            _record_endpoint_observation(
                member,
                endpoint,
                reachable=False,
                latency_ms=(time.monotonic() - started) * 1_000,
                error="Peer returned an invalid federation response",
            )
            failures.append(f"{endpoint}: invalid response")
            continue
        try:
            with _REPLAY_LOCK:
                result = decrypt_secure_payload(
                    member.shared_secret or "",
                    remote_envelope,
                    seen_nonces=_REPLAY_NONCES,
                )
        except FederationError as exc:
            _record_endpoint_observation(
                member,
                endpoint,
                reachable=False,
                latency_ms=(time.monotonic() - started) * 1_000,
                error=str(exc),
            )
            failures.append(f"{endpoint}: {exc}")
            continue
        _record_endpoint_observation(
            member,
            endpoint,
            reachable=True,
            latency_ms=(time.monotonic() - started) * 1_000,
        )
        member.last_seen_at = utc_now()
        preferred_endpoint = ""
        try:
            preferred_endpoint = normalize_endpoint(str(member.preferred_endpoint_url or ""))
        except (FederationError, ValueError):
            pass
        if not preferred_endpoint or not _endpoint_metrics_for_member(member).get(
            preferred_endpoint,
            {},
        ).get("reachable", True):
            member.preferred_endpoint_url = endpoint
        _select_best_member_endpoint(member)
        return result
    if not peer_responded:
        member.reachable = False
        member.connection_status = "offline"
        member.last_error = "; ".join(failures)[-2048:] or "No known federation endpoint could be reached"
        db.commit()
    message = "; ".join(failures)[-2048:] or "No known federation endpoint completed the request"
    raise FederationError(f"Peer could not be reached through known endpoints: {message}", status_code=503)


def pair_with_peer(
    db: Session,
    settings: Settings,
    endpoint: str,
    pairing_code: str,
    *,
    auto_pair_known: bool = True,
) -> TranscodeFederationMember:
    endpoint = normalize_endpoint(endpoint)
    state = get_federation_state(db, settings)
    if not settings.federation_enabled or not state.get("enabled"):
        raise FederationError("Enable federation before pairing", status_code=409)
    hello = _http_json(settings, endpoint, "hello", {})
    if int(hello.get("protocol_version") or 0) != PROTOCOL_VERSION:
        raise FederationError("Peer uses an incompatible federation protocol", status_code=426)
    if hello.get("installation_id") == state["installation_id"]:
        raise FederationError("An installation cannot pair with itself")
    client_nonce = secrets.token_urlsafe(24)
    descriptor = local_descriptor(db, settings)
    request = {
        **descriptor,
        "pairing_code": pairing_code,
        "client_nonce": client_nonce,
    }
    hello_endpoints = _normalize_endpoint_list(
        hello.get("endpoint_urls")
        if isinstance(hello.get("endpoint_urls"), (list, tuple, set))
        else []
    )
    response: dict[str, Any] | None = None
    pair_endpoints = _normalize_endpoint_list([endpoint, *hello_endpoints])
    for index, pair_endpoint in enumerate(pair_endpoints):
        try:
            response = _http_json(settings, pair_endpoint, "pair", request)
            break
        except FederationError as exc:
            if exc.status_code not in {502, 503, 504}:
                raise
            if index == len(pair_endpoints) - 1:
                raise
    if response is None:
        raise FederationError("Peer could not be reached through its advertised endpoints", status_code=503)
    server_nonce = str(response.get("server_nonce") or "")
    target = dict(response.get("target")) if isinstance(response.get("target"), dict) else dict(hello)
    target_endpoints = target.get("endpoint_urls")
    target["endpoint_urls"] = _normalize_endpoint_list(
        [
            endpoint,
            *hello_endpoints,
            *(
                target_endpoints
                if isinstance(target_endpoints, (list, tuple, set))
                else []
            ),
        ],
    )
    target_id = str(target.get("installation_id") or hello.get("installation_id") or "")
    if not server_nonce or not target_id:
        raise FederationError("Peer returned an incomplete pairing response", status_code=502)
    shared_secret = derive_shared_secret(
        pairing_code,
        client_nonce,
        server_nonce,
        state["installation_id"],
        target_id,
    )
    # Pairing is also the explicit re-admission path for a member that was
    # previously excluded.  Clear the local exclusion before persisting the
    # freshly authenticated member so the next heartbeat is allowed again.
    if target_id in set(state.get("excluded_installation_ids", [])):
        state["excluded_installation_ids"] = [
            item
            for item in state.get("excluded_installation_ids", [])
            if item != target_id
        ]
    setting = db.get(AppSetting, FEDERATION_STATE_KEY)
    if setting is not None:
        setting.value = state
    member = _upsert_member(db, target, shared_secret=shared_secret)
    db.commit()
    try:
        probe_member_endpoints(db, settings, member, force=True)
    except FederationError:
        # Pairing itself is already complete.  A later maintenance heartbeat
        # will retry the authenticated route probes without losing the member.
        logger.info("Federation endpoint probes could not complete after pairing", exc_info=True)
    if auto_pair_known:
        for known in response.get("known_members", []):
            if not isinstance(known, dict) or known.get("installation_id") in {
                state["installation_id"],
                target_id,
            }:
                continue
            urls = _normalize_endpoint_list(
                known.get("endpoint_urls")
                if isinstance(known.get("endpoint_urls"), (list, tuple, set))
                else []
            )
            if not urls:
                continue
            paired = False
            for known_endpoint in urls:
                try:
                    pair_with_peer(db, settings, known_endpoint, pairing_code, auto_pair_known=False)
                    paired = True
                    break
                except FederationError:
                    continue
            if not paired:
                logger.info("Known federation member could not be paired through any advertised endpoint")
    return member


_REPLAY_NONCES: set[str] = set()
_REPLAY_LOCK = threading.Lock()


def _member_for_installation(db: Session, installation_id: str) -> TranscodeFederationMember:
    member = db.scalar(
        select(TranscodeFederationMember).where(
            TranscodeFederationMember.installation_id == installation_id
        )
    )
    if member is None or not member.shared_secret or member.status != "active":
        raise FederationAuthenticationError("Unknown federation member")
    return member


def decrypt_member_request(
    db: Session,
    installation_id: str,
    envelope: dict[str, Any] | TranscodeFederationProtocolSecureEnvelope,
) -> tuple[TranscodeFederationMember, dict[str, Any]]:
    member = _member_for_installation(db, installation_id)
    with _REPLAY_LOCK:
        payload = decrypt_secure_payload(member.shared_secret, envelope, seen_nonces=_REPLAY_NONCES)
    return member, payload


def encrypt_member_response(member: TranscodeFederationMember, payload: dict[str, Any]) -> dict[str, Any]:
    if not member.shared_secret:
        raise FederationAuthenticationError("Federation member has no shared secret")
    return encrypt_secure_payload(member.shared_secret, payload)


def member_heartbeat(
    db: Session,
    settings: Settings,
    member: TranscodeFederationMember,
    payload: dict[str, Any],
) -> dict[str, Any]:
    descriptor = payload.get("descriptor") if isinstance(payload.get("descriptor"), dict) else {}
    if descriptor.get("installation_id") != member.installation_id:
        raise FederationAuthenticationError("Heartbeat installation mismatch")
    state = get_federation_state(db, settings)
    if member.installation_id in set(state.get("excluded_installation_ids", [])):
        raise FederationAuthenticationError("Federation member is excluded")
    remote_excluded = set(
        _normalize_excluded_installation_ids(
            state,
            payload.get("excluded_installation_ids", []),
            ignored_ids=(member.installation_id,),
        )
    )
    if remote_excluded:
        state["excluded_installation_ids"] = _normalize_excluded_installation_ids(
            state,
            [*state.get("excluded_installation_ids", []), *remote_excluded],
        )
        setting = db.get(AppSetting, FEDERATION_STATE_KEY)
        if setting is not None:
            setting.value = state
        for excluded_id in remote_excluded:
            excluded_member = db.scalar(
                select(TranscodeFederationMember).where(
                    TranscodeFederationMember.installation_id == excluded_id
                )
            )
            if excluded_member is not None:
                excluded_member.status = "excluded"
                excluded_member.accept_jobs = False
    _upsert_member(db, descriptor, shared_secret=member.shared_secret)
    for known in payload.get("members", []):
        if isinstance(known, dict) and known.get("installation_id") not in {
            state["installation_id"],
            member.installation_id,
        }:
            _upsert_member(db, known, reachable=bool(known.get("reachable", False)), connection_status="discovered")
    db.commit()
    return {
        "descriptor": local_descriptor(db, settings),
        "excluded_installation_ids": list(state.get("excluded_installation_ids", [])),
        "members": [
            {
                "installation_id": item.installation_id,
                "federation_id": item.federation_id,
                "display_name": item.display_name,
                "endpoint_urls": item.endpoint_urls or [],
                "protocol_version": item.protocol_version,
                "application_version": item.application_version,
                "reachable": item.reachable,
                "accept_jobs": item.accept_jobs,
            }
            for item in db.scalars(select(TranscodeFederationMember)).all()
            if item.installation_id != member.installation_id
        ],
    }


def _member_descriptors(db: Session, local_installation_id: str) -> list[dict[str, Any]]:
    return [
        {
            "installation_id": item.installation_id,
            "federation_id": item.federation_id,
            "display_name": item.display_name,
            "endpoint_urls": item.endpoint_urls or [],
            "protocol_version": item.protocol_version,
            "application_version": item.application_version,
            "reachable": item.reachable,
            "accept_jobs": item.accept_jobs,
        }
        for item in db.scalars(select(TranscodeFederationMember)).all()
        if item.installation_id != local_installation_id and item.status != "excluded"
    ]


def sync_peer(
    db: Session,
    settings: Settings,
    installation_id: str,
    *,
    probe_all: bool = False,
) -> dict[str, Any]:
    """Exchange an authenticated descriptor and optionally refresh routes.

    Heartbeats keep membership state fresh, but do not trigger a periodic
    network benchmark.  The initial full probe is supplied by the runtime on
    startup; later maintenance probes only newly advertised or failed routes.
    """

    member = _member_for_installation(db, installation_id)
    if not _member_endpoint_urls(member):
        raise FederationError("Federation member has no endpoint URL", status_code=503)
    state = get_federation_state(db, settings)
    payload = {
        "descriptor": local_descriptor(db, settings),
        "members": _member_descriptors(db, state["installation_id"]),
        "excluded_installation_ids": list(state.get("excluded_installation_ids", [])),
    }
    result = _post_member_envelope(db, settings, member, "heartbeat", payload)
    descriptor = result.get("descriptor") if isinstance(result.get("descriptor"), dict) else None
    if descriptor:
        _upsert_member(db, descriptor, shared_secret=member.shared_secret)
    for known in result.get("members", []):
        if isinstance(known, dict) and known.get("installation_id") not in {
            state["installation_id"],
            member.installation_id,
        }:
            _upsert_member(db, known, reachable=bool(known.get("reachable", False)), connection_status="discovered")
    remote_excluded = set(
        _normalize_excluded_installation_ids(
            state,
            result.get("excluded_installation_ids", []),
            ignored_ids=(member.installation_id,),
        )
    )
    if remote_excluded:
        state["excluded_installation_ids"] = _normalize_excluded_installation_ids(
            state,
            [*state.get("excluded_installation_ids", []), *remote_excluded],
        )
        setting = db.get(AppSetting, FEDERATION_STATE_KEY)
        if setting is not None:
            setting.value = state
        for excluded_id in remote_excluded:
            excluded_member = db.scalar(
                select(TranscodeFederationMember).where(
                    TranscodeFederationMember.installation_id == excluded_id
                )
            )
            if excluded_member is not None:
                excluded_member.status = "excluded"
                excluded_member.accept_jobs = False
    probe_endpoints = (
        _member_endpoint_urls(member)
        if probe_all
        else _member_endpoint_probe_candidates(member)
    )
    if probe_endpoints:
        try:
            probe_member_endpoints(
                db,
                settings,
                member,
                force=probe_all,
                endpoints=probe_endpoints,
            )
        except FederationError:
            # Heartbeats remain useful when a peer has not implemented the
            # optional probe route or all routes are temporarily unavailable.
            logger.info("Federation endpoint probes could not complete", exc_info=True)
    db.commit()
    return result


def _post_secure_member(
    db: Session,
    settings: Settings,
    member: TranscodeFederationMember,
    route: str,
    payload: dict[str, Any],
    *,
    timeout_seconds: float | None = None,
) -> dict[str, Any]:
    if not member.shared_secret or not member.endpoint_urls:
        raise FederationError("Federation member is not ready for secure requests", status_code=503)
    return _post_member_envelope(
        db,
        settings,
        member,
        route,
        payload,
        timeout_seconds=timeout_seconds,
    )


def test_federation_network(db: Session, settings: Settings) -> None:
    """Run a complete, user-requested route test for every connected member."""

    if not federation_enabled(db, settings):
        raise FederationError("Federation is not enabled on this installation", status_code=409)
    members = db.scalars(
        select(TranscodeFederationMember).where(
            TranscodeFederationMember.status == "active",
            TranscodeFederationMember.connection_status == "connected",
        )
    ).all()
    if not members:
        raise FederationError(
            "No connected federation installation is available for a network test",
            status_code=409,
        )

    failures: list[str] = []
    for member in members:
        try:
            observations = probe_member_endpoints(db, settings, member, force=True)
            if not any(bool(observation.get("reachable")) for observation in observations.values()):
                failures.append(f"{member.display_name}: no known endpoint completed a probe")
        except FederationError as exc:
            failures.append(f"{member.display_name}: {exc}")
    db.commit()
    if failures:
        raise FederationError(
            "Federation network test failed: " + "; ".join(failures)[-1900:],
            status_code=503,
        )


def test_remote_member_capability_matrix(
    db: Session,
    settings: Settings,
    installation_id: str,
) -> TranscodeCapabilityMatrixRead:
    """Run the isolated capability test on one connected federation member."""

    if not federation_enabled(db, settings):
        raise FederationError("Federation is not enabled on this installation", status_code=409)
    member = _remote_member(db, installation_id)
    response = _post_secure_member(
        db,
        settings,
        member,
        "capability-matrix/test",
        {"kind": "capability_matrix_test"},
        timeout_seconds=max(
            float(settings.federation_request_timeout_seconds),
            FEDERATION_CAPABILITY_MATRIX_TIMEOUT_SECONDS,
        ),
    )
    try:
        result = TranscodeCapabilityMatrixRead.model_validate(response.get("capability_matrix"))
    except (TypeError, ValueError) as exc:
        raise FederationError(
            "Peer returned an invalid capability matrix",
            status_code=502,
        ) from exc
    member.capability_matrix = result.model_dump(mode="json")
    member.reachable = True
    member.connection_status = "connected"
    member.last_seen_at = utc_now()
    member.last_sync_at = utc_now()
    member.last_error = None
    db.commit()
    return result


def _transfer_descriptor(transfer: TranscodeTransfer, db: Session) -> dict[str, Any]:
    return {
        "id": transfer.id,
        "direction": transfer.direction,
        "role": transfer.role,
        "relative_name": transfer.relative_name,
        "total_bytes": transfer.total_bytes,
        "transferred_bytes": transfer.transferred_bytes,
        "chunk_size": transfer.chunk_size,
        "sha256": transfer.sha256,
        "status": transfer.status,
        "completed_chunks": sorted(completed_chunk_indices(db, transfer.id)),
    }


def remote_attempt_status(
    db: Session,
    settings: Settings,
    member: TranscodeFederationMember,
    attempt_id: str,
) -> dict[str, Any]:
    state = get_federation_state(db, settings)
    attempt = db.get(TranscodeRemoteAttempt, attempt_id)
    if attempt is None or attempt.origin_installation_id != member.installation_id:
        raise FederationError("Remote attempt not found", status_code=404)
    if attempt.target_installation_id != state["installation_id"]:
        raise FederationAuthenticationError("Remote attempt target mismatch")
    attempt.last_origin_contact_at = utc_now()
    attempt.lease_expires_at = utc_now() + timedelta(seconds=120)
    db.commit()
    transfers = db.scalars(
        select(TranscodeTransfer).where(TranscodeTransfer.attempt_id == attempt.id)
    ).all()
    return {
        "attempt_id": attempt.id,
        "global_job_id": attempt.global_job_id,
        "attempt_number": attempt.attempt_number,
        "status": attempt.status,
        "processing_phase": attempt.processing_phase,
        "phase_detail": attempt.phase_detail,
        "progress_percent": attempt.progress_percent,
        "processed_seconds": attempt.processed_seconds,
        "speed": attempt.speed,
        "eta_seconds": attempt.eta_seconds,
        "source_bytes_total": attempt.source_bytes_total,
        "source_bytes_transferred": attempt.source_bytes_transferred,
        "result_bytes_total": attempt.result_bytes_total,
        "result_bytes_transferred": attempt.result_bytes_transferred,
        "result_transfer_id": attempt.result_transfer_id,
        "result_filename": attempt.result_filename,
        "result_size_bytes": attempt.result_size_bytes,
        "result_sha256": attempt.result_sha256,
        "error": attempt.error,
        "transfers": [_transfer_descriptor(item, db) for item in transfers],
        "lease_expires_at": attempt.lease_expires_at.isoformat(),
    }


def cancel_remote_attempt(
    db: Session,
    settings: Settings,
    member: TranscodeFederationMember,
    attempt_id: str,
) -> dict[str, Any]:
    state = get_federation_state(db, settings)
    attempt = db.get(TranscodeRemoteAttempt, attempt_id)
    if attempt is None or attempt.origin_installation_id != member.installation_id:
        raise FederationError("Remote attempt not found", status_code=404)
    if attempt.target_installation_id != state["installation_id"]:
        raise FederationAuthenticationError("Remote attempt target mismatch")
    if attempt.status not in {"completed", "failed", "canceled"}:
        attempt.status = "canceled"
        attempt.processing_phase = "canceled"
        attempt.finished_at = utc_now()
        attempt.phase_detail = None
        db.commit()
    return remote_attempt_status(db, settings, member, attempt_id)


def read_remote_result_chunk(
    db: Session,
    settings: Settings,
    member: TranscodeFederationMember,
    transfer_id: str,
    chunk_index: int,
) -> dict[str, Any]:
    state = get_federation_state(db, settings)
    transfer = db.get(TranscodeTransfer, transfer_id)
    if transfer is None or transfer.direction != "download":
        raise FederationError("Result transfer not found", status_code=404)
    attempt = db.get(TranscodeRemoteAttempt, transfer.attempt_id)
    if attempt is None or attempt.origin_installation_id != member.installation_id:
        raise FederationAuthenticationError("Result transfer origin mismatch")
    if attempt.target_installation_id != state["installation_id"]:
        raise FederationAuthenticationError("Result transfer target mismatch")
    if attempt.status != "result_ready":
        raise FederationError("Remote result is not ready", status_code=409)
    offset, data = read_transfer_chunk(
        Path(transfer.local_path),
        chunk_index,
        transfer.chunk_size,
        transfer.total_bytes,
    )
    return {
        "transfer_id": transfer_id,
        "chunk_index": chunk_index,
        "offset": offset,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "data": base64.urlsafe_b64encode(data).decode("ascii"),
    }


def _safe_workspace(settings: Settings, global_job_id: str, attempt_id: str) -> Path:
    for candidate in (global_job_id, attempt_id):
        if not candidate or any(char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for char in candidate):
            raise FederationError("Invalid remote workspace identifier")
    workspace = (Path(settings.config_path) / "transcode-federation" / global_job_id / attempt_id).resolve()
    root = (Path(settings.config_path) / "transcode-federation").resolve()
    try:
        workspace.relative_to(root)
    except ValueError as exc:
        raise FederationError("Remote workspace escapes its configured root") from exc
    return workspace


def _workspace_size_bytes(workspace: Path) -> int:
    total = 0
    if not workspace.exists():
        return 0
    try:
        for item in workspace.rglob("*"):
            if item.is_file() and not item.is_symlink():
                total += item.stat().st_size
    except OSError:
        return total
    return total


def ensure_remote_storage_available(
    settings: Settings,
    workspace: Path,
    *,
    additional_bytes: int = 0,
) -> None:
    """Fail a remote attempt with a stable reason when temp storage is tight."""

    usage = _workspace_size_bytes(workspace)
    budget = int(getattr(settings, "federation_temp_budget_bytes", 0) or 0)
    if budget and usage + max(0, int(additional_bytes)) > budget:
        raise FederationError("Remote temporary-space budget is exhausted", status_code=507)
    try:
        free_bytes = shutil.disk_usage(Path(settings.config_path).resolve()).free
    except OSError:
        free_bytes = 0
    if free_bytes and max(0, int(additional_bytes)) > free_bytes:
        raise FederationError("Remote temporary storage is exhausted", status_code=507)


def accept_remote_assignment(
    db: Session,
    settings: Settings,
    member: TranscodeFederationMember,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Accept an origin assignment without creating a local MediaFile/job."""

    state = get_federation_state(db, settings)
    if not state.get("accept_jobs", True):
        raise FederationError("This worker is not accepting remote jobs", status_code=409)
    if payload.get("origin_installation_id") != member.installation_id:
        raise FederationAuthenticationError("Assignment origin mismatch")
    if payload.get("target_installation_id") != state["installation_id"]:
        raise FederationAuthenticationError("Assignment target mismatch")
    attempt_id = str(payload.get("attempt_id") or "")
    global_job_id = str(payload.get("global_job_id") or "")
    source_filename = Path(str(payload.get("source_filename") or "")).name
    if not attempt_id or not global_job_id or not source_filename:
        raise FederationError("Assignment is missing its correlation fields", status_code=422)
    validate_transfer_name(source_filename)
    existing_attempt = db.get(TranscodeRemoteAttempt, attempt_id)
    if existing_attempt is not None:
        if existing_attempt.status == "expired":
            # A direct connection can disappear during a transfer or after a
            # target restart.  Reusing the same attempt preserves its
            # persistent chunk state and cannot publish an old result because
            # the origin still owns the current attempt ID.
            existing_attempt.status = "accepted"
            existing_attempt.processing_phase = "preparing_transfer"
            existing_attempt.phase_detail = "Resuming after the federation connection was restored"
            existing_attempt.error = None
            existing_attempt.finished_at = None
            existing_attempt.last_origin_contact_at = utc_now()
            existing_attempt.lease_expires_at = utc_now() + timedelta(seconds=120)
            db.commit()
        return remote_attempt_status(db, settings, member, attempt_id)
    try:
        plan = TranscodePlan.model_validate(payload.get("plan") or {})
    except ValueError as exc:
        raise FederationError("Assignment contains an invalid structured transcode plan", status_code=422) from exc
    descriptor = local_descriptor(db, settings)
    local_candidate = WorkerCandidate(
        installation_id=str(descriptor["installation_id"]),
        display_name=str(descriptor["display_name"]),
        is_local=False,
        reachable=True,
        accept_jobs=True,
        capabilities=descriptor.get("capabilities", {}),
        capability_matrix=descriptor.get("capability_matrix", {}),
        resources=descriptor.get("resources", {}),
        active_jobs=int(descriptor.get("active_jobs") or 0),
        network_mbps=float(descriptor.get("network_mbps") or 100.0),
    )
    supported, support_reason = worker_supports_plan(local_candidate, plan)
    if not supported:
        raise FederationError(support_reason, status_code=409)
    snapshot = payload.get("source_snapshot")
    if not isinstance(snapshot, dict):
        raise FederationError("Assignment contains no source metadata", status_code=422)
    source_transfer = payload.get("source_transfer")
    if not isinstance(source_transfer, dict):
        raise FederationError("Assignment contains no source transfer", status_code=422)
    source_total = int(source_transfer.get("total_bytes") or 0)
    source_sha256 = str(source_transfer.get("sha256") or "").lower()
    if source_total <= 0 or len(source_sha256) != 64 or any(
        char not in "0123456789abcdef" for char in source_sha256
    ):
        raise FederationError("Assignment contains an invalid source transfer descriptor", status_code=422)
    if int(payload.get("source_size_bytes") or source_total) != source_total:
        raise FederationError("Source transfer size does not match the source snapshot", status_code=422)
    declared_source_hash = str(payload.get("source_sha256") or source_sha256).lower()
    if declared_source_hash != source_sha256:
        raise FederationError("Source transfer checksum does not match the source descriptor", status_code=422)
    source_chunk_size = int(source_transfer.get("chunk_size") or settings.federation_chunk_size_bytes)
    if source_chunk_size < 64 * 1024 or source_chunk_size > 16 * 1024 * 1024:
        raise FederationError("Assignment contains an invalid source chunk size", status_code=422)
    workspace = _safe_workspace(settings, global_job_id, attempt_id)
    required_bytes = source_total
    for item in payload.get("subtitle_transfers", []):
        if isinstance(item, dict):
            required_bytes += int(item.get("total_bytes") or 0)
    required_bytes += required_bytes
    if getattr(settings, "federation_temp_budget_bytes", 0) and required_bytes > int(settings.federation_temp_budget_bytes):
        raise FederationError("Remote assignment exceeds the configured temporary-space budget", status_code=409)
    try:
        free_bytes = shutil.disk_usage(Path(settings.config_path).resolve()).free
    except OSError:
        free_bytes = 0
    if free_bytes and required_bytes > free_bytes:
        raise FederationError("Remote assignment does not fit in available temporary space", status_code=409)
    source_path = workspace / source_filename
    attempt = TranscodeRemoteAttempt(
        id=attempt_id,
        job_id=None,
        global_job_id=global_job_id,
        attempt_number=int(payload.get("attempt_number") or 1),
        origin_installation_id=member.installation_id,
        target_installation_id=state["installation_id"],
        assignment_mode=str(payload.get("assignment_mode") or "automatic"),
        status="accepted",
        processing_phase="preparing_transfer",
        plan=plan.model_dump(mode="json"),
        source_snapshot=snapshot,
        source_filename=source_filename,
        source_size_bytes=int(payload.get("source_size_bytes") or source_total),
        source_sha256=declared_source_hash,
        workspace_path=str(workspace),
        source_bytes_total=source_total,
        lease_token=secrets.token_urlsafe(24),
        lease_expires_at=utc_now() + timedelta(seconds=120),
        last_origin_contact_at=utc_now(),
    )
    db.add(attempt)
    workspace.mkdir(parents=True, exist_ok=True)
    source_id = str(source_transfer.get("id") or "")
    expected_source_id = transfer_id_for_attempt(attempt_id, "upload", "source")
    if source_id != expected_source_id:
        raise FederationAuthenticationError("Source transfer identity mismatch")
    source_row = TranscodeTransfer(
        id=source_id,
        attempt_id=attempt_id,
        direction="upload",
        role="source",
        relative_name=source_filename,
        total_bytes=source_total,
        chunk_size=source_chunk_size,
        sha256=source_sha256,
        status="pending",
        local_path=str(source_path),
    )
    db.add(source_row)
    for item in payload.get("subtitle_transfers", []):
        if not isinstance(item, dict):
            continue
        transfer_id = str(item.get("id") or "")
        role = str(item.get("role") or "")
        expected_id = transfer_id_for_attempt(attempt_id, "upload", role)
        if transfer_id != expected_id:
            raise FederationAuthenticationError("Subtitle transfer identity mismatch")
        relative_name = validate_transfer_name(str(item.get("relative_name") or ""))
        local_path = workspace / relative_name
        subtitle_total = int(item.get("total_bytes") or 0)
        subtitle_sha256 = str(item.get("sha256") or "").lower()
        subtitle_chunk_size = int(item.get("chunk_size") or settings.federation_chunk_size_bytes)
        if subtitle_total <= 0 or len(subtitle_sha256) != 64 or any(
            char not in "0123456789abcdef" for char in subtitle_sha256
        ):
            raise FederationError("Assignment contains an invalid subtitle transfer descriptor", status_code=422)
        if subtitle_chunk_size < 64 * 1024 or subtitle_chunk_size > 16 * 1024 * 1024:
            raise FederationError("Assignment contains an invalid subtitle chunk size", status_code=422)
        db.add(
            TranscodeTransfer(
                id=transfer_id,
                attempt_id=attempt_id,
                direction="upload",
                role=role,
                relative_name=relative_name,
                total_bytes=subtitle_total,
                chunk_size=subtitle_chunk_size,
                sha256=subtitle_sha256,
                status="pending",
                local_path=str(local_path),
            )
        )
    db.commit()
    return remote_attempt_status(db, settings, member, attempt_id)


def _remote_media_object(attempt: TranscodeRemoteAttempt) -> Any:
    """Build a path-isolated MediaFile-shaped object for plan validation only."""

    from types import SimpleNamespace

    snapshot = attempt.source_snapshot if isinstance(attempt.source_snapshot, dict) else {}
    workspace = Path(attempt.workspace_path)
    external = []
    for item in snapshot.get("external_subtitles", []):
        if not isinstance(item, dict):
            continue
        relative_name = validate_transfer_name(str(item.get("path") or ""))
        external.append(
            SimpleNamespace(
                id=int(item.get("id") or 0),
                # Sidecars are transferred below workspace/subtitles/ to keep
                # them separate from the source file.
                path=f"subtitles/{relative_name}",
                language=item.get("language"),
                format=item.get("format"),
            )
        )
    def stream_objects(kind: str) -> list[Any]:
        return [SimpleNamespace(**item) for item in snapshot.get(kind, []) if isinstance(item, dict)]

    return SimpleNamespace(
        id=0,
        library_id=0,
        # The target-side validation path still reads the nullable root
        # identity when it derives the default output layout.  There is no
        # persisted library root on the isolated worker, but the attribute
        # must exist so validation can use the supplied workspace overrides.
        library_root_id=None,
        library_root=SimpleNamespace(path=str(workspace)),
        library=SimpleNamespace(path=str(workspace)),
        relative_path=attempt.source_filename,
        filename=attempt.source_filename,
        extension=Path(attempt.source_filename).suffix.lower(),
        size_bytes=attempt.source_size_bytes,
        mtime=0.0,
        duration_seconds=snapshot.get("duration_seconds"),
        primary_video_codec=snapshot.get("primary_video_codec"),
        primary_video_hdr_type=snapshot.get("primary_video_hdr_type"),
        primary_video_width=snapshot.get("primary_video_width"),
        primary_video_height=snapshot.get("primary_video_height"),
        video_streams=stream_objects("video_streams"),
        audio_streams=stream_objects("audio_streams"),
        subtitle_streams=stream_objects("subtitle_streams"),
        external_subtitles=external,
        has_embedded_cover=bool(snapshot.get("has_embedded_cover")),
        embedded_cover_stream_index=snapshot.get("embedded_cover_stream_index"),
        raw_ffprobe_json=None,
    )


def run_remote_attempt(
    attempt_id: str,
    settings: Settings,
    *,
    is_cancel_requested: Callable[[str], bool] | None = None,
) -> None:
    """Run a target-side attempt after all source chunks have arrived."""

    import subprocess

    from backend.app.services.transcoding import (
        TranscodeCancelled,
        _update_progress,
        validate_transcode_plan,
    )

    db = SessionLocal()
    process: subprocess.Popen[str] | None = None
    reservation: TranscodeResourceReservation | None = None
    last_reservation_renewal = time.monotonic()
    try:
        attempt = db.get(TranscodeRemoteAttempt, attempt_id)
        if attempt is None or attempt.status in {"completed", "failed", "canceled", "result_ready"}:
            return
        uploads = db.scalars(
            select(TranscodeTransfer).where(
                TranscodeTransfer.attempt_id == attempt.id,
                TranscodeTransfer.direction == "upload",
            )
        ).all()
        if not uploads or any(item.status != "complete" for item in uploads):
            attempt.status = "waiting_for_transfer"
            attempt.processing_phase = "transferring_source"
            db.commit()
            return
        for item in uploads:
            if not verify_transfer_checksum(item):
                item.status = "corrupt"
                item.last_error = "Complete transfer checksum mismatch"
                attempt.status = "waiting_for_transfer"
                attempt.processing_phase = "transferring_source"
                db.commit()
                return
        db.commit()
        attempt.status = "running"
        attempt.processing_phase = "preparing_transcode"
        attempt.phase_detail = "Validating the target-side structured plan"
        attempt.heartbeat_at = utc_now()
        db.commit()
        media_file = _remote_media_object(attempt)
        plan = TranscodePlan.model_validate(attempt.plan)
        workspace = Path(attempt.workspace_path)
        output_path = workspace / f".result.{plan.container}.part"
        capabilities = get_transcode_capabilities(settings)
        validation = validate_transcode_plan(
            db,
            settings,
            media_file,
            plan,
            output_path_override=output_path,
            output_root_override=workspace,
            capabilities_override=capabilities,
            device_id_override=plan.target_device_id,
        )
        if not validation.valid:
            raise FederationError("; ".join(validation.errors) or "Target-side plan validation failed", status_code=422)
        if validation.hardware_backend:
            device_id = validation.device_id or f"backend:{validation.hardware_backend}"
            capacity = int(
                getattr(
                    __import__("backend.app.services.app_settings", fromlist=["get_app_settings"])
                    .get_app_settings(db, settings)
                    .transcoding,
                    "gpu_parallel_jobs_per_device",
                    1,
                )
            )
            resource_type = "gpu"
        else:
            capacity = int(transcode_capacity(settings)["cpu_parallel_jobs"])
            device_id = "cpu"
            resource_type = "cpu"
        attempt.processing_phase = "reserving_device"
        attempt.phase_detail = f"Reserving {resource_type} capacity"
        db.commit()
        reservation_reason = f"Waiting for an available {resource_type} resource"
        last_lease_refresh = time.monotonic()
        while reservation is None:
            if is_cancel_requested and is_cancel_requested(attempt_id):
                raise TranscodeCancelled("Remote transcoding was canceled")
            if time.monotonic() - last_lease_refresh >= 5:
                db.commit()
                db.refresh(attempt, attribute_names=["status", "lease_expires_at"])
                last_lease_refresh = time.monotonic()
            if attempt.status == "canceled":
                raise TranscodeCancelled("Remote transcoding was canceled")
            if attempt.status == "expired":
                raise FederationError("Origin heartbeat expired while waiting for a resource", status_code=409)
            if attempt.lease_expires_at < utc_now():
                raise FederationError("Origin heartbeat expired while waiting for a resource", status_code=409)
            try:
                reservation = reserve_resource(
                    db,
                    owner_installation_id=str(get_federation_state(db, settings)["installation_id"]),
                    resource_type=resource_type,
                    device_id=device_id,
                    capacity=max(1, capacity),
                    attempt_id=attempt.id,
                    lease_seconds=60,
                )
                db.commit()
            except FederationError as exc:
                db.rollback()
                if exc.status_code != 409:
                    raise
                attempt = db.get(TranscodeRemoteAttempt, attempt_id)
                if attempt is None:
                    raise FederationError("Remote attempt disappeared while waiting for a resource", status_code=409)
                attempt.processing_phase = "reserving_device"
                attempt.phase_detail = reservation_reason
                attempt.heartbeat_at = utc_now()
                db.commit()
                time.sleep(1.0)
        attempt.processing_phase = "transcoding"
        attempt.phase_detail = "FFmpeg is processing the isolated workspace source"
        db.commit()
        duration = float(attempt.source_snapshot.get("duration_seconds") or 0.0)
        ensure_remote_storage_available(
            settings,
            workspace,
            additional_bytes=max(1024 * 1024, int(attempt.source_size_bytes * 0.65)),
        )
        last_storage_check = time.monotonic()
        last_lease_refresh = time.monotonic()
        process = subprocess.Popen(
            list(validation.ffmpeg_arguments),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=False,
            **__import__("backend.app.utils.processes", fromlist=["get_hidden_subprocess_kwargs"])
            .get_hidden_subprocess_kwargs(),
        )
        if process.stdout is not None:
            for raw_line in process.stdout:
                if is_cancel_requested and is_cancel_requested(attempt_id):
                    raise TranscodeCancelled("Remote transcoding was canceled")
                if time.monotonic() - last_lease_refresh >= 5:
                    db.commit()
                    db.refresh(attempt, attribute_names=["status", "lease_expires_at"])
                    last_lease_refresh = time.monotonic()
                if attempt.status == "canceled":
                    raise TranscodeCancelled("Remote transcoding was canceled")
                if attempt.status == "expired":
                    raise FederationError("Origin heartbeat expired while transcoding", status_code=409)
                if attempt.lease_expires_at < utc_now():
                    raise FederationError("Origin heartbeat expired while transcoding", status_code=409)
                if reservation is not None and time.monotonic() - last_reservation_renewal >= 20:
                    renew_resource_reservation(
                        db,
                        reservation.id,
                        lease_token=reservation.lease_token,
                        lease_seconds=60,
                    )
                    db.commit()
                    last_reservation_renewal = time.monotonic()
                if time.monotonic() - last_storage_check >= 20:
                    ensure_remote_storage_available(settings, workspace, additional_bytes=1024 * 1024)
                    last_storage_check = time.monotonic()
                line = raw_line.strip()
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                _update_progress(attempt, key, value, duration)
                attempt.heartbeat_at = utc_now()
                if key == "progress" or attempt.heartbeat_at.second % 2 == 0:
                    db.commit()
        stderr = process.stderr.read() if process.stderr is not None else ""
        return_code = process.wait()
        if return_code != 0:
            raise RuntimeError((stderr or f"FFmpeg exited with code {return_code}").strip()[-32000:])
        if not output_path.exists() or output_path.stat().st_size <= 0:
            raise RuntimeError("Target FFmpeg completed without producing a result")
        result_hash = sha256_file(output_path)
        result_transfer = create_transfer(
            db,
            attempt,
            direction="download",
            role="result",
            relative_name=f"result.{plan.container}",
            local_path=output_path,
            total_bytes=output_path.stat().st_size,
            sha256=result_hash,
            chunk_size=int(getattr(settings, "federation_chunk_size_bytes", 1024 * 1024)),
        )
        result_transfer.status = "ready"
        attempt.result_path = str(output_path)
        attempt.result_filename = result_transfer.relative_name
        attempt.result_size_bytes = result_transfer.total_bytes
        attempt.result_sha256 = result_hash
        attempt.result_transfer_id = result_transfer.id
        attempt.result_bytes_total = result_transfer.total_bytes
        attempt.status = "result_ready"
        attempt.processing_phase = "preparing_result_transfer"
        attempt.phase_detail = "Result is ready for resumable transfer to the origin"
        attempt.progress_percent = 100.0
        attempt.finished_at = utc_now()
        db.commit()
    except TranscodeCancelled as exc:
        if process is not None and process.poll() is None:
            process.kill()
        attempt = db.get(TranscodeRemoteAttempt, attempt_id)
        if attempt is not None:
            attempt.status = "canceled"
            attempt.processing_phase = "canceled"
            attempt.error = str(exc)
            attempt.finished_at = utc_now()
            db.commit()
    except FederationError as exc:
        # A lost origin heartbeat expires the attempt instead of turning a
        # recoverable network interruption into a permanent failure.  The
        # origin can resubmit the same deterministic attempt and resume its
        # completed chunks after the peer returns.
        if process is not None and process.poll() is None:
            process.kill()
        attempt = db.get(TranscodeRemoteAttempt, attempt_id)
        if attempt is not None:
            attempt.status = "expired" if exc.status_code == 409 else "failed"
            attempt.processing_phase = "failed"
            attempt.error = (str(exc) or exc.__class__.__name__)[-32000:]
            attempt.finished_at = utc_now()
            db.commit()
    except Exception as exc:
        if process is not None and process.poll() is None:
            process.kill()
        attempt = db.get(TranscodeRemoteAttempt, attempt_id)
        if attempt is not None:
            attempt.status = "failed"
            attempt.processing_phase = "failed"
            attempt.error = (str(exc) or exc.__class__.__name__)[-32000:]
            attempt.finished_at = utc_now()
            db.commit()
    finally:
        if reservation is not None:
            try:
                release_resource_reservation(db, reservation.id, lease_token=reservation.lease_token)
                db.commit()
            except Exception:
                db.rollback()
        db.close()


def build_remote_assignment(
    db: Session,
    settings: Settings,
    job: TranscodeJob,
) -> dict[str, Any]:
    """Reconstruct the wire assignment from persisted origin rows."""

    if not job.remote_attempt_id or not job.target_installation_id:
        raise FederationError("Transcode job has no remote attempt", status_code=409)
    attempt = db.get(TranscodeRemoteAttempt, job.remote_attempt_id)
    if attempt is None:
        raise FederationError("Remote attempt is missing", status_code=409)
    transfers = db.scalars(
        select(TranscodeTransfer).where(TranscodeTransfer.attempt_id == attempt.id)
    ).all()
    source_transfer = next((item for item in transfers if item.role == "source"), None)
    if source_transfer is None:
        raise FederationError("Remote attempt has no source transfer", status_code=409)
    source = db.get(__import__("backend.app.models.entities", fromlist=["MediaFile"]).MediaFile, job.source_file_id)
    if source is None:
        raise FederationError("Transcode source file no longer exists", status_code=409)
    subtitle_transfers = [
        {
            "id": item.id,
            "direction": item.direction,
            "role": item.role,
            "relative_name": item.relative_name,
            "total_bytes": item.total_bytes,
            "sha256": item.sha256,
            "chunk_size": item.chunk_size,
            "subtitle_id": int(item.role.split("-", 1)[1])
            if item.role.startswith("subtitle-") and item.role.split("-", 1)[1].isdigit()
            else None,
        }
        for item in transfers
        if item.role.startswith("subtitle-")
    ]
    return {
        "attempt_id": attempt.id,
        "global_job_id": attempt.global_job_id,
        "attempt_number": attempt.attempt_number,
        "origin_installation_id": attempt.origin_installation_id,
        "target_installation_id": attempt.target_installation_id,
        "assignment_mode": attempt.assignment_mode,
        "plan": attempt.plan,
        "source_snapshot": attempt.source_snapshot,
        "source_transfer": _transfer_descriptor(source_transfer, db),
        "subtitle_transfers": subtitle_transfers,
        "source_size_bytes": attempt.source_size_bytes,
        "source_sha256": attempt.source_sha256,
        "source_filename": attempt.source_filename,
        "lease_token": attempt.lease_token,
    }


def post_remote_assignment(
    db: Session,
    settings: Settings,
    job: TranscodeJob,
) -> dict[str, Any]:
    member = _remote_member(db, str(job.target_installation_id))
    payload = build_remote_assignment(db, settings, job)
    response = _post_secure_member(db, settings, member, "jobs/assign", payload)
    attempt_id = str(response.get("attempt_id") or job.remote_attempt_id or "")
    if attempt_id != job.remote_attempt_id:
        raise FederationError("Target returned a different remote attempt id", status_code=502)
    return response


def send_remote_transfer_chunk(
    db: Session,
    settings: Settings,
    job: TranscodeJob,
    transfer: TranscodeTransfer,
    *,
    chunk_index: int,
) -> dict[str, Any]:
    member = _remote_member(db, str(job.target_installation_id))
    offset, data = read_transfer_chunk(
        Path(transfer.local_path),
        chunk_index,
        transfer.chunk_size,
        transfer.total_bytes,
    )
    payload = {
        "transfer_id": transfer.id,
        "attempt_id": transfer.attempt_id,
        "chunk_index": chunk_index,
        "offset": offset,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "data": base64.urlsafe_b64encode(data).decode("ascii"),
    }
    response = _post_secure_member(
        db,
        settings,
        member,
        f"transfers/{transfer.id}/chunk",
        payload,
    )
    record = db.scalar(
        select(TranscodeTransferChunk).where(
            TranscodeTransferChunk.transfer_id == transfer.id,
            TranscodeTransferChunk.chunk_index == chunk_index,
        )
    )
    if record is None:
        db.add(
            TranscodeTransferChunk(
                transfer_id=transfer.id,
                chunk_index=chunk_index,
                offset=offset,
                size=len(data),
                sha256=payload["sha256"],
                verified=True,
            )
        )
    transfer.transferred_bytes = min(
        transfer.total_bytes,
        int(response.get("transferred_bytes") or transfer.transferred_bytes + len(data)),
    )
    transfer.status = "complete" if transfer.transferred_bytes >= transfer.total_bytes else "transferring"
    db.commit()
    return response


def fetch_remote_result_chunk(
    db: Session,
    settings: Settings,
    job: TranscodeJob,
    transfer: TranscodeTransfer,
    *,
    chunk_index: int,
) -> dict[str, Any]:
    member = _remote_member(db, str(job.target_installation_id))
    response = _post_secure_member(
        db,
        settings,
        member,
        f"transfers/{transfer.id}/read",
        {"transfer_id": transfer.id, "chunk_index": chunk_index},
    )
    return response


def remote_attempt_status_from_origin(
    db: Session,
    settings: Settings,
    job: TranscodeJob,
) -> dict[str, Any]:
    member = _remote_member(db, str(job.target_installation_id))
    return _post_secure_member(
        db,
        settings,
        member,
        f"jobs/{job.remote_attempt_id}/status",
        {"attempt_id": job.remote_attempt_id},
    )


def cancel_remote_attempt_from_origin(
    db: Session,
    settings: Settings,
    job: TranscodeJob,
) -> dict[str, Any]:
    member = _remote_member(db, str(job.target_installation_id))
    return _post_secure_member(
        db,
        settings,
        member,
        f"jobs/{job.remote_attempt_id}/cancel",
        {"attempt_id": job.remote_attempt_id},
    )


def _copy_remote_progress_to_job(job: TranscodeJob, status: dict[str, Any]) -> None:
    job.processing_phase = str(status.get("processing_phase") or job.processing_phase or "queued")
    job.phase_detail = status.get("phase_detail")
    job.progress_percent = float(status.get("progress_percent") or 0.0)
    job.processed_seconds = float(status.get("processed_seconds") or 0.0)
    job.speed = status.get("speed")
    job.eta_seconds = status.get("eta_seconds")
    job.source_transfer_bytes = int(status.get("source_bytes_transferred") or job.source_transfer_bytes or 0)
    job.source_transfer_total_bytes = int(status.get("source_bytes_total") or job.source_transfer_total_bytes or 0)
    job.result_transfer_bytes = int(status.get("result_bytes_transferred") or job.result_transfer_bytes or 0)
    job.result_transfer_total_bytes = int(status.get("result_bytes_total") or job.result_transfer_total_bytes or 0)


def _mark_remote_job_failed(db: Session, job: TranscodeJob, error: str, *, canceled: bool = False) -> int:
    job.status = JobStatus.canceled if canceled else JobStatus.failed
    job.processing_phase = "canceled" if canceled else "failed"
    job.phase_detail = None
    job.error = error[-32000:]
    job.finished_at = utc_now()
    db.commit()
    return job.library_id


def execute_remote_transcode_job(
    job_id: int,
    settings: Settings,
    *,
    is_cancel_requested: Any,
) -> int:
    """Origin-side orchestration with resumable upload/download chunks."""

    from backend.app.models.entities import MediaFile, TranscodeVariant
    from backend.app.services.transcoding import _publish_without_overwrite

    db = SessionLocal()
    try:
        job = db.get(TranscodeJob, job_id)
        if job is None:
            raise ValueError("Transcoding job not found")
        if job.status != JobStatus.queued:
            return job.library_id
        attempt = db.get(TranscodeRemoteAttempt, job.remote_attempt_id)
        if attempt is None:
            return _mark_remote_job_failed(db, job, "Remote attempt is missing")
        job.status = JobStatus.running
        job.started_at = utc_now()
        job.attempt = (job.attempt or 0) + 1
        job.execution_attempt = (job.execution_attempt or 0) + 1
        job.processing_phase = "selecting_worker"
        job.phase_detail = "Contacting the selected federation worker"
        job.error = None
        db.commit()
        if is_cancel_requested(job_id):
            return _mark_remote_job_failed(db, job, "Remote transcoding was canceled", canceled=True)
        assignment_status = post_remote_assignment(db, settings, job)
        _copy_remote_progress_to_job(job, assignment_status)
        db.commit()
        if assignment_status.get("status") in {"failed", "canceled"}:
            return _mark_remote_job_failed(
                db,
                job,
                str(assignment_status.get("error") or "Remote worker rejected the attempt"),
                canceled=assignment_status.get("status") == "canceled",
            )
        transfers = db.scalars(
            select(TranscodeTransfer).where(
                TranscodeTransfer.attempt_id == attempt.id,
                TranscodeTransfer.direction == "upload",
            )
        ).all()
        for transfer in transfers:
            if transfer.status == "complete":
                continue
            job.processing_phase = "transferring_source"
            job.phase_detail = f"Transferring {transfer.relative_name}"
            if transfer.role == "source":
                job.source_transfer_id = transfer.id
                job.source_transfer_total_bytes = transfer.total_bytes
            db.commit()
            completed = set(assignment_status.get("completed_chunks", []))
            status_transfers = assignment_status.get("transfers")
            if isinstance(status_transfers, list):
                remote_transfer = next(
                    (item for item in status_transfers if isinstance(item, dict) and item.get("id") == transfer.id),
                    None,
                )
                if remote_transfer:
                    completed.update(int(item) for item in remote_transfer.get("completed_chunks", []))
            started = time.monotonic()
            sent_bytes = 0
            for index in range(chunk_count(transfer.total_bytes, transfer.chunk_size)):
                if index in completed:
                    continue
                if is_cancel_requested(job_id):
                    try:
                        cancel_remote_attempt_from_origin(db, settings, job)
                    except FederationError:
                        logger.info("Remote cancellation request could not reach target", exc_info=True)
                    return _mark_remote_job_failed(db, job, "Remote transcoding was canceled", canceled=True)
                response = send_remote_transfer_chunk(
                    db,
                    settings,
                    job,
                    transfer,
                    chunk_index=index,
                )
                sent_bytes = max(sent_bytes, int(response.get("transferred_bytes") or 0))
                if transfer.role == "source":
                    job.source_transfer_bytes = sent_bytes
                elapsed = max(0.001, time.monotonic() - started)
                job.transfer_speed_bytes_per_second = sent_bytes / elapsed
                remaining = max(0, transfer.total_bytes - sent_bytes)
                job.transfer_eta_seconds = remaining / job.transfer_speed_bytes_per_second if job.transfer_speed_bytes_per_second else None
                db.commit()
            if sent_bytes > 0:
                member = _remote_member(db, str(job.target_installation_id))
                record_network_metric(
                    db,
                    member,
                    direction="upload",
                    bytes_transferred=sent_bytes,
                    duration_seconds=max(0.001, time.monotonic() - started),
                    endpoint_url=member.preferred_endpoint_url,
                )
            transfer.transferred_bytes = transfer.total_bytes
            transfer.status = "complete"
            db.commit()
        job.processing_phase = "preparing_transcode"
        job.phase_detail = "The federation worker is preparing the target-side transcode"
        db.commit()
        while True:
            if is_cancel_requested(job_id):
                try:
                    cancel_remote_attempt_from_origin(db, settings, job)
                except FederationError:
                    logger.info("Remote cancellation request could not reach target", exc_info=True)
                return _mark_remote_job_failed(db, job, "Remote transcoding was canceled", canceled=True)
            status = remote_attempt_status_from_origin(db, settings, job)
            _copy_remote_progress_to_job(job, status)
            remote_state = str(status.get("status") or "")
            if remote_state == "result_ready":
                db.commit()
                break
            if remote_state == "expired":
                job.status = JobStatus.queued
                job.processing_phase = "selecting_worker"
                job.phase_detail = "Waiting to resume after the federation lease expired"
                job.error = None
                db.commit()
                return job.library_id
            if remote_state in {"failed", "canceled"}:
                return _mark_remote_job_failed(
                    db,
                    job,
                    str(status.get("error") or "Remote worker did not complete the transcode"),
                    canceled=remote_state == "canceled",
                )
            db.commit()
            time.sleep(1.0)
        remote_transfer_id = str(status.get("result_transfer_id") or "")
        result_total = int(status.get("result_size_bytes") or status.get("result_bytes_total") or 0)
        result_sha = str(status.get("result_sha256") or "")
        if not remote_transfer_id or result_total <= 0 or len(result_sha) != 64:
            return _mark_remote_job_failed(db, job, "Remote worker returned an incomplete result descriptor")
        result_transfer = db.get(TranscodeTransfer, transfer_id_for_attempt(attempt.id, "download", "result"))
        if result_transfer is None:
            result_transfer = create_transfer(
                db,
                attempt,
                direction="download",
                role="result",
                relative_name=str(status.get("result_filename") or "result"),
                local_path=Path(job.temporary_path or ""),
                total_bytes=result_total,
                sha256=result_sha,
                chunk_size=int(getattr(settings, "federation_chunk_size_bytes", 1024 * 1024)),
            )
        job.result_transfer_id = result_transfer.id
        job.result_transfer_total_bytes = result_total
        job.processing_phase = "transferring_result"
        job.phase_detail = "Transferring the validated result back to the origin"
        db.commit()
        started = time.monotonic()
        for index in range(chunk_count(result_total, result_transfer.chunk_size)):
            if is_cancel_requested(job_id):
                try:
                    cancel_remote_attempt_from_origin(db, settings, job)
                except FederationError:
                    logger.info("Remote cancellation request could not reach target", exc_info=True)
                return _mark_remote_job_failed(db, job, "Remote result transfer was canceled", canceled=True)
            completed = completed_chunk_indices(db, result_transfer.id)
            if index in completed:
                continue
            response = fetch_remote_result_chunk(
                db,
                settings,
                job,
                result_transfer,
                chunk_index=index,
            )
            data = base64.urlsafe_b64decode(str(response.get("data") or "").encode("ascii"))
            record_transfer_chunk(
                db,
                result_transfer,
                chunk_index=index,
                offset=int(response.get("offset") or index * result_transfer.chunk_size),
                data=data,
                sha256=str(response.get("sha256") or ""),
            )
            job.result_transfer_bytes = result_transfer.transferred_bytes
            elapsed = max(0.001, time.monotonic() - started)
            job.transfer_speed_bytes_per_second = result_transfer.transferred_bytes / elapsed
            remaining = max(0, result_total - result_transfer.transferred_bytes)
            job.transfer_eta_seconds = remaining / job.transfer_speed_bytes_per_second if job.transfer_speed_bytes_per_second else None
            db.commit()
        if result_transfer.transferred_bytes > 0:
            member = _remote_member(db, str(job.target_installation_id))
            record_network_metric(
                db,
                member,
                direction="download",
                bytes_transferred=result_transfer.transferred_bytes,
                duration_seconds=max(0.001, time.monotonic() - started),
                endpoint_url=member.preferred_endpoint_url,
            )
            db.commit()
        if not verify_transfer_checksum(result_transfer):
            return _mark_remote_job_failed(db, job, "Remote result checksum verification failed")
        source = db.get(MediaFile, job.source_file_id) if job.source_file_id else None
        source_path = Path(job.source_path_snapshot)
        current_stat = source_path.stat()
        if current_stat.st_size != job.source_size_snapshot or current_stat.st_mtime != job.source_mtime_snapshot:
            return _mark_remote_job_failed(db, job, "The source file changed while the remote job was running")
        output_path = Path(job.output_path_snapshot)
        job.processing_phase = "validating_result"
        job.phase_detail = "Validating the complete result checksum and source snapshot"
        db.commit()
        if job.output_mode == "replace_original":
            job.processing_phase = "publishing"
            os.replace(Path(result_transfer.local_path), output_path)
        else:
            job.processing_phase = "publishing"
            _publish_without_overwrite(Path(result_transfer.local_path), output_path)
        if source is not None:
            variant = TranscodeVariant(
                group_id=job.group_id,
                job_id=job.id,
                original_file_id=job.source_file_id,
                library_root_id=source.library_root_id,
                output_relative_path=job.output_relative_path,
                output_filename=output_path.name,
                source_path_snapshot=job.source_path_snapshot,
                output_path_snapshot=job.output_path_snapshot,
                output_mode=job.output_mode,
                analysis_status="awaiting_analysis",
                output_file_id=source.id if job.output_mode == "replace_original" else None,
            )
            if job.output_mode == "replace_original":
                source.is_transcode_variant = False
                job.result_file_id = source.id
            db.add(variant)
        job.status = JobStatus.completed
        job.processing_phase = "completed"
        job.phase_detail = None
        job.progress_percent = 100.0
        job.result_transfer_bytes = result_total
        job.result_transfer_total_bytes = result_total
        job.transfer_eta_seconds = 0.0
        job.finished_at = utc_now()
        db.commit()
        return job.library_id
    except FederationError as exc:
        job = db.get(TranscodeJob, job_id)
        if job is not None and exc.status_code in {502, 503, 504} and job.status not in {
            JobStatus.completed,
            JobStatus.canceled,
        }:
            job.status = JobStatus.queued
            job.processing_phase = "selecting_worker"
            job.phase_detail = f"Waiting for the selected federation worker: {str(exc)[:512]}"
            job.error = None
            db.commit()
            return job.library_id
        if job is not None and job.status not in {JobStatus.completed, JobStatus.canceled}:
            return _mark_remote_job_failed(db, job, str(exc) or exc.__class__.__name__)
        raise
    except Exception as exc:
        job = db.get(TranscodeJob, job_id)
        if job is not None and job.status not in {JobStatus.completed, JobStatus.canceled}:
            return _mark_remote_job_failed(db, job, str(exc) or exc.__class__.__name__)
        raise
    finally:
        db.close()


def mark_member_offline(db: Session, installation_id: str, error: str) -> None:
    member = db.scalar(
        select(TranscodeFederationMember).where(
            TranscodeFederationMember.installation_id == installation_id
        )
    )
    if member is None:
        return
    member.reachable = False
    member.connection_status = "offline"
    member.last_error = error[:2048]
    db.commit()


def record_network_metric(
    db: Session,
    member: TranscodeFederationMember,
    *,
    direction: str,
    bytes_transferred: int,
    duration_seconds: float,
    endpoint_url: str | None = None,
) -> None:
    if direction not in {"upload", "download"} or bytes_transferred <= 0 or duration_seconds <= 0:
        return
    measured_mbps = max(0.01, min(100000.0, bytes_transferred * 8 / duration_seconds / 1_000_000))
    db.add(
        TranscodeNetworkMetric(
            member_id=member.id,
            direction=direction,
            bytes_transferred=int(bytes_transferred),
            duration_seconds=float(duration_seconds),
            measured_mbps=measured_mbps,
        )
    )
    # A recent measured transfer should influence scheduling quickly without
    # making one small transfer an unbounded speed ranking.
    previous = float(member.network_mbps or 0.0)
    member.network_mbps = measured_mbps if previous <= 0 else (previous * 0.35 + measured_mbps * 0.65)
    if endpoint_url:
        _record_endpoint_observation(
            member,
            endpoint_url,
            reachable=True,
            upload_mbps=measured_mbps if direction == "upload" else None,
            download_mbps=measured_mbps if direction == "download" else None,
        )
        _select_best_member_endpoint(member)


def cleanup_federation_attempts(db: Session, settings: Settings, *, now: datetime | None = None) -> int:
    """Expire stale target attempts and remove only their private workspaces."""

    current = now or utc_now()
    root = (Path(settings.config_path) / "transcode-federation").resolve()
    retention = timedelta(hours=max(1, int(getattr(settings, "federation_result_retention_hours", 24))))
    removed = 0
    attempts = db.scalars(select(TranscodeRemoteAttempt)).all()
    for attempt in attempts:
        workspace = Path(attempt.workspace_path)
        try:
            workspace.resolve().relative_to(root)
        except ValueError:
            # Origin rows point at the normal output directory and are not
            # owned by target-side federation cleanup.
            continue
        if attempt.status in {"accepted", "waiting_for_transfer", "running"} and attempt.lease_expires_at < current:
            attempt.status = "expired"
            attempt.processing_phase = "failed"
            attempt.phase_detail = None
            attempt.error = "Remote execution lease expired before completion"
            attempt.finished_at = current
        terminal_at = attempt.finished_at or attempt.updated_at or attempt.created_at
        if attempt.status in {"completed", "failed", "canceled", "expired"} and terminal_at < current - retention:
            try:
                shutil.rmtree(workspace, ignore_errors=True)
            except OSError:
                logger.info("Unable to remove expired federation workspace %s", workspace, exc_info=True)
            if attempt.job_id is None:
                db.delete(attempt)
                removed += 1
    if removed or any(
        attempt.status == "expired" and attempt.finished_at == current
        for attempt in attempts
    ):
        db.commit()
    return removed


def exclude_member(db: Session, settings: Settings, installation_id: str) -> None:
    state = get_federation_state(db, settings)
    excluded = set(state.get("excluded_installation_ids", []))
    excluded.add(installation_id)
    state["excluded_installation_ids"] = sorted(excluded)
    setting = db.get(AppSetting, FEDERATION_STATE_KEY)
    if setting is not None:
        setting.value = state
    member = db.scalar(
        select(TranscodeFederationMember).where(
            TranscodeFederationMember.installation_id == installation_id
        )
    )
    if member is not None:
        member.status = "excluded"
        member.accept_jobs = False
    db.commit()


def discovery_payload(descriptor: dict[str, Any]) -> dict[str, Any]:
    return {
        "message": DISCOVERY_MESSAGE,
        "protocol_version": PROTOCOL_VERSION,
        "application_version": descriptor.get("application_version"),
        "installation_id": descriptor.get("installation_id"),
        "federation_id": descriptor.get("federation_id"),
        "display_name": descriptor.get("display_name"),
        "endpoint_urls": descriptor.get("endpoint_urls", []),
    }


def _local_discovery_host(peer_address: tuple[str, int]) -> str | None:
    """Resolve the local interface that can answer a particular peer."""

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route_socket:
            route_socket.connect(peer_address)
            return str(route_socket.getsockname()[0])
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return None


def discover_peers(
    settings: Settings,
    descriptor: dict[str, Any],
    *,
    timeout_seconds: float = 0.75,
) -> list[dict[str, Any]]:
    """Discover direct LAN peers without presenting this installation as a peer."""

    found: dict[str, dict[str, Any]] = {}
    packet = json.dumps(discovery_payload(descriptor), separators=(",", ":")).encode("utf-8")
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.settimeout(min(2.0, max(0.1, timeout_seconds)))
            sock.sendto(packet, ("255.255.255.255", int(settings.federation_discovery_port)))
            deadline = time.monotonic() + max(0.1, timeout_seconds)
            while time.monotonic() < deadline:
                try:
                    raw, _address = sock.recvfrom(65535)
                except socket.timeout:
                    break
                try:
                    peer = json.loads(raw.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    continue
                if peer.get("message") != DISCOVERY_MESSAGE:
                    continue
                if peer.get("installation_id") == descriptor.get("installation_id"):
                    continue
                installation_id = str(peer.get("installation_id") or "")
                if installation_id:
                    found[installation_id] = peer
    except OSError as exc:
        logger.info("Federation UDP discovery unavailable: %s", exc)
    return list(found.values())


class DiscoveryResponder:
    """Small opt-in UDP responder used by server and desktop runtimes."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="medialyze-federation-discovery", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        self._thread = None

    def _run(self) -> None:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("", int(self.settings.federation_discovery_port)))
            sock.settimeout(0.5)
        except OSError as exc:
            logger.info("Federation discovery responder unavailable: %s", exc)
            return
        with sock:
            while not self._stop.is_set():
                try:
                    raw, address = sock.recvfrom(65535)
                    request = json.loads(raw.decode("utf-8"))
                except socket.timeout:
                    continue
                except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                    continue
                if request.get("message") != DISCOVERY_MESSAGE:
                    continue
                db = SessionLocal()
                try:
                    descriptor = local_descriptor(db, self.settings)
                    response = discovery_payload(descriptor)
                    host = _local_discovery_host(address)
                    if host:
                        response["endpoint_urls"] = _merge_endpoint_urls(
                            response.get("endpoint_urls") or [],
                            [_format_local_endpoint(host, int(self.settings.federation_port))],
                        )
                    sock.sendto(json.dumps(response).encode("utf-8"), address)
                except OSError:
                    break
                except Exception:
                    logger.debug("Federation discovery response failed", exc_info=True)
                finally:
                    db.close()


def _candidate_capabilities(candidate: WorkerCandidate) -> TranscodeCapabilitiesRead | None:
    """Parse a worker descriptor without trusting incomplete peer state."""

    raw = dict(candidate.capabilities) if isinstance(candidate.capabilities, dict) else {}
    raw.setdefault("ffmpeg_available", True)
    raw.setdefault("ffmpeg_path", "ffmpeg")
    raw_encoders = raw.get("encoders")
    if isinstance(raw_encoders, list):
        normalized_encoders: list[dict[str, Any]] = []
        for item in raw_encoders:
            if not isinstance(item, dict):
                continue
            normalized = dict(item)
            if not normalized.get("codec") and normalized.get("name"):
                normalized["codec"] = _encoder_codec(str(normalized["name"])) or str(normalized["name"])
            normalized_encoders.append(normalized)
        raw["encoders"] = normalized_encoders
    try:
        return TranscodeCapabilitiesRead.model_validate(raw)
    except ValueError:
        return None


def _resolve_worker_plan(
    candidate: WorkerCandidate,
    plan: TranscodePlan,
) -> tuple[TranscodeCapabilitiesRead | None, TranscodePlan | None, str | None]:
    capabilities = _candidate_capabilities(candidate)
    if capabilities is None:
        return None, None, "Worker capability data is incomplete"
    if not capabilities.ffmpeg_available:
        return capabilities, None, capabilities.error or "FFmpeg is unavailable on this worker"
    execution_mode = plan.execution_mode or "hardware_required"
    resolved_plan, errors = resolve_transcode_plan_encoders(
        plan,
        capabilities,
        execution_mode=execution_mode,
        target_device_id=plan.target_device_id,
        force_auto=plan.target_mode != "local",
    )
    if errors:
        return capabilities, None, "; ".join(errors)
    return capabilities, resolved_plan, None


def _capability_encoders(candidate: WorkerCandidate) -> list[dict[str, Any]]:
    values = candidate.capabilities.get("encoders") if isinstance(candidate.capabilities, dict) else []
    return [item for item in values if isinstance(item, dict)]


def _is_hardware_encoder(encoder: str) -> bool:
    return any(encoder.lower().endswith(marker) for marker in HARDWARE_ENCODER_MARKERS)


def _worker_resource_allowed(candidate: WorkerCandidate, plan: TranscodePlan, requested: list[str]) -> tuple[bool, str]:
    """Apply the target member's foreign-job resource policy.

    Local policy is intentionally ignored here: local jobs are governed by
    the existing transcode settings and the same database reservations.  The
    policy only limits work originating on another installation.
    """

    if candidate.is_local:
        return True, "Local resources are governed by local transcode settings"
    resources = candidate.resources if isinstance(candidate.resources, dict) else {}
    policy = resources.get("resource_policy") if isinstance(resources.get("resource_policy"), dict) else {}
    if not requested or not any(_is_hardware_encoder(item) for item in requested):
        if policy.get("cpu", True) is False:
            return False, "This member does not accept foreign CPU jobs"
        return True, "CPU resource is enabled"
    gpu_policy = policy.get("gpu") if isinstance(policy.get("gpu"), dict) else {}
    if plan.target_device_id and gpu_policy.get(plan.target_device_id) is False:
        return False, "The selected GPU is not enabled for foreign jobs"
    if plan.target_device_id:
        return True, "The selected GPU is enabled"
    devices = resources.get("gpu_devices") if isinstance(resources.get("gpu_devices"), list) else []
    enabled_devices = [
        item for item in devices
        if isinstance(item, dict)
        and item.get("status") == "available"
        and item.get("id")
        and item.get("accepted", gpu_policy.get(str(item.get("id")), True)) is not False
    ]
    if devices and not enabled_devices:
        return False, "This member has no GPU enabled for foreign jobs"
    if gpu_policy and all(value is False for value in gpu_policy.values()):
        return False, "This member has no GPU enabled for foreign jobs"
    return True, "A compatible GPU is enabled"


def _worker_supports_resolved_plan(
    candidate: WorkerCandidate,
    plan: TranscodePlan,
    capabilities: TranscodeCapabilitiesRead,
) -> tuple[bool, str]:
    encoders = {item.name: item for item in capabilities.encoders}
    requested = [
        str(item.encoder or "")
        for item in plan.video_streams
        if item.action == "encode" and item.encoder
    ]
    if plan.execution_mode == "cpu_only" and any(_is_hardware_encoder(item) for item in requested):
        return False, "Plan requests a hardware encoder in CPU-only mode"
    if plan.execution_mode == "hardware_required" and requested and not any(
        _is_hardware_encoder(item) for item in requested
    ):
        return False, "Plan does not contain a hardware encoder"
    resource_allowed, resource_reason = _worker_resource_allowed(candidate, plan, requested)
    if not resource_allowed:
        return False, resource_reason
    if plan.target_device_id == "cpu" and any(_is_hardware_encoder(item) for item in requested):
        return False, "The selected CPU cannot execute a hardware encoder plan"
    for encoder in requested:
        capability = encoders.get(encoder)
        if capability is None or capability.available is False:
            return False, f"Encoder {encoder} is not available on this worker"
        if plan.target_device_id and capability.device_ids and plan.target_device_id not in capability.device_ids:
            return False, f"Encoder {encoder} is not available on the selected device"
    return True, "Automatically selected encoders are available"


def worker_supports_plan(candidate: WorkerCandidate, plan: TranscodePlan) -> tuple[bool, str]:
    if not candidate.reachable or (not candidate.is_local and not candidate.accept_jobs):
        return False, "Worker is offline or does not accept jobs"
    capabilities, resolved_plan, resolution_error = _resolve_worker_plan(candidate, plan)
    if capabilities is None or resolved_plan is None:
        return False, resolution_error or "Worker cannot resolve this transcode plan"
    return _worker_supports_resolved_plan(candidate, resolved_plan, capabilities)


def estimate_worker_finish_seconds(
    candidate: WorkerCandidate,
    *,
    source_size_bytes: int,
    duration_seconds: float,
    output_size_ratio: float = 0.65,
) -> float:
    source_size = max(0, int(source_size_bytes))
    duration = max(0.0, float(duration_seconds))
    if candidate.is_local:
        transfer_seconds = 0.0
    else:
        mbps = max(0.1, float(candidate.network_mbps or 0.1))
        result_size = source_size * max(0.1, min(2.0, output_size_ratio))
        transfer_seconds = (source_size + result_size) / (mbps * 125_000)
    resources = candidate.resources if isinstance(candidate.resources, dict) else {}
    speed_factor = float(resources.get("transcode_speed_factor") or 1.0)
    speed_factor = max(0.05, min(20.0, speed_factor))
    capacity = max(1, int(resources.get("parallel_jobs") or 1))
    queue_seconds = max(0.0, candidate.queue_wait_seconds)
    if candidate.active_jobs:
        queue_seconds += duration * max(0, candidate.active_jobs - capacity + 1) * 0.25
    return queue_seconds + transfer_seconds + duration * speed_factor


def select_worker(
    candidates: Iterable[WorkerCandidate],
    plan: TranscodePlan,
    *,
    source_size_bytes: int,
    duration_seconds: float,
) -> WorkerSelection:
    eligible: list[WorkerSelection] = []
    for candidate in candidates:
        if not candidate.reachable or (not candidate.is_local and not candidate.accept_jobs):
            continue
        capabilities, resolved_plan, _resolution_error = _resolve_worker_plan(candidate, plan)
        if capabilities is None or resolved_plan is None:
            continue
        supported, reason = _worker_supports_resolved_plan(candidate, resolved_plan, capabilities)
        if not supported:
            continue
        eligible.append(
            WorkerSelection(
                candidate=candidate,
                estimated_seconds=estimate_worker_finish_seconds(
                    candidate,
                    source_size_bytes=source_size_bytes,
                    duration_seconds=duration_seconds,
                ),
                reason=reason,
                resolved_plan=resolved_plan,
            )
        )
    if not eligible:
        raise FederationError("No eligible federation worker supports this transcode plan", status_code=409)
    chosen = min(
        eligible,
        key=lambda item: (
            round(item.estimated_seconds, 6),
            0 if item.candidate.is_local else 1,
            item.candidate.installation_id,
        ),
    )
    return chosen


def candidates_for_plan(
    db: Session,
    settings: Settings,
    plan: TranscodePlan,
) -> list[WorkerCandidate]:
    local = local_descriptor(db, settings)
    candidates = [
        WorkerCandidate(
            installation_id=str(local["installation_id"]),
            display_name=str(local["display_name"]),
            is_local=True,
            reachable=True,
            accept_jobs=True,
            capabilities=local.get("capabilities", {}),
            capability_matrix=local.get("capability_matrix", {}),
            resources=local.get("resources", {}),
            active_jobs=int(local.get("active_jobs") or 0),
            network_mbps=100.0,
        )
    ]
    explicit_id = plan.target_member_id if plan.target_mode == "member" else None
    if plan.target_mode == "local":
        return candidates
    for member in db.scalars(
        select(TranscodeFederationMember).where(TranscodeFederationMember.status == "active")
    ).all():
        if explicit_id and member.installation_id != explicit_id:
            continue
        candidates.append(
            WorkerCandidate(
                installation_id=member.installation_id,
                display_name=member.display_name,
                is_local=False,
                reachable=member.reachable and member.connection_status == "connected",
                accept_jobs=member.accept_jobs,
                capabilities=member.capabilities or {},
                capability_matrix=member.capability_matrix or {},
                resources=member.resources or {},
                active_jobs=member.active_jobs,
                network_mbps=member.network_mbps,
            )
        )
    return candidates


def transfer_id_for_attempt(attempt_id: str, direction: str, role: str) -> str:
    return uuid5(NAMESPACE_URL, f"medialyze:{attempt_id}:{direction}:{role}").hex


def sha256_file(path: Path, *, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def validate_transfer_name(name: str) -> str:
    value = str(name or "").replace("\\", "/")
    path = Path(value)
    windows_path = PureWindowsPath(value)
    if (
        not value
        or "\x00" in value
        or any(ord(char) < 32 for char in value)
        or path.is_absolute()
        or windows_path.drive
        or windows_path.anchor
        or value.startswith("/")
    ):
        raise FederationError("Transfer names must be relative paths")
    if any(part in {"", ".", ".."} for part in value.split("/")):
        raise FederationError("Transfer names may not escape the remote workspace")
    if len(value) > 2048:
        raise FederationError("Transfer name is too long")
    return value


def create_transfer(
    db: Session,
    attempt: TranscodeRemoteAttempt,
    *,
    direction: str,
    role: str,
    relative_name: str,
    local_path: Path,
    total_bytes: int,
    sha256: str,
    chunk_size: int,
) -> TranscodeTransfer:
    validate_transfer_name(relative_name)
    transfer_id = transfer_id_for_attempt(attempt.id, direction, role)
    transfer = db.get(TranscodeTransfer, transfer_id)
    if transfer is None:
        transfer = TranscodeTransfer(
            id=transfer_id,
            attempt_id=attempt.id,
            direction=direction,
            role=role,
            relative_name=relative_name,
            total_bytes=int(total_bytes),
            chunk_size=int(chunk_size),
            sha256=sha256,
            status="pending",
            local_path=str(local_path),
        )
        db.add(transfer)
    return transfer


def chunk_count(total_bytes: int, chunk_size: int) -> int:
    if total_bytes <= 0:
        return 0
    return (int(total_bytes) + int(chunk_size) - 1) // int(chunk_size)


def read_transfer_chunk(path: Path, chunk_index: int, chunk_size: int, total_bytes: int) -> tuple[int, bytes]:
    offset = int(chunk_index) * int(chunk_size)
    if chunk_index < 0 or offset >= total_bytes:
        raise FederationError("Invalid transfer chunk index")
    with path.open("rb") as handle:
        handle.seek(offset)
        data = handle.read(min(chunk_size, total_bytes - offset))
    if not data:
        raise FederationError("Transfer chunk is empty")
    return offset, data


def completed_chunk_indices(db: Session, transfer_id: str) -> set[int]:
    return {
        int(item.chunk_index)
        for item in db.scalars(
            select(TranscodeTransferChunk).where(
                TranscodeTransferChunk.transfer_id == transfer_id,
                TranscodeTransferChunk.verified.is_(True),
            )
        ).all()
    }


def record_transfer_chunk(
    db: Session,
    transfer: TranscodeTransfer,
    *,
    chunk_index: int,
    offset: int,
    data: bytes,
    sha256: str,
) -> bool:
    if hashlib.sha256(data).hexdigest() != str(sha256).lower():
        raise FederationError("Transfer chunk checksum mismatch", status_code=422)
    expected_offset = int(chunk_index) * int(transfer.chunk_size)
    if int(offset) != expected_offset or int(offset) < 0 or int(offset) + len(data) > int(transfer.total_bytes):
        raise FederationError("Transfer chunk offset is invalid", status_code=422)
    expected_size = min(int(transfer.chunk_size), int(transfer.total_bytes) - expected_offset)
    if len(data) != expected_size:
        raise FederationError("Transfer chunk size is invalid", status_code=422)
    target = Path(transfer.local_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        with target.open("wb") as handle:
            if transfer.total_bytes:
                handle.truncate(transfer.total_bytes)
    with target.open("r+b") as handle:
        handle.seek(offset)
        handle.write(data)
    chunk = db.scalar(
        select(TranscodeTransferChunk).where(
            TranscodeTransferChunk.transfer_id == transfer.id,
            TranscodeTransferChunk.chunk_index == chunk_index,
        )
    )
    if chunk is None:
        chunk = TranscodeTransferChunk(
            transfer_id=transfer.id,
            chunk_index=chunk_index,
            offset=offset,
            size=len(data),
            sha256=sha256,
            verified=True,
        )
        db.add(chunk)
    else:
        chunk.offset = offset
        chunk.size = len(data)
        chunk.sha256 = sha256
        chunk.verified = True
    verified_bytes = int(
        db.scalar(
            select(func.coalesce(func.sum(TranscodeTransferChunk.size), 0)).where(
                TranscodeTransferChunk.transfer_id == transfer.id,
                TranscodeTransferChunk.verified.is_(True),
            )
        )
        or 0
    )
    # The just-added chunk is not visible to the aggregate until flush.
    db.flush()
    verified_bytes = int(
        db.scalar(
            select(func.coalesce(func.sum(TranscodeTransferChunk.size), 0)).where(
                TranscodeTransferChunk.transfer_id == transfer.id,
                TranscodeTransferChunk.verified.is_(True),
            )
        )
        or 0
    )
    transfer.transferred_bytes = min(int(transfer.total_bytes), verified_bytes)
    transfer.status = "complete" if transfer.transferred_bytes >= transfer.total_bytes else "transferring"
    return transfer.status == "complete"


def verify_transfer_checksum(transfer: TranscodeTransfer) -> bool:
    path = Path(transfer.local_path)
    if not path.exists() or path.stat().st_size != transfer.total_bytes:
        return False
    valid = hmac.compare_digest(sha256_file(path), transfer.sha256)
    if valid:
        transfer.status = "complete"
        transfer.transferred_bytes = transfer.total_bytes
    else:
        transfer.status = "corrupt"
        transfer.last_error = "Complete transfer checksum mismatch"
    return valid


def expire_resource_reservations(db: Session, *, now: datetime | None = None) -> int:
    current = now or utc_now()
    reservations = db.scalars(
        select(TranscodeResourceReservation).where(
            TranscodeResourceReservation.status == "active",
            TranscodeResourceReservation.expires_at < current,
        )
    ).all()
    for reservation in reservations:
        reservation.status = "expired"
        reservation.released_at = current
    if reservations:
        db.commit()
    return len(reservations)


def reserve_resource(
    db: Session,
    *,
    owner_installation_id: str,
    resource_type: str,
    device_id: str,
    capacity: int,
    job_id: int | None = None,
    attempt_id: str | None = None,
    slots: int = 1,
    lease_seconds: int = 60,
    lease_token: str | None = None,
) -> TranscodeResourceReservation:
    if capacity < 1 or slots < 1 or slots > capacity:
        raise FederationError("Invalid federation resource reservation")
    expire_resource_reservations(db)
    used = int(
        db.scalar(
            select(func.coalesce(func.sum(TranscodeResourceReservation.slots), 0)).where(
                TranscodeResourceReservation.status == "active",
                TranscodeResourceReservation.owner_installation_id == owner_installation_id,
                TranscodeResourceReservation.resource_type == resource_type,
                TranscodeResourceReservation.device_id == device_id,
            )
        )
        or 0
    )
    if used + slots > capacity:
        raise FederationError("Requested federation resource is currently busy", status_code=409)
    reservation = TranscodeResourceReservation(
        job_id=job_id,
        attempt_id=attempt_id,
        owner_installation_id=owner_installation_id,
        resource_type=resource_type,
        device_id=device_id,
        slots=slots,
        lease_token=lease_token or secrets.token_urlsafe(24),
        status="active",
        expires_at=utc_now() + timedelta(seconds=max(5, lease_seconds)),
    )
    db.add(reservation)
    db.flush()
    return reservation


def renew_resource_reservation(
    db: Session,
    reservation_id: int,
    lease_token: str,
    *,
    lease_seconds: int = 60,
) -> TranscodeResourceReservation:
    reservation = db.get(TranscodeResourceReservation, reservation_id)
    if reservation is None or reservation.status != "active" or not hmac.compare_digest(
        reservation.lease_token, lease_token
    ):
        raise FederationAuthenticationError("Invalid resource reservation lease")
    if reservation.expires_at < utc_now():
        reservation.status = "expired"
        reservation.released_at = utc_now()
        db.commit()
        raise FederationError("Resource reservation lease expired", status_code=409)
    reservation.expires_at = utc_now() + timedelta(seconds=max(5, lease_seconds))
    db.flush()
    return reservation


def release_resource_reservation(
    db: Session,
    reservation_id: int,
    *,
    lease_token: str | None = None,
) -> None:
    reservation = db.get(TranscodeResourceReservation, reservation_id)
    if reservation is None or reservation.status != "active":
        return
    if lease_token is not None and not hmac.compare_digest(reservation.lease_token, lease_token):
        raise FederationAuthenticationError("Invalid resource reservation lease")
    reservation.status = "released"
    reservation.released_at = utc_now()
    db.flush()


def choose_worker_for_media_file(db: Session, settings: Settings, media_file: Any, plan: TranscodePlan) -> WorkerSelection:
    """Resolve the target without changing the plan or silently falling back.

    A caller using ``target_mode=local`` never reaches this function.  For an
    automatic plan the local worker is simply another candidate; for an
    explicit member the candidate list is narrowed and an ineligible member
    produces a visible error.
    """

    from backend.app.services.app_settings import get_app_settings

    app_settings = get_app_settings(db, settings)
    effective_plan = plan.model_copy(
        update={
            "execution_mode": plan.execution_mode or app_settings.transcoding.execution_mode,
        }
    )
    candidates = candidates_for_plan(db, settings, effective_plan)
    if plan.target_mode == "member" and not any(
        not item.is_local and item.installation_id == plan.target_member_id for item in candidates
    ):
        raise FederationError("The selected federation member is not connected", status_code=409)
    return select_worker(
        candidates,
        effective_plan,
        source_size_bytes=int(media_file.size_bytes or 0),
        duration_seconds=float(media_file.duration_seconds or 0.0),
    )


def _remote_media_snapshot(media_file: Any) -> dict[str, Any]:
    """Serialize only metadata needed to rebuild a target-side FFmpeg plan."""

    return {
        "id": 0,
        "library_id": 0,
        "relative_path": Path(media_file.filename).name,
        "filename": media_file.filename,
        "extension": media_file.extension,
        "size_bytes": int(media_file.size_bytes or 0),
        "mtime": float(media_file.mtime or 0),
        "duration_seconds": media_file.duration_seconds,
        "primary_video_codec": media_file.primary_video_codec,
        "primary_video_hdr_type": media_file.primary_video_hdr_type,
        "primary_video_width": media_file.primary_video_width,
        "primary_video_height": media_file.primary_video_height,
        "has_embedded_cover": bool(media_file.has_embedded_cover),
        "embedded_cover_stream_index": media_file.embedded_cover_stream_index,
        "raw_ffprobe_json": None,
        "video_streams": [
            {
                "stream_index": item.stream_index,
                "codec": item.codec,
                "profile": item.profile,
                "width": item.width,
                "height": item.height,
                "pix_fmt": item.pix_fmt,
                "color_space": item.color_space,
                "color_transfer": item.color_transfer,
                "color_primaries": item.color_primaries,
                "frame_rate": item.frame_rate,
                "bit_rate": item.bit_rate,
                "bit_depth": item.bit_depth,
                "hdr_type": item.hdr_type,
            }
            for item in media_file.video_streams
        ],
        "audio_streams": [
            {
                "stream_index": item.stream_index,
                "codec": item.codec,
                "profile": item.profile,
                "spatial_audio_profile": item.spatial_audio_profile,
                "channels": item.channels,
                "channel_layout": item.channel_layout,
                "sample_rate": item.sample_rate,
                "bit_rate": item.bit_rate,
                "bit_depth": item.bit_depth,
                "language": item.language,
                "default_flag": item.default_flag,
                "forced_flag": item.forced_flag,
            }
            for item in media_file.audio_streams
        ],
        "subtitle_streams": [
            {
                "stream_index": item.stream_index,
                "codec": item.codec,
                "language": item.language,
                "default_flag": item.default_flag,
                "forced_flag": item.forced_flag,
                "subtitle_type": item.subtitle_type,
            }
            for item in media_file.subtitle_streams
        ],
        "external_subtitles": [
            {
                "id": item.id,
                "path": validate_transfer_name(item.path),
                "language": item.language,
                "format": item.format,
            }
            for item in media_file.external_subtitles
        ],
    }


def _remote_member(db: Session, installation_id: str) -> TranscodeFederationMember:
    member = db.scalar(
        select(TranscodeFederationMember).where(
            TranscodeFederationMember.installation_id == installation_id,
            TranscodeFederationMember.status == "active",
        )
    )
    if member is None or not member.shared_secret:
        raise FederationError("The selected federation member is not connected", status_code=409)
    if not member.endpoint_urls:
        raise FederationError("The selected federation member has no endpoint", status_code=409)
    return member


def queue_remote_transcode_job(
    db: Session,
    settings: Settings,
    media_file: Any,
    plan: TranscodePlan,
    selection: WorkerSelection,
    *,
    profile_id: int | None = None,
    profile_version: int | None = None,
    rule_id: int | None = None,
    rule_version: int | None = None,
    rule_snapshot: dict | None = None,
    automation_run_id: int | None = None,
    automation_trigger: str | None = None,
    output_subfolder: str | None = None,
) -> tuple[TranscodeJob, dict[str, Any]]:
    """Create the origin rows for a remote job.

    The target is contacted by the runtime after this transaction commits;
    queueing therefore remains fast and a failed peer cannot leave a half
    created local job.
    """

    from backend.app.models.entities import TranscodeVariantGroup
    from backend.app.services.transcoding import (
        _group_for_source,
        _source_paths,
        validate_transcode_plan,
    )

    member = _remote_member(db, selection.candidate.installation_id)
    remote_capabilities = TranscodeCapabilitiesRead.model_validate(member.capabilities or {})
    resolved_plan = selection.resolved_plan or plan
    validation = validate_transcode_plan(
        db,
        settings,
        media_file,
        resolved_plan,
        output_subfolder=output_subfolder,
        capabilities_override=remote_capabilities,
        device_id_override=resolved_plan.target_device_id,
    )
    if not validation.valid:
        raise FederationError("; ".join(validation.errors) or "Remote transcode plan is invalid", status_code=422)
    normalized_plan = validation.normalized_plan
    paths = _source_paths(media_file)
    source_stat = paths.source.stat()
    source_hash = sha256_file(paths.source)
    group = _group_for_source(db, media_file)
    if group is None:
        group = TranscodeVariantGroup(
            library_id=media_file.library_id,
            original_file_id=media_file.id,
            original_library_root_id=media_file.library_root_id,
            original_relative_path=media_file.relative_path,
            original_filename=media_file.filename,
        )
        db.add(group)
        db.flush()
    output_path = Path(validation.output_path)
    if validation.output_mode == "transcode_output":
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_storage_root = Path(
            getattr(settings, "transcode_output_root", None)
            or (Path(settings.config_path) / "Transcode_Output")
        ).resolve()
        output_relative_path = output_path.relative_to(output_storage_root).as_posix()
    else:
        output_storage_root = paths.root
        output_relative_path = output_path.relative_to(paths.root).as_posix()
    temporary_path = output_path.with_name(
        f".{output_path.stem}.medialyze-{uuid4().hex}{output_path.suffix}.part"
    )
    from backend.app.services.app_settings import get_app_settings

    app_settings = get_app_settings(db, settings)
    state = get_federation_state(db, settings)
    global_job_id = uuid4().hex
    attempt_id = uuid4().hex
    lease_token = secrets.token_urlsafe(24)
    job = TranscodeJob(
        group_id=group.id,
        library_id=media_file.library_id,
        source_file_id=media_file.id,
        status=JobStatus.queued,
        profile=normalized_plan.profile,
        profile_id=profile_id,
        profile_version=profile_version,
        rule_id=rule_id,
        rule_version=rule_version,
        rule_snapshot=rule_snapshot,
        automation_run_id=automation_run_id,
        automation_trigger=automation_trigger,
        plan_version=normalized_plan.version,
        plan=normalized_plan.model_dump(mode="json"),
        ffmpeg_arguments=[],
        ffmpeg_command="",
        warnings=validation.warnings,
        source_path_snapshot=str(paths.source),
        source_size_snapshot=source_stat.st_size,
        source_mtime_snapshot=source_stat.st_mtime,
        output_path_snapshot=str(output_path),
        output_relative_path=output_relative_path,
        output_mode=validation.output_mode,
        output_storage_root=str(output_storage_root),
        retry_count=app_settings.transcoding.retry_count,
        cpu_budget_percent=app_settings.transcoding.cpu_budget_percent,
        cpu_thread_budget=validation.cpu_thread_budget,
        device_id=normalized_plan.target_device_id,
        hardware_backend=validation.hardware_backend,
        ffmpeg_version=remote_capabilities.version,
        remove_partial_output=app_settings.transcoding.remove_partial_output,
        on_error=app_settings.transcoding.on_error,
        temporary_path=str(temporary_path),
        global_job_id=global_job_id,
        origin_installation_id=state["installation_id"],
        target_installation_id=member.installation_id,
        target_member_id=member.installation_id,
        assignment_mode=normalized_plan.target_mode,
        processing_phase="queued",
        execution_attempt=0,
        remote_attempt_id=attempt_id,
        lease_token=lease_token,
        source_sha256=source_hash,
    )
    db.add(job)
    db.flush()
    snapshot = _remote_media_snapshot(media_file)
    attempt = TranscodeRemoteAttempt(
        id=attempt_id,
        job_id=job.id,
        global_job_id=global_job_id,
        attempt_number=1,
        origin_installation_id=state["installation_id"],
        target_installation_id=member.installation_id,
        assignment_mode=normalized_plan.target_mode,
        status="queued",
        processing_phase="queued",
        plan=normalized_plan.model_dump(mode="json"),
        source_snapshot=snapshot,
        source_filename=Path(media_file.filename).name,
        source_size_bytes=source_stat.st_size,
        source_sha256=source_hash,
        workspace_path=str(temporary_path.parent),
        source_bytes_total=source_stat.st_size,
        lease_token=lease_token,
        lease_expires_at=utc_now() + timedelta(seconds=120),
        last_origin_contact_at=utc_now(),
    )
    db.add(attempt)
    chunk_size = int(getattr(settings, "federation_chunk_size_bytes", 1024 * 1024))
    source_transfer = create_transfer(
        db,
        attempt,
        direction="upload",
        role="source",
        relative_name=Path(media_file.filename).name,
        local_path=paths.source,
        total_bytes=source_stat.st_size,
        sha256=source_hash,
        chunk_size=chunk_size,
    )
    job.source_transfer_id = source_transfer.id
    job.source_transfer_total_bytes = source_stat.st_size
    attempt_source = {
        "id": source_transfer.id,
        "direction": source_transfer.direction,
        "role": source_transfer.role,
        "relative_name": source_transfer.relative_name,
        "total_bytes": source_transfer.total_bytes,
        "sha256": source_transfer.sha256,
        "chunk_size": source_transfer.chunk_size,
    }
    subtitle_transfers: list[dict[str, Any]] = []
    for item in snapshot["external_subtitles"]:
        decision = next(
            (candidate for candidate in normalized_plan.external_subtitles if candidate.subtitle_id == item["id"]),
            None,
        )
        if decision is None or decision.action == "drop":
            continue
        sidecar = (paths.source.parent / item["path"]).resolve()
        try:
            sidecar.relative_to(paths.root)
        except ValueError as exc:
            raise FederationError("External subtitle escapes the library root", status_code=422) from exc
        if not sidecar.exists():
            raise FederationError(f"External subtitle no longer exists: {item['path']}", status_code=422)
        sidecar_transfer = create_transfer(
            db,
            attempt,
            direction="upload",
            role=f"subtitle-{item['id']}",
            relative_name=f"subtitles/{item['path']}",
            local_path=sidecar,
            total_bytes=sidecar.stat().st_size,
            sha256=sha256_file(sidecar),
            chunk_size=chunk_size,
        )
        subtitle_transfers.append(
            {
                "id": sidecar_transfer.id,
                "direction": sidecar_transfer.direction,
                "role": sidecar_transfer.role,
                "relative_name": sidecar_transfer.relative_name,
                "total_bytes": sidecar_transfer.total_bytes,
                "sha256": sidecar_transfer.sha256,
                "chunk_size": sidecar_transfer.chunk_size,
                "subtitle_id": item["id"],
            }
        )
    db.commit()
    db.refresh(job)
    return job, {
        "attempt_id": attempt_id,
        "global_job_id": global_job_id,
        "attempt_number": 1,
        "origin_installation_id": state["installation_id"],
        "target_installation_id": member.installation_id,
        "assignment_mode": normalized_plan.target_mode,
        "plan": normalized_plan.model_dump(mode="json"),
        "source_snapshot": snapshot,
        "source_transfer": attempt_source,
        "subtitle_transfers": subtitle_transfers,
        "source_size_bytes": source_stat.st_size,
        "source_sha256": source_hash,
        "source_filename": Path(media_file.filename).name,
        "lease_token": lease_token,
    }
