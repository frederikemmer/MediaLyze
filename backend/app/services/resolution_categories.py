from __future__ import annotations

import re
from dataclasses import dataclass

from backend.app.schemas.app_settings import ResolutionCategory

DEFAULT_RESOLUTION_CATEGORIES: tuple[ResolutionCategory, ...] = (
    ResolutionCategory(id="8k", label="8k", min_width=7680, min_height=3200),
    ResolutionCategory(id="4k", label="4k", min_width=3840, min_height=1600),
    ResolutionCategory(id="1080p", label="1080p", min_width=1920, min_height=800),
    ResolutionCategory(id="720p", label="720p", min_width=1280, min_height=533),
    ResolutionCategory(id="sd", label="sd", min_width=0, min_height=0),
)
LEGACY_RESOLUTION_ALIASES: dict[str, str] = {
    "2160p": "4k",
    "4k": "4k",
    "1080p": "1080p",
    "720p": "720p",
    "sd": "sd",
    "8k": "8k",
}


@dataclass(frozen=True, slots=True)
class ResolutionCategoryUpdateResult:
    categories: list[ResolutionCategory]
    changed: bool
    logic_changed: bool
    removed_ids: set[str]


def default_resolution_categories() -> list[ResolutionCategory]:
    return [item.model_copy() for item in DEFAULT_RESOLUTION_CATEGORIES]


def _coerce_categories(categories: list[ResolutionCategory] | list[dict] | None) -> list[ResolutionCategory]:
    if not categories:
        return default_resolution_categories()
    return [
        item if isinstance(item, ResolutionCategory) else ResolutionCategory.model_validate(item)
        for item in categories
    ]


def category_sort_key(category: ResolutionCategory) -> tuple[int, int, str]:
    return (-(category.min_width * category.min_height), -category.min_height, -category.min_width, category.id)


def normalize_resolution_category_id(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return normalized or "resolution"


def normalize_resolution_categories(
    payload: list[ResolutionCategory] | list[dict] | None,
    *,
    existing_categories: list[ResolutionCategory] | None = None,
) -> ResolutionCategoryUpdateResult:
    base_existing = list(existing_categories or [])
    default_categories = default_resolution_categories()
    raw_items = list(payload or default_categories)
    if not raw_items:
        raise ValueError("At least one resolution category is required")

    existing_by_id = {category.id: category for category in base_existing}
    seen_ids: set[str] = set()
    normalized_items: list[ResolutionCategory] = []

    for index, item in enumerate(raw_items):
        candidate = item if isinstance(item, ResolutionCategory) else ResolutionCategory.model_validate(item)
        requested_id = candidate.id.strip()
        if requested_id and requested_id in existing_by_id:
            resolved_id = requested_id
        elif requested_id and requested_id not in existing_by_id and base_existing:
            raise ValueError("Resolution category ids are immutable")
        else:
            resolved_id = normalize_resolution_category_id(candidate.label) if base_existing else normalize_resolution_category_id(
                requested_id or candidate.label
            )

        unique_id = resolved_id
        suffix = 2
        while unique_id in seen_ids:
            if base_existing:
                raise ValueError("Resolution category ids must be unique")
            unique_id = f"{resolved_id}_{suffix}"
            suffix += 1

        seen_ids.add(unique_id)
        normalized_items.append(
            ResolutionCategory(
                id=unique_id,
                label=candidate.label.strip() or unique_id,
                min_width=max(0, int(candidate.min_width)),
                min_height=max(0, int(candidate.min_height)),
            )
        )

    normalized_items.sort(key=category_sort_key)
    fallback_items = [item for item in normalized_items if item.min_width == 0 and item.min_height == 0]
    if not fallback_items:
        raise ValueError("A fallback resolution category with 0x0 thresholds is required")
    if len(fallback_items) > 1:
        raise ValueError("Only one fallback resolution category with 0x0 thresholds is allowed")
    if normalized_items[-1].id != fallback_items[0].id:
        raise ValueError("The fallback resolution category must remain the final category")

    changed = [item.model_dump(mode="json") for item in normalized_items] != [
        item.model_dump(mode="json") for item in (base_existing or default_categories)
    ]
    logic_changed = [
        (item.id, item.min_width, item.min_height)
        for item in normalized_items
    ] != [
        (item.id, item.min_width, item.min_height)
        for item in (base_existing or default_categories)
    ]
    removed_ids = set(existing_by_id) - {item.id for item in normalized_items}

    return ResolutionCategoryUpdateResult(
        categories=normalized_items,
        changed=changed,
        logic_changed=logic_changed or bool(removed_ids),
        removed_ids=removed_ids,
    )


def normalize_resolution_for_matching(width: int | None, height: int | None) -> tuple[int, int] | None:
    if not width or not height:
        return None
    return max(width, height), min(width, height)


def classify_resolution_category(
    width: int | None,
    height: int | None,
    categories: list[ResolutionCategory] | None,
) -> ResolutionCategory | None:
    normalized = normalize_resolution_for_matching(width, height)
    if normalized is None:
        return None
    max_edge, min_edge = normalized
    ordered = _coerce_categories(categories)
    for category in ordered:
        if max_edge >= category.min_width and min_edge >= category.min_height:
            return category
    return ordered[-1]


def resolution_category_rank_map(categories: list[ResolutionCategory] | None) -> dict[str, float]:
    ordered = _coerce_categories(categories)
    total = len(ordered)
    return {category.id: float(total - index) for index, category in enumerate(ordered)}


def resolve_resolution_category_fallback(
    category_id: str | None,
    categories: list[ResolutionCategory] | None,
) -> str | None:
    ordered = _coerce_categories(categories)
    if not ordered:
        return None
    if not category_id:
        return ordered[-1].id

    index_by_id = {category.id: index for index, category in enumerate(ordered)}
    if category_id in index_by_id:
        return category_id

    default_order = [category.id for category in default_resolution_categories()]
    if category_id in default_order:
        removed_index = default_order.index(category_id)
        for fallback_id in reversed(default_order[:removed_index]):
            if fallback_id in index_by_id:
                return fallback_id
        for fallback_id in default_order[removed_index + 1:]:
            if fallback_id in index_by_id:
                return fallback_id

    return ordered[-1].id


def resolution_category_search_terms(categories: list[ResolutionCategory] | None) -> dict[str, str]:
    terms: dict[str, str] = {}
    for category in _coerce_categories(categories):
        terms[category.id.lower()] = category.id
        terms[category.label.strip().lower()] = category.id
    ordered = _coerce_categories(categories)
    for alias, category_id in LEGACY_RESOLUTION_ALIASES.items():
        if any(category.id == category_id for category in ordered):
            terms[alias] = category_id
    return terms
