from datetime import date
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.api.deps import get_app_settings
from backend.app.api.routes import router
from backend.app.core.config import Settings
from backend.app.schemas.compatibility import (
    CompatibilityProfile,
    CompatibilityStatus,
    HardwareProfile,
    SoftwareProfile,
)
from backend.app.services.compatibility import (
    evaluate_compatibility,
    evaluate_hardware_profile,
    evaluate_software_profile,
)
from backend.app.services.compatibility_profiles import (
    ProfileCatalogError,
    create_local_profile,
    delete_local_profile,
    list_profiles,
)


def _hardware(**overrides) -> HardwareProfile:
    payload = {
        "schema_version": 1,
        "profile_version": 1,
        "id": "test-hardware",
        "name": "Test Hardware",
        "category": "streaming_device",
        "manufacturer": "Test",
        "status": "local",
        "added": date(2026, 6, 10),
        "last_modified": date(2026, 6, 10),
        "video": {
            "h264": {
                "hardware_decode": True,
                "max_resolution": "4K",
                "max_fps": 60,
                "bit_depth": [8, 10],
                "hdr": ["HDR10"],
            }
        },
        "audio": {"aac": True, "truehd": "passthrough_only"},
        "containers": ["mkv"],
        "subtitles": {"srt": True, "ass": "limited"},
        "sources": [],
    }
    payload.update(overrides)
    return HardwareProfile.model_validate(payload)


def _software(**overrides) -> SoftwareProfile:
    payload = {
        "schema_version": 1,
        "profile_version": 1,
        "id": "test-player",
        "name": "Test Player",
        "category": "player",
        "developer": "Test",
        "platforms": ["Test OS"],
        "status": "local",
        "added": date(2026, 6, 10),
        "last_modified": date(2026, 6, 10),
        "video": {"h264": {"mode": "direct"}, "hevc": {"mode": "transcode"}},
        "audio": {"aac": {"mode": "direct"}, "truehd": {"mode": "direct"}},
        "containers": {"mkv": {"mode": "direct"}, "avi": {"mode": "transcode"}},
        "subtitles": {"srt": {"mode": "direct"}, "ass": {"mode": "direct"}},
        "sources": [],
    }
    payload.update(overrides)
    return SoftwareProfile.model_validate(payload)


def _combination() -> CompatibilityProfile:
    return CompatibilityProfile(
        schema_version=1,
        profile_version=1,
        id="living-room",
        name="Living room",
        status="local",
        added=date(2026, 6, 10),
        last_modified=date(2026, 6, 10),
        hardware_profile_id="test-hardware",
        software_profile_id="test-player",
    )


def _file(**overrides):
    payload = {
        "id": 7,
        "extension": "mkv",
        "video_streams": [
            SimpleNamespace(
                stream_index=0,
                codec="h264",
                width=3840,
                height=2160,
                frame_rate=24,
                bit_depth=10,
                hdr_type="HDR10",
            )
        ],
        "audio_streams": [
            SimpleNamespace(stream_index=1, codec="aac", default_flag=True),
        ],
        "subtitle_streams": [],
        "external_subtitles": [],
    }
    payload.update(overrides)
    return SimpleNamespace(**payload)


def test_shipped_profiles_load_with_matching_ids(tmp_path) -> None:
    settings = Settings(config_path=tmp_path)
    assert [profile.id for profile in list_profiles(settings, "hardware")] == [
        "apple-tv-2nd-gen",
        "apple-tv-3rd-gen",
        "apple-tv-4k-1st-gen",
        "apple-tv-4k-2nd-gen",
        "apple-tv-4k-3rd-gen",
        "apple-tv-hd",
    ]
    assert {profile.id for profile in list_profiles(settings, "software")} == {
        "jellyfin-android",
        "jellyfin-android-tv",
        "jellyfin-ios",
        "jellyfin-swiftfin-ios",
        "jellyfin-roku",
        "jellyfin-kodi",
        "jellyfin-media-player-desktop",
        "plex-apple-tv",
        "plex-playstation-4",
        "plex-playstation-5",
        "plex-smart-tv-generic",
        "plex-web-browser",
        "plex-xbox",
        "streamyfin-apple-tv",
        "streamyfin-ios",
        "vlc-3-desktop",
    }


def test_official_profiles_explicitly_declare_current_schema_fields() -> None:
    catalog_root = Path("backend/app/profile_catalog")
    for path in sorted((catalog_root / "hardware_profiles").glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["schema_version"] == 1
        assert payload["profile_version"] >= 1
        assert payload["id"] == path.stem
        assert payload["status"] == "official"
        assert payload["sources"]
    for path in sorted((catalog_root / "software_profiles").glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["schema_version"] == 1
        assert payload["profile_version"] >= 1
        assert payload["id"] == path.stem
        assert payload["status"] == "official"
        assert payload["sources"]
        assert "rules" in payload
        assert payload["server_fallback"] in {"unsupported", "transcode"}


def test_official_streamyfin_profiles_reflect_mpv_device_profile() -> None:
    catalog_root = Path("backend/app/profile_catalog/software_profiles")
    for profile_id in ["streamyfin-ios", "streamyfin-apple-tv"]:
        payload = json.loads((catalog_root / f"{profile_id}.json").read_text(encoding="utf-8"))
        assert payload["server_fallback"] == "transcode"
        assert payload["containers"]["mkv"]["mode"] == "direct"
        assert payload["containers"]["mp4"]["mode"] == "direct"
        assert payload["video"]["h264"]["mode"] == "direct"
        assert payload["video"]["hevc"]["mode"] == "direct"
        assert payload["video"]["av1"]["mode"] == "conditional"
        assert payload["audio"]["truehd"]["mode"] == "direct"
        assert payload["audio"]["dts"]["mode"] == "direct"
        assert payload["subtitles"]["ass"]["mode"] == "direct"
        assert payload["subtitles"]["hdmv_pgs_subtitle"]["mode"] == "conditional"
        assert any(rule["id"] == "streamyfin-hevc-dolby-vision" for rule in payload["rules"])


def test_official_plex_profiles_include_documented_transcoding_fallback() -> None:
    catalog_root = Path("backend/app/profile_catalog/software_profiles")
    expected_profiles = [
        "plex-web-browser",
        "plex-smart-tv-generic",
        "plex-apple-tv",
        "plex-playstation-5",
        "plex-playstation-4",
        "plex-xbox",
    ]
    for profile_id in expected_profiles:
        payload = json.loads((catalog_root / f"{profile_id}.json").read_text(encoding="utf-8"))
        assert payload["server_fallback"] == "transcode"
        assert payload["developer"] == "Plex"

    web = json.loads((catalog_root / "plex-web-browser.json").read_text(encoding="utf-8"))
    assert web["containers"]["mp4"]["mode"] == "direct"
    assert web["containers"]["mkv"]["mode"] == "direct_stream"
    assert web["video"]["h264"]["mode"] == "direct"
    assert web["audio"]["aac"]["mode"] == "direct"

    ps5 = json.loads((catalog_root / "plex-playstation-5.json").read_text(encoding="utf-8"))
    assert ps5["containers"]["mp4"]["mode"] == "direct"
    assert ps5["containers"]["mkv"]["mode"] == "direct_stream"
    assert ps5["video"]["hevc"]["mode"] == "direct"
    assert ps5["audio"]["eac3"]["mode"] == "direct"
    assert ps5["subtitles"]["srt"]["mode"] == "video_transcode"

    apple_tv = json.loads((catalog_root / "plex-apple-tv.json").read_text(encoding="utf-8"))
    assert apple_tv["containers"]["mp4"]["mode"] == "direct"
    assert apple_tv["containers"]["mkv"]["mode"] == "direct_stream"
    assert apple_tv["video"]["h264"]["mode"] == "direct"
    assert apple_tv["video"]["hevc"]["mode"] == "conditional"
    assert apple_tv["audio"]["dts"]["mode"] == "transcode"
    assert apple_tv["audio"]["truehd"]["mode"] == "transcode"
    assert apple_tv["subtitles"]["pgs"]["mode"] == "video_transcode"

    xbox = json.loads((catalog_root / "plex-xbox.json").read_text(encoding="utf-8"))
    assert xbox["containers"]["mkv"]["mode"] == "direct"
    assert xbox["video"]["vp9"]["mode"] == "direct"
    assert xbox["audio"]["flac"]["mode"] == "direct"
    assert xbox["audio"]["dts"]["mode"] == "conditional"
    assert xbox["audio"]["truehd"]["mode"] == "conditional"


def test_official_apple_tv_profiles_include_common_subtitle_formats() -> None:
    catalog_root = Path("backend/app/profile_catalog/hardware_profiles")
    expected_direct = {"srt", "subrip", "mov_text", "webvtt"}
    expected_limited = {"ass", "ssa", "dvd_subtitle", "hdmv_pgs_subtitle", "pgs", "dvb_subtitle"}
    for path in sorted(catalog_root.glob("apple-tv*.json")):
        subtitles = json.loads(path.read_text(encoding="utf-8"))["subtitles"]
        assert {key for key, value in subtitles.items() if value is True} >= expected_direct
        assert {key for key, value in subtitles.items() if value == "limited"} >= expected_limited


def test_official_apple_tv_profiles_include_safe_audio_containers() -> None:
    catalog_root = Path("backend/app/profile_catalog/hardware_profiles")
    expected_audio_containers = {"mp3", "m4a", "m4b", "aac", "aif", "aiff", "wav"}
    for path in sorted(catalog_root.glob("apple-tv*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        containers = set(payload["containers"])
        assert containers >= expected_audio_containers
        if payload["audio"].get("flac") is True:
            assert "flac" in containers


def test_official_apple_tv_profiles_direct_play_common_audiobook_containers(tmp_path) -> None:
    settings = Settings(config_path=tmp_path)
    hardware_profiles = {
        profile.id: profile
        for profile in list_profiles(settings, "hardware")
        if profile.id.startswith("apple-tv")
    }
    for hardware in hardware_profiles.values():
        mp3_result = evaluate_hardware_profile(
            _file(extension="mp3", video_streams=[], audio_streams=[
                SimpleNamespace(stream_index=0, codec="mp3", default_flag=True),
            ]),
            hardware,
        )
        assert mp3_result.container_status == CompatibilityStatus.direct_play
        assert mp3_result.audio_status == CompatibilityStatus.direct_play

        m4b_result = evaluate_hardware_profile(
            _file(extension="m4b", video_streams=[], audio_streams=[
                SimpleNamespace(stream_index=0, codec="aac", default_flag=True),
            ]),
            hardware,
        )
        assert m4b_result.container_status == CompatibilityStatus.direct_play
        assert m4b_result.audio_status == CompatibilityStatus.direct_play


def test_official_apple_tv_profiles_remux_mkv_instead_of_marking_it_unsupported(tmp_path) -> None:
    settings = Settings(config_path=tmp_path)
    hardware_profiles = [
        profile
        for profile in list_profiles(settings, "hardware")
        if profile.id.startswith("apple-tv")
    ]
    for hardware in hardware_profiles:
        result = evaluate_hardware_profile(
            _file(
                extension="mkv",
                video_streams=[
                    SimpleNamespace(
                        stream_index=0,
                        codec="h264",
                        width=640,
                        height=360,
                        frame_rate=24,
                        bit_depth=8,
                        hdr_type="SDR",
                    )
                ],
                audio_streams=[
                    SimpleNamespace(stream_index=1, codec="aac", default_flag=True),
                ],
            ),
            hardware,
        )
        assert result.status == CompatibilityStatus.direct_stream
        assert result.container_status == CompatibilityStatus.direct_stream
        assert any(finding.code == "container_remux_required" for finding in result.findings)


def test_local_profiles_are_atomic_and_cannot_shadow_official_profiles(tmp_path) -> None:
    settings = Settings(config_path=tmp_path)
    created = create_local_profile(settings, "hardware", _hardware().model_dump(mode="json"))
    assert created.catalog_source.value == "local"
    assert (tmp_path / "hardware_profiles" / "test-hardware.json").exists()

    duplicate = _hardware(id="apple-tv-4k-3rd-gen")
    with pytest.raises(ProfileCatalogError, match="already exists"):
        create_local_profile(settings, "hardware", duplicate.model_dump(mode="json"))

    assert delete_local_profile(settings, "hardware", "test-hardware") is True


def test_direct_play_selects_one_supported_audio_path_and_warns_for_optional_streams() -> None:
    media_file = _file(
        audio_streams=[
            SimpleNamespace(stream_index=1, codec="dts", default_flag=True),
            SimpleNamespace(stream_index=2, codec="aac", default_flag=False),
        ]
    )
    result = evaluate_compatibility(media_file, _combination(), _hardware(), _software())
    assert result.status == CompatibilityStatus.direct_play
    assert result.selected_audio_stream_index == 2
    assert any(finding.code == "audio_codec_unsupported" for finding in result.findings)


def test_passthrough_only_is_direct_play_with_warning() -> None:
    media_file = _file(
        audio_streams=[SimpleNamespace(stream_index=1, codec="truehd", default_flag=True)]
    )
    result = evaluate_compatibility(media_file, _combination(), _hardware(), _software())
    assert result.status == CompatibilityStatus.direct_play
    assert any(finding.code == "audio_passthrough_only" for finding in result.findings)


def test_hardware_profile_can_be_evaluated_without_a_combination() -> None:
    result = evaluate_hardware_profile(_file(), _hardware())
    assert result.profile_type == "hardware"
    assert result.profile_id == "test-hardware"
    assert result.status == CompatibilityStatus.direct_play
    assert result.video_status == CompatibilityStatus.direct_play


def test_hardware_profile_container_gap_is_remux_not_unsupported() -> None:
    result = evaluate_hardware_profile(_file(extension="avi"), _hardware(containers=["mkv"]))
    assert result.status == CompatibilityStatus.direct_stream
    assert result.container_status == CompatibilityStatus.direct_stream
    assert any(finding.code == "container_remux_required" for finding in result.findings)


def test_software_profile_can_be_evaluated_without_a_combination() -> None:
    result = evaluate_software_profile(_file(), _software())
    assert result.profile_type == "software"
    assert result.profile_id == "test-player"
    assert result.status == CompatibilityStatus.direct_play
    assert result.container_status == CompatibilityStatus.direct_play


def test_explicit_software_transcoding_produces_video_transcode_result() -> None:
    media_file = _file(
        video_streams=[
            SimpleNamespace(
                stream_index=0,
                codec="hevc",
                width=3840,
                height=2160,
                frame_rate=24,
                bit_depth=10,
                hdr_type="HDR10",
            )
        ]
    )
    result = evaluate_compatibility(media_file, _combination(), _hardware(), _software())
    assert result.status == CompatibilityStatus.video_transcode
    assert result.video_status == CompatibilityStatus.video_transcode
    assert any(finding.code == "video_transcode_required" for finding in result.findings)


def test_unknown_required_metadata_is_unsupported() -> None:
    media_file = _file(
        video_streams=[
            SimpleNamespace(
                stream_index=0,
                codec=None,
                width=None,
                height=None,
                frame_rate=None,
                bit_depth=None,
                hdr_type=None,
            )
        ]
    )
    result = evaluate_compatibility(media_file, _combination(), _hardware(), _software())
    assert result.status == CompatibilityStatus.conditional
    assert any(finding.code == "metadata_unknown" for finding in result.findings)


def test_server_fallback_distinguishes_direct_stream_from_video_transcode() -> None:
    software = _software(
        server_fallback="transcode",
        containers={"mkv": {"mode": "direct_stream"}},
        audio={"aac": {"mode": "direct_stream"}},
    )
    result = evaluate_compatibility(_file(), _combination(), _hardware(), software)
    assert result.status == CompatibilityStatus.direct_stream
    assert result.container_status == CompatibilityStatus.direct_stream
    assert result.audio_status == CompatibilityStatus.direct_stream


def test_unverifiable_capability_condition_is_conditional() -> None:
    software = _software(
        video={
            "h264": {
                "mode": "conditional",
                "conditions": [{"kind": "setting", "value": "Enable H.264 High 10 Profile"}],
            }
        }
    )
    result = evaluate_compatibility(_file(), _combination(), _hardware(), software)
    assert result.status == CompatibilityStatus.conditional
    assert any(finding.code == "playback_condition_unverified" for finding in result.findings)


def test_combined_container_codec_rule_can_require_direct_stream() -> None:
    software = _software(
        rules=[
            {
                "id": "hevc-mkv-remux",
                "match": {"containers": ["mkv"], "video_codecs": ["h264"]},
                "mode": "direct_stream",
            }
        ]
    )
    result = evaluate_compatibility(_file(), _combination(), _hardware(), software)
    assert result.video_status == CompatibilityStatus.direct_stream


def test_subtitle_burn_in_causes_video_transcode() -> None:
    media_file = _file(
        subtitle_streams=[SimpleNamespace(stream_index=3, codec="ass")],
    )
    software = _software(subtitles={"ass": {"mode": "video_transcode"}})
    result = evaluate_compatibility(media_file, _combination(), _hardware(), software)
    assert result.status == CompatibilityStatus.video_transcode
    assert result.subtitle_status == CompatibilityStatus.video_transcode
    assert any(finding.code == "subtitle_burn_in_required" for finding in result.findings)


def test_profile_api_crud_and_official_profile_protection(tmp_path) -> None:
    settings = Settings(config_path=tmp_path)
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_app_settings] = lambda: settings
    client = TestClient(app)

    response = client.get("/api/compatibility/hardware-profiles")
    assert response.status_code == 200
    assert response.json()[0]["catalog_source"] == "official"

    response = client.post(
        "/api/compatibility/hardware-profiles",
        json=_hardware().model_dump(mode="json"),
    )
    assert response.status_code == 201

    response = client.post(
        "/api/compatibility/software-profiles",
        json=_software().model_dump(mode="json"),
    )
    assert response.status_code == 201

    response = client.post(
        "/api/compatibility/profiles",
        json=_combination().model_dump(mode="json"),
    )
    assert response.status_code == 201
    assert response.json()["hardware_profile_id"] == "test-hardware"

    response = client.delete("/api/compatibility/hardware-profiles/test-hardware")
    assert response.status_code == 400
    assert "referenced" in response.json()["detail"]

    response = client.patch(
        "/api/compatibility/hardware-profiles/apple-tv-4k-3rd-gen",
        json={"notes": "Changed"},
    )
    assert response.status_code == 400
    assert "read-only" in response.json()["detail"]
