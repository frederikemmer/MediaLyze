from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.entities import DuplicateDetectionMode


class DuplicateGroupFileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    relative_path: str
    filename: str
    size_bytes: int
    last_analyzed_at: str | None = None


class DuplicateGroupRead(BaseModel):
    signature: str
    label: str
    file_count: int
    total_size_bytes: int
    items: list[DuplicateGroupFileRead] = Field(default_factory=list)


class DuplicateGroupPageRead(BaseModel):
    mode: DuplicateDetectionMode
    total_groups: int
    duplicate_file_count: int
    offset: int
    limit: int
    items: list[DuplicateGroupRead] = Field(default_factory=list)
