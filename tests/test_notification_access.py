"""Notification targets follow the same rights as their destination pages."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.app.db.base import Base
from backend.app.models.entities import Library, LibraryType, MediaFile
from backend.app.services.access import Principal
from backend.app.services.notification_access import notification_source_allowed


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        library = Library(id=1, name="Visible", path="/visible", type=LibraryType.movies)
        session.add(library)
        session.add(Library(id=2, name="Hidden", path="/hidden", type=LibraryType.movies))
        session.flush()
        session.add(MediaFile(id=1, library_id=1, filename="movie.mkv", relative_path="movie.mkv", extension="mkv", size_bytes=1, mtime=1))
        session.flush()
        yield session
    engine.dispose()


def principal(*rights, actions=()):
    return Principal("account", "reader", "Reader", False,
                     {"global": list(rights), "mode": "per_library", "libraries": {"1": list(actions)}})


@pytest.mark.parametrize("section,right", [
    ("quality-profiles", "settings.quality.view"),
    ("compatibility-profiles", "settings.hardware.view"),
    ("transcoding-presets", "settings.presets.view"),
    ("accounts", "access.users"),
    ("jellyfin", "connector.view"),
    ("telemetry", "settings.app.view"),
])
def test_settings_destination_requires_its_own_right(db, section, right):
    source = {"area": "settings", "href": f"/settings?section={section}"}
    assert notification_source_allowed(db, principal(right), source)
    assert not notification_source_allowed(db, principal(), source)
    if right != "settings.app.view":
        assert not notification_source_allowed(db, principal("settings.app.view"), source)


def test_personal_destinations_are_available_without_global_settings(db):
    for href in ("/settings?section=accounts&account=me", "/settings?section=application#notification-settings", "/settings?section=logs"):
        assert notification_source_allowed(db, principal(), {"area": "settings", "href": href})


def test_transcoding_settings_sources_require_the_destination_permission(db):
    source = {"area": "transcoding", "href": "/settings?section=transcoding-presets"}
    assert notification_source_allowed(db, principal("settings.presets.view"), source)
    assert not notification_source_allowed(db, principal(actions=["library.read", "transcode.view"]), source)


def test_file_and_transcoding_overview_targets_remain_library_scoped(db):
    metadata = principal(actions=["library.read"])
    transcoding = principal(actions=["library.read", "transcode.view"])
    assert notification_source_allowed(db, metadata, {"area": "library", "href": "/files/1"})
    assert not notification_source_allowed(db, metadata, {"area": "library", "href": "/libraries/2"})
    assert not notification_source_allowed(db, metadata, {"area": "transcoding", "href": "/files/1"})
    for href in ("/files/1", "/transcoding"):
        assert notification_source_allowed(db, transcoding, {"area": "transcoding", "href": href})
        assert not notification_source_allowed(db, principal(), {"area": "transcoding", "href": href})
    assert not notification_source_allowed(db, transcoding, {"area": "transcoding", "href": "/files/999"})


def test_unknown_or_external_settings_destinations_are_denied(db):
    for href in ("/settings?section=unknown", "//example.org/settings?section=application", "https://example.org/settings?section=application", "/other?section=application"):
        assert not notification_source_allowed(db, principal("settings.app.view"), {"area": "settings", "href": href})


@pytest.mark.parametrize("href,right", [("/", "overview.dashboard"), ("/storage-map", "overview.storage"), ("/files/compare", "overview.compare")])
def test_personal_layout_destinations_require_the_overview_right(db, href, right):
    source = {"area": "library", "href": href}
    assert notification_source_allowed(db, principal(right), source)
    assert not notification_source_allowed(db, principal(), source)


def test_atomic_preference_updates_preserve_independent_fields_and_storage_removals(db):
    from backend.app.models.access import LocalAccount
    from backend.app.services.personal_preferences import patch_preferences
    def merge_account_preferences(session, account_id, patch):
        return patch_preferences(session, Principal("account", account_id, "Reader", False, {}), patch)
    account = LocalAccount(id="test-preferences", username="Reader", username_key="reader", password_hash="not-used",
                           preferences={"extra": "kept", "storage": {"removed": "old"}, "ui_preferences": {"notifications": {"duration_seconds": 2.5}}})
    db.add(account)
    db.commit()
    # Simulate a request that already loaded the old JSON before another writer.
    stale = db.get(LocalAccount, account.id)
    assert stale.preferences["ui_preferences"]["notifications"]["duration_seconds"] == 2.5
    with Session(db.bind) as other:
        merge_account_preferences(other, account.id, {"ui_preferences": {"notifications": {"duration_seconds": 8}}})
        other.commit()
    result = merge_account_preferences(db, account.id, {"storage": {"medialyze-theme": "dark"}, "ui_preferences": {"color_theme": "dark"}})
    db.commit()
    assert result == {"extra": "kept", "storage": {"medialyze-theme": "dark"}, "ui_preferences": {"color_theme": "dark", "notifications": {"duration_seconds": 8}}}
