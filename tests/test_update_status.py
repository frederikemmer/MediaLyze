import json
from datetime import UTC, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.models.entities import AppSetting
from backend.app.services.update_status import (
    UPDATE_STATUS_KEY,
    check_for_updates,
    get_update_status,
    is_newer_stable_version,
    parse_remote_release_notes,
)


def _session_factory():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def test_stable_version_comparison_ignores_dev_and_prerelease_values() -> None:
    assert is_newer_stable_version("0.12.0", "0.11.0") is True
    assert is_newer_stable_version("v0.11.0", "0.11.0") is False
    assert is_newer_stable_version("0.12.0-beta.1", "0.11.0") is False
    assert is_newer_stable_version("0.12.0", "dev") is False


def test_parse_remote_release_notes_reads_released_versions_only() -> None:
    notes = parse_remote_release_notes(
        "\n".join(
            [
                "# Changelog",
                "## vUnreleased",
                "- hidden",
                "## v0.12.0",
                ">2026-05-15",
                "### New",
                "- add `download` button [#12](https://github.com/frederikemmer/MediaLyze/issues/12)",
                "## v0.11.0",
                "### Fixed",
                "- improve **history**",
            ]
        )
    )

    assert notes == [
        {
            "version": "0.12.0",
            "date": "2026-05-15",
            "sections": [{"title": "New", "items": ["add download button [#12](https://github.com/frederikemmer/MediaLyze/issues/12)"]}],
        },
        {
            "version": "0.11.0",
            "date": None,
            "sections": [{"title": "Fixed", "items": ["improve history"]}],
        },
    ]


def test_update_check_persists_latest_stable_release_and_remote_notes(monkeypatch) -> None:
    settings = Settings()
    settings.app_version = "0.11.0"
    session_factory = _session_factory()

    def fake_get_text(url: str, _timeout: float) -> str:
        if url.endswith("/latest"):
            return json.dumps({"tag_name": "v0.12.0", "draft": False, "prerelease": False})
        return "## v0.12.0\n\n### New\n\n- newer release"

    monkeypatch.setattr("backend.app.services.update_status._get_text", fake_get_text)

    with session_factory() as db:
        status = check_for_updates(db, settings)

    assert status is not None
    assert status.latest_version == "0.12.0"
    assert status.update_available is True
    assert status.release_notes[0].version == "0.12.0"


def test_failed_update_check_keeps_last_successful_result(monkeypatch) -> None:
    settings = Settings()
    settings.app_version = "0.11.0"
    session_factory = _session_factory()

    with session_factory() as db:
        db.add(
            AppSetting(
                key=UPDATE_STATUS_KEY,
                value={
                    "latest_version": "0.12.0",
                    "checked_at": datetime(2026, 5, 15, tzinfo=UTC).isoformat(),
                    "release_notes": [],
                },
            )
        )
        db.commit()

        monkeypatch.setattr(
            "backend.app.services.update_status._get_text",
            lambda *_args: (_ for _ in ()).throw(OSError("offline")),
        )

        assert check_for_updates(db, settings) is None
        status = get_update_status(db, settings)

    assert status.latest_version == "0.12.0"
    assert status.update_available is True
