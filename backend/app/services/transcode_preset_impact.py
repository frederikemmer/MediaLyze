from __future__ import annotations

from collections import defaultdict
from hashlib import sha256

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.entities import TranscodeRule
from backend.app.schemas.transcoding import TranscodePresetRuleImpact, TranscodePresetRuleReference
from backend.app.services.access_context import principal_context


def preset_rule_impacts(
    db: Session, fields: tuple[str, ...], preset_id: int | None = None,
) -> dict[tuple[str, int], TranscodePresetRuleImpact]:
    # Confirmation must cover every linked rule, including hidden scopes.
    # Project only the permitted names into the response below.
    rules = TranscodeRule.__table__.c
    columns = [rules[field] for field in fields]
    query = select(rules.id, rules.name, rules.enabled, rules.library_ids, rules.updated_at, *columns)
    if preset_id is not None:
        query = query.where(columns[0] == preset_id)
    groups = defaultdict(list)
    for row in db.execute(query.order_by(rules.priority, rules.id)):
        for field in fields:
            if (linked_id := getattr(row, field)) is not None:
                groups[field, linked_id].append(row)

    principal = principal_context.get()
    return {
        key: TranscodePresetRuleImpact(
            token=sha256(repr((key, sorted((row.id, row.updated_at) for row in rows))).encode()).hexdigest(),
            total=len(rows),
            rules=[
                TranscodePresetRuleReference(id=row.id, name=row.name, enabled=row.enabled)
                for row in rows
                if principal is None or principal.owner or (
                    principal.has("settings.app.view") and row.library_ids and all(
                        principal.has("library.read", target) and principal.has("transcode.view", target)
                        for target in row.library_ids
                    )
                )
            ],
        )
        for key, rows in groups.items()
    }


def preset_rule_impact(db: Session, field: str, preset_id: int) -> TranscodePresetRuleImpact | None:
    return preset_rule_impacts(db, (field,), preset_id).get((field, preset_id))
