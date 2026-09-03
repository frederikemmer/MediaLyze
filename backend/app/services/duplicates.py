from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
from typing import Protocol

from sqlalchemy import Select, and_, case, delete, exists, func, or_, select, union
from sqlalchemy.orm import Session

from backend.app.models.entities import DuplicateDetectionMode, DuplicateGroupSuppression, Library, LibraryRoot, MediaFile
from backend.app.schemas.app_settings import DuplicateMatchingSettings
from backend.app.schemas.duplicates import (
    DuplicateGroupFileRead,
    DuplicateGroupPageRead,
    DuplicateGroupRead,
    DuplicateSuppressionRead,
)
from backend.app.services.pattern_recognition import default_duplicate_matching_settings, merge_pattern_lists

FILE_HASH_ALGORITHM = "sha256"
FILE_HASH_CHUNK_SIZE = 1024 * 1024
FILENAME_SIGNATURE_PATTERN = re.compile(r"[\s._-]+")


def _effective_duplicate_filename_suffix_regexes(settings: DuplicateMatchingSettings) -> list[str]:
    if settings.effective_filename_suffix_regexes:
        return settings.effective_filename_suffix_regexes
    return merge_pattern_lists(
        settings.user_filename_suffix_regexes,
        settings.default_filename_suffix_regexes,
    )


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


def normalize_filename_pattern_signature(
    file_path: Path,
    duplicate_matching_settings: DuplicateMatchingSettings | None = None,
) -> str:
    settings = duplicate_matching_settings or default_duplicate_matching_settings()
    candidate = normalize_filename_signature(file_path)
    for pattern in _effective_duplicate_filename_suffix_regexes(settings):
        candidate = re.sub(pattern, "", candidate, flags=re.IGNORECASE)
        candidate = re.sub(r"\s+", " ", candidate).strip()
    return candidate


class FilenameDuplicateDetectionStrategy:
    mode = DuplicateDetectionMode.filename

    def __init__(self, duplicate_matching_settings: DuplicateMatchingSettings | None = None) -> None:
        self.duplicate_matching_settings = duplicate_matching_settings or default_duplicate_matching_settings()

    def needs_processing(self, media_file: MediaFile) -> bool:
        return not (media_file.filename_signature or "").strip() or not (
            media_file.filename_pattern_signature or ""
        ).strip()

    def build_payload(self, file_path: Path) -> dict[str, str | None]:
        return {
            "filename_signature": normalize_filename_signature(file_path),
            "filename_pattern_signature": normalize_filename_pattern_signature(
                file_path,
                self.duplicate_matching_settings,
            ),
        }

    def apply_payload(self, media_file: MediaFile, payload: dict[str, str | None]) -> None:
        media_file.filename_signature = payload.get("filename_signature")
        media_file.filename_pattern_signature = payload.get("filename_pattern_signature")


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

    def __init__(self, duplicate_matching_settings: DuplicateMatchingSettings | None = None) -> None:
        self._strategies = (
            FilenameDuplicateDetectionStrategy(duplicate_matching_settings),
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


def get_duplicate_detection_strategy(
    mode: DuplicateDetectionMode | str,
    duplicate_matching_settings: DuplicateMatchingSettings | None = None,
) -> DuplicateDetectionStrategy:
    normalized_mode = DuplicateDetectionMode(mode)
    if normalized_mode == DuplicateDetectionMode.off:
        return DisabledDuplicateDetectionStrategy()
    if normalized_mode == DuplicateDetectionMode.both:
        return CombinedDuplicateDetectionStrategy(duplicate_matching_settings)
    if normalized_mode == DuplicateDetectionMode.filehash:
        return FileHashDuplicateDetectionStrategy()
    return FilenameDuplicateDetectionStrategy(duplicate_matching_settings)


def backfill_filename_pattern_signatures(
    db: Session,
    duplicate_matching_settings: DuplicateMatchingSettings | None = None,
) -> int:
    updated = 0
    media_files = db.scalars(
        select(MediaFile).where(
            or_(
                MediaFile.filename_pattern_signature.is_(None),
                func.length(func.trim(MediaFile.filename_pattern_signature)) == 0,
            )
        )
    ).all()
    for media_file in media_files:
        media_file.filename_pattern_signature = normalize_filename_pattern_signature(
            Path(media_file.filename),
            duplicate_matching_settings,
        )
        updated += 1
    if updated:
        db.flush()
    return updated


def normalize_suppression_mode(mode: DuplicateDetectionMode | str) -> DuplicateDetectionMode:
    normalized_mode = DuplicateDetectionMode(mode)
    if normalized_mode not in {DuplicateDetectionMode.filename, DuplicateDetectionMode.filehash}:
        raise ValueError("Duplicate suppression mode must be filename or filehash")
    return normalized_mode


def _normalize_suppression_signature(signature: str) -> str:
    normalized_signature = signature.strip()
    if not normalized_signature:
        raise ValueError("Duplicate suppression signature must not be empty")
    return normalized_signature


def suppress_duplicate_group(
    db: Session,
    library_id: int,
    mode: DuplicateDetectionMode | str,
    signature: str,
) -> DuplicateSuppressionRead | None:
    if db.get(Library, library_id) is None:
        return None

    normalized_mode = normalize_suppression_mode(mode)
    normalized_signature = _normalize_suppression_signature(signature)
    suppression = db.scalar(
        select(DuplicateGroupSuppression).where(
            DuplicateGroupSuppression.library_id == library_id,
            DuplicateGroupSuppression.mode == normalized_mode,
            DuplicateGroupSuppression.signature == normalized_signature,
        )
    )
    if suppression is None:
        suppression = DuplicateGroupSuppression(
            library_id=library_id,
            mode=normalized_mode,
            signature=normalized_signature,
        )
        db.add(suppression)
        db.flush()
    db.commit()
    db.refresh(suppression)
    return DuplicateSuppressionRead(
        id=suppression.id,
        library_id=suppression.library_id,
        mode=suppression.mode,
        signature=suppression.signature,
        created_at=suppression.created_at,
    )


def unsuppress_duplicate_group(
    db: Session,
    library_id: int,
    mode: DuplicateDetectionMode | str,
    signature: str,
) -> bool:
    if db.get(Library, library_id) is None:
        return False

    normalized_mode = normalize_suppression_mode(mode)
    normalized_signature = _normalize_suppression_signature(signature)
    db.execute(
        delete(DuplicateGroupSuppression).where(
            DuplicateGroupSuppression.library_id == library_id,
            DuplicateGroupSuppression.mode == normalized_mode,
            DuplicateGroupSuppression.signature == normalized_signature,
        )
    )
    db.commit()
    return True


def _suppression_exists_expression(library_id: int, mode: DuplicateDetectionMode, signature_column):
    return exists(
        select(1).where(
            DuplicateGroupSuppression.library_id == library_id,
            DuplicateGroupSuppression.mode == mode,
            DuplicateGroupSuppression.signature == signature_column,
        )
    )


def _filename_signature_expression():
    # Keep the legacy signature as a fallback until the next scan/startup
    # backfill has populated the enhanced title-core signature.
    return func.coalesce(MediaFile.filename_pattern_signature, MediaFile.filename_signature)


def _filename_signature_is_present():
    signature_column = _filename_signature_expression()
    return func.length(func.trim(signature_column)) > 0


def _filename_group_duration_condition(
    duplicate_matching_settings: DuplicateMatchingSettings | None,
):
    settings = duplicate_matching_settings or default_duplicate_matching_settings()
    enhanced_signature_present = and_(
        MediaFile.filename_pattern_signature.is_not(None),
        func.length(func.trim(MediaFile.filename_pattern_signature)) > 0,
    )
    # Legacy rows predate title-core signatures and have no runtime-aware
    # group semantics. They remain queryable until they are backfilled or
    # reprocessed; all enhanced groups require known runtimes in range.
    return or_(
        func.sum(case((enhanced_signature_present, 1), else_=0)) == 0,
        and_(
            func.count(case((MediaFile.duration_seconds > 0, MediaFile.id))) == func.count(MediaFile.id),
            func.max(MediaFile.duration_seconds) - func.min(MediaFile.duration_seconds)
            <= settings.duration_tolerance_seconds,
        ),
    )


def _active_signature_statement(
    library_id: int,
    mode: DuplicateDetectionMode,
    *,
    include_suppressed: bool = False,
    suppressed_only: bool = False,
    duplicate_matching_settings: DuplicateMatchingSettings | None = None,
) -> Select:
    if mode == DuplicateDetectionMode.both:
        raise ValueError("Combined duplicate mode must be expanded before building a signature query")

    if mode == DuplicateDetectionMode.filehash:
        signature_column = MediaFile.content_hash
        statement = (
            select(
                signature_column.label("signature"),
                func.count(MediaFile.id).label("file_count"),
                func.coalesce(func.sum(MediaFile.size_bytes), 0).label("total_size_bytes"),
                func.min(MediaFile.filename).label("label_source"),
            )
            .where(
                MediaFile.library_id == library_id,
                MediaFile.is_transcode_variant.is_(False),
                MediaFile.content_hash_algorithm == FILE_HASH_ALGORITHM,
                MediaFile.content_hash.is_not(None),
                func.length(func.trim(MediaFile.content_hash)) > 0,
            )
            .group_by(signature_column)
            .having(func.count(MediaFile.id) > 1)
        )
        suppression_exists = _suppression_exists_expression(library_id, mode, signature_column)
        if suppressed_only:
            return statement.where(suppression_exists)
        if not include_suppressed:
            return statement.where(~suppression_exists)
        return statement

    signature_column = _filename_signature_expression()
    statement = (
        select(
            signature_column.label("signature"),
            func.count(MediaFile.id).label("file_count"),
            func.coalesce(func.sum(MediaFile.size_bytes), 0).label("total_size_bytes"),
            func.min(MediaFile.filename).label("label_source"),
        )
        .where(
            MediaFile.library_id == library_id,
            MediaFile.is_transcode_variant.is_(False),
            _filename_signature_is_present(),
        )
        .group_by(signature_column)
        .having(
            func.count(MediaFile.id) > 1,
            _filename_group_duration_condition(duplicate_matching_settings),
        )
    )
    suppression_exists = _suppression_exists_expression(library_id, mode, signature_column)
    if suppressed_only:
        return statement.where(suppression_exists)
    if not include_suppressed:
        return statement.where(~suppression_exists)
    return statement


def _duplicate_file_membership_statement(
    library_id: int,
    mode: DuplicateDetectionMode,
    duplicate_matching_settings: DuplicateMatchingSettings | None = None,
) -> Select:
    grouped = _active_signature_statement(
        library_id,
        mode,
        duplicate_matching_settings=duplicate_matching_settings,
    ).subquery()
    if mode == DuplicateDetectionMode.filehash:
        return (
            select(MediaFile.id.label("media_file_id"))
            .join(grouped, MediaFile.content_hash == grouped.c.signature)
            .where(
                MediaFile.library_id == library_id,
                MediaFile.is_transcode_variant.is_(False),
                MediaFile.content_hash_algorithm == FILE_HASH_ALGORITHM,
                MediaFile.content_hash.is_not(None),
                func.length(func.trim(MediaFile.content_hash)) > 0,
            )
        )

    signature_column = _filename_signature_expression()
    return (
        select(MediaFile.id.label("media_file_id"))
        .join(grouped, signature_column == grouped.c.signature)
        .where(
            MediaFile.library_id == library_id,
            MediaFile.is_transcode_variant.is_(False),
            _filename_signature_is_present(),
        )
    )


def get_duplicate_group_counts(
    db: Session,
    library_id: int,
    mode: DuplicateDetectionMode | str,
    duplicate_matching_settings: DuplicateMatchingSettings | None = None,
) -> tuple[int, int]:
    active_modes = get_active_duplicate_detection_modes(mode)
    total_groups = 0
    membership_statements: list[Select] = []

    for active_mode in active_modes:
        grouped = _active_signature_statement(
            library_id,
            active_mode,
            duplicate_matching_settings=duplicate_matching_settings,
        ).subquery()
        total_groups += int(db.scalar(select(func.count()).select_from(grouped)) or 0)
        membership_statements.append(
            _duplicate_file_membership_statement(
                library_id,
                active_mode,
                duplicate_matching_settings,
            )
        )

    if not membership_statements:
        return 0, 0

    if len(membership_statements) == 1:
        duplicate_file_count = db.scalar(select(func.count()).select_from(membership_statements[0].subquery())) or 0
    else:
        membership_union = union(*membership_statements).subquery()
        duplicate_file_count = db.scalar(select(func.count()).select_from(membership_union)) or 0
    return int(total_groups), int(duplicate_file_count)


def get_suppressed_duplicate_group_count(
    db: Session,
    library_id: int,
    mode: DuplicateDetectionMode | str,
    duplicate_matching_settings: DuplicateMatchingSettings | None = None,
) -> int:
    total_groups = 0
    for active_mode in get_active_duplicate_detection_modes(mode):
        grouped = _active_signature_statement(
            library_id,
            active_mode,
            include_suppressed=True,
            suppressed_only=True,
            duplicate_matching_settings=duplicate_matching_settings,
        ).subquery()
        total_groups += int(db.scalar(select(func.count()).select_from(grouped)) or 0)
    return total_groups


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
    suppressed: bool = False


def _count_groups_for_mode(
    db: Session,
    library_id: int,
    mode: DuplicateDetectionMode,
    *,
    include_suppressed: bool = False,
    duplicate_matching_settings: DuplicateMatchingSettings | None = None,
) -> int:
    grouped = _active_signature_statement(
        library_id,
        mode,
        include_suppressed=include_suppressed,
        duplicate_matching_settings=duplicate_matching_settings,
    ).subquery()
    return int(db.scalar(select(func.count()).select_from(grouped)) or 0)


def _suppressed_signatures(
    db: Session,
    library_id: int,
    mode: DuplicateDetectionMode,
    signatures: Sequence[str],
) -> set[str]:
    if not signatures:
        return set()
    return set(
        db.execute(
            select(DuplicateGroupSuppression.signature).where(
                DuplicateGroupSuppression.library_id == library_id,
                DuplicateGroupSuppression.mode == mode,
                DuplicateGroupSuppression.signature.in_(signatures),
            )
        ).scalars()
    )


def _page_group_rows(
    db: Session,
    library_id: int,
    mode: DuplicateDetectionMode,
    offset: int,
    limit: int,
    *,
    include_suppressed: bool = False,
    duplicate_matching_settings: DuplicateMatchingSettings | None = None,
) -> list[DuplicateGroupRow]:
    if limit <= 0:
        return []

    rows: list[DuplicateGroupRow] = []
    remaining_offset = offset
    remaining_limit = limit

    for active_mode in get_active_duplicate_detection_modes(mode):
        group_count = _count_groups_for_mode(
            db,
            library_id,
            active_mode,
            include_suppressed=include_suppressed,
            duplicate_matching_settings=duplicate_matching_settings,
        )
        if remaining_offset >= group_count:
            remaining_offset -= group_count
            continue

        grouped = _active_signature_statement(
            library_id,
            active_mode,
            include_suppressed=include_suppressed,
            duplicate_matching_settings=duplicate_matching_settings,
        ).subquery()
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
        suppressed_signatures = _suppressed_signatures(
            db,
            library_id,
            active_mode,
            [str(row.signature) for row in result_rows if row.signature is not None],
        )
        rows.extend(
            DuplicateGroupRow(
                mode=active_mode,
                signature=str(row.signature),
                file_count=int(row.file_count or 0),
                total_size_bytes=int(row.total_size_bytes or 0),
                label_source=row.label_source,
                suppressed=str(row.signature) in suppressed_signatures,
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
                    MediaFile.library_root_id,
                    LibraryRoot.display_name.label("root_name"),
                    MediaFile.relative_path,
                    MediaFile.filename,
                    MediaFile.size_bytes,
                    MediaFile.content_hash.label("signature"),
                )
                .outerjoin(LibraryRoot, LibraryRoot.id == MediaFile.library_root_id)
                .where(
                    MediaFile.library_id == library_id,
                    MediaFile.content_hash_algorithm == FILE_HASH_ALGORITHM,
                    MediaFile.content_hash.in_(signatures),
                )
                .order_by(MediaFile.content_hash.asc(), LibraryRoot.display_name.asc(), MediaFile.relative_path.asc())
            ).all()
        else:
            signature_column = _filename_signature_expression()
            rows = db.execute(
                select(
                    MediaFile.id,
                    MediaFile.library_root_id,
                    LibraryRoot.display_name.label("root_name"),
                    MediaFile.relative_path,
                    MediaFile.filename,
                    MediaFile.size_bytes,
                    signature_column.label("signature"),
                )
                .outerjoin(LibraryRoot, LibraryRoot.id == MediaFile.library_root_id)
                .where(
                    MediaFile.library_id == library_id,
                    signature_column.in_(signatures),
                )
                .order_by(signature_column.asc(), LibraryRoot.display_name.asc(), MediaFile.relative_path.asc())
            ).all()

        for row in rows:
            display_path = f"{row.root_name}/{row.relative_path}" if row.root_name else row.relative_path
            grouped_items[(mode, str(row.signature))].append(
                DuplicateGroupFileRead(
                    id=row.id,
                    root_id=row.library_root_id,
                    root_name=row.root_name,
                    display_path=display_path,
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
    include_suppressed: bool = False,
    duplicate_matching_settings: DuplicateMatchingSettings | None = None,
) -> DuplicateGroupPageRead:
    library = db.get(Library, library_id)
    if library is None:
        raise ValueError(f"Library {library_id} not found")

    mode = library.duplicate_detection_mode
    resolved_duplicate_matching_settings = duplicate_matching_settings
    if resolved_duplicate_matching_settings is None:
        from backend.app.services.app_settings import get_app_settings

        resolved_duplicate_matching_settings = get_app_settings(db).pattern_recognition.duplicate_matching

    total_groups, duplicate_file_count = get_duplicate_group_counts(
        db,
        library_id,
        mode,
        resolved_duplicate_matching_settings,
    )
    suppressed_group_count = get_suppressed_duplicate_group_count(
        db,
        library_id,
        mode,
        resolved_duplicate_matching_settings,
    )
    group_rows = _page_group_rows(
        db,
        library_id,
        mode,
        offset,
        limit,
        include_suppressed=include_suppressed,
        duplicate_matching_settings=resolved_duplicate_matching_settings,
    )
    items_by_signature = _group_files_by_signature(db, library_id, group_rows)

    items = [
        DuplicateGroupRead(
            mode=row.mode,
            signature=row.signature,
            label=_group_label(row.mode, row.signature, row.label_source),
            file_count=row.file_count,
            total_size_bytes=row.total_size_bytes,
            suppressed=row.suppressed,
            items=items_by_signature.get((row.mode, row.signature), []),
        )
        for row in group_rows
    ]
    return DuplicateGroupPageRead(
        mode=mode,
        total_groups=total_groups,
        duplicate_file_count=duplicate_file_count,
        include_suppressed=include_suppressed,
        suppressed_group_count=suppressed_group_count,
        offset=offset,
        limit=limit,
        items=items,
    )
