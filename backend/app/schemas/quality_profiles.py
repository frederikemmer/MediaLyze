from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.entities import QualityProfileMediaType
from backend.app.schemas._time import UtcDateTime
from backend.app.schemas.quality import QualityProfile


class QualityProfileCreate(BaseModel):
    name: str
    media_type: QualityProfileMediaType
    profile: QualityProfile = Field(default_factory=QualityProfile)
    is_default: bool = False


class QualityProfileUpdate(BaseModel):
    name: str | None = None
    profile: QualityProfile | None = None
    is_default: bool | None = None


class QualityProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    media_type: QualityProfileMediaType
    profile: QualityProfile
    is_default: bool
    is_builtin: bool
    created_at: UtcDateTime
    updated_at: UtcDateTime
    library_count: int = 0
