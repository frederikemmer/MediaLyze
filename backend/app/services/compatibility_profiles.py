from __future__ import annotations

import json
import os
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from backend.app.core.config import Settings
from backend.app.schemas.compatibility import (
    CatalogSource,
    CompatibilityProfile,
    HardwareProfile,
    SoftwareProfile,
)


ProfileT = TypeVar("ProfileT", bound=BaseModel)
PROFILE_MODELS = {
    "hardware": HardwareProfile,
    "software": SoftwareProfile,
    "compatibility": CompatibilityProfile,
}
LOCAL_DIRECTORIES = {
    "hardware": "hardware_profiles",
    "software": "software_profiles",
    "compatibility": "compatibility_profiles",
}


class ProfileCatalogError(ValueError):
    pass


def official_catalog_root() -> Path:
    return Path(__file__).resolve().parents[1] / "profile_catalog"


def _load_directory(path: Path, model: type[ProfileT], source: CatalogSource) -> list[ProfileT]:
    if not path.exists():
        return []
    profiles: list[ProfileT] = []
    for profile_path in sorted(path.glob("*.json")):
        try:
            payload = json.loads(profile_path.read_text(encoding="utf-8"))
            profile = model.model_validate(payload)
        except (OSError, json.JSONDecodeError, ValidationError) as exc:
            raise ProfileCatalogError(f"Invalid profile {profile_path.name}: {exc}") from exc
        if profile.id != profile_path.stem:
            raise ProfileCatalogError(f"Profile id does not match filename: {profile_path.name}")
        if source == CatalogSource.official and profile.status != "official":
            raise ProfileCatalogError(f"Official profile must have status=official: {profile_path.name}")
        profiles.append(profile.model_copy(update={"catalog_source": source}))
    return profiles


def list_profiles(settings: Settings, kind: str):
    model = PROFILE_MODELS[kind]
    official = []
    if kind != "compatibility":
        official = _load_directory(
            official_catalog_root() / LOCAL_DIRECTORIES[kind],
            model,
            CatalogSource.official,
        )
    local = _load_directory(
        Path(settings.config_path) / LOCAL_DIRECTORIES[kind],
        model,
        CatalogSource.local,
    )
    by_id = {profile.id: profile for profile in official}
    for profile in local:
        if profile.id in by_id:
            raise ProfileCatalogError(f"Local profile duplicates official id: {profile.id}")
        by_id[profile.id] = profile
    return sorted(by_id.values(), key=lambda item: item.name.casefold())


def get_profile(settings: Settings, kind: str, profile_id: str):
    return next((item for item in list_profiles(settings, kind) if item.id == profile_id), None)


def _write_local_profile(settings: Settings, kind: str, profile: BaseModel) -> None:
    directory = Path(settings.config_path) / LOCAL_DIRECTORIES[kind]
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{profile.id}.json"
    temporary = directory / f".{profile.id}.{os.getpid()}.tmp"
    temporary.write_text(
        json.dumps(profile.model_dump(mode="json", exclude={"catalog_source"}), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, target)


def create_local_profile(settings: Settings, kind: str, payload: dict):
    model = PROFILE_MODELS[kind]
    profile = model.model_validate({**payload, "status": "local"})
    if get_profile(settings, kind, profile.id):
        raise ProfileCatalogError(f"Profile id already exists: {profile.id}")
    if kind == "compatibility":
        validate_compatibility_references(settings, profile)
    _write_local_profile(settings, kind, profile)
    return profile.model_copy(update={"catalog_source": CatalogSource.local})


def update_local_profile(settings: Settings, kind: str, profile_id: str, payload: dict):
    current = get_profile(settings, kind, profile_id)
    if current is None:
        return None
    if current.catalog_source != CatalogSource.local:
        raise ProfileCatalogError("Official profiles are read-only")
    merged = current.model_dump(mode="json", exclude={"catalog_source"})
    merged.update(payload)
    merged["id"] = profile_id
    merged["status"] = "local"
    model = PROFILE_MODELS[kind]
    profile = model.model_validate(merged)
    if kind == "compatibility":
        validate_compatibility_references(settings, profile)
    _write_local_profile(settings, kind, profile)
    return profile.model_copy(update={"catalog_source": CatalogSource.local})


def delete_local_profile(settings: Settings, kind: str, profile_id: str) -> bool:
    profile = get_profile(settings, kind, profile_id)
    if profile is None:
        return False
    if profile.catalog_source != CatalogSource.local:
        raise ProfileCatalogError("Official profiles are read-only")
    if kind in {"hardware", "software"}:
        field = f"{kind}_profile_id"
        if any(getattr(item, field) == profile_id for item in list_profiles(settings, "compatibility")):
            raise ProfileCatalogError("Profile is referenced by a compatibility profile")
    target = Path(settings.config_path) / LOCAL_DIRECTORIES[kind] / f"{profile_id}.json"
    target.unlink()
    return True


def validate_compatibility_references(settings: Settings, profile: CompatibilityProfile) -> None:
    if get_profile(settings, "hardware", profile.hardware_profile_id) is None:
        raise ProfileCatalogError(f"Unknown hardware profile: {profile.hardware_profile_id}")
    if get_profile(settings, "software", profile.software_profile_id) is None:
        raise ProfileCatalogError(f"Unknown software profile: {profile.software_profile_id}")

