import os
import tempfile

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("CONFIG_PATH", tempfile.mkdtemp(prefix="medialyze-config-"))
os.environ.setdefault("MEDIA_ROOT", tempfile.mkdtemp(prefix="medialyze-media-"))

from backend.app.db.base import Base
from backend.app.services.app_settings import get_app_settings, update_app_settings
from backend.app.schemas.app_settings import AppSettingsUpdate


def test_update_app_settings_persists_ignore_patterns() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        updated = update_app_settings(
            db,
            AppSettingsUpdate(ignore_patterns=["  \\.nfo$  ", "(^|/)extras(/|$)", "\\.nfo$"]),
        )
        loaded = get_app_settings(db)

    assert updated.ignore_patterns == ["\\.nfo$", "(^|/)extras(/|$)"]
    assert loaded.ignore_patterns == ["\\.nfo$", "(^|/)extras(/|$)"]


def test_update_app_settings_rejects_invalid_regex() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    with session_factory() as db:
        with pytest.raises(ValueError, match="Invalid ignore pattern"):
            update_app_settings(db, AppSettingsUpdate(ignore_patterns=["["]))
