from __future__ import annotations

from pathlib import Path

from backend.app.models.entities import DuplicateDetectionMode, MediaFile
from backend.app.services.duplicates.base import ArtifactResult, DuplicateGroupAssignment, DuplicateRecord

def normalize_duplicate_filename(value: str) -> str:
    return Path(value).name.casefold().strip()


class FilenameDuplicateStrategy:
    mode = DuplicateDetectionMode.filename

    def ensure_artifact(
        self,
        media_file: MediaFile,
        file_path: Path,
    ) -> ArtifactResult:
        normalized = normalize_duplicate_filename(file_path.name)
        if media_file.duplicate_filename_key == normalized:
            return ArtifactResult(updated=False, cache_hit=True)
        media_file.duplicate_filename_key = normalized or None
        return ArtifactResult(updated=True, cache_hit=False)

    def artifact_ready(self, media_file: MediaFile) -> bool:
        return bool(media_file.duplicate_filename_key)

    def build_candidate_buckets(self, records: list[DuplicateRecord]) -> list[list[DuplicateRecord]]:
        buckets: dict[str, list[DuplicateRecord]] = {}
        for record in records:
            key = record.duplicate_filename_key or ""
            if not key:
                continue
            buckets.setdefault(key, []).append(record)
        return [bucket for bucket in buckets.values() if len(bucket) > 1]

    def build_groups(self, records: list[DuplicateRecord]) -> list[DuplicateGroupAssignment]:
        assignments: list[DuplicateGroupAssignment] = []
        for bucket in self.build_candidate_buckets(records):
            ordered = sorted(bucket, key=lambda item: (item.filename.lower(), item.media_file_id))
            file_ids = tuple(sorted(item.media_file_id for item in bucket))
            assignments.append(
                DuplicateGroupAssignment(
                    group_key="",
                    label=ordered[0].filename,
                    file_ids=file_ids,
                )
            )
        return assignments
