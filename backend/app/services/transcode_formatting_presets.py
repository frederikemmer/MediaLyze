from __future__ import annotations

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.models.entities import AppSetting, TranscodeFormattingPreset
from backend.app.schemas.transcoding import (
    TranscodeFormattingDefinition,
    TranscodeFormattingPresetCreate,
    TranscodeFormattingPresetRead,
    TranscodeFormattingPresetUpdate,
    TranscodePresetRuleImpact,
)

from backend.app.services.transcode_preset_impact import preset_rule_impact, preset_rule_impacts


def seed_standard_formatting_presets(db: Session) -> None:
    existing = db.execute(
        insert(AppSetting)
        .values(key="standard_formatting_presets_seeded", value={})
        .on_conflict_do_nothing(index_elements=[AppSetting.key])
    )
    if existing.rowcount == 0:
        return

    standards = (
        ("filename", "MediaLyze Standard",
         "{sourceName} ({releaseYear}) [{resolution}, {dynRange}, {codec}] [{audioLanguages}]"),
        ("folder", "MediaLyze Standard", "{folderName} ({releaseYear})"),
        ("folder", "MediaLyze Standard – Serien",
         "Season {seasonNumber} ({releaseYear}) [{resolution}, {dynRange}, {codec}] [{audioLanguages}]"),
    )
    for kind, name, template in standards:
        existing_name = db.scalar(select(TranscodeFormattingPreset.id).where(
            TranscodeFormattingPreset.kind == kind,
            func.lower(TranscodeFormattingPreset.name) == name.lower(),
        ))
        if existing_name is None:
            db.add(TranscodeFormattingPreset(
                kind=kind,
                name=name,
                definition=TranscodeFormattingDefinition(
                    template=template, source_name_explicit=kind == "filename",
                ).model_dump(mode="json"),
                is_default=False,
            ))


class FormattingPresetError(ValueError):
    pass


def _read(preset: TranscodeFormattingPreset, impact: TranscodePresetRuleImpact | None = None) -> TranscodeFormattingPresetRead:
    return TranscodeFormattingPresetRead.model_validate({
        "id": preset.id,
        "kind": preset.kind,
        "name": preset.name,
        "definition": preset.definition,
        "is_default": preset.is_default,
        "rule_impact": impact,
    })


def list_formatting_presets(db: Session) -> list[TranscodeFormattingPresetRead]:
    rows = db.scalars(select(TranscodeFormattingPreset).order_by(
        TranscodeFormattingPreset.kind, func.lower(TranscodeFormattingPreset.name), TranscodeFormattingPreset.id,
    )).all()
    impacts = preset_rule_impacts(db, ("filename_preset_id", "folder_preset_id"))
    return [_read(row, impacts.get((f"{row.kind}_preset_id", row.id))) for row in rows]


def get_formatting_preset(db: Session, preset_id: int) -> TranscodeFormattingPreset:
    row = db.get(TranscodeFormattingPreset, preset_id)
    if row is None:
        raise FormattingPresetError("Formatting preset not found")
    return row


def _name(db: Session, kind: str, name: str, exclude_id: int | None = None) -> str:
    normalized = name.strip()
    if not normalized:
        raise FormattingPresetError("A preset name is required")
    query = select(TranscodeFormattingPreset.id).where(
        TranscodeFormattingPreset.kind == kind,
        func.lower(TranscodeFormattingPreset.name) == normalized.lower(),
    )
    if exclude_id is not None:
        query = query.where(TranscodeFormattingPreset.id != exclude_id)
    if db.scalar(query) is not None:
        raise FormattingPresetError("A formatting preset with this name already exists")
    return normalized


def create_formatting_preset(db: Session, payload: TranscodeFormattingPresetCreate) -> TranscodeFormattingPresetRead:
    row = TranscodeFormattingPreset(
        kind=payload.kind,
        name=_name(db, payload.kind, payload.name),
        definition=payload.definition.model_dump(mode="json"),
        is_default=False,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise FormattingPresetError("A formatting preset with this name already exists") from exc
    db.refresh(row)
    return _read(row)


def update_formatting_preset(db: Session, preset_id: int, payload: TranscodeFormattingPresetUpdate) -> TranscodeFormattingPresetRead:
    db.execute(text("BEGIN IMMEDIATE"))
    row = get_formatting_preset(db, preset_id)
    impact = preset_rule_impact(db, f"{row.kind}_preset_id", row.id)
    if (payload.name is not None or payload.definition is not None) and impact and payload.confirm_rule_impact != impact.token:
        db.rollback()
        raise FormattingPresetError("Rule impact confirmation required")
    if payload.name is not None:
        row.name = _name(db, row.kind, payload.name, row.id)
    if payload.definition is not None:
        row.definition = payload.definition.model_dump(mode="json")
    if payload.is_default is True:
        db.execute(update(TranscodeFormattingPreset).where(
            TranscodeFormattingPreset.kind == row.kind,
            TranscodeFormattingPreset.id != row.id,
        ).values(is_default=False))
    if payload.is_default is not None:
        row.is_default = payload.is_default
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise FormattingPresetError("A formatting preset with this name already exists") from exc
    db.refresh(row)
    return _read(row, impact)


def delete_formatting_preset(db: Session, preset_id: int) -> None:
    db.delete(get_formatting_preset(db, preset_id))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise FormattingPresetError("This formatting preset is used by an automation rule") from exc
