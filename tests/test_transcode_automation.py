from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from backend.app.db.base import Base
from backend.app.models.entities import (
    TranscodeAutomationRecord,
    TranscodeProfile,
    TranscodeRule,
)
from backend.app.schemas.transcoding import (
    TranscodeCondition,
    TranscodeConditionGroup,
    TranscodeProfileCreate,
    TranscodeProfileDefinition,
    TranscodeProfileStreamRule,
    TranscodeRuleCreate,
    TranscodeRuleUpdate,
    TranscodeReplacementApproval,
)
from backend.app.services import transcode_automation as automation
from backend.app.services import transcoding
from backend.app.services.app_settings import get_app_settings
from backend.app.utils.time import utc_now
from tests.test_transcoding import _capabilities, _media_file, _settings


def _session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def _profile_definition(*, external: bool = False) -> TranscodeProfileDefinition:
    return TranscodeProfileDefinition(
        container="source",
        execution_mode="cpu_only",
        video_rules=[
            TranscodeProfileStreamRule(
                match_codecs=["hevc"],
                action="convert",
                codec="h264",
                encoder="libx264",
                crf=20,
            )
        ],
        external_subtitle_rules=(
            [TranscodeProfileStreamRule(match_languages=["en"], action="copy")]
            if external
            else []
        ),
    )


def _condition_group(*children, operator: str = "and") -> TranscodeConditionGroup:
    return TranscodeConditionGroup(operator=operator, children=list(children))


def test_saved_profile_schema_is_stream_index_free() -> None:
    with pytest.raises(ValidationError):
        TranscodeProfileDefinition(video_rules=[{"stream_index": 0}])

    rule = TranscodeProfileStreamRule.model_validate(
        {"match": {"codec": "hevc"}, "action": "encode", "target_codec": "h264"}
    )
    assert rule.match_codecs == ["hevc"]
    assert rule.action == "convert"
    assert rule.codec == "h264"
    assert "stream_index" not in rule.model_dump()


def test_builtin_profiles_are_seeded_and_immutable(tmp_path: Path) -> None:
    factory = _session_factory()
    with factory() as db:
        automation.ensure_builtin_transcode_profiles(db)
        db.commit()
        profiles = automation.list_transcode_profiles(db)

        assert {profile.builtin_key for profile in profiles} == {"compatibility", "storage", "modern"}
        builtin = db.scalar(select(TranscodeProfile).where(TranscodeProfile.builtin_key == "storage"))
        assert builtin is not None
        with pytest.raises(automation.TranscodeAutomationError, match="immutable"):
            automation.update_transcode_profile(
                db,
                builtin.id,
                automation.TranscodeProfileUpdate(description="changed"),
            )


def test_profile_and_rule_versions_revoke_replace_approval(tmp_path: Path) -> None:
    factory = _session_factory()
    settings = _settings(tmp_path)
    with factory() as db:
        media_file = _media_file(db, tmp_path)
        automation.ensure_builtin_transcode_profiles(db)
        db.commit()
        profile = automation.create_transcode_profile(
            db,
            TranscodeProfileCreate(name="  Test profile  ", definition=_profile_definition()),
        )
        assert profile.name == "Test profile"

        created = automation.create_transcode_rule(
            db,
            TranscodeRuleCreate(
                name="Replace source",
                enabled=True,
                priority=0,
                library_ids=[media_file.library_id],
                profile_id=profile.id,
                output_mode="replace_original",
            ),
        )
        assert created.enabled is False
        approved = automation.approve_transcode_rule_replacement(
            db, created.id, TranscodeReplacementApproval(confirm=True)
        )
        assert approved.replacement_approved is True
        enabled = automation.update_transcode_rule(
            db, created.id, TranscodeRuleUpdate(enabled=True)
        )
        assert enabled.enabled is True
        assert enabled.replacement_approved is True

        changed = automation.update_transcode_rule(
            db,
            created.id,
            TranscodeRuleUpdate(conditions=_condition_group(TranscodeCondition(field="size", operator=">", value=1))),
        )
        assert changed.version == created.version + 1
        assert changed.enabled is False
        assert changed.replacement_approved is False

        approved_again = automation.approve_transcode_rule_replacement(
            db, created.id, TranscodeReplacementApproval(confirm=True)
        )
        automation.update_transcode_rule(db, created.id, TranscodeRuleUpdate(enabled=True))
        assert approved_again.replacement_approved is True

        profile_model = db.get(TranscodeProfile, profile.id)
        assert profile_model is not None
        next_definition = _profile_definition()
        next_definition.video_rules[0].crf = 24
        updated_profile = automation.update_transcode_profile(
            db,
            profile.id,
            automation.TranscodeProfileUpdate(definition=next_definition),
        )
        assert updated_profile.version == profile.version + 1
        affected_rule = automation.serialize_transcode_rule(db, db.get(TranscodeRule, created.id))
        assert affected_rule.enabled is False
        assert affected_rule.replacement_approved is False


def test_conditions_support_nested_and_or_missing_and_multitrack(tmp_path: Path) -> None:
    factory = _session_factory()
    settings = _settings(tmp_path)
    with factory() as db:
        media_file = _media_file(db, tmp_path)
        app_settings = get_app_settings(db, settings)

        nested = _condition_group(
            TranscodeCondition(field="size", operator=">=", value=1),
            _condition_group(
                TranscodeCondition(field="video_codec", operator="equals", value="h264"),
                TranscodeCondition(field="hdr_type", operator="equals", value="hdr10"),
                operator="or",
            ),
        )
        assert automation.condition_matches(media_file, nested, app_settings) is True
        assert automation.condition_matches(
            media_file,
            _condition_group(
                TranscodeCondition(field="audio_languages", operator="equals", value="en"),
                TranscodeCondition(field="subtitle_sources", operator="contains", value="external"),
            ),
            app_settings,
        ) is True
        assert automation.condition_matches(
            media_file,
            _condition_group(
                TranscodeCondition(field="audio_bitrate", operator="not_equals", value=123),
            ),
            app_settings,
        ) is False
        assert automation.condition_matches(
            media_file,
            _condition_group(TranscodeCondition(field="audio_bitrate", operator="missing")),
            app_settings,
        ) is True


def test_reordering_keeps_approved_replace_version(tmp_path: Path) -> None:
    factory = _session_factory()
    with factory() as db:
        media_file = _media_file(db, tmp_path)
        automation.ensure_builtin_transcode_profiles(db)
        db.commit()
        profile = db.scalar(select(TranscodeProfile).where(TranscodeProfile.builtin_key == "compatibility"))
        assert profile is not None
        replace_rule = automation.create_transcode_rule(
            db,
            TranscodeRuleCreate(
                name="Approved replace",
                priority=0,
                library_ids=[media_file.library_id],
                profile_id=profile.id,
                output_mode="replace_original",
            ),
        )
        other_rule = automation.create_transcode_rule(
            db,
            TranscodeRuleCreate(
                name="Other rule",
                priority=1,
                library_ids=[media_file.library_id],
                profile_id=profile.id,
            ),
        )
        approved = automation.approve_transcode_rule_replacement(
            db, replace_rule.id, TranscodeReplacementApproval(confirm=True)
        )
        assert approved.replacement_approved is True
        reordered = automation.reorder_transcode_rules(
            db, automation.TranscodeRuleReorder(rule_ids=[other_rule.id, replace_rule.id])
        )
        current = next(rule for rule in reordered if rule.id == replace_rule.id)
        assert current.version == replace_rule.version + 1
        assert current.replacement_approved is True


def test_profile_materialization_copies_unmatched_internal_and_external_is_opt_in(tmp_path: Path) -> None:
    factory = _session_factory()
    settings = _settings(tmp_path)
    with factory() as db:
        media_file = _media_file(db, tmp_path)
        profile = TranscodeProfile(
            name="materialization",
            definition=_profile_definition().model_dump(mode="json"),
        )
        db.add(profile)
        db.commit()
        app_settings = get_app_settings(db, settings)

        plan = automation.materialize_transcode_profile(
            profile,
            media_file,
            _capabilities(),
            app_settings,
        )
        assert plan.profile == "expert"
        assert [(item.stream_index, item.action.value) for item in plan.video_streams] == [(0, "encode")]
        assert [(item.stream_index, item.action.value) for item in plan.audio_streams] == [(1, "copy")]
        assert [(item.stream_index, item.action.value) for item in plan.subtitle_streams] == [(2, "copy")]
        assert plan.external_subtitles == []

        definition = _profile_definition(external=True)
        profile.definition = definition.model_dump(mode="json")
        db.commit()
        plan_with_sidecar = automation.materialize_transcode_profile(
            profile,
            media_file,
            _capabilities(),
            app_settings,
        )
        assert [(item.subtitle_id, item.action) for item in plan_with_sidecar.external_subtitles] == [
            (media_file.external_subtitles[0].id, "copy")
        ]


def test_output_subfolder_is_relative_and_keeps_library_root_layout(monkeypatch, tmp_path: Path) -> None:
    factory = _session_factory()
    settings = _settings(tmp_path)
    monkeypatch.setattr(transcoding, "get_transcode_capabilities", lambda *_args, **_kwargs: _capabilities())
    with factory() as db:
        media_file = _media_file(db, tmp_path)
        plan = transcoding.initial_transcode_profiles(media_file, _capabilities())["compatibility"]
        validation = transcoding.validate_transcode_plan(
            db,
            settings,
            media_file,
            plan,
            output_subfolder="anime\\optimized",
        )
        assert validation.valid is True
        output = Path(validation.output_path)
        output_root = (settings.config_path / "Transcode_Output").resolve()
        assert output.relative_to(output_root).as_posix().startswith("anime/optimized/library-")
        assert output.name == "Movie [3840x2160, HDR10, HEVC] [en].mkv"

        for invalid in ("../escape", "/absolute", "C:/drive", "//server/share", "a/../b"):
            with pytest.raises(ValueError):
                transcoding.normalize_transcode_output_subfolder(invalid)


def test_first_blocked_winner_does_not_fall_through(tmp_path: Path) -> None:
    factory = _session_factory()
    settings = _settings(tmp_path)
    with factory() as db:
        media_file = _media_file(db, tmp_path)
        automation.ensure_builtin_transcode_profiles(db)
        db.commit()
        profile = db.scalar(select(TranscodeProfile).where(TranscodeProfile.builtin_key == "compatibility"))
        assert profile is not None
        first = automation.create_transcode_rule(
            db,
            TranscodeRuleCreate(
                name="First replacement",
                priority=0,
                library_ids=[media_file.library_id],
                profile_id=profile.id,
                output_mode="replace_original",
            ),
        )
        second = automation.create_transcode_rule(
            db,
            TranscodeRuleCreate(
                name="Fallback output",
                priority=1,
                library_ids=[media_file.library_id],
                profile_id=profile.id,
            ),
        )
        first_model = db.get(TranscodeRule, first.id)
        second_model = db.get(TranscodeRule, second.id)
        assert first_model is not None and second_model is not None
        first_model.enabled = True
        second_model.enabled = True
        db.commit()
        rules = automation._active_rules(db)
        decision = automation._decision_for_file(
            db,
            settings,
            media_file,
            rules,
            get_app_settings(db, settings),
            _capabilities(),
            retry_failed=False,
        )
        assert decision.status == "blocked"
        assert decision.rule_id == first.id
        assert decision.reason and "approval" in decision.reason.lower()


def test_durable_record_skips_same_source_and_rule_version(tmp_path: Path) -> None:
    factory = _session_factory()
    settings = _settings(tmp_path)
    with factory() as db:
        media_file = _media_file(db, tmp_path)
        automation.ensure_builtin_transcode_profiles(db)
        db.commit()
        profile = db.scalar(select(TranscodeProfile).where(TranscodeProfile.builtin_key == "compatibility"))
        assert profile is not None
        rule = automation.create_transcode_rule(
            db,
            TranscodeRuleCreate(
                name="Durable record rule",
                priority=0,
                library_ids=[media_file.library_id],
                profile_id=profile.id,
            ),
        )
        rule_model = db.get(TranscodeRule, rule.id)
        assert rule_model is not None
        rule_model.enabled = True
        db.add(
            TranscodeAutomationRecord(
                identity_key=automation._identity_key(media_file),
                library_id=media_file.library_id,
                source_file_id=media_file.id,
                library_root_id=media_file.library_root_id,
                relative_path=media_file.relative_path,
                source_path_snapshot=str(Path(media_file.library_root.path) / media_file.relative_path),
                source_size_snapshot=media_file.size_bytes,
                source_mtime_snapshot=media_file.mtime,
                rule_id=rule.id,
                rule_version=rule.version,
                profile_id=profile.id,
                profile_version=profile.version,
                status="completed",
                result_source_size=media_file.size_bytes,
                result_source_mtime=media_file.mtime,
            )
        )
        db.commit()
        decision = automation._decision_for_file(
            db,
            settings,
            media_file,
            automation._active_rules(db),
            get_app_settings(db, settings),
            _capabilities(),
            retry_failed=False,
        )
        assert decision.status == "skipped"
        assert "already processed" in (decision.reason or "")
