import os
import tempfile

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("CONFIG_PATH", tempfile.mkdtemp(prefix="medialyze-config-"))
os.environ.setdefault("MEDIA_ROOT", tempfile.mkdtemp(prefix="medialyze-media-"))

from backend.app.core.config import Settings
from backend.app.db.base import Base
from backend.app.models.entities import AppSetting
from backend.app.schemas.app_settings import AppSettingsUpdate
from backend.app.services.app_settings import (
    BUILT_IN_DEFAULT_IGNORE_PATTERNS,
    get_app_settings,
    update_app_settings,
)


def build_session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def build_settings(tmp_path, *, disable_default_ignore_patterns: bool = False) -> Settings:
    return Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path / "media",
        disable_default_ignore_patterns=disable_default_ignore_patterns,
    )


def test_get_app_settings_seeds_built_in_default_ignore_patterns_for_new_installations(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        loaded = get_app_settings(db, settings)

    assert loaded.user_ignore_patterns == []
    assert loaded.default_ignore_patterns == list(BUILT_IN_DEFAULT_IGNORE_PATTERNS)
    assert loaded.ignore_patterns == list(BUILT_IN_DEFAULT_IGNORE_PATTERNS)
    assert [item.id for item in loaded.resolution_categories] == ["8k", "4k", "1080p", "720p", "sd"]
    assert [(item.min_width, item.min_height) for item in loaded.resolution_categories] == [
        (7296, 3040),
        (3648, 1520),
        (1824, 760),
        (1216, 506),
        (0, 0),
    ]
    assert loaded.scan_performance.scan_worker_count == 4
    assert loaded.scan_performance.parallel_scan_jobs == 2
    assert loaded.feature_flags.show_analyzed_files_csv_export is False
    assert loaded.feature_flags.show_full_width_app_shell is False
    assert loaded.feature_flags.hide_quality_score_meter is False


def test_built_in_default_ignore_patterns_include_tmm_recycle_folder() -> None:
    assert "*/.deletedByTMM/*" in BUILT_IN_DEFAULT_IGNORE_PATTERNS


def test_get_app_settings_skips_built_in_default_ignore_patterns_when_disabled(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path, disable_default_ignore_patterns=True)

    with session_factory() as db:
        loaded = get_app_settings(db, settings)

    assert loaded.user_ignore_patterns == []
    assert loaded.default_ignore_patterns == []
    assert loaded.ignore_patterns == []
    assert loaded.scan_performance.scan_worker_count == 4
    assert loaded.scan_performance.parallel_scan_jobs == 2
    assert loaded.feature_flags.show_analyzed_files_csv_export is False
    assert loaded.feature_flags.show_full_width_app_shell is False
    assert loaded.feature_flags.hide_quality_score_meter is False


def test_get_app_settings_treats_legacy_ignore_patterns_as_user_patterns(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        db.add(AppSetting(key="global", value={"ignore_patterns": ["*.nfo", "*/Extras/*"]}))
        db.commit()

        loaded = get_app_settings(db, settings)

    assert loaded.user_ignore_patterns == ["*.nfo", "*/Extras/*"]
    assert loaded.default_ignore_patterns == []
    assert loaded.ignore_patterns == ["*.nfo", "*/Extras/*"]
    assert loaded.scan_performance.scan_worker_count == 4
    assert loaded.scan_performance.parallel_scan_jobs == 2
    assert loaded.feature_flags.show_analyzed_files_csv_export is False
    assert loaded.feature_flags.show_full_width_app_shell is False
    assert loaded.feature_flags.hide_quality_score_meter is False


def test_update_app_settings_persists_split_ignore_patterns_and_merges_effective_list(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        updated = update_app_settings(
            db,
            AppSettingsUpdate(
                user_ignore_patterns=["  *.tmp  ", "*/cache/*", "*.tmp"],
                default_ignore_patterns=["*/.DS_Store", "*.tmp", "*/@eaDir/*"],
                scan_performance={
                    "scan_worker_count": 6,
                    "parallel_scan_jobs": 3,
                },
                feature_flags={
                    "show_analyzed_files_csv_export": True,
                    "show_full_width_app_shell": True,
                    "hide_quality_score_meter": True,
                },
            ),
            settings,
        )
        loaded = get_app_settings(db, settings)
        stored = db.get(AppSetting, "global")

    assert updated.user_ignore_patterns == ["*.tmp", "*/cache/*"]
    assert updated.default_ignore_patterns == ["*/.DS_Store", "*.tmp", "*/@eaDir/*"]
    assert updated.ignore_patterns == ["*.tmp", "*/cache/*", "*/.DS_Store", "*/@eaDir/*"]
    assert updated.scan_performance.scan_worker_count == 6
    assert updated.scan_performance.parallel_scan_jobs == 3
    assert updated.feature_flags.show_analyzed_files_csv_export is True
    assert updated.feature_flags.show_full_width_app_shell is True
    assert updated.feature_flags.hide_quality_score_meter is True
    assert loaded == updated
    assert stored is not None
    assert stored.value == {
        "user_ignore_patterns": ["*.tmp", "*/cache/*"],
        "default_ignore_patterns": ["*/.DS_Store", "*.tmp", "*/@eaDir/*"],
        "resolution_categories": [item.model_dump(mode="json") for item in updated.resolution_categories],
        "scan_performance": {
            "scan_worker_count": 6,
            "parallel_scan_jobs": 3,
        },
        "feature_flags": {
            "show_analyzed_files_csv_export": True,
            "show_full_width_app_shell": True,
            "hide_quality_score_meter": True,
        },
    }


def test_update_app_settings_accepts_legacy_ignore_pattern_payload_as_user_patterns(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        updated = update_app_settings(
            db,
            AppSettingsUpdate(ignore_patterns=["[sample]", "*thumbs.db"]),
            settings,
        )

    assert updated.user_ignore_patterns == ["[sample]", "*thumbs.db"]
    assert updated.default_ignore_patterns == list(BUILT_IN_DEFAULT_IGNORE_PATTERNS)
    assert updated.ignore_patterns == ["[sample]", "*thumbs.db", *BUILT_IN_DEFAULT_IGNORE_PATTERNS[:-1]]
    assert updated.scan_performance.scan_worker_count == 4
    assert updated.scan_performance.parallel_scan_jobs == 2
    assert updated.feature_flags.show_analyzed_files_csv_export is False
    assert updated.feature_flags.show_full_width_app_shell is False
    assert updated.feature_flags.hide_quality_score_meter is False


def test_update_app_settings_supports_resolution_category_renames_and_remaps_quality_profiles(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        updated = update_app_settings(
            db,
            AppSettingsUpdate(
                resolution_categories=[
                    {"id": "4k", "label": "UHD", "min_width": 3840, "min_height": 2160},
                    {"id": "1080p", "label": "Full HD", "min_width": 1920, "min_height": 1080},
                    {"id": "sd", "label": "SD", "min_width": 0, "min_height": 0},
                ]
            ),
            settings,
        )

    assert [item.id for item in updated.resolution_categories] == ["4k", "1080p", "sd"]
    assert [item.label for item in updated.resolution_categories] == ["UHD", "Full HD", "SD"]


def test_update_app_settings_merges_partial_scan_performance_updates(tmp_path) -> None:
    session_factory = build_session_factory()
    settings = build_settings(tmp_path)

    with session_factory() as db:
        first = update_app_settings(
            db,
            AppSettingsUpdate(
                scan_performance={
                    "scan_worker_count": 7,
                    "parallel_scan_jobs": 2,
                }
            ),
            settings,
        )
        second = update_app_settings(
            db,
            AppSettingsUpdate(scan_performance={"parallel_scan_jobs": 5}),
            settings,
        )

    assert first.scan_performance.scan_worker_count == 7
    assert first.scan_performance.parallel_scan_jobs == 2
    assert second.scan_performance.scan_worker_count == 7
    assert second.scan_performance.parallel_scan_jobs == 5
