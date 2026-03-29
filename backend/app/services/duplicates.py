from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
import hashlib
from pathlib import Path
import re
from typing import Protocol

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from backend.app.models.entities import DuplicateDetectionMode, Library, MediaFile
from backend.app.schemas.duplicates import DuplicateGroupFileRead, DuplicateGroupPageRead, DuplicateGroupRead

FILE_HASH_ALGORITHM = "sha256"
FILE_HASH_CHUNK_SIZE = 1024 * 1024
FILENAME_SIGNATURE_PATTERN = re.compile(r"[\s._-]+")


class DuplicateDetectionStrategy(Protocol):
    mode: DuplicateDetectionMode

    def needs_processing(self, media_file: MediaFile) -> bool:
        ...

    def build_payload(self, file_path: Path) -> dict[str, str | None]:
        ...

    def apply_payload(self, media_file: MediaFile, payload: dict[str, str | None]) -> None:
        ...


def normalize_filename_signature(file_path: Path) -> str:
    return FILENAME_SIGNATURE_PATTERN.sub(" ", file_path.stem.lower()).strip()


class FilenameDuplicateDetectionStrategy:
    mode = DuplicateDetectionMode.filename

    def needs_processing(self, media_file: MediaFile) -> bool:
        return not (media_file.filename_signature or "").strip()

    def build_payload(self, file_path: Path) -> dict[str, str | None]:
        return {"filename_signature": normalize_filename_signature(file_path)}

    def apply_payload(self, media_file: MediaFile, payload: dict[str, str | None]) -> None:
        media_file.filename_signature = payload.get("filename_signature")


class FileHashDuplicateDetectionStrategy:
    mode = DuplicateDetectionMode.filehash

    def needs_processing(self, media_file: MediaFile) -> bool:
        return not media_file.content_hash or media_file.content_hash_algorithm != FILE_HASH_ALGORITHM

    def build_payload(self, file_path: Path) -> dict[str, str | None]:
        digest = hashlib.new(FILE_HASH_ALGORITHM)
        with file_path.open("rb") as handle:
            while chunk := handle.read(FILE_HASH_CHUNK_SIZE):
                digest.update(chunk)
        return {
            "content_hash": digest.hexdigest(),
            "content_hash_algorithm": FILE_HASH_ALGORITHM,
        }

    def apply_payload(self, media_file: MediaFile, payload: dict[str, str | None]) -> None:
        media_file.content_hash = payload.get("content_hash")
        media_file.content_hash_algorithm = payload.get("content_hash_algorithm")


def get_duplicate_detection_strategy(mode: DuplicateDetectionMode | str) -> DuplicateDetectionStrategy:
    normalized_mode = DuplicateDetectionMode(mode)
    if normalized_mode == DuplicateDetectionMode.filehash:
        return FileHashDuplicateDetectionStrategy()
    return FilenameDuplicateDetectionStrategy()


def _active_signature_statement(library_id: int, mode: DuplicateDetectionMode) -> Select:
    if mode == DuplicateDetectionMode.filehash:
        signature_column = MediaFile.content_hash
        return (
            select(
                signature_column.label("signature"),
                func.count(MediaFile.id).label("file_count"),
                func.coalesce(func.sum(MediaFile.size_bytes), 0).label("total_size_bytes"),
                func.min(MediaFile.filename).label("label_source"),
            )
            .where(
                MediaFile.library_id == library_id,
                MediaFile.content_hash_algorithm == FILE_HASH_ALGORITHM,
                MediaFile.content_hash.is_not(None),
                func.length(func.trim(MediaFile.content_hash)) > 0,
            )
            .group_by(signature_column)
            .having(func.count(MediaFile.id) > 1)
        )

    signature_column = MediaFile.filename_signature
    return (
        select(
            signature_column.label("signature"),
            func.count(MediaFile.id).label("file_count"),
            func.coalesce(func.sum(MediaFile.size_bytes), 0).label("total_size_bytes"),
            func.min(MediaFile.filename).label("label_source"),
        )
        .where(
            MediaFile.library_id == library_id,
            MediaFile.filename_signature.is_not(None),
            func.length(func.trim(MediaFile.filename_signature)) > 0,
        )
        .group_by(signature_column)
        .having(func.count(MediaFile.id) > 1)
    )


def get_duplicate_group_counts(db: Session, library_id: int, mode: DuplicateDetectionMode | str) -> tuple[int, int]:
    normalized_mode = DuplicateDetectionMode(mode)
    grouped = _active_signature_statement(library_id, normalized_mode).subquery()
    total_groups = db.scalar(select(func.count()).select_from(grouped)) or 0
    duplicate_file_count = db.scalar(select(func.coalesce(func.sum(grouped.c.file_count), 0))) or 0
    return int(total_groups), int(duplicate_file_count)


def _group_label(mode: DuplicateDetectionMode, signature: str, label_source: str | None) -> str:
    if mode == DuplicateDetectionMode.filehash:
        return label_source or f"{FILE_HASH_ALGORITHM}:{signature[:12]}"
    return signature


def _page_group_rows(db: Session, library_id: int, mode: DuplicateDetectionMode, offset: int, limit: int):
    grouped = _active_signature_statement(library_id, mode).subquery()
    return db.execute(
        select(
            grouped.c.signature,
            grouped.c.file_count,
            grouped.c.total_size_bytes,
            grouped.c.label_source,
        )
        .order_by(grouped.c.signature.asc())
        .offset(offset)
        .limit(limit)
    ).all()


def _group_files_by_signature(
    db: Session,
    library_id: int,
    mode: DuplicateDetectionMode,
    signatures: Sequence[str],
) -> dict[str, list[DuplicateGroupFileRead]]:
    if not signatures:
        return {}

    if mode == DuplicateDetectionMode.filehash:
        rows = db.execute(
            select(
                MediaFile.id,
                MediaFile.relative_path,
                MediaFile.filename,
                MediaFile.size_bytes,
                MediaFile.content_hash.label("signature"),
            )
            .where(
                MediaFile.library_id == library_id,
                MediaFile.content_hash_algorithm == FILE_HASH_ALGORITHM,
                MediaFile.content_hash.in_(signatures),
            )
            .order_by(MediaFile.content_hash.asc(), MediaFile.relative_path.asc())
        ).all()
    else:
        rows = db.execute(
            select(
                MediaFile.id,
                MediaFile.relative_path,
                MediaFile.filename,
                MediaFile.size_bytes,
                MediaFile.filename_signature.label("signature"),
            )
            .where(
                MediaFile.library_id == library_id,
                MediaFile.filename_signature.in_(signatures),
            )
            .order_by(MediaFile.filename_signature.asc(), MediaFile.relative_path.asc())
        ).all()

    grouped_items: dict[str, list[DuplicateGroupFileRead]] = defaultdict(list)
    for row in rows:
        grouped_items[str(row.signature)].append(
            DuplicateGroupFileRead(
                id=row.id,
                relative_path=row.relative_path,
                filename=row.filename,
                size_bytes=row.size_bytes,
            )
        )
    return grouped_items


def list_library_duplicate_groups(
    db: Session,
    library_id: int,
    *,
    offset: int = 0,
    limit: int = 25,
) -> DuplicateGroupPageRead:
    library = db.get(Library, library_id)
    if library is None:
        raise ValueError(f"Library {library_id} not found")

    mode = library.duplicate_detection_mode
    total_groups, duplicate_file_count = get_duplicate_group_counts(db, library_id, mode)
    group_rows = _page_group_rows(db, library_id, mode, offset, limit)
    signatures = [str(row.signature) for row in group_rows if row.signature is not None]
    items_by_signature = _group_files_by_signature(db, library_id, mode, signatures)

    items = [
        DuplicateGroupRead(
            signature=str(row.signature),
            label=_group_label(mode, str(row.signature), row.label_source),
            file_count=int(row.file_count or 0),
            total_size_bytes=int(row.total_size_bytes or 0),
            items=items_by_signature.get(str(row.signature), []),
        )
        for row in group_rows
        if row.signature is not None
    ]
    return DuplicateGroupPageRead(
        mode=mode,
        total_groups=total_groups,
        duplicate_file_count=duplicate_file_count,
        offset=offset,
        limit=limit,
        items=items,
    )
