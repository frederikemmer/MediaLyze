from __future__ import annotations

from collections import defaultdict
import json
import subprocess
from pathlib import Path

from backend.app.models.entities import DuplicateDetectionMode, MediaFile
from backend.app.services.duplicates.base import ArtifactResult, DuplicateGroupAssignment, DuplicateRecord

PERCEPTUAL_HASH_VERSION = 1
FRAME_WIDTH = 9
FRAME_HEIGHT = 8
FRAME_TIMESTAMPS = (0.1, 0.3, 0.5, 0.7, 0.9)


def _dhash_from_grayscale(frame_bytes: bytes) -> int:
    bits = 0
    bit_index = 0
    for row in range(FRAME_HEIGHT):
        offset = row * FRAME_WIDTH
        for col in range(FRAME_WIDTH - 1):
            left = frame_bytes[offset + col]
            right = frame_bytes[offset + col + 1]
            if left > right:
                bits |= 1 << bit_index
            bit_index += 1
    return bits


def _hamming_distance(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def _extract_frame_hash(
    ffmpeg_path: str,
    file_path: Path,
    timestamp_seconds: float,
    *,
    timeout_seconds: int | None = None,
) -> int:
    command = [
        ffmpeg_path,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{timestamp_seconds:.3f}",
        "-i",
        str(file_path),
        "-frames:v",
        "1",
        "-vf",
        f"scale={FRAME_WIDTH}:{FRAME_HEIGHT},format=gray",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "pipe:1",
    ]
    run_kwargs = {
        "check": True,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "stdin": subprocess.DEVNULL,
    }
    if timeout_seconds and timeout_seconds > 0:
        run_kwargs["timeout"] = timeout_seconds
    try:
        result = subprocess.run(command, **run_kwargs)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"ffmpeg frame extraction timed out after {int(timeout_seconds or 0)}s") from exc
    expected_length = FRAME_WIDTH * FRAME_HEIGHT
    if len(result.stdout) != expected_length:
        raise ValueError(f"Unexpected perceptual hash frame size for {file_path}")
    return _dhash_from_grayscale(result.stdout)


class PerceptualDuplicateStrategy:
    mode = DuplicateDetectionMode.perceptual_hash

    def ensure_artifact(
        self,
        media_file: MediaFile,
        file_path: Path,
        *,
        ffmpeg_path: str,
        ffmpeg_timeout_seconds: int | None = None,
    ) -> ArtifactResult:
        existing = media_file.perceptual_hash or {}
        if existing and media_file.perceptual_hash_version == PERCEPTUAL_HASH_VERSION:
            return ArtifactResult(updated=False, cache_hit=True)

        duration = 0.0
        if media_file.media_format and media_file.media_format.duration:
            duration = max(0.0, float(media_file.media_format.duration))
        timestamps = [max(0.0, duration * ratio) for ratio in FRAME_TIMESTAMPS]
        hashes = [
            _extract_frame_hash(
                ffmpeg_path,
                file_path,
                timestamp,
                timeout_seconds=ffmpeg_timeout_seconds,
            )
            for timestamp in timestamps
        ]
        media_file.perceptual_hash = {
            "version": PERCEPTUAL_HASH_VERSION,
            "frame_hashes": hashes,
            "duration": duration,
            "size_bytes": media_file.size_bytes,
        }
        media_file.perceptual_hash_version = PERCEPTUAL_HASH_VERSION
        return ArtifactResult(updated=True, cache_hit=False)

    def artifact_ready(self, media_file: MediaFile) -> bool:
        payload = media_file.perceptual_hash or {}
        return bool(payload.get("frame_hashes")) and media_file.perceptual_hash_version == PERCEPTUAL_HASH_VERSION

    def build_candidate_buckets(self, records: list[DuplicateRecord]) -> list[list[DuplicateRecord]]:
        buckets: dict[str, list[DuplicateRecord]] = defaultdict(list)
        for record in records:
            payload = record.perceptual_hash or {}
            frame_hashes = payload.get("frame_hashes") or []
            if not frame_hashes:
                continue
            duration = float(payload.get("duration") or record.duration or 0.0)
            duration_bucket = int(duration // 300)
            prefix = "-".join(f"{int(value):016x}"[:4] for value in frame_hashes[:2])
            buckets[f"{duration_bucket}:{prefix}"].append(record)
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
                left_payload = left.perceptual_hash or {}
                left_hashes = [int(value) for value in left_payload.get("frame_hashes") or []]
                left_duration = float(left_payload.get("duration") or left.duration or 0.0)
                if not left_hashes:
                    continue
                for right in bucket[index + 1:]:
                    right_payload = right.perceptual_hash or {}
                    right_hashes = [int(value) for value in right_payload.get("frame_hashes") or []]
                    right_duration = float(right_payload.get("duration") or right.duration or 0.0)
                    if not right_hashes or len(right_hashes) != len(left_hashes):
                        continue
                    distance = sum(_hamming_distance(a, b) for a, b in zip(left_hashes, right_hashes, strict=True)) / len(left_hashes)
                    duration_delta = abs(left_duration - right_duration)
                    duration_limit = max(10.0, max(left_duration, right_duration) * 0.03)
                    if distance <= 10 and duration_delta <= duration_limit:
                        union(left.media_file_id, right.media_file_id)

            grouped: dict[int, list[DuplicateRecord]] = defaultdict(list)
            for record in bucket:
                grouped[find(record.media_file_id)].append(record)

            for group in grouped.values():
                if len(group) < 2:
                    continue
                ordered = sorted(group, key=lambda item: (item.filename.lower(), item.media_file_id))
                assignments.append(
                    DuplicateGroupAssignment(
                        group_key="",
                        label=ordered[0].filename,
                        file_ids=tuple(sorted(item.media_file_id for item in group)),
                    )
                )
        return assignments
