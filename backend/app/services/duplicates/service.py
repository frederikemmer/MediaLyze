from __future__ import annotations

from collections.abc import Iterable
from hashlib import sha1
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from backend.app.models.entities import DuplicateDetectionMode, Library, MediaFile, MediaFormat
from backend.app.schemas.media import DuplicateGroupPageRead, DuplicateGroupRead, DuplicateSummaryRead
from backend.app.services.duplicates.base import DuplicateGroupAssignment, DuplicateRecord, DuplicateStrategy
from backend.app.services.duplicates.content_hash import ContentHashDuplicateStrategy
from backend.app.services.duplicates.filename import FilenameDuplicateStrategy
from backend.app.services.duplicates.perceptual import PerceptualDuplicateStrategy

STRATEGIES: dict[DuplicateDetectionMode, DuplicateStrategy] = {
    DuplicateDetectionMode.filename: FilenameDuplicateStrategy(),
    DuplicateDetectionMode.content_hash: ContentHashDuplicateStrategy(),
    DuplicateDetectionMode.perceptual_hash: PerceptualDuplicateStrategy(),
}


def get_duplicate_strategy(mode: DuplicateDetectionMode | str | None) -> DuplicateStrategy:
    if isinstance(mode, str):
        mode = DuplicateDetectionMode(mode)
    return STRATEGIES[mode or DuplicateDetectionMode.filename]


def _group_key(mode: DuplicateDetectionMode, file_ids: tuple[int, ...]) -> str:
    digest = sha1(f"{mode.value}:{','.join(str(item) for item in file_ids)}".encode("utf-8")).hexdigest()
    return digest[:16]


def collect_duplicate_records(db: Session, library_id: int) -> list[DuplicateRecord]:
    media_files = db.scalars(
        select(MediaFile)
        .where(MediaFile.library_id == library_id)
        .options(selectinload(MediaFile.media_format))
        .order_by(MediaFile.id.asc())
    ).all()
    return [
        DuplicateRecord(
            media_file_id=media_file.id,
            filename=media_file.filename,
            relative_path=media_file.relative_path,
            size_bytes=media_file.size_bytes,
            duration=media_file.media_format.duration if media_file.media_format else None,
            duplicate_filename_key=media_file.duplicate_filename_key,
            content_hash=media_file.content_hash,
            perceptual_hash=media_file.perceptual_hash,
        )
        for media_file in media_files
    ]


def rebuild_duplicate_groups(db: Session, library: Library) -> dict[str, int]:
    strategy = get_duplicate_strategy(library.duplicate_detection_mode)
    records = collect_duplicate_records(db, library.id)
    groups = strategy.build_groups(records)
    assignments_by_file_id: dict[int, DuplicateGroupAssignment] = {}

    for assignment in groups:
        file_ids = tuple(sorted(set(assignment.file_ids)))
        if len(file_ids) < 2:
            continue
        final_assignment = DuplicateGroupAssignment(
            group_key=_group_key(library.duplicate_detection_mode, file_ids),
            label=assignment.label,
            file_ids=file_ids,
        )
        for file_id in file_ids:
            assignments_by_file_id[file_id] = final_assignment

    media_files = db.scalars(select(MediaFile).where(MediaFile.library_id == library.id)).all()
    duplicate_files = 0
    for media_file in media_files:
        assignment = assignments_by_file_id.get(media_file.id)
        if assignment is None:
            media_file.duplicate_group_key = None
            media_file.duplicate_group_label = None
            media_file.duplicate_group_member_count = 0
            continue
        media_file.duplicate_group_key = assignment.group_key
        media_file.duplicate_group_label = assignment.label
        media_file.duplicate_group_member_count = len(assignment.file_ids)
        duplicate_files += 1

    return {
        "groups_found": len({assignment.group_key for assignment in assignments_by_file_id.values()}),
        "duplicate_files": duplicate_files,
        "pending_files": 0,
    }


def list_duplicate_groups(db: Session, library_id: int, offset: int = 0, limit: int = 50) -> DuplicateGroupPageRead:
    library = db.get(Library, library_id)
    if library is None:
        raise ValueError(f"Library {library_id} not found")

    rows = db.execute(
        select(
            MediaFile.duplicate_group_key,
            MediaFile.duplicate_group_label,
            func.count(MediaFile.id),
            func.group_concat(MediaFile.id, ","),
        )
        .where(
            MediaFile.library_id == library_id,
            MediaFile.duplicate_group_member_count >= 2,
            MediaFile.duplicate_group_key.is_not(None),
        )
        .group_by(MediaFile.duplicate_group_key, MediaFile.duplicate_group_label)
        .order_by(func.count(MediaFile.id).desc(), MediaFile.duplicate_group_label.asc())
    ).all()
    total = len(rows)
    items = [
        DuplicateGroupRead(
            group_key=group_key,
            label=label or group_key,
            file_count=file_count,
            file_ids=[int(value) for value in (file_ids or "").split(",") if value],
            mode=library.duplicate_detection_mode.value,
        )
        for group_key, label, file_count, file_ids in rows[offset: offset + limit]
        if group_key
    ]
    return DuplicateGroupPageRead(total=total, offset=offset, limit=limit, items=items)


def get_duplicate_summary(db: Session, library_id: int) -> DuplicateSummaryRead:
    library = db.get(Library, library_id)
    if library is None:
        raise ValueError(f"Library {library_id} not found")
    groups_found = db.scalar(
        select(func.count(func.distinct(MediaFile.duplicate_group_key))).where(
            MediaFile.library_id == library_id,
            MediaFile.duplicate_group_member_count >= 2,
            MediaFile.duplicate_group_key.is_not(None),
        )
    ) or 0
    duplicate_files = db.scalar(
        select(func.count(MediaFile.id)).where(
            MediaFile.library_id == library_id,
            MediaFile.duplicate_group_member_count >= 2,
        )
    ) or 0
    return DuplicateSummaryRead(
        mode=library.duplicate_detection_mode.value,
        groups_found=groups_found,
        duplicate_files=duplicate_files,
        pending_files=0,
    )
