import os
import tempfile
from datetime import UTC, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("CONFIG_PATH", tempfile.mkdtemp(prefix="medialyze-config-"))
os.environ.setdefault("MEDIA_ROOT", tempfile.mkdtemp(prefix="medialyze-media-"))

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.models.entities import (
    DuplicateDetectionMode,
    Library,
    LibraryType,
    MediaFile,
    ScanMode,
    ScanStatus,
)
from backend.app.schemas.app_settings import AppSettingsUpdate
from backend.app.services.app_settings import get_app_settings, update_app_settings
from backend.app.services.telemetry import (
    build_media_kind_counts_for_telemetry,
    build_telemetry_payload,
    is_dev_app_version,
    _post_json,
    round_count_for_telemetry,
    round_storage_gb_for_telemetry,
    send_current_telemetry_snapshot,
    send_initial_telemetry_snapshot,
    send_update_telemetry_snapshot,
    should_send_telemetry,
    should_send_update_telemetry,
)


def build_session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def build_settings(tmp_path) -> Settings:
    return Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path / "media",
        telemetry_endpoint="https://telemetry.example.test/api/telemetry/ingest",
    )


def add_media_file(db, library_id: int, filename: str, size_bytes: int, status=ScanStatus.ready) -> None:
    db.add(
        MediaFile(
            library_id=library_id,
            relative_path=filename,
            filename=filename,
            extension=filename.rsplit(".", 1)[-1],
            size_bytes=size_bytes,
            mtime=1.0,
            scan_status=status,
            quality_score=5,
        )
    )


def test_round_count_for_telemetry() -> None:
    assert round_count_for_telemetry(-1) == 0
    assert round_count_for_telemetry(0) == 0
    assert round_count_for_telemetry(7) == 7
    assert round_count_for_telemetry(99) == 99
    assert round_count_for_telemetry(127) == 120
    assert round_count_for_telemetry(999) == 990
    assert round_count_for_telemetry(23793) == 23000


def test_round_storage_gb_for_telemetry() -> None:
    assert round_storage_gb_for_telemetry(-1) == 0
    assert round_storage_gb_for_telemetry(0) == 0
    assert round_storage_gb_for_telemetry(534_000_000) == 1
    assert round_storage_gb_for_telemetry(24_000_000_000) == 24
    assert round_storage_gb_for_telemetry(496_000_000_000) == 490
    assert round_storage_gb_for_telemetry(12_000_000_000_000) == 12000


def test_build_media_kind_counts_for_telemetry_classifies_ready_files_by_extension(tmp_path) -> None:
    session_factory = build_session_factory()

    with session_factory() as db:
        library = Library(
            name="Mixed",
            path="/tmp/mixed",
            type=LibraryType.mixed,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.off,
            scan_config={},
        )
        db.add(library)
        db.flush()

        add_media_file(db, library.id, "song.flac", 100)
        add_media_file(db, library.id, "movie.mkv", 100)
        add_media_file(db, library.id, "metadata.bin", 100)
        add_media_file(db, library.id, "pending.mp3", 100, status=ScanStatus.pending)
        db.commit()

        counts = build_media_kind_counts_for_telemetry(db)

    assert counts == {"audio": 1, "video": 1, "other": 1}


def test_build_media_kind_counts_for_telemetry_rounds_each_kind(tmp_path) -> None:
    session_factory = build_session_factory()

    with session_factory() as db:
        library = Library(
            name="Music",
            path="/tmp/music",
            type=LibraryType.music,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.off,
            scan_config={},
        )
        db.add(library)
        db.flush()

        for index in range(127):
            add_media_file(db, library.id, f"song-{index}.mp3", 100)
        db.commit()

        counts = build_media_kind_counts_for_telemetry(db)

    assert counts["audio"] == 120


def test_enabled_payload_includes_app_settings_and_media_kind_counts(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        app_settings = update_app_settings(
            db,
            AppSettingsUpdate(
                ui_preferences={"interface_language": "de", "color_theme": "dark"},
                scan_performance={
                    "scan_worker_count": 6,
                    "parallel_scan_jobs": 3,
                    "comparison_scatter_point_limit": 10000,
                },
            ),
            settings,
        )
        library = Library(
            name="Mixed",
            path="/tmp/mixed",
            type=LibraryType.mixed,
            scan_mode=ScanMode.scheduled_daily,
            duplicate_detection_mode=DuplicateDetectionMode.both,
            scan_config={},
        )
        db.add(library)
        db.flush()
        add_media_file(db, library.id, "song.mp3", 534_000_000)
        add_media_file(db, library.id, "movie.mp4", 24_000_000_000)
        db.commit()

        payload = build_telemetry_payload(db, settings, app_settings, mode="enabled")

    assert payload["usage"]["media_kind_counts"] == {"audio": 1, "video": 1, "other": 0}
    assert payload["usage"]["analyzed_file_count_rounded"] == 2
    assert payload["usage"]["storage_size_gb_rounded"] == 24
    assert payload["usage"]["scan_mode_counts"]["scheduled_daily"] == 1
    assert payload["usage"]["duplicate_detection_mode_counts"]["both"] == 1
    assert payload["app_settings"] == {
        "interface_language": "de",
        "color_theme": "dark",
        "scan_worker_count": 6,
        "parallel_scan_jobs": 3,
        "comparison_scatter_point_limit": 10000,
    }


def test_enabled_payload_counts_all_configured_libraries_not_only_dashboard_visible(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        app_settings = get_app_settings(db, settings)
        visible_library = Library(
            name="Visible",
            path="/tmp/visible",
            type=LibraryType.movies,
            scan_mode=ScanMode.manual,
            duplicate_detection_mode=DuplicateDetectionMode.off,
            scan_config={},
            show_on_dashboard=True,
        )
        hidden_library = Library(
            name="Hidden",
            path="/tmp/hidden",
            type=LibraryType.series,
            scan_mode=ScanMode.scheduled,
            duplicate_detection_mode=DuplicateDetectionMode.both,
            scan_config={},
            show_on_dashboard=False,
        )
        db.add_all([visible_library, hidden_library])
        db.flush()
        add_media_file(db, visible_library.id, "visible.mkv", 1_000_000_000)
        add_media_file(db, hidden_library.id, "hidden.mp4", 2_000_000_000)
        db.commit()

        payload = build_telemetry_payload(db, settings, app_settings, mode="enabled")

    assert payload["usage"]["library_count"] == 2
    assert payload["usage"]["library_type_counts"]["movies"] == 1
    assert payload["usage"]["library_type_counts"]["series"] == 1
    assert payload["usage"]["analyzed_file_count_rounded"] == 2
    assert payload["usage"]["storage_size_gb_rounded"] == 3
    assert payload["usage"]["media_kind_counts"]["video"] == 2
    assert payload["usage"]["scan_mode_counts"]["manual"] == 1
    assert payload["usage"]["scan_mode_counts"]["scheduled"] == 1
    assert payload["usage"]["duplicate_detection_mode_counts"]["off"] == 1
    assert payload["usage"]["duplicate_detection_mode_counts"]["both"] == 1


def test_minimal_payload_excludes_usage_and_app_settings(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        app_settings = get_app_settings(db, settings)
        payload = build_telemetry_payload(db, settings, app_settings, mode="minimal")

    assert "usage" not in payload
    assert "media_kind_counts" not in payload
    assert "app_settings" not in payload


def test_telemetry_payload_uses_normalized_backend_version(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)
    settings.app_version = "0.0.0"

    with session_factory() as db:
        app_settings = get_app_settings(db, settings)
        payload = build_telemetry_payload(db, settings, app_settings, mode="minimal")

    assert payload["app"]["version"] == "0.0.0"


def test_dev_versions_are_marked_as_test_telemetry(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)
    settings.app_version = "0.12.0-dev003"

    with session_factory() as db:
        app_settings = get_app_settings(db, settings)
        payload = build_telemetry_payload(db, settings, app_settings, mode="minimal")

    assert is_dev_app_version("0.12.0") is False
    assert is_dev_app_version("0.12.0-dev003") is True
    assert payload["app"]["version"] == "0.12.0-dev003"
    assert payload["is_test"] is True


def test_release_versions_are_not_marked_as_test_telemetry(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)
    settings.app_version = "0.12.0"

    with session_factory() as db:
        app_settings = get_app_settings(db, settings)
        payload = build_telemetry_payload(db, settings, app_settings, mode="minimal")

    assert payload["app"]["version"] == "0.12.0"
    assert payload["is_test"] is False


def test_none_payload_excludes_usage_and_app_settings(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        app_settings = get_app_settings(db, settings)
        payload = build_telemetry_payload(db, settings, app_settings, mode="none")

    assert "usage" not in payload
    assert "media_kind_counts" not in payload
    assert "app_settings" not in payload


def test_should_send_telemetry_allows_one_snapshot_per_utc_day(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        app_settings = update_app_settings(db, AppSettingsUpdate(telemetry={"mode": "enabled"}), settings)

    same_day_settings = app_settings.model_copy(
        update={
            "telemetry": app_settings.telemetry.model_copy(
                update={"last_sent_at": datetime(2026, 5, 11, 16, 10, tzinfo=UTC)}
            )
        }
    )
    next_day_settings = app_settings.model_copy(
        update={
            "telemetry": app_settings.telemetry.model_copy(
                update={"last_sent_at": datetime(2026, 5, 11, 23, 59, tzinfo=UTC)}
            )
        }
    )

    assert should_send_telemetry(same_day_settings, datetime(2026, 5, 11, 23, 59, tzinfo=UTC)) is False
    assert should_send_telemetry(next_day_settings, datetime(2026, 5, 12, 0, 0, tzinfo=UTC)) is True


def test_should_send_update_telemetry_only_for_changed_reported_versions(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)
    settings.app_version = "0.11.1"

    with session_factory() as db:
        app_settings = update_app_settings(db, AppSettingsUpdate(telemetry={"mode": "enabled"}), settings)

    same_version_settings = app_settings.model_copy(
        update={"telemetry": app_settings.telemetry.model_copy(update={"last_sent_app_version": "0.11.1"})}
    )
    previous_version_settings = app_settings.model_copy(
        update={"telemetry": app_settings.telemetry.model_copy(update={"last_sent_app_version": "0.11.0"})}
    )

    assert should_send_update_telemetry(same_version_settings, settings) is False
    assert should_send_update_telemetry(previous_version_settings, settings) is True


def test_should_send_update_telemetry_uses_legacy_last_payload_version(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)
    settings.app_version = "0.11.1"

    with session_factory() as db:
        app_settings = update_app_settings(db, AppSettingsUpdate(telemetry={"mode": "minimal"}), settings)

    legacy_settings = app_settings.model_copy(
        update={
            "telemetry": app_settings.telemetry.model_copy(
                update={"last_user_visible_payload": {"app": {"version": "0.11.1"}}}
            )
        }
    )

    assert should_send_update_telemetry(legacy_settings, settings) is False


def test_send_current_telemetry_snapshot_posts_normal_payload_and_marks_sent(tmp_path, monkeypatch) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)
    posted: dict = {}

    def fake_post_json(url, payload, timeout):
        posted["url"] = url
        posted["json"] = payload
        posted["timeout"] = timeout

    monkeypatch.setattr("backend.app.services.telemetry._post_json", fake_post_json)

    with session_factory() as db:
        update_app_settings(db, AppSettingsUpdate(telemetry={"mode": "minimal"}), settings)

        sent = send_current_telemetry_snapshot(db, settings, force=True)
        loaded = get_app_settings(db, settings)

    assert sent is True
    assert posted["url"] == "https://telemetry.example.test/api/telemetry/ingest"
    assert posted["timeout"] == settings.telemetry_timeout_seconds
    assert posted["json"]["telemetry_mode"] == "minimal"
    assert posted["json"]["is_test"] is False
    assert posted["json"]["installation_id"] != "00000000-0000-0000-0000-000000000000"
    assert loaded.telemetry.last_sent_at is not None
    assert loaded.telemetry.last_sent_app_version == settings.app_version
    assert loaded.telemetry.last_user_visible_payload == posted["json"]


def test_send_current_telemetry_snapshot_marks_dev_versions_as_test(tmp_path, monkeypatch) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)
    settings.app_version = "0.12.0-dev003"
    posted = {}

    def fake_post_json(url, payload, timeout):
        posted["json"] = payload

    monkeypatch.setattr("backend.app.services.telemetry._post_json", fake_post_json)

    with session_factory() as db:
        update_app_settings(db, AppSettingsUpdate(telemetry={"mode": "minimal"}), settings)
        sent = send_current_telemetry_snapshot(db, settings, force=True)

    assert sent is True
    assert posted["json"]["app"]["version"] == "0.12.0-dev003"
    assert posted["json"]["is_test"] is True


def test_post_json_uses_certifi_ca_bundle(monkeypatch) -> None:
    captured: dict = {}
    context = object()

    class Response:
        status = 200
        headers = {}

        def getcode(self):
            return self.status

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

    def fake_create_default_context(*, cafile):
        captured["cafile"] = cafile
        return context

    def fake_urlopen(request, *, timeout, context):
        captured["request"] = request
        captured["timeout"] = timeout
        captured["context"] = context
        return Response()

    monkeypatch.setattr("backend.app.services.telemetry.certifi.where", lambda: "/bundle/cacert.pem")
    monkeypatch.setattr("backend.app.services.telemetry.ssl.create_default_context", fake_create_default_context)
    monkeypatch.setattr("backend.app.services.telemetry.urllib.request.urlopen", fake_urlopen)

    _post_json("https://telemetry.example.test/api/telemetry/ingest", {"ok": True}, 2.0)

    assert captured["cafile"] == "/bundle/cacert.pem"
    assert captured["context"] is context
    assert captured["timeout"] == 2.0
    assert captured["request"].headers["Content-type"] == "application/json"


def test_send_current_telemetry_snapshot_retries_limited_failures(tmp_path, monkeypatch) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)
    calls: list[dict] = []
    sleeps: list[int] = []

    def fake_post_json(url, payload, timeout):
        calls.append(payload)
        if len(calls) < 4:
            raise RuntimeError("temporary network down")

    monkeypatch.setattr("backend.app.services.telemetry._post_json", fake_post_json)
    monkeypatch.setattr("backend.app.services.telemetry.time.sleep", lambda seconds: sleeps.append(seconds))

    with session_factory() as db:
        update_app_settings(db, AppSettingsUpdate(telemetry={"mode": "minimal"}), settings)

        sent = send_current_telemetry_snapshot(db, settings, force=True)
        loaded = get_app_settings(db, settings)

    assert sent is True
    assert len(calls) == 4
    assert sleeps == [1, 2, 5]
    assert loaded.telemetry.last_sent_at is not None
    assert loaded.telemetry.last_user_visible_payload == calls[-1]


def test_send_initial_telemetry_snapshot_posts_hidden_minimal_payload_and_marks_initialized(
    tmp_path,
    monkeypatch,
) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)
    posted: dict = {}

    def fake_post_json(url, payload, timeout):
        posted["url"] = url
        posted["json"] = payload
        posted["timeout"] = timeout

    monkeypatch.setattr("backend.app.services.telemetry._post_json", fake_post_json)

    with session_factory() as db:
        sent = send_initial_telemetry_snapshot(db, settings)
        loaded = get_app_settings(db, settings)

    assert sent is True
    assert posted["url"] == "https://telemetry.example.test/api/telemetry/ingest"
    assert posted["json"]["telemetry_mode"] == "minimal"
    assert posted["json"]["is_test"] is False
    assert loaded.telemetry.mode == "initialized"
    assert loaded.telemetry.last_sent_at is not None
    assert loaded.telemetry.last_sent_app_version == settings.app_version
    assert loaded.telemetry.last_user_visible_payload is None


def test_installation_id_survives_version_updates(tmp_path, monkeypatch) -> None:
    session_factory = build_session_factory()
    first_settings = build_settings(tmp_path)
    first_settings.app_version = "0.10.4"
    second_settings = build_settings(tmp_path)
    second_settings.app_version = "0.11.0"
    posted: list[dict] = []

    def fake_post_json(url, payload, timeout):
        posted.append(payload)

    monkeypatch.setattr("backend.app.services.telemetry._post_json", fake_post_json)

    with session_factory() as db:
        assert send_initial_telemetry_snapshot(db, first_settings) is True
        first_id = posted[-1]["installation_id"]
        update_app_settings(db, AppSettingsUpdate(telemetry={"mode": "enabled"}), second_settings)

        assert send_current_telemetry_snapshot(db, second_settings, force=True) is True
        loaded = get_app_settings(db, second_settings)

    assert posted[0]["app"]["version"] == "0.10.4"
    assert posted[1]["app"]["version"] == "0.11.0"
    assert posted[1]["installation_id"] == first_id
    assert loaded.telemetry.installation_id == first_id


def test_send_update_telemetry_snapshot_posts_once_after_version_change(tmp_path, monkeypatch) -> None:
    session_factory = build_session_factory()
    previous_settings = build_settings(tmp_path)
    previous_settings.app_version = "0.11.0"
    updated_settings = build_settings(tmp_path)
    updated_settings.app_version = "0.11.1"
    posted: list[dict] = []

    def fake_post_json(url, payload, timeout):
        posted.append(payload)

    monkeypatch.setattr("backend.app.services.telemetry._post_json", fake_post_json)

    with session_factory() as db:
        update_app_settings(db, AppSettingsUpdate(telemetry={"mode": "minimal"}), previous_settings)
        assert send_current_telemetry_snapshot(db, previous_settings, force=True) is True

        assert send_update_telemetry_snapshot(db, updated_settings) is True
        assert send_update_telemetry_snapshot(db, updated_settings) is False
        loaded = get_app_settings(db, updated_settings)

    assert [payload["app"]["version"] for payload in posted] == ["0.11.0", "0.11.1"]
    assert loaded.telemetry.last_sent_app_version == "0.11.1"


def test_send_initial_telemetry_snapshot_waits_for_retry_when_network_fails(tmp_path, monkeypatch) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)
    calls = 0
    sleeps: list[int] = []

    def fake_post_json(url, payload, timeout):
        nonlocal calls
        calls += 1
        raise RuntimeError("network down")

    monkeypatch.setattr("backend.app.services.telemetry._post_json", fake_post_json)
    monkeypatch.setattr("backend.app.services.telemetry.time.sleep", lambda seconds: sleeps.append(seconds))

    with session_factory() as db:
        sent = send_initial_telemetry_snapshot(db, settings)
        loaded = get_app_settings(db, settings)

    assert sent is False
    assert calls == 5
    assert sleeps == [1, 2, 5, 10]
    assert loaded.telemetry.mode == "none"
    assert loaded.telemetry.last_sent_at is None
    assert loaded.telemetry.last_user_visible_payload is None


def test_send_current_telemetry_snapshot_ignores_network_failure(tmp_path, monkeypatch) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)
    sleeps: list[int] = []

    def fake_post_json(url, payload, timeout):
        raise RuntimeError("network down")

    monkeypatch.setattr("backend.app.services.telemetry._post_json", fake_post_json)
    monkeypatch.setattr("backend.app.services.telemetry.time.sleep", lambda seconds: sleeps.append(seconds))

    with session_factory() as db:
        update_app_settings(db, AppSettingsUpdate(telemetry={"mode": "minimal"}), settings)

        sent = send_current_telemetry_snapshot(db, settings, force=True)
        loaded = get_app_settings(db, settings)

    assert sent is False
    assert sleeps == [1, 2, 5, 10]
    assert loaded.telemetry.last_sent_at is None
