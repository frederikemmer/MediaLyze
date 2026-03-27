from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from backend.app.models.entities import DuplicateDetectionMode, MediaFile


@dataclass(frozen=True)
class ArtifactResult:
    updated: bool
    cache_hit: bool


@dataclass(frozen=True)
class DuplicateRecord:
    media_file_id: int
    filename: str
    relative_path: str
    size_bytes: int
    duration: float | None
    duplicate_filename_key: str | None
    content_hash: str | None
    perceptual_hash: dict | None


@dataclass(frozen=True)
class DuplicateGroupAssignment:
    group_key: str
    label: str
    file_ids: tuple[int, ...]


class DuplicateStrategy(Protocol):
    mode: DuplicateDetectionMode

    def ensure_artifact(
        self,
        media_file: MediaFile,
        file_path: Path,
        *,
        ffmpeg_path: str,
        ffmpeg_timeout_seconds: int | None = None,
    ) -> ArtifactResult:
        ...

    def artifact_ready(self, media_file: MediaFile) -> bool:
        ...

    def build_candidate_buckets(self, records: list[DuplicateRecord]) -> Iterable[list[DuplicateRecord]]:
        ...

    def build_groups(self, records: list[DuplicateRecord]) -> list[DuplicateGroupAssignment]:
        ...
