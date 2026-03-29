<<<<<<< HEAD
from pydantic import BaseModel, ConfigDict, Field
=======
from pydantic import BaseModel, Field
>>>>>>> e346af6e232e30a40b6c1803e7df43a77d8cf6c6

from backend.app.models.entities import DuplicateDetectionMode


class DuplicateGroupFileRead(BaseModel):
<<<<<<< HEAD
    model_config = ConfigDict(from_attributes=True)

=======
>>>>>>> e346af6e232e30a40b6c1803e7df43a77d8cf6c6
    id: int
    relative_path: str
    filename: str
    size_bytes: int
<<<<<<< HEAD
    last_analyzed_at: str | None = None
=======
>>>>>>> e346af6e232e30a40b6c1803e7df43a77d8cf6c6


class DuplicateGroupRead(BaseModel):
    signature: str
    label: str
    file_count: int
    total_size_bytes: int
    items: list[DuplicateGroupFileRead] = Field(default_factory=list)


class DuplicateGroupPageRead(BaseModel):
    mode: DuplicateDetectionMode
<<<<<<< HEAD
    total_groups: int
    duplicate_file_count: int
    offset: int
    limit: int
=======
    total_groups: int = 0
    duplicate_file_count: int = 0
    offset: int = 0
    limit: int = 25
>>>>>>> e346af6e232e30a40b6c1803e7df43a77d8cf6c6
    items: list[DuplicateGroupRead] = Field(default_factory=list)
