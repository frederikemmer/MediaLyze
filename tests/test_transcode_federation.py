from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.models.entities import (
    TranscodeFederationMember,
    TranscodeRemoteAttempt,
    TranscodeTransfer,
)
from backend.app.schemas.transcoding import (
    TranscodePlan,
    TranscodeStreamAction,
    TranscodeStreamPlan,
)
from backend.app.services import transcode_federation as federation
from backend.app.utils.time import utc_now


def _session_factory() -> sessionmaker[Session]:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def _settings(tmp_path: Path) -> Settings:
    config_path = tmp_path / "config"
    media_path = tmp_path / "media"
    config_path.mkdir()
    media_path.mkdir()
    return Settings(
        runtime_mode="desktop",
        config_path=config_path,
        media_root=media_path,
        ffmpeg_path="ffmpeg-test",
    )


def _cpu_plan(target_mode: str = "local") -> TranscodePlan:
    return TranscodePlan(
        profile="expert",
        container="mkv",
        execution_mode="cpu_only",
        target_mode=target_mode,
        video_streams=[
            TranscodeStreamPlan(
                stream_index=0,
                action=TranscodeStreamAction.encode,
                codec="h264",
                encoder="libx264",
            )
        ],
    )


def _candidate(
    installation_id: str,
    *,
    is_local: bool,
    speed_factor: float = 1.0,
    network_mbps: float = 100.0,
    active_jobs: int = 0,
) -> federation.WorkerCandidate:
    return federation.WorkerCandidate(
        installation_id=installation_id,
        display_name=installation_id,
        is_local=is_local,
        reachable=True,
        accept_jobs=True,
        capabilities={"encoders": [{"name": "libx264", "available": True}]},
        capability_matrix={},
        resources={"transcode_speed_factor": speed_factor, "parallel_jobs": 1},
        active_jobs=active_jobs,
        network_mbps=network_mbps,
    )


def _attempt(tmp_path: Path) -> TranscodeRemoteAttempt:
    now = utc_now()
    return TranscodeRemoteAttempt(
        id="attempt-1",
        global_job_id="global-1",
        attempt_number=1,
        origin_installation_id="origin-1",
        target_installation_id="target-1",
        plan=_cpu_plan().model_dump(mode="json"),
        source_snapshot={},
        source_filename="source.mkv",
        source_size_bytes=11,
        source_sha256="0" * 64,
        workspace_path=str(tmp_path),
        lease_token="lease",
        lease_expires_at=now + timedelta(minutes=2),
        last_origin_contact_at=now,
    )


def test_member_read_handles_discovered_peer_without_capabilities() -> None:
    member = TranscodeFederationMember(
        id=1,
        installation_id="discovered-peer",
        federation_id="federation-1",
        display_name="Discovered peer",
        endpoint_urls=[],
        protocol_version=1,
        status="discovered",
        connection_status="discovered",
        reachable=False,
        accept_jobs=False,
        resources={},
        capabilities={},
        capability_matrix={},
        active_jobs=0,
        network_mbps=100.0,
    )

    result = federation._member_read(member)

    assert result.capabilities is None
    assert result.capability_matrix is None


def test_secure_envelope_rejects_tampering_stale_messages_and_replays() -> None:
    secret = "f" * 64
    envelope = federation.encrypt_secure_payload(
        secret,
        {"kind": "heartbeat", "value": 7},
        timestamp=1000,
        nonce=b"0123456789abcdef",
    )
    seen: set[str] = set()

    assert federation.decrypt_secure_payload(secret, envelope, now=1000, seen_nonces=seen) == {
        "kind": "heartbeat",
        "value": 7,
    }
    with pytest.raises(federation.FederationAuthenticationError, match="replay"):
        federation.decrypt_secure_payload(secret, envelope, now=1000, seen_nonces=seen)

    tampered = dict(envelope)
    tampered["ciphertext"] = federation.encrypt_secure_payload(
        secret,
        {"kind": "heartbeat", "value": 8},
        timestamp=1000,
        nonce=b"fedcba9876543210",
    )["ciphertext"]
    with pytest.raises(federation.FederationAuthenticationError):
        federation.decrypt_secure_payload(secret, tampered, now=1000)
    with pytest.raises(federation.FederationAuthenticationError, match="Stale"):
        federation.decrypt_secure_payload(secret, envelope, now=1401)


def test_pairing_code_state_keeps_stable_identity_and_rotates_future_pairings(tmp_path: Path) -> None:
    SessionLocal = _session_factory()
    settings = _settings(tmp_path)
    with SessionLocal() as db:
        first = federation.get_federation_state(db, settings)
        installation_id = first["installation_id"]
        old_code = first["pairing_code"]
        new_code, from_environment = federation.reset_pairing_code(db, settings)
        second = federation.get_federation_state(db, settings)

        assert not from_environment
        assert second["installation_id"] == installation_id
        assert new_code != old_code
        assert not federation.verify_pairing_code(settings, second, old_code)
        assert federation.verify_pairing_code(settings, second, new_code)


def test_worker_selection_accounts_for_network_and_prefers_local_on_true_tie() -> None:
    plan = _cpu_plan()
    remote = _candidate("remote", is_local=False, speed_factor=0.05, network_mbps=1000)
    local = _candidate("local", is_local=True, speed_factor=2.0)

    selected = federation.select_worker(
        [local, remote],
        plan,
        source_size_bytes=100 * 1024 * 1024,
        duration_seconds=100,
    )
    assert selected.candidate.installation_id == "remote"
    assert selected.estimated_seconds > 0

    tie = federation.select_worker(
        [_candidate("remote", is_local=False), _candidate("local", is_local=True)],
        plan,
        source_size_bytes=0,
        duration_seconds=0,
    )
    assert tie.candidate.installation_id == "local"


def test_transfer_names_are_relative_and_chunk_state_is_resumable(tmp_path: Path) -> None:
    assert federation.validate_transfer_name("subtitles/Movie.en.srt") == "subtitles/Movie.en.srt"
    for unsafe in ("../secret", r"..\secret", "C:secret", r"C:\secret", r"\\server\secret", "/etc/passwd"):
        with pytest.raises(federation.FederationError):
            federation.validate_transfer_name(unsafe)

    SessionLocal = _session_factory()
    source = tmp_path / "source.bin"
    source.write_bytes(b"hello world")
    target = tmp_path / "received.bin"
    with SessionLocal() as db:
        attempt = _attempt(tmp_path)
        db.add(attempt)
        db.flush()
        transfer = TranscodeTransfer(
            id=federation.transfer_id_for_attempt(attempt.id, "upload", "source"),
            attempt_id=attempt.id,
            direction="upload",
            role="source",
            relative_name="source.bin",
            total_bytes=source.stat().st_size,
            chunk_size=4,
            sha256=federation.sha256_file(source),
            local_path=str(target),
        )
        db.add(transfer)
        db.commit()

        for index in range(federation.chunk_count(transfer.total_bytes, transfer.chunk_size)):
            offset, data = federation.read_transfer_chunk(source, index, transfer.chunk_size, transfer.total_bytes)
            complete = federation.record_transfer_chunk(
                db,
                transfer,
                chunk_index=index,
                offset=offset,
                data=data,
                sha256=federation.hashlib.sha256(data).hexdigest(),
            )
            db.commit()
            if index < 2:
                assert not complete

        assert complete
        assert transfer.status == "complete"
        assert target.read_bytes() == source.read_bytes()
        assert federation.verify_transfer_checksum(transfer)


def test_resource_reservation_uses_capacity_and_releases_leases(tmp_path: Path) -> None:
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        first = federation.reserve_resource(
            db,
            owner_installation_id="worker",
            resource_type="gpu",
            device_id="cuda0",
            capacity=1,
            lease_seconds=60,
        )
        db.commit()
        with pytest.raises(federation.FederationError, match="busy"):
            federation.reserve_resource(
                db,
                owner_installation_id="worker",
                resource_type="gpu",
                device_id="cuda0",
                capacity=1,
                lease_seconds=60,
            )
        federation.release_resource_reservation(db, first.id, lease_token=first.lease_token)
        db.commit()
        second = federation.reserve_resource(
            db,
            owner_installation_id="worker",
            resource_type="gpu",
            device_id="cuda0",
            capacity=1,
            lease_seconds=60,
        )
        assert second.status == "active"
