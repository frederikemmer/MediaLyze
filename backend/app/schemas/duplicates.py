from pydantic import BaseModel, Field

from backend.app.models.entities import DuplicateDetectionMode


class DuplicateGroupFileRead(BaseModel):
    id: int
    relative_path: str
    filename: str
    size_bytes: int


class DuplicateGroupRead(BaseModel):
    signature: str
    label: str
    file_count: int
    total_size_bytes: int
    items: list[DuplicateGroupFileRead] = Field(default_factory=list)


class DuplicateGroupPageRead(BaseModel):
    mode: DuplicateDetectionMode
    total_groups: int = 0
    duplicate_file_count: int = 0
    offset: int = 0
    limit: int = 25
    items: list[DuplicateGroupRead] = Field(default_factory=list)
