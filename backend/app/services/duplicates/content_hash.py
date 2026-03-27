from __future__ import annotations

from collections import defaultdict
import hashlib
from pathlib import Path

from backend.app.models.entities import DuplicateDetectionMode, MediaFile
from backend.app.services.duplicates.base import ArtifactResult, DuplicateGroupAssignment, DuplicateRecord


class ContentHashDuplicateStrategy:
    mode = DuplicateDetectionMode.content_hash

    def ensure_artifact(self, media_file: MediaFile, file_path: Path, *, ffmpeg_path: str) -> ArtifactResult:
        if media_file.content_hash:
            return ArtifactResult(updated=False, cache_hit=True)

        digest = hashlib.sha256()
        with file_path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        media_file.content_hash = digest.hexdigest()
        return ArtifactResult(updated=True, cache_hit=False)

    def artifact_ready(self, media_file: MediaFile) -> bool:
        return bool(media_file.content_hash)

    def build_candidate_buckets(self, records: list[DuplicateRecord]) -> list[list[DuplicateRecord]]:
        buckets: dict[str, list[DuplicateRecord]] = defaultdict(list)
        for record in records:
            if record.content_hash:
                buckets[record.content_hash].append(record)
        return [bucket for bucket in buckets.values() if len(bucket) > 1]

    def build_groups(self, records: list[DuplicateRecord]) -> list[DuplicateGroupAssignment]:
        groups: list[DuplicateGroupAssignment] = []
        for bucket in self.build_candidate_buckets(records):
            ordered = sorted(bucket, key=lambda item: (item.filename.lower(), item.media_file_id))
            groups.append(
                DuplicateGroupAssignment(
                    group_key="",
                    label=ordered[0].filename,
                    file_ids=tuple(sorted(item.media_file_id for item in bucket)),
                )
            )
        return groups
