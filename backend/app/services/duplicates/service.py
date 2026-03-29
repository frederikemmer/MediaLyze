from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Protocol

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.models.entities import DuplicateDetectionMode, Library, MediaFile
from backend.app.schemas.duplicates import DuplicateGroupFileRead, DuplicateGroupPageRead, DuplicateGroupRead

FILENAME_SIGNATURE_PATTERN = re.compile(r"[\s._-]+")
CONTENT_HASH_ALGORITHM = "sha256"
CONTENT_HASH_CHUNK_SIZE = 1024 * 1024


class DuplicateDetectionStrategy(Protocol):
    mode: DuplicateDetectionMode

    def requires_processing(self, media_file: MediaFile) -> bool: ...

    def build_signature(self, file_path: Path) -> dict[str, str]: ...

    def apply_signature(self, media_file: MediaFile, signature_data: dict[str, str]) -> None: ...


class FilenameDuplicateDetectionStrategy:
    mode = DuplicateDetectionMode.filename

    def requires_processing(self, media_file: MediaFile) -> bool:
        return not bool((media_file.filename_signature or "").strip())

    def build_signature(self, file_path: Path) -> dict[str, str]:
        return {"filename_signature": normalize_filename_signature(file_path)}

    def apply_signature(self, media_file: MediaFile, signature_data: dict[str, str]) -> None:
        media_file.filename_signature = signature_data["filename_signature"]


class FileHashDuplicateDetectionStrategy:
    mode = DuplicateDetectionMode.filehash

    def requires_processing(self, media_file: MediaFile) -> bool:
        return not (
            (media_file.content_hash or "").strip()
            and (media_file.content_hash_algorithm or "").strip().lower() == CONTENT_HASH_ALGORITHM
        )

    def build_signature(self, file_path: Path) -> dict[str, str]:
        return {
            "filename_signature": normalize_filename_signature(file_path),
            "content_hash": compute_content_hash(file_path),
            "content_hash_algorithm": CONTENT_HASH_ALGORITHM,
        }

    def apply_signature(self, media_file: MediaFile, signature_data: dict[str, str]) -> None:
        media_file.filename_signature = signature_data["filename_signature"]
        media_file.content_hash = signature_data["content_hash"]
        media_file.content_hash_algorithm = signature_data["content_hash_algorithm"]


def normalize_filename_signature(file_path: Path | str) -> str:
    stem = Path(file_path).stem.strip().lower()
    return FILENAME_SIGNATURE_PATTERN.sub(" ", stem).strip()


def compute_content_hash(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        while True:
            chunk = handle.read(CONTENT_HASH_CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def get_duplicate_detection_strategy(mode: DuplicateDetectionMode | str) -> DuplicateDetectionStrategy:
    normalized_mode = DuplicateDetectionMode(mode)
    if normalized_mode == DuplicateDetectionMode.filehash:
        return FileHashDuplicateDetectionStrategy()
    return FilenameDuplicateDetectionStrategy()


def _signature_column(mode: DuplicateDetectionMode):
    if mode == DuplicateDetectionMode.filehash:
        return MediaFile.content_hash
    return MediaFile.filename_signature


def _group_label(mode: DuplicateDetectionMode, signature: str, files: list[MediaFile]) -> str:
    if mode == DuplicateDetectionMode.filehash:
        return files[0].filename if files else signature
    return signature


def count_duplicate_groups(db: Session, library_id: int, mode: DuplicateDetectionMode) -> tuple[int, int]:
    signature_column = _signature_column(mode)
    grouped = (
        select(
            signature_column.label("signature"),
            func.count(MediaFile.id).label("file_count"),
        )
        .where(
            MediaFile.library_id == library_id,
            signature_column.is_not(None),
            func.length(func.trim(signature_column)) > 0,
        )
        .group_by(signature_column)
        .having(func.count(MediaFile.id) > 1)
        .subquery()
    )
    total_groups = db.scalar(select(func.count()).select_from(grouped)) or 0
    duplicate_file_count = db.scalar(select(func.coalesce(func.sum(grouped.c.file_count), 0)).select_from(grouped)) or 0
    return int(total_groups), int(duplicate_file_count)


def list_duplicate_groups(
    db: Session,
    library: Library,
    *,
    offset: int = 0,
    limit: int = 25,
) -> DuplicateGroupPageRead:
    mode = library.duplicate_detection_mode
    signature_column = _signature_column(mode)
    grouped = (
        select(
            signature_column.label("signature"),
            func.count(MediaFile.id).label("file_count"),
            func.coalesce(func.sum(MediaFile.size_bytes), 0).label("total_size_bytes"),
        )
        .where(
            MediaFile.library_id == library.id,
            signature_column.is_not(None),
            func.length(func.trim(signature_column)) > 0,
        )
        .group_by(signature_column)
        .having(func.count(MediaFile.id) > 1)
        .order_by(func.count(MediaFile.id).desc(), signature_column.asc())
        .offset(offset)
        .limit(limit)
    )
    group_rows = db.execute(grouped).all()
    total_groups, duplicate_file_count = count_duplicate_groups(db, library.id, mode)

    signatures = [str(row.signature) for row in group_rows]
    files_by_signature: dict[str, list[MediaFile]] = {signature: [] for signature in signatures}
    if signatures:
        files = db.scalars(
            select(MediaFile)
            .where(
                MediaFile.library_id == library.id,
                signature_column.in_(signatures),
            )
            .order_by(MediaFile.relative_path.asc(), MediaFile.id.asc())
        ).all()
        for media_file in files:
            signature = getattr(
                media_file,
                "content_hash" if mode == DuplicateDetectionMode.filehash else "filename_signature",
            )
            if signature in files_by_signature:
                files_by_signature[signature].append(media_file)

    items = [
        DuplicateGroupRead(
            signature=str(row.signature),
            label=_group_label(mode, str(row.signature), files_by_signature.get(str(row.signature), [])),
            file_count=int(row.file_count or 0),
            total_size_bytes=int(row.total_size_bytes or 0),
            items=[
                DuplicateGroupFileRead(
                    id=media_file.id,
                    relative_path=media_file.relative_path,
                    filename=media_file.filename,
                    size_bytes=media_file.size_bytes,
                    last_analyzed_at=media_file.last_analyzed_at.isoformat().replace("+00:00", "Z")
                    if media_file.last_analyzed_at
                    else None,
                )
                for media_file in files_by_signature.get(str(row.signature), [])
            ],
        )
        for row in group_rows
    ]

    return DuplicateGroupPageRead(
        mode=mode,
        total_groups=total_groups,
        duplicate_file_count=duplicate_file_count,
        offset=offset,
        limit=limit,
        items=items,
    )
