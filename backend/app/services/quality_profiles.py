from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from backend.app.models.entities import Library, LibraryType, MediaFile, QualityProfileDefinition, QualityProfileMediaType
from backend.app.schemas.app_settings import ResolutionCategory
from backend.app.schemas.quality_profiles import QualityProfileCreate, QualityProfileRead, QualityProfileUpdate
from backend.app.services.quality import default_quality_profile, default_quality_profile_for_media_type, normalize_quality_profile
from backend.app.services.stats_cache import stats_cache


DEFAULT_PROFILE_NAMES = {
    QualityProfileMediaType.video: "Default video",
    QualityProfileMediaType.music: "Default music",
    QualityProfileMediaType.audiobook: "Default audiobook",
}


def media_type_for_library_type(library_type: LibraryType | str) -> QualityProfileMediaType | None:
    value = library_type.value if isinstance(library_type, LibraryType) else str(library_type)
    if value in {"movies", "series"}:
        return QualityProfileMediaType.video
    if value == "music":
        return QualityProfileMediaType.music
    if value == "audiobooks":
        return QualityProfileMediaType.audiobook
    return None


def media_type_for_media_file(media_file: MediaFile) -> QualityProfileMediaType:
    library_media_type = media_type_for_library_type(media_file.library.type)
    if library_media_type is not None:
        return library_media_type
    if media_file.video_streams:
        return QualityProfileMediaType.video
    return QualityProfileMediaType.music


def ensure_default_quality_profiles(db: Session, resolution_categories: list[ResolutionCategory]) -> None:
    existing_defaults = set(
        db.scalars(select(QualityProfileDefinition.media_type).where(QualityProfileDefinition.is_default.is_(True))).all()
    )
    for media_type in QualityProfileMediaType:
        if media_type in existing_defaults:
            continue
        db.add(
            QualityProfileDefinition(
                name=DEFAULT_PROFILE_NAMES[media_type],
                media_type=media_type,
                profile=normalize_quality_profile(
                    default_quality_profile_for_media_type(media_type.value),
                    resolution_categories,
                ),
                is_default=True,
            )
        )
    db.flush()


def migrate_legacy_library_quality_profiles(
    db: Session,
    resolution_categories: list[ResolutionCategory],
) -> None:
    ensure_default_quality_profiles(db, resolution_categories)
    libraries = db.scalars(select(Library).order_by(Library.id.asc())).all()
    if not libraries:
        return
    if any(library.quality_profile_id is not None for library in libraries):
        for library in libraries:
            if library.quality_profile_id is None:
                continue
            profile = db.get(QualityProfileDefinition, library.quality_profile_id)
            if profile is not None and _profile_matches_legacy_default(profile.profile, resolution_categories):
                library.quality_profile_id = None
        db.flush()
        return

    imported_by_key: dict[tuple[QualityProfileMediaType, str], QualityProfileDefinition] = {}
    default_profiles = _default_profile_map(db)
    for library in libraries:
        media_type = media_type_for_library_type(library.type)
        if media_type is None:
            library.quality_profile_id = None
            continue
        current = normalize_quality_profile(library.quality_profile, resolution_categories)
        if current == default_profiles[media_type].profile:
            library.quality_profile_id = None
            continue
        key = (media_type, _profile_key(current))
        profile = imported_by_key.get(key)
        if profile is None:
            profile = QualityProfileDefinition(
                name=_unique_profile_name(db, media_type, f"{library.name} quality"),
                media_type=media_type,
                profile=current,
                is_default=False,
            )
            db.add(profile)
            db.flush()
            imported_by_key[key] = profile
        library.quality_profile_id = profile.id
    db.flush()


def list_quality_profiles(db: Session) -> list[QualityProfileRead]:
    rows = db.execute(
        select(QualityProfileDefinition, func.count(Library.id))
        .join(Library, Library.quality_profile_id == QualityProfileDefinition.id, isouter=True)
        .group_by(QualityProfileDefinition.id)
        .order_by(QualityProfileDefinition.media_type.asc(), QualityProfileDefinition.is_default.desc(), QualityProfileDefinition.name.asc())
    ).all()
    return [
        QualityProfileRead.model_validate(profile).model_copy(update={"library_count": library_count or 0})
        for profile, library_count in rows
    ]


def create_quality_profile(
    db: Session,
    payload: QualityProfileCreate,
    resolution_categories: list[ResolutionCategory],
) -> tuple[QualityProfileDefinition, list[int]]:
    name = _clean_name(payload.name)
    _assert_unique_name(db, payload.media_type, name)
    profile = QualityProfileDefinition(
        name=name,
        media_type=payload.media_type,
        profile=normalize_quality_profile(payload.profile, resolution_categories),
        is_default=False,
    )
    db.add(profile)
    db.flush()
    affected_library_ids: list[int] = []
    if payload.is_default:
        affected_library_ids = _set_default_profile(db, profile)
    db.commit()
    db.refresh(profile)
    stats_cache.invalidate(str(id(db.get_bind())))
    return profile, affected_library_ids


def update_quality_profile(
    db: Session,
    profile_id: int,
    payload: QualityProfileUpdate,
    resolution_categories: list[ResolutionCategory],
) -> tuple[QualityProfileDefinition | None, list[int]]:
    profile = db.get(QualityProfileDefinition, profile_id)
    if profile is None:
        return None, []
    affected_library_ids = _affected_library_ids_for_profile(db, profile)
    if payload.name is not None:
        name = _clean_name(payload.name)
        _assert_unique_name(db, profile.media_type, name, profile_id=profile.id)
        profile.name = name
    if payload.profile is not None:
        profile.profile = normalize_quality_profile(payload.profile, resolution_categories)
    if payload.is_default is True and not profile.is_default:
        affected_library_ids = sorted(set(affected_library_ids + _set_default_profile(db, profile)))
    db.commit()
    db.refresh(profile)
    stats_cache.invalidate(str(id(db.get_bind())))
    return profile, affected_library_ids


def delete_quality_profile(db: Session, profile_id: int) -> tuple[bool, list[int]]:
    profile = db.get(QualityProfileDefinition, profile_id)
    if profile is None:
        return False, []
    if profile.is_default:
        raise ValueError("Default quality profiles cannot be deleted")
    affected_library_ids = _affected_library_ids_for_profile(db, profile)
    db.execute(update(Library).where(Library.quality_profile_id == profile.id).values(quality_profile_id=None))
    db.delete(profile)
    db.commit()
    stats_cache.invalidate(str(id(db.get_bind())))
    return True, affected_library_ids


def validate_library_quality_profile(
    db: Session,
    library_type: LibraryType,
    profile_id: int | None,
) -> QualityProfileDefinition | None:
    expected_media_type = media_type_for_library_type(library_type)
    if expected_media_type is None:
        if profile_id is not None:
            raise ValueError("Mixed and other libraries use default quality profiles automatically")
        return None
    if profile_id is None:
        return None
    profile = db.get(QualityProfileDefinition, profile_id)
    if profile is None:
        raise ValueError("Quality profile not found")
    if profile.media_type != expected_media_type:
        raise ValueError("Quality profile is not compatible with this library type")
    return profile


def effective_quality_profile_for_library(
    db: Session,
    library: Library,
    resolution_categories: list[ResolutionCategory],
) -> dict[str, Any]:
    profile = None
    if library.quality_profile_id is not None:
        profile = db.get(QualityProfileDefinition, library.quality_profile_id)
        if profile is not None and _profile_matches_legacy_default(profile.profile, resolution_categories):
            profile = None
    media_type = media_type_for_library_type(library.type)
    if media_type is None:
        media_type = QualityProfileMediaType.video
    if profile is None or profile.media_type != media_type:
        legacy_profile = _legacy_profile_if_custom(library, media_type, resolution_categories)
        if legacy_profile is not None:
            return legacy_profile
        profile = _default_profile_map(db).get(media_type)
        if profile is None:
            return normalize_quality_profile(default_quality_profile_for_media_type(media_type.value), resolution_categories)
    return normalize_quality_profile(profile.profile, resolution_categories)


def effective_quality_profile_for_media_file(
    db: Session,
    media_file: MediaFile,
    resolution_categories: list[ResolutionCategory],
) -> dict[str, Any]:
    library = media_file.library
    library_media_type = media_type_for_library_type(library.type)
    if library_media_type is not None and library.quality_profile_id is not None:
        profile = db.get(QualityProfileDefinition, library.quality_profile_id)
        if (
            profile is not None
            and profile.media_type == library_media_type
            and not _profile_matches_legacy_default(profile.profile, resolution_categories)
        ):
            return normalize_quality_profile(profile.profile, resolution_categories)
    if library_media_type is not None:
        legacy_profile = _legacy_profile_if_custom(library, library_media_type, resolution_categories)
        if legacy_profile is not None:
            return legacy_profile
    media_type = media_type_for_media_file(media_file)
    profile = _default_profile_map(db).get(media_type)
    if profile is None:
        return normalize_quality_profile(default_quality_profile_for_media_type(media_type.value), resolution_categories)
    return normalize_quality_profile(profile.profile, resolution_categories)


def _legacy_profile_if_custom(
    library: Library,
    media_type: QualityProfileMediaType,
    resolution_categories: list[ResolutionCategory],
) -> dict[str, Any] | None:
    current = normalize_quality_profile(library.quality_profile, resolution_categories)
    legacy_default = normalize_quality_profile(default_quality_profile(), resolution_categories)
    return current if current != legacy_default else None


def _profile_matches_legacy_default(
    profile: dict[str, Any],
    resolution_categories: list[ResolutionCategory],
) -> bool:
    return normalize_quality_profile(profile, resolution_categories) == normalize_quality_profile(
        default_quality_profile(),
        resolution_categories,
    )


def _set_default_profile(db: Session, profile: QualityProfileDefinition) -> list[int]:
    previous_default = db.scalar(
        select(QualityProfileDefinition).where(
            QualityProfileDefinition.media_type == profile.media_type,
            QualityProfileDefinition.is_default.is_(True),
        )
    )
    if previous_default is not None and previous_default.id != profile.id:
        previous_default.is_default = False
    profile.is_default = True
    return _affected_default_library_ids(db, profile.media_type)


def _default_profile_map(db: Session) -> dict[QualityProfileMediaType, QualityProfileDefinition]:
    rows = db.scalars(select(QualityProfileDefinition).where(QualityProfileDefinition.is_default.is_(True))).all()
    return {profile.media_type: profile for profile in rows}


def _affected_library_ids_for_profile(db: Session, profile: QualityProfileDefinition) -> list[int]:
    explicit_ids = db.scalars(select(Library.id).where(Library.quality_profile_id == profile.id)).all()
    if profile.is_default:
        return sorted(set(explicit_ids + _affected_default_library_ids(db, profile.media_type)))
    return sorted(set(explicit_ids))


def _affected_default_library_ids(db: Session, media_type: QualityProfileMediaType) -> list[int]:
    rows = db.scalars(select(Library).order_by(Library.id.asc())).all()
    affected: list[int] = []
    for library in rows:
        library_media_type = media_type_for_library_type(library.type)
        if library_media_type == media_type and library.quality_profile_id is None:
            affected.append(library.id)
        elif library_media_type is None and media_type in {QualityProfileMediaType.video, QualityProfileMediaType.music}:
            affected.append(library.id)
    return affected


def _clean_name(name: str) -> str:
    candidate = name.strip()
    if not candidate:
        raise ValueError("Quality profile name must not be empty")
    return candidate


def _assert_unique_name(
    db: Session,
    media_type: QualityProfileMediaType,
    name: str,
    *,
    profile_id: int | None = None,
) -> None:
    existing = db.scalar(
        select(QualityProfileDefinition.id).where(
            QualityProfileDefinition.media_type == media_type,
            QualityProfileDefinition.name == name,
        )
    )
    if existing is not None and existing != profile_id:
        raise ValueError("A quality profile with this name already exists for this media type")


def _unique_profile_name(db: Session, media_type: QualityProfileMediaType, base_name: str) -> str:
    existing = set(
        db.scalars(select(QualityProfileDefinition.name).where(QualityProfileDefinition.media_type == media_type)).all()
    )
    if base_name not in existing:
        return base_name
    index = 2
    while f"{base_name} {index}" in existing:
        index += 1
    return f"{base_name} {index}"


def _profile_key(profile: dict[str, Any]) -> str:
    import json

    return json.dumps(profile, sort_keys=True, separators=(",", ":"))
