from __future__ import annotations

from collections import defaultdict
from difflib import SequenceMatcher
import re
from pathlib import Path

from backend.app.models.entities import DuplicateDetectionMode, MediaFile
from backend.app.services.duplicates.base import ArtifactResult, DuplicateGroupAssignment, DuplicateRecord

RELEASE_TOKEN_RE = re.compile(
    r"\b("
    r"2160p|1080p|720p|480p|x264|x265|h264|h265|hevc|av1|hdr10\+?|hdr|sdr|dv|dovi|"
    r"bluray|blu-ray|bdrip|brrip|webrip|web-dl|webdl|remux|proper|repack|extended|"
    r"limited|internal|readnfo|subs?|dubbed|multi|aac2?\.?0|ac3|eac3|dts(?:hd)?|"
    r"truehd|atmos|10bit|8bit"
    r")\b",
    re.IGNORECASE,
)
BRACKET_RE = re.compile(r"[\[\(\{].*?[\]\)\}]")
SEPARATOR_RE = re.compile(r"[._\-]+")
WHITESPACE_RE = re.compile(r"\s+")


def normalize_duplicate_filename(value: str) -> str:
    candidate = Path(value).stem.casefold()
    candidate = BRACKET_RE.sub(" ", candidate)
    candidate = SEPARATOR_RE.sub(" ", candidate)
    candidate = RELEASE_TOKEN_RE.sub(" ", candidate)
    candidate = re.sub(r"\b(?:sample|trailer|featurette)\b", " ", candidate)
    candidate = WHITESPACE_RE.sub(" ", candidate).strip()
    return candidate


class FilenameDuplicateStrategy:
    mode = DuplicateDetectionMode.filename

    def ensure_artifact(self, media_file: MediaFile, file_path: Path, *, ffmpeg_path: str) -> ArtifactResult:
        normalized = normalize_duplicate_filename(file_path.name)
        if media_file.duplicate_filename_key == normalized:
            return ArtifactResult(updated=False, cache_hit=True)
        media_file.duplicate_filename_key = normalized or None
        return ArtifactResult(updated=True, cache_hit=False)

    def artifact_ready(self, media_file: MediaFile) -> bool:
        return bool(media_file.duplicate_filename_key)

    def build_candidate_buckets(self, records: list[DuplicateRecord]) -> list[list[DuplicateRecord]]:
        buckets: dict[str, list[DuplicateRecord]] = defaultdict(list)
        for record in records:
            key = record.duplicate_filename_key or ""
            if not key:
                continue
            tokens = key.split()
            bucket_key = " ".join(tokens[:3]) if tokens else key[:12]
            buckets[bucket_key].append(record)
        return [bucket for bucket in buckets.values() if len(bucket) > 1]

    def build_groups(self, records: list[DuplicateRecord]) -> list[DuplicateGroupAssignment]:
        assignments: list[DuplicateGroupAssignment] = []
        for bucket in self.build_candidate_buckets(records):
            parents = {record.media_file_id: record.media_file_id for record in bucket}

            def find(value: int) -> int:
                while parents[value] != value:
                    parents[value] = parents[parents[value]]
                    value = parents[value]
                return value

            def union(left: int, right: int) -> None:
                left_root = find(left)
                right_root = find(right)
                if left_root != right_root:
                    parents[right_root] = left_root

            for index, left in enumerate(bucket):
                left_key = left.duplicate_filename_key or ""
                for right in bucket[index + 1:]:
                    right_key = right.duplicate_filename_key or ""
                    if not left_key or not right_key:
                        continue
                    if SequenceMatcher(None, left_key, right_key).ratio() >= 0.90:
                        union(left.media_file_id, right.media_file_id)

            grouped: dict[int, list[DuplicateRecord]] = defaultdict(list)
            for record in bucket:
                grouped[find(record.media_file_id)].append(record)

            for group in grouped.values():
                if len(group) < 2:
                    continue
                ordered = sorted(group, key=lambda item: (item.filename.lower(), item.media_file_id))
                file_ids = tuple(sorted(item.media_file_id for item in group))
                assignments.append(
                    DuplicateGroupAssignment(
                        group_key="",
                        label=ordered[0].filename,
                        file_ids=file_ids,
                    )
                )
        return assignments
