from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable, Iterable

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from backend.app.core.config import Settings
from backend.app.models.entities import (
    JobStatus,
    Library,
    MediaFile,
    TranscodeAutomationRecord,
    TranscodeAutomationRun,
    TranscodeJob,
    TranscodeProfile,
    TranscodeRule,
)
from backend.app.schemas.transcoding import (
    TranscodeAutomationDecisionRead,
    TranscodeAutomationPreviewRead,
    TranscodeAutomationRunRead,
    TranscodeAutomationScope,
    TranscodeCondition,
    TranscodeConditionGroup,
    TranscodeProfileCreate,
    TranscodeProfileDefinition,
    TranscodeProfilePlanRead,
    TranscodeProfileRead,
    TranscodeProfileStreamRule,
    TranscodeProfileUpdate,
    TranscodeReplacementApproval,
    TranscodeRuleCreate,
    TranscodeRuleRead,
    TranscodeRuleReorder,
    TranscodeRuleUpdate,
)
from backend.app.services.app_settings import get_app_settings
from backend.app.services.languages import expand_language_search_terms, normalize_language_tag
from backend.app.services.media_search import (
    SearchValidationError,
    _parse_bitrate_value,
    _parse_duration_value,
    _parse_quality_score_value,
    _parse_size_value,
)
from backend.app.services.resolution_categories import default_resolution_categories
from backend.app.services.transcoding import (
    TranscodeValidationError,
    _available_encoder,
    _listed_encoder,
    _preferred_hardware_encoders,
    _source_container,
    _source_paths,
    get_transcode_capabilities,
    normalize_transcode_output_subfolder,
    queue_transcode_job,
    validate_transcode_plan,
)
from backend.app.utils.time import utc_now


class TranscodeAutomationError(ValueError):
    pass


AUTOMATION_PAGE_SIZE = 50
TERMINAL_AUTOMATION_STATUSES = {"completed", "failed", "canceled"}


def _profile_definition(profile: TranscodeProfile) -> TranscodeProfileDefinition:
    try:
        return TranscodeProfileDefinition.model_validate(profile.definition or {})
    except Exception as exc:
        raise TranscodeAutomationError(
            f"Profile {profile.name!r} contains an invalid definition"
        ) from exc


def _profile_payload(profile: TranscodeProfile, rule_count: int = 0) -> TranscodeProfileRead:
    return TranscodeProfileRead(
        id=profile.id,
        name=profile.name,
        description=profile.description or "",
        version=profile.version,
        is_builtin=bool(profile.is_builtin),
        builtin_key=profile.builtin_key,
        definition=_profile_definition(profile),
        used_by_rule_count=rule_count,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


def serialize_transcode_profile(db: Session, profile: TranscodeProfile) -> TranscodeProfileRead:
    count = int(db.scalar(select(func.count(TranscodeRule.id)).where(TranscodeRule.profile_id == profile.id)) or 0)
    return _profile_payload(profile, count)


def _profile_definition_for_builtin(key: str) -> TranscodeProfileDefinition:
    if key == "compatibility":
        return TranscodeProfileDefinition(container="source")
    if key == "storage":
        return TranscodeProfileDefinition(
            container="mkv",
            video_rules=[
                TranscodeProfileStreamRule(
                    action="convert",
                    codec="hevc",
                    crf=22,
                    preset="medium",
                )
            ],
        )
    if key == "modern":
        return TranscodeProfileDefinition(
            container="mkv",
            video_rules=[
                TranscodeProfileStreamRule(
                    action="convert",
                    codec="av1",
                    crf=30,
                    preset="6",
                )
            ],
        )
    raise TranscodeAutomationError(f"Unknown built-in transcoding profile: {key}")


BUILTIN_PROFILE_SPECS = (
    ("compatibility", "Compatibility", "Copy compatible streams without changing their codecs."),
    ("storage", "Storage saver", "Convert video to HEVC while keeping audio and subtitles."),
    ("modern", "Modern AV1", "Convert video to AV1 while keeping audio and subtitles."),
)


def ensure_builtin_transcode_profiles(db: Session) -> None:
    """Seed immutable templates without overwriting user-edited database data."""

    existing_names = {str(name).casefold() for name in db.scalars(select(TranscodeProfile.name)).all()}
    dirty = False
    for key, name, description in BUILTIN_PROFILE_SPECS:
        if db.scalar(select(TranscodeProfile).where(TranscodeProfile.builtin_key == key)) is not None:
            continue
        actual_name = name
        if actual_name.casefold() in existing_names:
            actual_name = f"MediaLyze {name}"
        profile = TranscodeProfile(
            name=actual_name,
            description=description,
            version=1,
            is_builtin=True,
            builtin_key=key,
            definition=_profile_definition_for_builtin(key).model_dump(mode="json"),
        )
        db.add(profile)
        existing_names.add(actual_name.casefold())
        dirty = True
    if dirty:
        db.flush()


def list_transcode_profiles(db: Session) -> list[TranscodeProfileRead]:
    profiles = db.scalars(
        select(TranscodeProfile).order_by(
            TranscodeProfile.is_builtin.desc(), TranscodeProfile.name.collate("NOCASE"), TranscodeProfile.id
        )
    ).all()
    counts = {
        profile_id: int(count)
        for profile_id, count in db.execute(
            select(TranscodeRule.profile_id, func.count(TranscodeRule.id)).group_by(TranscodeRule.profile_id)
        ).all()
    }
    return [_profile_payload(profile, counts.get(profile.id, 0)) for profile in profiles]


def get_transcode_profile(db: Session, profile_id: int) -> TranscodeProfile:
    profile = db.get(TranscodeProfile, profile_id)
    if profile is None:
        raise TranscodeAutomationError("Transcoding profile not found")
    return profile


def _validate_profile_definition(definition: TranscodeProfileDefinition | None) -> TranscodeProfileDefinition:
    if definition is None:
        return TranscodeProfileDefinition()
    # Pydantic's extra-forbid rule is the important guard here: stream_index,
    # subtitle ids and other file-specific values cannot enter a saved profile.
    return TranscodeProfileDefinition.model_validate(definition.model_dump(mode="json"))


def create_transcode_profile(db: Session, payload: TranscodeProfileCreate) -> TranscodeProfileRead:
    definition = _validate_profile_definition(payload.definition)
    name = payload.name.strip()
    if not name:
        raise TranscodeAutomationError("The transcoding profile needs a name")
    if db.scalar(select(TranscodeProfile).where(func.lower(TranscodeProfile.name) == name.casefold())):
        raise TranscodeAutomationError("A transcoding profile with this name already exists")
    profile = TranscodeProfile(
        name=name,
        description=payload.description.strip(),
        version=1,
        is_builtin=False,
        definition=definition.model_dump(mode="json"),
    )
    db.add(profile)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise TranscodeAutomationError("A transcoding profile with this name already exists") from exc
    db.refresh(profile)
    return _profile_payload(profile)


def duplicate_transcode_profile(
    db: Session,
    profile_id: int,
    name: str | None = None,
) -> TranscodeProfileRead:
    source = get_transcode_profile(db, profile_id)
    candidate = (name or f"{source.name} copy").strip()
    if not candidate:
        raise TranscodeAutomationError("The duplicated profile needs a name")
    if db.scalar(select(TranscodeProfile).where(func.lower(TranscodeProfile.name) == candidate.casefold())):
        raise TranscodeAutomationError("A transcoding profile with this name already exists")
    profile = TranscodeProfile(
        name=candidate,
        description=source.description or "",
        version=1,
        is_builtin=False,
        definition=_profile_definition(source).model_dump(mode="json"),
    )
    db.add(profile)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise TranscodeAutomationError("A transcoding profile with this name already exists") from exc
    db.refresh(profile)
    return _profile_payload(profile)


def update_transcode_profile(
    db: Session,
    profile_id: int,
    payload: TranscodeProfileUpdate,
) -> TranscodeProfileRead:
    profile = get_transcode_profile(db, profile_id)
    if profile.is_builtin:
        raise TranscodeAutomationError("Built-in transcoding profiles are immutable; duplicate one to edit it")
    changes = payload.model_dump(exclude_unset=True, mode="json")
    if not changes:
        return _profile_payload(profile)
    if "name" in changes:
        name = str(changes["name"]).strip()
        if not name:
            raise TranscodeAutomationError("The transcoding profile needs a name")
        duplicate = db.scalar(
            select(TranscodeProfile).where(
                func.lower(TranscodeProfile.name) == name.casefold(),
                TranscodeProfile.id != profile.id,
            )
        )
        if duplicate:
            raise TranscodeAutomationError("A transcoding profile with this name already exists")
        profile.name = name
    if "description" in changes:
        profile.description = str(changes["description"] or "").strip()
    if "definition" in changes:
        definition = _validate_profile_definition(payload.definition)
        profile.definition = definition.model_dump(mode="json")
    definition_changed = "definition" in changes
    profile.version += 1
    if definition_changed:
        for rule in db.scalars(
            select(TranscodeRule).where(
                TranscodeRule.profile_id == profile.id,
                TranscodeRule.output_mode == "replace_original",
            )
        ).all():
            rule.replacement_approved_version = None
            rule.enabled = False
    db.commit()
    cancel_queued_automation_work(db, profile_id=profile.id, reason="The referenced profile changed")
    db.refresh(profile)
    return _profile_payload(profile)


def delete_transcode_profile(db: Session, profile_id: int) -> None:
    profile = get_transcode_profile(db, profile_id)
    if profile.is_builtin:
        raise TranscodeAutomationError("Built-in transcoding profiles cannot be deleted")
    used = int(db.scalar(select(func.count(TranscodeRule.id)).where(TranscodeRule.profile_id == profile.id)) or 0)
    if used:
        raise TranscodeAutomationError("The profile is still used by one or more rules")
    db.delete(profile)
    db.commit()


def _library_ids_exist(db: Session, library_ids: Iterable[int]) -> list[int]:
    normalized = list(dict.fromkeys(int(value) for value in library_ids))
    if not normalized:
        raise TranscodeAutomationError("At least one library must be selected")
    existing = set(db.scalars(select(Library.id).where(Library.id.in_(normalized))).all())
    missing = [value for value in normalized if value not in existing]
    if missing:
        raise TranscodeAutomationError(f"Selected library does not exist: {missing[0]}")
    return normalized


def _conditions_payload(
    conditions: TranscodeConditionGroup | None,
) -> dict[str, Any] | None:
    if conditions is None:
        return None
    return conditions.model_dump(mode="json")


def _rule_conditions(rule: TranscodeRule) -> TranscodeConditionGroup | None:
    if not rule.conditions:
        return None
    try:
        return TranscodeConditionGroup.model_validate(rule.conditions)
    except Exception as exc:
        raise TranscodeAutomationError(f"Rule {rule.name!r} contains invalid conditions") from exc


def _rule_payload(db: Session, rule: TranscodeRule) -> TranscodeRuleRead:
    profile = get_transcode_profile(db, rule.profile_id)
    return TranscodeRuleRead(
        id=rule.id,
        name=rule.name,
        enabled=bool(rule.enabled),
        priority=rule.priority,
        version=rule.version,
        library_ids=list(rule.library_ids or []),
        conditions=_rule_conditions(rule),
        profile_id=profile.id,
        profile_name=profile.name,
        profile_version=profile.version,
        output_mode=rule.output_mode,
        output_subfolder=rule.output_subfolder or "",
        replacement_approved=rule.replacement_approved_version == rule.version,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


def serialize_transcode_rule(db: Session, rule: TranscodeRule) -> TranscodeRuleRead:
    return _rule_payload(db, rule)


def list_transcode_rules(db: Session) -> list[TranscodeRuleRead]:
    return [
        _rule_payload(db, rule)
        for rule in db.scalars(
            select(TranscodeRule).order_by(TranscodeRule.priority.asc(), TranscodeRule.id.asc())
        ).all()
    ]


def get_transcode_rule(db: Session, rule_id: int) -> TranscodeRule:
    rule = db.get(TranscodeRule, rule_id)
    if rule is None:
        raise TranscodeAutomationError("Transcoding rule not found")
    return rule


def _normalized_rule_output_subfolder(value: str | None) -> str:
    try:
        return normalize_transcode_output_subfolder(value)
    except ValueError as exc:
        raise TranscodeAutomationError(str(exc)) from exc


def _validate_rule_output_layout(output_mode: str, output_subfolder: str) -> None:
    if output_subfolder and output_mode != "transcode_output":
        raise TranscodeAutomationError(
            "Output subfolders are only available for the Transcode_Output target"
        )


def _rule_enabled_for_output(rule: TranscodeRule, requested: bool) -> bool:
    if rule.output_mode == "replace_original" and rule.replacement_approved_version != rule.version:
        return False
    return bool(requested)


def create_transcode_rule(db: Session, payload: TranscodeRuleCreate) -> TranscodeRuleRead:
    name = payload.name.strip()
    if not name:
        raise TranscodeAutomationError("The transcoding rule needs a name")
    if db.scalar(select(TranscodeRule).where(func.lower(TranscodeRule.name) == name.casefold())):
        raise TranscodeAutomationError("A transcoding rule with this name already exists")
    profile = get_transcode_profile(db, payload.profile_id)
    conditions = _rule_conditions(
        TranscodeRule(
            name=name,
            conditions=_conditions_payload(payload.conditions),
            profile_id=profile.id,
            library_ids=list(payload.library_ids),
        )
    )
    normalized_libraries = _library_ids_exist(db, payload.library_ids)
    output_subfolder = _normalized_rule_output_subfolder(payload.output_subfolder)
    _validate_rule_output_layout(payload.output_mode, output_subfolder)
    # New rules are always disabled.  Replacement additionally requires the
    # separate one-time approval endpoint before it can ever be enabled.
    rule = TranscodeRule(
        name=name,
        enabled=False,
        priority=payload.priority,
        version=1,
        library_ids=normalized_libraries,
        conditions=_conditions_payload(conditions),
        profile_id=profile.id,
        output_mode=payload.output_mode,
        output_subfolder=output_subfolder,
        replacement_approved_version=None,
    )
    db.add(rule)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise TranscodeAutomationError("A transcoding rule with this name already exists") from exc
    db.refresh(rule)
    return _rule_payload(db, rule)


def update_transcode_rule(
    db: Session,
    rule_id: int,
    payload: TranscodeRuleUpdate,
) -> TranscodeRuleRead:
    rule = get_transcode_rule(db, rule_id)
    changes = payload.model_dump(exclude_unset=True, mode="json")
    if not changes:
        return _rule_payload(db, rule)
    relevant_change = any(
        key in changes for key in {"conditions", "library_ids", "profile_id", "output_mode", "output_subfolder"}
    )
    disable_requested = changes.get("enabled") is False
    if "name" in changes:
        name = str(changes["name"]).strip()
        if not name:
            raise TranscodeAutomationError("The transcoding rule needs a name")
        duplicate = db.scalar(
            select(TranscodeRule).where(func.lower(TranscodeRule.name) == name.casefold(), TranscodeRule.id != rule.id)
        )
        if duplicate:
            raise TranscodeAutomationError("A transcoding rule with this name already exists")
        rule.name = name
    if "library_ids" in changes:
        rule.library_ids = _library_ids_exist(db, payload.library_ids or [])
    if "conditions" in changes:
        rule.conditions = _conditions_payload(payload.conditions)
        _rule_conditions(rule)
    if "profile_id" in changes:
        get_transcode_profile(db, int(payload.profile_id or 0))
        rule.profile_id = int(payload.profile_id or 0)
    next_output_mode = str(changes.get("output_mode", rule.output_mode))
    next_output_subfolder = (
        _normalized_rule_output_subfolder(payload.output_subfolder)
        if "output_subfolder" in changes
        else rule.output_subfolder or ""
    )
    _validate_rule_output_layout(next_output_mode, next_output_subfolder)
    if "output_mode" in changes:
        rule.output_mode = next_output_mode
    if "output_subfolder" in changes:
        rule.output_subfolder = next_output_subfolder
    if "priority" in changes:
        rule.priority = int(payload.priority or 0)
    if "enabled" in changes:
        rule.enabled = bool(payload.enabled)
    # Enable/disable, display-name, and priority changes do not alter the
    # materialized plan.  Keeping their version stable is important for the
    # explicit replacement approval: a user must be able to approve a rule
    # and then enable it without approving the same bytes twice.  Changes to
    # the matching/output/profile contract create a new version below.
    if relevant_change:
        rule.version += 1
    if relevant_change:
        rule.replacement_approved_version = None
    rule.enabled = _rule_enabled_for_output(rule, rule.enabled)
    db.commit()
    if relevant_change or disable_requested:
        cancel_queued_automation_work(db, rule_id=rule.id, reason="The referenced rule changed")
    db.refresh(rule)
    return _rule_payload(db, rule)


def delete_transcode_rule(db: Session, rule_id: int) -> None:
    rule = get_transcode_rule(db, rule_id)
    cancel_queued_automation_work(db, rule_id=rule.id, reason="The rule was deleted")
    db.delete(rule)
    db.commit()


def reorder_transcode_rules(db: Session, payload: TranscodeRuleReorder) -> list[TranscodeRuleRead]:
    rules = db.scalars(select(TranscodeRule).order_by(TranscodeRule.id.asc())).all()
    expected = {rule.id for rule in rules}
    received = list(payload.rule_ids)
    if set(received) != expected or len(received) != len(expected):
        raise TranscodeAutomationError("Reordering must include every transcoding rule exactly once")
    by_id = {rule.id: rule for rule in rules}
    changed_rules: list[TranscodeRule] = []
    for priority, rule_id in enumerate(received):
        rule = by_id[rule_id]
        if rule.priority == priority:
            continue
        was_approved = rule.replacement_approved_version == rule.version
        rule.priority = priority
        rule.version += 1
        # Priority affects which rule wins, but does not change the bytes
        # produced by this rule. Keep an existing replace-original approval
        # attached to the new priority version; content/output changes revoke
        # approval in update_transcode_rule instead.
        if was_approved and rule.output_mode == "replace_original":
            rule.replacement_approved_version = rule.version
        changed_rules.append(rule)
    db.commit()
    for rule in changed_rules:
        cancel_queued_automation_work(db, rule_id=rule.id, reason="The transcoding rule order changed")
    return list_transcode_rules(db)


def approve_transcode_rule_replacement(
    db: Session,
    rule_id: int,
    payload: TranscodeReplacementApproval,
) -> TranscodeRuleRead:
    rule = get_transcode_rule(db, rule_id)
    if rule.output_mode != "replace_original":
        raise TranscodeAutomationError("Replacement approval is only available for replace-original rules")
    if not payload.confirm:
        rule.replacement_approved_version = None
        rule.enabled = False
    else:
        rule.replacement_approved_version = rule.version
    db.commit()
    db.refresh(rule)
    return _rule_payload(db, rule)


def _stream_matches(rule: TranscodeProfileStreamRule, stream: Any) -> bool:
    codec = str(getattr(stream, "codec", None) or getattr(stream, "format", None) or "").lower()
    codecs = {str(value).strip().lower() for value in rule.match_codecs if str(value).strip()}
    if codecs and codec not in codecs:
        return False
    languages = {
        (normalize_language_tag(str(value).strip()) or str(value).strip()).lower()
        for value in rule.match_languages
        if str(value).strip()
    }
    source_language = (normalize_language_tag(str(getattr(stream, "language", "") or "")) or "und").lower()
    if languages and source_language not in languages:
        return False
    if rule.match_default is not None and bool(getattr(stream, "default_flag", False)) != rule.match_default:
        return False
    return True


def _video_software_encoder(codec: str) -> tuple[str, ...]:
    return {
        "h264": ("libx264",),
        "hevc": ("libx265",),
        "av1": ("libsvtav1", "libaom-av1"),
        "vp9": ("libvpx-vp9",),
        "vp8": ("libvpx",),
        "mpeg2video": ("mpeg2video",),
    }.get(codec, (codec,))


def _audio_encoder(codec: str) -> tuple[str, ...]:
    return {
        "aac": ("aac",),
        "opus": ("libopus", "opus"),
        "vorbis": ("libvorbis",),
        "flac": ("flac",),
        "mp3": ("libmp3lame",),
        "ac3": ("ac3",),
        "eac3": ("eac3",),
    }.get(codec, (codec,))


def _subtitle_encoder(codec: str) -> tuple[str, ...]:
    return {
        "srt": ("srt", "subrip"),
        "subrip": ("srt", "subrip"),
        "ass": ("ass",),
        "ssa": ("ass", "ssa"),
        "webvtt": ("webvtt",),
        "vtt": ("webvtt", "vtt"),
        "mov_text": ("mov_text",),
    }.get(codec, (codec,))


def _select_encoder(
    kind: str,
    codec: str,
    requested: str | None,
    capabilities,
    execution_mode: str,
) -> str:
    if requested and requested.lower() not in {"auto", "auto_hardware", "automatic"}:
        return requested
    if kind == "video" and execution_mode != "cpu_only":
        preferred = _preferred_hardware_encoders(codec)
        selected = _available_encoder(capabilities, *preferred)
        if selected:
            return selected
        if execution_mode == "hardware_required":
            listed = _listed_encoder(capabilities, *preferred)
            if listed:
                return listed
    preferred_software = (
        _video_software_encoder(codec)
        if kind == "video"
        else _subtitle_encoder(codec)
        if kind == "subtitle"
        else _audio_encoder(codec)
    )
    return _available_encoder(capabilities, *preferred_software) or preferred_software[0]


def _materialize_stream(
    source: Any,
    rule: TranscodeProfileStreamRule,
    kind: str,
    container: str,
    capabilities,
    execution_mode: str,
) -> Any:
    from backend.app.schemas.transcoding import TranscodeStreamPlan

    action = {"copy": "copy", "convert": "encode", "remove": "drop"}[rule.action]
    source_codec = str(getattr(source, "codec", None) or getattr(source, "format", None) or "").lower() or None
    target_codec = (rule.codec or source_codec or "").lower() or None
    encoder = None
    if action == "encode":
        if not target_codec:
            target_codec = source_codec
        if not target_codec:
            target_codec = "h264" if kind == "video" else "aac"
        encoder = _select_encoder(kind, target_codec, rule.encoder, capabilities, execution_mode)
    stream_index = getattr(source, "stream_index", None)
    if stream_index is None:
        stream_index = getattr(source, "id", 0)
    return TranscodeStreamPlan(
        stream_index=int(stream_index),
        action=action,
        codec=target_codec if action == "encode" else None,
        encoder=encoder,
        bitrate=rule.bitrate,
        crf=rule.crf,
        cq=rule.cq,
        width=rule.width,
        height=rule.height,
        frame_rate=rule.frame_rate,
        pixel_format=rule.pixel_format,
        profile=rule.profile,
        level=rule.level,
        preset=rule.preset,
        gop_size=rule.gop_size,
        language=rule.language or getattr(source, "language", None),
        title=rule.title,
    )


def _first_matching_stream_rule(
    rules: list[TranscodeProfileStreamRule],
    stream: Any,
) -> TranscodeProfileStreamRule | None:
    return next((rule for rule in rules if _stream_matches(rule, stream)), None)


def materialize_transcode_profile(
    profile: TranscodeProfile,
    media_file: MediaFile,
    capabilities,
    app_settings,
    *,
    output_mode: str | None = None,
) -> Any:
    """Turn an abstract saved profile into the existing concrete plan contract."""

    definition = _profile_definition(profile)
    container = _source_container(media_file) if definition.container == "source" else definition.container
    execution_mode = (
        app_settings.transcoding.execution_mode
        if definition.execution_mode == "inherit"
        else definition.execution_mode
    )
    video_plans = []
    audio_plans = []
    subtitle_plans = []
    for source, rules in (
        (media_file.video_streams, definition.video_rules),
        (media_file.audio_streams, definition.audio_rules),
        (media_file.subtitle_streams, definition.subtitle_rules),
    ):
        target = video_plans if source is media_file.video_streams else audio_plans if source is media_file.audio_streams else subtitle_plans
        kind = "video" if target is video_plans else "audio" if target is audio_plans else "subtitle"
        for stream in sorted(source, key=lambda item: item.stream_index):
            rule = _first_matching_stream_rule(rules, stream)
            if rule is None:
                rule = TranscodeProfileStreamRule(action="copy")
            target.append(_materialize_stream(stream, rule, kind, container, capabilities, execution_mode))
    from backend.app.schemas.transcoding import ExternalSubtitlePlan, TranscodePlan

    external_plans = []
    for external in sorted(media_file.external_subtitles, key=lambda item: item.id):
        rule = _first_matching_stream_rule(definition.external_subtitle_rules, external)
        if rule is None:
            # External sidecars are never embedded implicitly.
            continue
        materialized = _materialize_stream(
            external,
            rule,
            "subtitle",
            container,
            capabilities,
            execution_mode,
        )
        external_plans.append(
            ExternalSubtitlePlan(
                subtitle_id=external.id,
                action="drop" if materialized.action == "drop" else "encode" if materialized.action == "encode" else "copy",
                codec=materialized.codec or materialized.encoder,
                language=materialized.language,
                title=materialized.title,
            )
        )
    profile_key = profile.builtin_key if profile.builtin_key in {"compatibility", "storage", "modern"} else "expert"
    return TranscodePlan(
        profile=profile_key,
        container=container,
        video_streams=video_plans,
        audio_streams=audio_plans,
        subtitle_streams=subtitle_plans,
        external_subtitles=external_plans,
        dynamic_range=definition.dynamic_range,
        chapters="keep" if definition.chapters == "keep" else "drop",
        metadata="keep" if definition.metadata == "keep" else "drop",
        cover="keep" if definition.cover == "keep" else "drop",
        attachments="keep" if definition.attachments == "keep" else "drop",
        filename_template=definition.filename_template,
        filename_template_override=definition.filename_template_override,
        include_subtitle_languages=definition.include_subtitle_languages,
        output_mode=output_mode,
        execution_mode=execution_mode,
    )


def materialize_saved_profile_plan(
    profile: TranscodeProfile,
    media_file: MediaFile,
    capabilities,
    app_settings,
) -> TranscodeProfilePlanRead:
    return TranscodeProfilePlanRead(
        profile=_profile_payload(profile),
        plan=materialize_transcode_profile(
            profile,
            media_file,
            capabilities,
            app_settings,
            output_mode=app_settings.transcoding.default_output_mode,
        ),
    )


def _field_values(media_file: MediaFile, field: str, app_settings) -> tuple[list[Any], bool]:
    key = field.strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "file": "path",
        "file_path": "path",
        "relative": "relative_path",
        "extension": "container",
        "container_format": "container",
        "runtime": "duration",
        "duration_seconds": "duration",
        "quality": "quality_score",
        "video_bitrate": "bitrate",
        "codec": "video_codec",
        "hdr": "hdr_type",
        "dynamic_range": "hdr_type",
        "audio_codec": "audio_codecs",
        "audio_spatial_profile": "audio_spatial_profiles",
        "audio_language": "audio_languages",
        "subtitle_language": "subtitle_languages",
        "subtitle_codec": "subtitle_codecs",
        "subtitle_source": "subtitle_sources",
        "bit_depth": "max_audio_bit_depth",
        "chapter_titles": "chapter_titles_search",
    }
    key = aliases.get(key, key)
    if key == "path":
        values = [media_file.filename, media_file.relative_path]
        if media_file.library_root is not None:
            values.append(media_file.library_root.display_name)
        return values, False
    if key == "filename":
        return [media_file.filename], False
    if key == "container":
        return [str(media_file.extension or Path(media_file.filename).suffix.lstrip(".")).lower()], False
    primary_video = min(media_file.video_streams, key=lambda stream: stream.stream_index, default=None)
    numeric = {
        "size": media_file.size_bytes,
        "size_bytes": media_file.size_bytes,
        "duration": media_file.duration_seconds,
        "quality_score": media_file.quality_score,
        "bitrate": media_file.bitrate,
        "audio_bitrate": media_file.audio_bitrate,
        "max_audio_bit_depth": media_file.max_audio_bit_depth,
        "audio_channels": media_file.audio_channels,
        "sample_rate": media_file.sample_rate,
        "chapter_count": media_file.chapter_count,
    }
    if key in numeric:
        return ([numeric[key]] if numeric[key] is not None else []), True
    if key == "video_codec":
        return ([str(primary_video.codec).lower()] if primary_video and primary_video.codec else []), False
    if key == "resolution":
        values: list[str] = []
        if primary_video and primary_video.width and primary_video.height:
            values.append(f"{primary_video.width}x{primary_video.height}")
            categories = app_settings.resolution_categories or default_resolution_categories()
            category = next(
                (
                    candidate
                    for candidate in categories
                    if primary_video.width >= candidate.min_width
                    and primary_video.height >= candidate.min_height
                ),
                None,
            )
            if category is not None:
                values.extend([category.id.lower(), category.label.lower()])
        return values, False
    if key == "hdr_type":
        if primary_video is None:
            return [], False
        value = str(primary_video.hdr_type).lower() if primary_video.hdr_type else "sdr"
        return list(dict.fromkeys((value, value.replace("_", " "), value.replace(" ", "_")))), False
    if key == "audio_codecs":
        return [str(stream.codec).lower() for stream in media_file.audio_streams if stream.codec], False
    if key == "audio_spatial_profiles":
        return [str(stream.spatial_audio_profile).lower() for stream in media_file.audio_streams if stream.spatial_audio_profile], False
    if key == "audio_languages":
        return [(normalize_language_tag(str(stream.language)) or "").lower() for stream in media_file.audio_streams if stream.language], False
    if key == "subtitle_languages":
        values = [(normalize_language_tag(str(stream.language)) or "").lower() for stream in media_file.subtitle_streams if stream.language]
        values.extend((normalize_language_tag(str(row.language)) or "").lower() for row in media_file.external_subtitles if row.language)
        return values, False
    if key == "subtitle_codecs":
        values = [str(stream.codec).lower() for stream in media_file.subtitle_streams if stream.codec]
        values.extend(str(row.format).lower() for row in media_file.external_subtitles if row.format)
        return values, False
    if key == "subtitle_sources":
        values: list[str] = []
        if media_file.subtitle_streams:
            values.append("internal")
        if media_file.external_subtitles:
            values.append("external")
        return values, False
    if key == "has_embedded_cover":
        return (["yes", "true"] if media_file.has_embedded_cover else ["no", "false"]), False
    if hasattr(media_file, key):
        value = getattr(media_file, key)
        return ([value] if value not in (None, "") else []), isinstance(value, (int, float))
    return [], False


def _condition_values(raw: Any) -> list[Any]:
    if isinstance(raw, (list, tuple, set)):
        return list(raw)
    return [raw]


def _parse_numeric_condition(field: str, raw: Any) -> float | int | None:
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return raw
    value = str(raw).strip()
    try:
        if field in {"size", "size_bytes"}:
            return _parse_size_value(value)
        if field in {"duration", "runtime", "duration_seconds"} and re.search(r"[smhd]", value, re.IGNORECASE):
            return _parse_duration_value(value)
        if field in {"bitrate", "audio_bitrate", "video_bitrate"}:
            return _parse_bitrate_value(value)
        if field in {"quality", "quality_score"}:
            return _parse_quality_score_value(value)
        return float(value) if "." in value else int(value)
    except (SearchValidationError, ValueError):
        return None


def _text_match(values: list[str], operator: str, wanted: list[str]) -> bool:
    if not values:
        return False
    normalized_values = [str(value).casefold() for value in values]
    normalized_wanted = [str(value).casefold() for value in wanted]
    if operator in {"equals", "equal", "is", "="}:
        return any(value == target for value in normalized_values for target in normalized_wanted)
    if operator in {"not_equals", "neq", "!=", "is_not"}:
        return not any(value == target for value in normalized_values for target in normalized_wanted)
    if operator in {"contains", "has", "like"}:
        return any(target in value for value in normalized_values for target in normalized_wanted)
    if operator in {"not_contains", "does_not_contain"}:
        return not any(target in value for value in normalized_values for target in normalized_wanted)
    if operator in {"starts_with", "prefix"}:
        return any(value.startswith(target) for value in normalized_values for target in normalized_wanted)
    if operator in {"ends_with", "suffix"}:
        return any(value.endswith(target) for value in normalized_values for target in normalized_wanted)
    if operator in {"in", "one_of"}:
        return any(value in normalized_wanted for value in normalized_values)
    if operator in {"not_in", "none_of"}:
        return not any(value in normalized_wanted for value in normalized_values)
    return False


def _condition_matches(media_file: MediaFile, condition: TranscodeCondition, app_settings) -> bool:
    values, numeric = _field_values(media_file, condition.field, app_settings)
    operator = condition.operator.strip().lower().replace("-", "_").replace(" ", "_")
    if operator in {"exists", "present", "has_value"}:
        return bool(values)
    if operator in {"missing", "not_exists", "absent", "empty"}:
        return not values
    if not values:
        return False
    raw_values = _condition_values(condition.value)
    numeric_operator = operator in {
        "=",
        "equals",
        "equal",
        "is",
        "!=",
        "neq",
        "not_equals",
        "is_not",
        ">",
        ">=",
        "<",
        "<=",
        "gt",
        "gte",
        "lt",
        "lte",
    }
    if (numeric and numeric_operator) or operator in {">", ">=", "<", "<=", "gt", "gte", "lt", "lte"}:
        actual = [float(value) for value in values if isinstance(value, (int, float))]
        if not actual:
            return False
        parsed = _parse_numeric_condition(condition.field, raw_values[0] if raw_values else None)
        if parsed is None:
            return False
        target = float(parsed)
        if operator in {">", "gt"}:
            return any(value > target for value in actual)
        if operator in {">=", "gte"}:
            return any(value >= target for value in actual)
        if operator in {"<", "lt"}:
            return any(value < target for value in actual)
        if operator in {"<=", "lte"}:
            return any(value <= target for value in actual)
        if operator in {"!=", "neq", "not_equals", "is_not"}:
            return any(value != target for value in actual)
        return any(value == target for value in actual)
    wanted = [str(value) for value in raw_values if value is not None]
    condition_field = condition.field.strip().lower().replace("-", "_").replace(" ", "_")
    if condition_field in {"audio_language", "audio_languages", "subtitle_language", "subtitle_languages", "audiobook_language"}:
        expanded_wanted: set[str] = set()
        for value in wanted:
            expanded_wanted.update(term.lower() for term in expand_language_search_terms(value))
            normalized = normalize_language_tag(value)
            if normalized:
                expanded_wanted.add(normalized.lower())
        wanted = sorted(expanded_wanted)
    if len(wanted) == 1 and wanted[0].startswith("!") and operator in {"equals", "=", "contains", "in"}:
        return not _text_match([str(value) for value in values], operator, [wanted[0][1:]])
    return _text_match([str(value) for value in values], operator, wanted)


def condition_matches(media_file: MediaFile, conditions: TranscodeConditionGroup | None, app_settings) -> bool:
    if conditions is None:
        return True
    if not conditions.children:
        return False
    results = [
        condition_matches(media_file, child, app_settings)
        if isinstance(child, TranscodeConditionGroup)
        else _condition_matches(media_file, child, app_settings)
        for child in conditions.children
    ]
    return all(results) if conditions.operator == "and" else any(results)


def _candidate_options(scope: TranscodeAutomationScope, rules: list[TranscodeRule]):
    if not rules:
        # An empty active-rule set is not an implicit "all files" selection.
        return [MediaFile.id == -1]
    library_ids = set(scope.library_ids)
    if not library_ids:
        for rule in rules:
            library_ids.update(int(value) for value in (rule.library_ids or []))
    filters = [MediaFile.is_transcode_variant.is_(False), MediaFile.video_streams.any()]
    if library_ids:
        filters.append(MediaFile.library_id.in_(library_ids))
    if scope.source_file_ids:
        filters.append(MediaFile.id.in_(scope.source_file_ids))
    return filters


def _load_candidates(
    db: Session,
    scope: TranscodeAutomationScope,
    rules: list[TranscodeRule],
    *,
    offset: int = 0,
    limit: int = AUTOMATION_PAGE_SIZE,
) -> list[MediaFile]:
    return db.scalars(
        select(MediaFile)
        .options(
            selectinload(MediaFile.library),
            selectinload(MediaFile.library_root),
            selectinload(MediaFile.media_format),
            selectinload(MediaFile.video_streams),
            selectinload(MediaFile.audio_streams),
            selectinload(MediaFile.subtitle_streams),
            selectinload(MediaFile.external_subtitles),
        )
        .where(*_candidate_options(scope, rules))
        .order_by(MediaFile.id.asc())
        .offset(offset)
        .limit(limit)
    ).all()


def _candidate_count(db: Session, scope: TranscodeAutomationScope, rules: list[TranscodeRule]) -> int:
    return int(db.scalar(select(func.count(MediaFile.id)).where(*_candidate_options(scope, rules))) or 0)


def _active_rules(db: Session, rule_ids: list[int] | None = None) -> list[TranscodeRule]:
    statement = select(TranscodeRule).where(TranscodeRule.enabled.is_(True))
    if rule_ids:
        statement = statement.where(TranscodeRule.id.in_(rule_ids))
    return db.scalars(statement.order_by(TranscodeRule.priority.asc(), TranscodeRule.id.asc())).all()


def _winning_rule(media_file: MediaFile, rules: list[TranscodeRule], app_settings) -> TranscodeRule | None:
    for rule in rules:
        if media_file.library_id not in {int(value) for value in (rule.library_ids or [])}:
            continue
        if condition_matches(media_file, _rule_conditions(rule), app_settings):
            return rule
    return None


def _identity_key(media_file: MediaFile) -> str:
    return f"{media_file.library_id}:{media_file.library_root_id or 0}:{media_file.relative_path}"


def _current_source_state(media_file: MediaFile) -> tuple[int, float]:
    return int(media_file.size_bytes), float(media_file.mtime)


def _existing_record(
    db: Session,
    media_file: MediaFile,
    rule: TranscodeRule,
    profile: TranscodeProfile,
) -> TranscodeAutomationRecord | None:
    records = db.scalars(
        select(TranscodeAutomationRecord).where(
            TranscodeAutomationRecord.identity_key == _identity_key(media_file),
            TranscodeAutomationRecord.rule_id == rule.id,
            TranscodeAutomationRecord.rule_version == rule.version,
            TranscodeAutomationRecord.profile_id == profile.id,
            TranscodeAutomationRecord.profile_version == profile.version,
        ).order_by(TranscodeAutomationRecord.created_at.desc())
    ).all()
    current_size, current_mtime = _current_source_state(media_file)
    for record in records:
        result_state = (record.result_source_size, record.result_source_mtime)
        if record.status == "completed" and result_state[0] is not None and result_state[1] is not None:
            if result_state[0] == current_size and float(result_state[1]) == current_mtime:
                return record
        if record.source_size_snapshot == current_size and float(record.source_mtime_snapshot) == current_mtime:
            return record
    return None


def _record_skip_reason(record: TranscodeAutomationRecord, retry_failed: bool) -> str | None:
    if record.status in {"queued", "running"}:
        return "A matching automation job is already queued or running"
    if record.status == "completed":
        return "This source state was already processed by the same rule and profile version"
    if record.status in {"failed", "canceled"} and not retry_failed:
        return "A previous attempt failed or was canceled; use explicit retry to run it again"
    return None


def _decision_for_file(
    db: Session,
    settings: Settings,
    media_file: MediaFile,
    rules: list[TranscodeRule],
    app_settings,
    capabilities,
    *,
    retry_failed: bool,
) -> TranscodeAutomationDecisionRead:
    base = dict(
        file_id=media_file.id,
        library_id=media_file.library_id,
        relative_path=media_file.relative_path,
        filename=media_file.filename,
    )
    rule = _winning_rule(media_file, rules, app_settings)
    if rule is None:
        return TranscodeAutomationDecisionRead(**base, status="unmatched")
    profile = db.get(TranscodeProfile, rule.profile_id)
    if profile is None:
        return TranscodeAutomationDecisionRead(
            **base,
            status="blocked",
            reason="The winning rule references a deleted profile",
            rule_id=rule.id,
            rule_name=rule.name,
            rule_version=rule.version,
        )
    common = dict(
        rule_id=rule.id,
        rule_name=rule.name,
        rule_version=rule.version,
        profile_id=profile.id,
        profile_name=profile.name,
        profile_version=profile.version,
    )
    if rule.output_mode == "replace_original" and rule.replacement_approved_version != rule.version:
        return TranscodeAutomationDecisionRead(
            **base,
            **common,
            status="blocked",
            reason="The winning replace-original rule needs approval for its current version",
        )
    existing = _existing_record(db, media_file, rule, profile)
    if existing is not None:
        reason = _record_skip_reason(existing, retry_failed)
        if reason:
            return TranscodeAutomationDecisionRead(**base, **common, status="skipped", reason=reason)
    try:
        plan = materialize_transcode_profile(profile, media_file, capabilities, app_settings, output_mode=rule.output_mode)
        plan.replacement_confirmed = rule.replacement_approved_version == rule.version
        validation = validate_transcode_plan(
            db,
            settings,
            media_file,
            plan,
            output_subfolder=rule.output_subfolder,
        )
    except Exception as exc:
        return TranscodeAutomationDecisionRead(**base, **common, status="blocked", reason=str(exc), plan=None)
    if not validation.valid:
        reason = "; ".join(validation.errors) or "The materialized plan is not executable"
        if any("already exists" in error.lower() for error in validation.errors):
            status = "skipped"
        else:
            status = "blocked"
        return TranscodeAutomationDecisionRead(
            **base,
            **common,
            status=status,
            reason=reason,
            output_path=validation.output_path,
            plan=validation.normalized_plan,
        )
    output_relative = None
    try:
        output_root = Path(
            getattr(settings, "transcode_output_root", None) or (Path(settings.config_path) / "Transcode_Output")
        ).resolve()
        if validation.output_mode == "transcode_output":
            output_relative = Path(validation.output_path).resolve().relative_to(output_root).as_posix()
        else:
            output_relative = Path(validation.output_path).resolve().relative_to(_source_paths(media_file).root).as_posix()
    except ValueError:
        output_relative = None
    return TranscodeAutomationDecisionRead(
        **base,
        **common,
        status="matched",
        output_path=validation.output_path,
        output_relative_path=output_relative,
        plan=validation.normalized_plan,
    )


def _scope_rules(db: Session, scope: TranscodeAutomationScope) -> list[TranscodeRule]:
    if scope.library_ids:
        _library_ids_exist(db, scope.library_ids)
    if scope.rule_ids:
        missing = [rule_id for rule_id in scope.rule_ids if db.get(TranscodeRule, rule_id) is None]
        if missing:
            raise TranscodeAutomationError(f"Transcoding rule not found: {missing[0]}")
    return _active_rules(db, scope.rule_ids or None)


def preview_transcode_automation(
    db: Session,
    settings: Settings,
    scope: TranscodeAutomationScope,
) -> TranscodeAutomationPreviewRead:
    app_settings = get_app_settings(db, settings)
    rules = _scope_rules(db, scope)
    capabilities = get_transcode_capabilities(settings)
    total = _candidate_count(db, scope, rules)
    limit = min(scope.limit, 100000)
    items: list[TranscodeAutomationDecisionRead] = []
    for media_file in _load_candidates(db, scope, rules, limit=limit):
        items.append(
            _decision_for_file(
                db,
                settings,
                media_file,
                rules,
                app_settings,
                capabilities,
                retry_failed=scope.retry_failed,
            )
        )
    counts = {key: 0 for key in ("matched", "queued", "blocked", "skipped", "unmatched")}
    for item in items:
        counts[item.status] = counts.get(item.status, 0) + 1
    return TranscodeAutomationPreviewRead(
        generated_at=utc_now(),
        total_files=total,
        items=items,
        **counts,
    )


def create_transcode_automation_run(
    db: Session,
    scope: TranscodeAutomationScope,
    *,
    trigger: str = "manual",
) -> TranscodeAutomationRunRead:
    _scope_rules(db, scope)
    run = TranscodeAutomationRun(
        status="queued",
        trigger_source=trigger,
        rule_ids=list(scope.rule_ids),
        library_ids=list(scope.library_ids),
        source_file_ids=list(scope.source_file_ids),
        retry_failed=scope.retry_failed,
        page_size=AUTOMATION_PAGE_SIZE,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return serialize_transcode_automation_run(run)


def serialize_transcode_automation_run(run: TranscodeAutomationRun) -> TranscodeAutomationRunRead:
    return TranscodeAutomationRunRead(
        id=run.id,
        status=run.status,
        trigger=run.trigger_source,
        rule_ids=list(run.rule_ids or []),
        library_ids=list(run.library_ids or []),
        source_file_ids=list(run.source_file_ids or []),
        retry_failed=bool(run.retry_failed),
        page_size=run.page_size,
        files_total=run.files_total,
        matched=run.matched,
        queued=run.queued,
        blocked=run.blocked,
        skipped=run.skipped,
        unmatched=run.unmatched,
        completed=run.completed,
        failed=run.failed,
        canceled=run.canceled,
        current_page=run.current_page,
        summary=dict(run.summary or {}),
        error=run.error,
        cancellation_requested=bool(run.cancellation_requested),
        created_at=run.created_at,
        updated_at=run.updated_at,
        started_at=run.started_at,
        finished_at=run.finished_at,
    )


def list_transcode_automation_runs(db: Session, limit: int = 100) -> list[TranscodeAutomationRunRead]:
    return [
        serialize_transcode_automation_run(run)
        for run in db.scalars(
            select(TranscodeAutomationRun)
            .order_by(TranscodeAutomationRun.created_at.desc(), TranscodeAutomationRun.id.desc())
            .limit(limit)
        ).all()
    ]


def get_transcode_automation_run(db: Session, run_id: int) -> TranscodeAutomationRun:
    run = db.get(TranscodeAutomationRun, run_id)
    if run is None:
        raise TranscodeAutomationError("Transcoding automation run not found")
    return run


def request_transcode_automation_cancellation(db: Session, run_id: int) -> TranscodeAutomationRunRead:
    run = get_transcode_automation_run(db, run_id)
    if run.status in TERMINAL_AUTOMATION_STATUSES:
        return serialize_transcode_automation_run(run)
    run.cancellation_requested = True
    if run.status == "queued":
        run.status = "canceled"
        run.error = "Canceled before the inventory started"
        run.finished_at = utc_now()
    db.commit()
    if run.status == "running":
        cancel_queued_automation_run_work(
            db,
            run_id=run.id,
            reason="Canceled by the user",
        )
    db.refresh(run)
    return serialize_transcode_automation_run(run)


def recover_orphaned_transcode_automation_runs(db: Session) -> int:
    runs = db.scalars(
        select(TranscodeAutomationRun).where(TranscodeAutomationRun.status.in_(["queued", "running"]))
    ).all()
    if not runs:
        return 0
    finished = utc_now()
    for run in runs:
        run.status = "canceled"
        run.cancellation_requested = True
        run.error = "Canceled during startup recovery"
        run.finished_at = finished
    run_ids = [run.id for run in runs]
    records = db.scalars(
        select(TranscodeAutomationRecord).where(
            TranscodeAutomationRecord.automation_run_id.in_(run_ids),
            TranscodeAutomationRecord.status.in_(["queued", "running"]),
        )
    ).all()
    for record in records:
        record.status = "canceled"
        record.error = "Canceled during startup recovery"
    canceled_by_run: dict[int, int] = {}
    for record in records:
        if record.automation_run_id is not None:
            canceled_by_run[record.automation_run_id] = canceled_by_run.get(record.automation_run_id, 0) + 1
    for run in runs:
        run.canceled += canceled_by_run.get(run.id, 0)
    db.commit()
    return len(runs)


def cancel_queued_automation_work(
    db: Session,
    *,
    rule_id: int | None = None,
    profile_id: int | None = None,
    reason: str,
) -> int:
    query = select(TranscodeJob).where(TranscodeJob.status == JobStatus.queued)
    if rule_id is not None:
        query = query.where(TranscodeJob.rule_id == rule_id)
    if profile_id is not None:
        query = query.where(TranscodeJob.profile_id == profile_id)
    jobs = db.scalars(query).all()
    job_ids = {job.id for job in jobs}
    for job in jobs:
        job.status = JobStatus.canceled
        job.error = reason
        job.finished_at = utc_now()
    records = db.scalars(
        select(TranscodeAutomationRecord).where(
            TranscodeAutomationRecord.status == "queued",
            *(
                [TranscodeAutomationRecord.rule_id == rule_id]
                if rule_id is not None
                else [TranscodeAutomationRecord.profile_id == profile_id]
                if profile_id is not None
                else []
            ),
        )
    ).all()
    for record in records:
        record.status = "canceled"
        record.error = reason
    if jobs or records:
        db.commit()
    return len(job_ids) + len(records)


def cancel_queued_automation_run_work(
    db: Session,
    *,
    run_id: int,
    reason: str,
) -> int:
    """Cancel only queued work owned by one inventory run.

    Running FFmpeg jobs are deliberately left alone: their immutable snapshot
    remains valid and the normal per-job cancel endpoint is still available.
    """

    jobs = db.scalars(
        select(TranscodeJob).where(
            TranscodeJob.automation_run_id == run_id,
            TranscodeJob.status == JobStatus.queued,
        )
    ).all()
    for job in jobs:
        job.status = JobStatus.canceled
        job.error = reason
        job.finished_at = utc_now()
    records = db.scalars(
        select(TranscodeAutomationRecord).where(
            TranscodeAutomationRecord.automation_run_id == run_id,
            TranscodeAutomationRecord.status == "queued",
        )
    ).all()
    for record in records:
        record.status = "canceled"
        record.error = reason
    run = db.get(TranscodeAutomationRun, run_id)
    if run is not None and records:
        run.canceled += len(records)
    if jobs or records:
        db.commit()
    return len(jobs) + len(records)


def _rule_snapshot(rule: TranscodeRule, profile: TranscodeProfile) -> dict[str, Any]:
    return {
        "rule": {
            "id": rule.id,
            "name": rule.name,
            "version": rule.version,
            "priority": rule.priority,
            "library_ids": list(rule.library_ids or []),
            "conditions": rule.conditions,
            "output_mode": rule.output_mode,
            "output_subfolder": rule.output_subfolder,
            "replacement_approved_version": rule.replacement_approved_version,
        },
        "profile": {
            "id": profile.id,
            "name": profile.name,
            "version": profile.version,
            "definition": profile.definition,
        },
    }


def _queue_decision(
    db: Session,
    settings: Settings,
    decision: TranscodeAutomationDecisionRead,
    *,
    run_id: int,
    retry_failed: bool,
    trigger: str,
) -> str:
    if decision.status != "matched" or decision.plan is None or decision.rule_id is None or decision.profile_id is None:
        return decision.status
    media_file = db.get(MediaFile, decision.file_id)
    rule = db.get(TranscodeRule, decision.rule_id)
    profile = db.get(TranscodeProfile, decision.profile_id)
    if media_file is None or rule is None or profile is None:
        return "blocked"
    # A management request may have changed the rule/profile after the page
    # was previewed.  Refresh the versioned rows before queueing so an old
    # materialized plan can never be attached to a newer contract.
    db.refresh(rule)
    db.refresh(profile)
    if (
        not rule.enabled
        or rule.version != decision.rule_version
        or profile.version != decision.profile_version
        or (
            rule.output_mode == "replace_original"
            and rule.replacement_approved_version != rule.version
        )
    ):
        return "skipped"
    try:
        source_stat = _source_paths(media_file).source.stat()
    except OSError:
        return "blocked"
    if source_stat.st_size != media_file.size_bytes or source_stat.st_mtime != media_file.mtime:
        return "skipped"
    existing = _existing_record(db, media_file, rule, profile)
    if existing is not None:
        reason = _record_skip_reason(existing, retry_failed)
        if reason:
            return "skipped"
        existing.status = "queued"
        existing.error = None
        existing.transcode_job_id = None
        existing.automation_run_id = run_id
        record = existing
    else:
        record = TranscodeAutomationRecord(
            identity_key=_identity_key(media_file),
            library_id=media_file.library_id,
            source_file_id=media_file.id,
            library_root_id=media_file.library_root_id,
            relative_path=media_file.relative_path,
            source_path_snapshot=str(_source_paths(media_file).source),
            source_size_snapshot=media_file.size_bytes,
            source_mtime_snapshot=media_file.mtime,
            rule_id=rule.id,
            rule_version=rule.version,
            profile_id=profile.id,
            profile_version=profile.version,
            status="queued",
            automation_run_id=run_id,
        )
        db.add(record)
    try:
        # The unique source/rule/profile identity is the durable concurrency
        # guard.  Two inventory runs can reach this point together; the loser
        # must become a skipped decision instead of failing the whole run.
        db.flush()
        job, _validation = queue_transcode_job(
            db,
            settings,
            media_file,
            decision.plan,
            profile_id=profile.id,
            profile_version=profile.version,
            rule_id=rule.id,
            rule_version=rule.version,
            rule_snapshot=_rule_snapshot(rule, profile),
            automation_run_id=run_id,
            automation_trigger=trigger,
            output_subfolder=rule.output_subfolder,
        )
        record.transcode_job_id = job.id
        db.commit()
    except IntegrityError:
        db.rollback()
        return "skipped"
    except (TranscodeValidationError, OSError, ValueError):
        db.rollback()
        return "blocked"
    return "queued"


def process_transcode_automation_run(
    settings: Settings,
    run_id: int,
    *,
    submit_job: Callable[[int], None],
    is_cancel_requested: Callable[[int], bool],
) -> None:
    from backend.app.db.session import SessionLocal

    db = SessionLocal()
    try:
        run = db.get(TranscodeAutomationRun, run_id)
        if run is None or run.status != "queued":
            return
        run.status = "running"
        run.started_at = utc_now()
        db.commit()
        scope = TranscodeAutomationScope(
            rule_ids=list(run.rule_ids or []),
            library_ids=list(run.library_ids or []),
            source_file_ids=list(run.source_file_ids or []),
            retry_failed=bool(run.retry_failed),
            limit=100000,
        )
        app_settings = get_app_settings(db, settings)
        rules = _scope_rules(db, scope)
        capabilities = get_transcode_capabilities(settings)
        run.files_total = _candidate_count(db, scope, rules)
        db.commit()
        offset = 0
        page = 0
        while True:
            db.refresh(run)
            if run.cancellation_requested or is_cancel_requested(run_id):
                run.status = "canceled"
                run.error = "Canceled by the user"
                run.finished_at = utc_now()
                db.commit()
                return
            # Re-read mutable rule/profile rows at every page boundary.  New
            # explicit versions affect the next page, while the queue-time
            # guard above protects the page currently being materialized.
            db.expire_all()
            run = db.get(TranscodeAutomationRun, run_id)
            if run is None:
                return
            rules = _scope_rules(db, scope)
            app_settings = get_app_settings(db, settings)
            candidates = _load_candidates(db, scope, rules, offset=offset, limit=AUTOMATION_PAGE_SIZE)
            if not candidates:
                break
            page += 1
            for media_file in candidates:
                decision = _decision_for_file(
                    db,
                    settings,
                    media_file,
                    rules,
                    app_settings,
                    capabilities,
                    retry_failed=scope.retry_failed,
                )
                status = decision.status
                if status == "matched":
                    run.matched += 1
                    status = _queue_decision(
                        db,
                        settings,
                        decision,
                        run_id=run.id,
                        retry_failed=scope.retry_failed,
                        trigger=run.trigger_source,
                    )
                if status == "queued":
                    run.queued += 1
                    try:
                        queued_job_id = db.scalar(
                            select(TranscodeJob.id).where(
                                TranscodeJob.automation_run_id == run.id,
                                TranscodeJob.source_file_id == decision.file_id,
                                TranscodeJob.rule_id == decision.rule_id,
                                TranscodeJob.status == JobStatus.queued,
                            ).order_by(TranscodeJob.id.desc()).limit(1)
                        )
                        if queued_job_id is not None:
                            submit_job(queued_job_id)
                    except Exception:
                        # The durable job remains visible as failed/canceled by
                        # the runtime submission path; continue the inventory.
                        run.failed += 1
                elif status == "blocked":
                    run.blocked += 1
                elif status == "skipped":
                    run.skipped += 1
                elif status == "unmatched":
                    run.unmatched += 1
            offset += len(candidates)
            run.current_page = page
            run.summary = {
                "last_page_size": len(candidates),
                "offset": offset,
                "rule_count": len(rules),
            }
            db.commit()
        run.status = "completed"
        run.finished_at = utc_now()
        db.commit()
    except Exception as exc:
        db.rollback()
        run = db.get(TranscodeAutomationRun, run_id)
        if run is not None:
            run.status = "failed"
            run.error = str(exc)[-32000:]
            run.finished_at = utc_now()
            db.commit()
    finally:
        db.close()


def finalize_transcode_automation_record(db: Session, job: TranscodeJob) -> None:
    record = db.scalar(
        select(TranscodeAutomationRecord).where(TranscodeAutomationRecord.transcode_job_id == job.id).limit(1)
    )
    if record is None:
        return
    if record.status in TERMINAL_AUTOMATION_STATUSES:
        return
    if job.status == JobStatus.completed:
        record.status = "completed"
        record.error = None
        try:
            source_path = Path(job.source_path_snapshot)
            stat = source_path.stat()
            record.result_source_path = str(source_path)
            record.result_source_size = stat.st_size
            record.result_source_mtime = stat.st_mtime
        except OSError:
            record.result_source_path = job.source_path_snapshot
            record.result_source_size = record.source_size_snapshot
            record.result_source_mtime = record.source_mtime_snapshot
    elif job.status == JobStatus.failed:
        record.status = "failed"
        record.error = job.error
    elif job.status == JobStatus.canceled:
        record.status = "canceled"
        record.error = job.error
    else:
        return
    if record.automation_run_id:
        run = db.get(TranscodeAutomationRun, record.automation_run_id)
        if run is not None and record.status in {"completed", "failed", "canceled"}:
            if record.status == "completed":
                run.completed += 1
            elif record.status == "failed":
                run.failed += 1
            else:
                run.canceled += 1
    db.commit()
