from __future__ import annotations

from pydantic import BaseModel, Field

from backend.app.schemas._time import UtcDateTime


class UpdateReleaseNotesSectionRead(BaseModel):
    title: str
    items: list[str]


class UpdateReleaseNotesRead(BaseModel):
    version: str
    date: str | None = None
    sections: list[UpdateReleaseNotesSectionRead]


class UpdateStatusRead(BaseModel):
    current_version: str
    latest_version: str | None = None
    update_available: bool = False
    checked_at: UtcDateTime | None = None
    release_notes: list[UpdateReleaseNotesRead] = Field(default_factory=list)
