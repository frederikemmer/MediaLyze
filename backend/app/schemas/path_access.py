from typing import Literal

from pydantic import BaseModel


PathKind = Literal["local", "network", "unknown"]


class PathInspectRequest(BaseModel):
    path: str


class PathInspectResponse(BaseModel):
    normalized_path: str
    exists: bool
    is_directory: bool
    path_kind: PathKind
    watch_supported: bool
