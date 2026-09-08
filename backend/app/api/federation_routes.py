"""HTTP endpoints for the direct MediaLyze transcode federation."""

from __future__ import annotations

import base64
import binascii
from datetime import timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.api.deps import get_app_settings, get_db_session, get_scan_runtime
from backend.app.core.config import Settings
from backend.app.models.entities import TranscodeRemoteAttempt, TranscodeTransfer
from backend.app.schemas.transcoding import (
    TranscodeFederationPairRequest,
    TranscodeFederationPasscodeResetRead,
    TranscodeFederationProtocolPairRequest,
    TranscodeFederationProtocolSecureEnvelope,
    TranscodeFederationRead,
    TranscodeFederationSettingsRead,
    TranscodeFederationSettingsUpdate,
)
from backend.app.services.transcode_federation import (
    FederationAuthenticationError,
    FederationError,
    accept_pairing_request,
    accept_remote_assignment,
    cancel_remote_attempt,
    decrypt_member_request,
    discover_peers,
    encrypt_member_response,
    ensure_remote_storage_available,
    exclude_member,
    federation_read,
    federation_settings_read,
    get_federation_state,
    local_descriptor,
    member_heartbeat,
    pair_with_peer,
    read_remote_result_chunk,
    record_transfer_chunk,
    remote_attempt_status,
    reset_pairing_code,
    sync_peer,
    update_federation_settings,
)
from backend.app.utils.time import utc_now

federation_router = APIRouter(prefix="/transcoding/federation", tags=["transcode-federation"])
federation_protocol_router = APIRouter(
    prefix="/transcoding/federation/protocol",
    tags=["transcode-federation-protocol"],
)


def _raise_federation_error(exc: FederationError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


@federation_router.get("", response_model=TranscodeFederationRead)
def federation_detail(
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> TranscodeFederationRead:
    return federation_read(db, settings)


@federation_router.patch("", response_model=TranscodeFederationSettingsRead)
def federation_update(
    payload: TranscodeFederationSettingsUpdate,
    runtime: Any = Depends(get_scan_runtime),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> TranscodeFederationSettingsRead:
    try:
        result = update_federation_settings(db, settings, payload)
        if hasattr(runtime, "_refresh_federation_transport"):
            runtime._refresh_federation_transport()
        return result
    except FederationError as exc:
        raise _raise_federation_error(exc) from exc


@federation_router.post("/passcode/reset", response_model=TranscodeFederationPasscodeResetRead)
def federation_passcode_reset(
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> TranscodeFederationPasscodeResetRead:
    reset_pairing_code(db, settings)
    current = federation_settings_read(db, settings)
    return TranscodeFederationPasscodeResetRead(
        pairing_code=current.pairing_code,
        pairing_code_from_environment=current.pairing_code_from_environment,
        pairing_code_expires_at=current.pairing_code_expires_at,
    )


@federation_router.post("/discover", response_model=TranscodeFederationRead)
def federation_discover(
    timeout_seconds: float = Query(default=0.75, ge=0.1, le=3.0),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> TranscodeFederationRead:
    descriptor = local_descriptor(db, settings)
    peers = discover_peers(settings, descriptor, timeout_seconds=timeout_seconds)
    return federation_read(db, settings, peers)


@federation_router.post("/members/pair", response_model=TranscodeFederationRead)
def federation_pair(
    payload: TranscodeFederationPairRequest,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> TranscodeFederationRead:
    try:
        pair_with_peer(db, settings, payload.endpoint, payload.pairing_code)
    except FederationError as exc:
        raise _raise_federation_error(exc) from exc
    return federation_read(db, settings)


@federation_router.post("/members/{installation_id}/sync", response_model=TranscodeFederationRead)
def federation_member_sync(
    installation_id: str,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> TranscodeFederationRead:
    try:
        sync_peer(db, settings, installation_id)
    except FederationError as exc:
        raise _raise_federation_error(exc) from exc
    return federation_read(db, settings)


@federation_router.delete("/members/{installation_id}", status_code=204)
def federation_member_exclude(
    installation_id: str,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> None:
    exclude_member(db, settings, installation_id)


@federation_protocol_router.post("/hello")
def federation_protocol_hello(
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, Any]:
    state = get_federation_state(db, settings)
    descriptor = local_descriptor(db, settings)
    descriptor["enabled"] = bool(settings.federation_enabled and state.get("enabled"))
    return descriptor


@federation_protocol_router.post("/pair")
def federation_protocol_pair(
    payload: TranscodeFederationProtocolPairRequest,
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, Any]:
    try:
        return accept_pairing_request(db, settings, payload)
    except FederationError as exc:
        raise _raise_federation_error(exc) from exc


@federation_protocol_router.post("/heartbeat")
def federation_protocol_heartbeat(
    envelope: TranscodeFederationProtocolSecureEnvelope,
    installation_id: str = Header(alias="X-MediaLyze-Installation-ID"),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, Any]:
    try:
        member, payload = decrypt_member_request(db, installation_id, envelope)
        response = member_heartbeat(db, settings, member, payload)
        return encrypt_member_response(member, response)
    except FederationAuthenticationError as exc:
        raise _raise_federation_error(exc) from exc
    except FederationError as exc:
        raise _raise_federation_error(exc) from exc


@federation_protocol_router.post("/transfers/{transfer_id}/chunk")
def federation_protocol_transfer_chunk(
    transfer_id: str,
    envelope: TranscodeFederationProtocolSecureEnvelope,
    installation_id: str = Header(alias="X-MediaLyze-Installation-ID"),
    runtime: Any = Depends(get_scan_runtime),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, Any]:
    try:
        member, payload = decrypt_member_request(db, installation_id, envelope)
        transfer = db.get(TranscodeTransfer, transfer_id)
        if transfer is None:
            raise FederationError("Transfer not found", status_code=404)
        if transfer.direction != "upload":
            raise FederationError("Only upload transfers accept incoming chunks", status_code=409)
        attempt_row = db.get(TranscodeRemoteAttempt, transfer.attempt_id)
        if attempt_row is None or attempt_row.origin_installation_id != member.installation_id:
            raise FederationAuthenticationError("Transfer origin mismatch")
        attempt = transfer.attempt_id
        if payload.get("transfer_id") != transfer_id:
            raise FederationAuthenticationError("Transfer id mismatch")
        if payload.get("attempt_id") not in {None, attempt}:
            raise FederationAuthenticationError("Transfer attempt mismatch")
        data = base64.urlsafe_b64decode(str(payload.get("data") or "").encode("ascii"))
        chunk_index = int(payload.get("chunk_index"))
        last_chunk_index = max(0, (int(transfer.total_bytes) - 1) // int(transfer.chunk_size))
        if chunk_index % 16 == 0 or chunk_index >= last_chunk_index:
            ensure_remote_storage_available(
                settings,
                Path(attempt_row.workspace_path),
                additional_bytes=len(data),
            )
        complete = record_transfer_chunk(
            db,
            transfer,
            chunk_index=chunk_index,
            offset=int(payload.get("offset")),
            data=data,
            sha256=str(payload.get("sha256") or ""),
        )
        if transfer.role == "source":
            attempt_row.source_bytes_transferred = transfer.transferred_bytes
            attempt_row.processing_phase = "transferring_source"
        now = utc_now()
        attempt_row.last_origin_contact_at = now
        attempt_row.lease_expires_at = now + timedelta(seconds=120)
        db.commit()
        if complete and hasattr(runtime, "submit_remote_attempt"):
            upload_transfers = db.scalars(
                select(TranscodeTransfer).where(
                    TranscodeTransfer.attempt_id == attempt,
                    TranscodeTransfer.direction == "upload",
                )
            ).all()
            if upload_transfers and all(item.status == "complete" for item in upload_transfers):
                runtime.submit_remote_attempt(attempt)
        return encrypt_member_response(
            member,
            {
                "transfer_id": transfer_id,
                "attempt_id": attempt,
                "transferred_bytes": transfer.transferred_bytes,
                "total_bytes": transfer.total_bytes,
                "status": transfer.status,
                "complete": complete,
            },
        )
    except (FederationAuthenticationError, FederationError) as exc:
        raise _raise_federation_error(exc) from exc
    except (ValueError, TypeError, binascii.Error) as exc:
        raise HTTPException(status_code=422, detail="Malformed transfer chunk") from exc


@federation_protocol_router.post("/jobs/assign")
def federation_protocol_assign(
    envelope: TranscodeFederationProtocolSecureEnvelope,
    installation_id: str = Header(alias="X-MediaLyze-Installation-ID"),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, Any]:
    try:
        member, payload = decrypt_member_request(db, installation_id, envelope)
        result = accept_remote_assignment(db, settings, member, payload)
        return encrypt_member_response(member, result)
    except (FederationAuthenticationError, FederationError) as exc:
        raise _raise_federation_error(exc) from exc


@federation_protocol_router.post("/jobs/{attempt_id}/status")
def federation_protocol_attempt_status(
    attempt_id: str,
    envelope: TranscodeFederationProtocolSecureEnvelope,
    installation_id: str = Header(alias="X-MediaLyze-Installation-ID"),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, Any]:
    try:
        member, payload = decrypt_member_request(db, installation_id, envelope)
        if payload.get("attempt_id") not in {None, attempt_id}:
            raise FederationAuthenticationError("Remote attempt id mismatch")
        return encrypt_member_response(member, remote_attempt_status(db, settings, member, attempt_id))
    except (FederationAuthenticationError, FederationError) as exc:
        raise _raise_federation_error(exc) from exc


@federation_protocol_router.post("/jobs/{attempt_id}/cancel")
def federation_protocol_attempt_cancel(
    attempt_id: str,
    envelope: TranscodeFederationProtocolSecureEnvelope,
    installation_id: str = Header(alias="X-MediaLyze-Installation-ID"),
    runtime: Any = Depends(get_scan_runtime),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, Any]:
    try:
        member, payload = decrypt_member_request(db, installation_id, envelope)
        if payload.get("attempt_id") not in {None, attempt_id}:
            raise FederationAuthenticationError("Remote attempt id mismatch")
        result = cancel_remote_attempt(db, settings, member, attempt_id)
        if hasattr(runtime, "cancel_remote_attempt"):
            runtime.cancel_remote_attempt(attempt_id)
        return encrypt_member_response(member, result)
    except (FederationAuthenticationError, FederationError) as exc:
        raise _raise_federation_error(exc) from exc


@federation_protocol_router.post("/transfers/{transfer_id}/read")
def federation_protocol_transfer_read(
    transfer_id: str,
    envelope: TranscodeFederationProtocolSecureEnvelope,
    installation_id: str = Header(alias="X-MediaLyze-Installation-ID"),
    db: Session = Depends(get_db_session),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, Any]:
    try:
        member, payload = decrypt_member_request(db, installation_id, envelope)
        if payload.get("transfer_id") not in {None, transfer_id}:
            raise FederationAuthenticationError("Transfer id mismatch")
        return encrypt_member_response(
            member,
            read_remote_result_chunk(
                db,
                settings,
                member,
                transfer_id,
                int(payload.get("chunk_index")),
            ),
        )
    except (FederationAuthenticationError, FederationError) as exc:
        raise _raise_federation_error(exc) from exc
