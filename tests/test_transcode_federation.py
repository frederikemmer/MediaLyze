from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.models.entities import (
    AppSetting,
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


def test_federation_settings_expose_hostname_and_ip_pairing_endpoints(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    SessionLocal = _session_factory()
    settings = _settings(tmp_path).model_copy(
        update={
            "federation_port": 8091,
            "federation_advertise_urls": "https://worker.example.lan:9443,http://192.168.1.40:8091,http://[2001:db8::40]:8091,http://127.0.0.1:8091",
        }
    )

    monkeypatch.setattr(federation.socket, "gethostname", lambda: "medialyze-nas")
    monkeypatch.setattr(federation.socket, "getfqdn", lambda: "medialyze-nas.local")

    def fake_getaddrinfo(*_args: object, **_kwargs: object) -> list[tuple[object, ...]]:
        return [
            (federation.socket.AF_INET, federation.socket.SOCK_STREAM, 6, "", ("192.168.1.20", 0)),
            (federation.socket.AF_INET, federation.socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0)),
            (federation.socket.AF_INET6, federation.socket.SOCK_STREAM, 6, "", ("2001:db8::20", 0, 0, 0)),
            (federation.socket.AF_INET6, federation.socket.SOCK_STREAM, 6, "", ("fe80::20", 0, 0, 0)),
        ]

    monkeypatch.setattr(federation.socket, "getaddrinfo", fake_getaddrinfo)

    with SessionLocal() as db:
        result = federation.federation_settings_read(db, settings)

    assert result.hostname_urls == [
        "https://worker.example.lan:9443",
        "http://medialyze-nas:8091",
        "http://medialyze-nas.local:8091",
    ]
    assert result.ip_urls == [
        "http://192.168.1.40:8091",
        "http://192.168.1.20:8091",
    ]


def test_lan_discovery_excludes_the_local_installation_and_its_endpoints(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(tmp_path)
    descriptor = {
        "protocol_version": federation.PROTOCOL_VERSION,
        "installation_id": "local-installation",
        "federation_id": "federation-1",
        "display_name": "Local",
        "endpoint_urls": ["http://192.168.1.20:8091"],
    }
    remote = {
        "message": federation.DISCOVERY_MESSAGE,
        "protocol_version": federation.PROTOCOL_VERSION,
        "installation_id": "remote-installation",
        "federation_id": "federation-1",
        "display_name": "Remote",
        "endpoint_urls": ["http://192.168.1.21:8091"],
        "reachable": True,
    }
    responses = [
        (federation.discovery_payload(descriptor), ("192.168.1.20", 43211)),
        (remote, ("192.168.1.21", 43211)),
    ]

    class FakeSocket:
        def __enter__(self) -> "FakeSocket":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def setsockopt(self, *_args: object) -> None:
            return None

        def settimeout(self, *_args: object) -> None:
            return None

        def sendto(self, *_args: object) -> None:
            return None

        def recvfrom(self, _size: int) -> tuple[bytes, tuple[str, int]]:
            if not responses:
                raise federation.socket.timeout
            payload, address = responses.pop(0)
            return federation.json.dumps(payload).encode("utf-8"), address

    monkeypatch.setattr(federation.socket, "socket", lambda *_args, **_kwargs: FakeSocket())

    found = federation.discover_peers(settings, descriptor)

    assert [peer["installation_id"] for peer in found] == ["remote-installation"]


def test_pairing_re_admits_a_previously_excluded_member(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    SessionLocal = _session_factory()
    settings = _settings(tmp_path).model_copy(update={"federation_enabled": True})
    with SessionLocal() as db:
        state = federation.get_federation_state(db, settings)
        target_id = "target-peer"
        state["enabled"] = True
        state["excluded_installation_ids"] = [target_id]
        db.get(AppSetting, federation.FEDERATION_STATE_KEY).value = state
        db.commit()

        def fake_local_descriptor(_db: Session, _settings: Settings) -> dict:
            return {
                "protocol_version": federation.PROTOCOL_VERSION,
                "installation_id": state["installation_id"],
                "federation_id": state["federation_id"],
                "display_name": "Local",
                "endpoint_urls": [],
                "accept_jobs": True,
                "resources": {},
                "capabilities": {},
                "capability_matrix": {},
                "active_jobs": 0,
                "network_mbps": 100.0,
            }

        def fake_http_json(
            _settings: Settings,
            _endpoint: str,
            route: str,
            _payload: dict,
        ) -> dict:
            if route == "hello":
                return {
                    "protocol_version": federation.PROTOCOL_VERSION,
                    "installation_id": target_id,
                    "federation_id": state["federation_id"],
                    "display_name": "Target",
                    "endpoint_urls": ["http://target-peer:8091"],
                }
            assert route == "pair"
            return {
                "server_nonce": "server-nonce",
                "target": {
                    "protocol_version": federation.PROTOCOL_VERSION,
                    "installation_id": target_id,
                    "federation_id": state["federation_id"],
                    "display_name": "Target",
                    "endpoint_urls": ["http://target-peer:8091"],
                    "accept_jobs": True,
                    "resources": {},
                    "capabilities": {},
                    "capability_matrix": {},
                    "active_jobs": 0,
                    "network_mbps": 100.0,
                },
                "known_members": [],
            }

        monkeypatch.setattr(federation, "local_descriptor", fake_local_descriptor)
        monkeypatch.setattr(federation, "_http_json", fake_http_json)

        member = federation.pair_with_peer(
            db,
            settings,
            "http://target-peer:8091",
            "pairing-code",
        )

        refreshed_state = federation.get_federation_state(db, settings)
        assert target_id not in refreshed_state["excluded_installation_ids"]
        assert member.status == "active"


def test_federation_state_drops_its_own_exclusion(tmp_path: Path) -> None:
    SessionLocal = _session_factory()
    settings = _settings(tmp_path)
    with SessionLocal() as db:
        state = federation.get_federation_state(db, settings)
        local_id = state["installation_id"]
        state["excluded_installation_ids"] = [local_id, "other-peer", "other-peer"]
        db.get(AppSetting, federation.FEDERATION_STATE_KEY).value = state
        db.commit()

        refreshed_state = federation.get_federation_state(db, settings)

        assert refreshed_state["excluded_installation_ids"] == ["other-peer"]


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


def test_pairing_code_is_six_digits_and_rotates_every_thirty_seconds(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    SessionLocal = _session_factory()
    settings = _settings(tmp_path)
    clock = {"now": 1000.25}
    monkeypatch.setattr(federation.time, "time", lambda: clock["now"])
    monkeypatch.setattr(federation, "_new_pairing_secret", lambda: "a" * 64)

    with SessionLocal() as db:
        first = federation.get_federation_state(db, settings)
        first_code = first["pairing_code"]
        assert len(first_code) == 6
        assert first_code.isascii() and first_code.isdecimal()
        assert federation.PAIRING_CODE_ROTATION_SECONDS == 30
        assert federation.pairing_code_expires_at() == 1020

        clock["now"] = 1030.25
        second = federation.get_federation_state(db, settings)
        second_code = second["pairing_code"]
        assert second_code != first_code
        assert federation.verify_pairing_code(settings, second, second_code)

        clock["now"] = 1060.25
        assert not federation.verify_pairing_code(settings, second, first_code)


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


def test_worker_selection_resolves_target_codec_against_selected_worker() -> None:
    plan = _cpu_plan(target_mode="automatic").model_copy(
        update={"execution_mode": "hardware_required"}
    )
    plan.video_streams[0].encoder = "h264_nvenc"
    candidate = federation.WorkerCandidate(
        installation_id="windows-worker",
        display_name="Windows worker",
        is_local=False,
        reachable=True,
        accept_jobs=True,
        capabilities={
            "platform": "win32",
            "encoders": [
                {
                    "name": "h264_qsv",
                    "codec": "h264",
                    "hardware": True,
                    "available": True,
                    "device_ids": ["qsv0"],
                }
            ],
            "devices": [
                {
                    "id": "qsv0",
                    "name": "Intel Quick Sync",
                    "vendor": "intel",
                    "backend": "qsv",
                    "status": "available",
                    "encoder_names": ["h264_qsv"],
                }
            ],
        },
        capability_matrix={},
        resources={"parallel_jobs": 1},
    )

    selected = federation.select_worker(
        [candidate],
        plan,
        source_size_bytes=10,
        duration_seconds=10,
    )

    assert selected.resolved_plan is not None
    assert selected.resolved_plan.video_streams[0].codec == "h264"
    assert selected.resolved_plan.video_streams[0].encoder == "h264_qsv"


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
