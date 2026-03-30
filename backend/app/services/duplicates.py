from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
from typing import Protocol

from sqlalchemy import Select, func, select, union
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


class CombinedDuplicateDetectionStrategy:
    mode = DuplicateDetectionMode.both

    def __init__(self) -> None:
        self._strategies = (
            FilenameDuplicateDetectionStrategy(),
            FileHashDuplicateDetectionStrategy(),
        )

    def needs_processing(self, media_file: MediaFile) -> bool:
        return any(strategy.needs_processing(media_file) for strategy in self._strategies)

    def build_payload(self, file_path: Path) -> dict[str, str | None]:
        payload: dict[str, str | None] = {}
        for strategy in self._strategies:
            payload.update(strategy.build_payload(file_path))
        return payload

    def apply_payload(self, media_file: MediaFile, payload: dict[str, str | None]) -> None:
        for strategy in self._strategies:
            strategy.apply_payload(media_file, payload)


class DisabledDuplicateDetectionStrategy:
    mode = DuplicateDetectionMode.off

    def needs_processing(self, media_file: MediaFile) -> bool:
        return False

    def build_payload(self, file_path: Path) -> dict[str, str | None]:
        return {}

    def apply_payload(self, media_file: MediaFile, payload: dict[str, str | None]) -> None:
        return None


def get_active_duplicate_detection_modes(mode: DuplicateDetectionMode | str) -> tuple[DuplicateDetectionMode, ...]:
    normalized_mode = DuplicateDetectionMode(mode)
    if normalized_mode == DuplicateDetectionMode.off:
        return ()
    if normalized_mode == DuplicateDetectionMode.both:
        return (DuplicateDetectionMode.filehash, DuplicateDetectionMode.filename)
    return (normalized_mode,)


def get_duplicate_detection_strategy(mode: DuplicateDetectionMode | str) -> DuplicateDetectionStrategy:
    normalized_mode = DuplicateDetectionMode(mode)
    if normalized_mode == DuplicateDetectionMode.off:
        return DisabledDuplicateDetectionStrategy()
    if normalized_mode == DuplicateDetectionMode.both:
        return CombinedDuplicateDetectionStrategy()
    if normalized_mode == DuplicateDetectionMode.filehash:
        return FileHashDuplicateDetectionStrategy()
    return FilenameDuplicateDetectionStrategy()


def _active_signature_statement(library_id: int, mode: DuplicateDetectionMode) -> Select:
    if mode == DuplicateDetectionMode.both:
        raise ValueError("Combined duplicate mode must be expanded before building a signature query")

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


def _duplicate_file_membership_statement(library_id: int, mode: DuplicateDetectionMode) -> Select:
    grouped = _active_signature_statement(library_id, mode).subquery()
    if mode == DuplicateDetectionMode.filehash:
        return (
            select(MediaFile.id.label("media_file_id"))
            .join(grouped, MediaFile.content_hash == grouped.c.signature)
            .where(
                MediaFile.library_id == library_id,
                MediaFile.content_hash_algorithm == FILE_HASH_ALGORITHM,
                MediaFile.content_hash.is_not(None),
                func.length(func.trim(MediaFile.content_hash)) > 0,
            )
        )

    return (
        select(MediaFile.id.label("media_file_id"))
        .join(grouped, MediaFile.filename_signature == grouped.c.signature)
        .where(
            MediaFile.library_id == library_id,
            MediaFile.filename_signature.is_not(None),
            func.length(func.trim(MediaFile.filename_signature)) > 0,
        )
    )


def get_duplicate_group_counts(db: Session, library_id: int, mode: DuplicateDetectionMode | str) -> tuple[int, int]:
    active_modes = get_active_duplicate_detection_modes(mode)
    total_groups = 0
    membership_statements: list[Select] = []

    for active_mode in active_modes:
        grouped = _active_signature_statement(library_id, active_mode).subquery()
        total_groups += int(db.scalar(select(func.count()).select_from(grouped)) or 0)
        membership_statements.append(_duplicate_file_membership_statement(library_id, active_mode))

    if not membership_statements:
        return 0, 0

    if len(membership_statements) == 1:
        duplicate_file_count = db.scalar(select(func.count()).select_from(membership_statements[0].subquery())) or 0
    else:
        membership_union = union(*membership_statements).subquery()
        duplicate_file_count = db.scalar(select(func.count()).select_from(membership_union)) or 0
    return int(total_groups), int(duplicate_file_count)


def _group_label(mode: DuplicateDetectionMode, signature: str, label_source: str | None) -> str:
    if mode == DuplicateDetectionMode.filehash:
        return label_source or f"{FILE_HASH_ALGORITHM}:{signature[:12]}"
    return signature


@dataclass(frozen=True)
class DuplicateGroupRow:
    mode: DuplicateDetectionMode
    signature: str
    file_count: int
    total_size_bytes: int
    label_source: str | None


def _count_groups_for_mode(db: Session, library_id: int, mode: DuplicateDetectionMode) -> int:
    grouped = _active_signature_statement(library_id, mode).subquery()
    return int(db.scalar(select(func.count()).select_from(grouped)) or 0)


def _page_group_rows(db: Session, library_id: int, mode: DuplicateDetectionMode, offset: int, limit: int) -> list[DuplicateGroupRow]:
    if limit <= 0:
        return []

    rows: list[DuplicateGroupRow] = []
    remaining_offset = offset
    remaining_limit = limit

    for active_mode in get_active_duplicate_detection_modes(mode):
        group_count = _count_groups_for_mode(db, library_id, active_mode)
        if remaining_offset >= group_count:
            remaining_offset -= group_count
            continue

        grouped = _active_signature_statement(library_id, active_mode).subquery()
        result_rows = db.execute(
            select(
                grouped.c.signature,
                grouped.c.file_count,
                grouped.c.total_size_bytes,
                grouped.c.label_source,
            )
            .order_by(grouped.c.signature.asc())
            .offset(remaining_offset)
            .limit(remaining_limit)
        ).all()
        rows.extend(
            DuplicateGroupRow(
                mode=active_mode,
                signature=str(row.signature),
                file_count=int(row.file_count or 0),
                total_size_bytes=int(row.total_size_bytes or 0),
                label_source=row.label_source,
            )
            for row in result_rows
            if row.signature is not None
        )
        remaining_limit -= len(result_rows)
        remaining_offset = 0
        if remaining_limit <= 0:
            break

    return rows


def _group_files_by_signature(
    db: Session,
    library_id: int,
    group_rows: Sequence[DuplicateGroupRow],
) -> dict[tuple[DuplicateDetectionMode, str], list[DuplicateGroupFileRead]]:
    if not group_rows:
        return {}

    signatures_by_mode: dict[DuplicateDetectionMode, list[str]] = defaultdict(list)
    for row in group_rows:
        signatures_by_mode[row.mode].append(row.signature)

    grouped_items: dict[tuple[DuplicateDetectionMode, str], list[DuplicateGroupFileRead]] = defaultdict(list)
    for mode, signatures in signatures_by_mode.items():
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

        for row in rows:
            grouped_items[(mode, str(row.signature))].append(
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
    items_by_signature = _group_files_by_signature(db, library_id, group_rows)

    items = [
        DuplicateGroupRead(
            mode=row.mode,
            signature=row.signature,
            label=_group_label(row.mode, row.signature, row.label_source),
            file_count=row.file_count,
            total_size_bytes=row.total_size_bytes,
            items=items_by_signature.get((row.mode, row.signature), []),
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
