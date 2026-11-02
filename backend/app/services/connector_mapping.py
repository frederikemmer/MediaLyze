from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from backend.app.models.entities import (
    ConnectorConnection,
    ConnectorItem,
    ConnectorLibrary,
    ConnectorLibraryLink,
    ConnectorLibraryLocation,
    ConnectorMediaMatch,
    ConnectorRootBinding,
    JellyfinLibrary,
    JellyfinPathMapping,
    LibraryRoot,
    MediaFile,
)
from backend.app.services.connector_pathing import (
    binding_source_key,
    normalize_connector_path,
    normalize_target_subpath,
)
from backend.app.services.connector_service import refresh_preferred_connections
from backend.app.schemas.connectors import (
    ConnectorBindingRead,
    ConnectorMappingCoverageRead,
    ConnectorMappingLibraryRead,
    ConnectorMappingLocationRead,
    ConnectorMappingOverviewRead,
    ConnectorMappingRecommendationRead,
)
from backend.app.utils.time import utc_now


MIN_CORPUS_EVIDENCE = 3


def _suggested_library_type(media_type: str | None) -> str:
    return {
        "movies": "movies",
        "movie": "movies",
        "tvshows": "series",
        "shows": "series",
        "series": "series",
        "music": "music",
        "books": "audiobooks",
        "audiobooks": "audiobooks",
        "mixed": "mixed",
    }.get((media_type or "").casefold(), "other")


@dataclass(slots=True)
class _CandidateRule:
    location_id: int
    library_root_id: int
    source_prefix: str
    target_subpath: str
    case_mode: str
    evidence_item_ids: set[int]
    direct: bool = False

    @property
    def evidence_count(self) -> int:
        return len(self.evidence_item_ids)

    @property
    def identity(self) -> tuple[int, int, str, str, str]:
        return (
            self.location_id,
            self.library_root_id,
            binding_source_key(self.source_prefix, self.case_mode),
            self.target_subpath,
            self.case_mode,
        )


def _mode(value: object) -> str:
    return str(getattr(value, "value", value))


def _path_parts(value: str) -> tuple[str, ...]:
    return normalize_connector_path(value).segments


def _starts_with(parts: tuple[str, ...], prefix: tuple[str, ...]) -> bool:
    return len(parts) >= len(prefix) and tuple(part.casefold() for part in parts[: len(prefix)]) == tuple(
        part.casefold() for part in prefix
    )


def _join_prefix(base: str, extra: tuple[str, ...]) -> str:
    display = normalize_connector_path(base).display
    if not extra:
        return display
    return f"{display.rstrip('/')}/{'/'.join(extra)}"


def _relative_parts(path: str, prefix: str) -> tuple[str, ...] | None:
    path_parts = _path_parts(path)
    prefix_parts = _path_parts(prefix)
    if not _starts_with(path_parts, prefix_parts):
        return None
    return path_parts[len(prefix_parts) :]


def _common_suffix_count(left: tuple[str, ...], right: tuple[str, ...]) -> int:
    count = 0
    for left_part, right_part in zip(reversed(left), reversed(right), strict=False):
        if left_part.casefold() != right_part.casefold():
            break
        count += 1
    return count


def _case_mode(path: str, relative_path: str) -> str:
    normalized = normalize_connector_path(path).display
    if normalized.startswith("//") or (len(normalized) >= 3 and normalized[1:3] == ":/"):
        return "insensitive"
    remote_name = PurePosixPath(normalized).name
    local_name = PurePosixPath(relative_path.replace("\\", "/")).name
    return "insensitive" if remote_name != local_name and remote_name.casefold() == local_name.casefold() else "sensitive"


def _metadata_supports(item: ConnectorItem, media: object) -> bool:
    size_matches = (
        item.size_bytes is not None
        and media.size_bytes is not None
        and int(item.size_bytes) == int(media.size_bytes)
    )
    duration_matches = (
        item.duration_seconds is not None
        and media.duration_seconds is not None
        and abs(float(item.duration_seconds) - float(media.duration_seconds)) <= 3
    )
    return size_matches or duration_matches


def _direct_rules(
    locations: list[ConnectorLibraryLocation],
    roots: list[LibraryRoot],
) -> list[_CandidateRule]:
    rules: list[_CandidateRule] = []
    for location in locations:
        location_parts = _path_parts(location.remote_path)
        for root in roots:
            root_parts = _path_parts(root.path)
            if tuple(part.casefold() for part in location_parts) == tuple(
                part.casefold() for part in root_parts
            ):
                source_prefix = location.remote_path
                target_subpath = ""
            elif _starts_with(root_parts, location_parts):
                source_prefix = _join_prefix(location.remote_path, root_parts[len(location_parts) :])
                target_subpath = ""
            elif _starts_with(location_parts, root_parts):
                source_prefix = location.remote_path
                target_subpath = "/".join(location_parts[len(root_parts) :])
            else:
                continue
            rules.append(
                _CandidateRule(
                    location_id=location.id,
                    library_root_id=root.id,
                    source_prefix=source_prefix,
                    target_subpath=normalize_target_subpath(target_subpath),
                    case_mode=_case_mode(location.remote_path, root.path),
                    evidence_item_ids=set(),
                    direct=True,
                )
            )
    return rules


def _corpus_rules(
    items: list[ConnectorItem],
    locations_by_library: dict[int, list[ConnectorLibraryLocation]],
    media_rows: list[object],
) -> list[_CandidateRule]:
    media_by_name: dict[str, list[object]] = defaultdict(list)
    for media in media_rows:
        media_by_name[str(media.filename).casefold()].append(media)

    grouped: dict[tuple[int, int, str, str, str], _CandidateRule] = {}
    for item in items:
        if not item.remote_path or item.connector_library_id is None:
            continue
        filename = PurePosixPath(item.remote_path.replace("\\", "/")).name.casefold()
        candidates = [
            media
            for media in media_by_name.get(filename, ())
            if media.library_root_id is not None and _metadata_supports(item, media)
        ]
        if len(candidates) != 1:
            continue
        media = candidates[0]
        matching_locations: list[tuple[int, ConnectorLibraryLocation, tuple[str, ...]]] = []
        for location in locations_by_library.get(item.connector_library_id, ()):
            relative_remote = _relative_parts(item.remote_path, location.remote_path)
            if relative_remote is not None:
                matching_locations.append((len(_path_parts(location.remote_path)), location, relative_remote))
        if not matching_locations:
            continue
        _length, location, remote_parts = max(matching_locations, key=lambda entry: entry[0])
        local_parts = tuple(
            part for part in media.relative_path.replace("\\", "/").split("/") if part
        )
        common = _common_suffix_count(remote_parts, local_parts)
        if common < 1:
            continue
        remote_extra = remote_parts[:-common]
        local_extra = local_parts[:-common]
        case_mode = _case_mode(item.remote_path, media.relative_path)
        source_prefix = _join_prefix(location.remote_path, remote_extra)
        target_subpath = normalize_target_subpath("/".join(local_extra))
        key = (
            location.id,
            int(media.library_root_id),
            binding_source_key(source_prefix, case_mode),
            target_subpath,
            case_mode,
        )
        rule = grouped.get(key)
        if rule is None:
            rule = _CandidateRule(
                location_id=location.id,
                library_root_id=int(media.library_root_id),
                source_prefix=source_prefix,
                target_subpath=target_subpath,
                case_mode=case_mode,
                evidence_item_ids=set(),
            )
            grouped[key] = rule
        rule.evidence_item_ids.add(item.id)
    return list(grouped.values())


def _select_unambiguous_rules(rules: list[_CandidateRule]) -> list[_CandidateRule]:
    by_source: dict[tuple[int, str], list[_CandidateRule]] = defaultdict(list)
    for rule in rules:
        by_source[(rule.location_id, binding_source_key(rule.source_prefix, rule.case_mode))].append(rule)

    selected: list[_CandidateRule] = []
    for candidates in by_source.values():
        direct = [rule for rule in candidates if rule.direct]
        considered = direct or candidates
        targets = {(rule.library_root_id, rule.target_subpath) for rule in considered}
        if len(targets) != 1:
            continue
        best = max(considered, key=lambda rule: (rule.direct, rule.evidence_count))
        if best.direct or best.evidence_count >= MIN_CORPUS_EVIDENCE:
            selected.append(best)
    return sorted(
        selected,
        key=lambda rule: (
            rule.location_id,
            -len(_path_parts(rule.source_prefix)),
            rule.library_root_id,
            rule.target_subpath,
        ),
    )


def _refresh_required_links(db: Session, connection: ConnectorConnection) -> int:
    derived_pairs = set(
        db.execute(
            select(ConnectorLibraryLocation.connector_library_id, LibraryRoot.library_id)
            .join(
                ConnectorRootBinding,
                ConnectorRootBinding.location_id == ConnectorLibraryLocation.id,
            )
            .join(ConnectorLibrary)
            .join(LibraryRoot, LibraryRoot.id == ConnectorRootBinding.library_root_id)
            .where(
                ConnectorLibrary.connection_id == connection.id,
                ConnectorRootBinding.active.is_(True),
            )
        )
    )
    links = list(
        db.scalars(
            select(ConnectorLibraryLink)
            .join(ConnectorLibrary)
            .where(ConnectorLibrary.connection_id == connection.id)
        )
    )
    by_pair = {(link.connector_library_id, link.library_id): link for link in links}
    for pair, link in by_pair.items():
        if pair in derived_pairs:
            link.link_method = "derived"
        elif link.link_method == "derived" or _mode(connection.library_mapping_mode) == "automatic":
            db.delete(link)
    for connector_library_id, library_id in derived_pairs - set(by_pair):
        db.add(
            ConnectorLibraryLink(
                connector_library_id=connector_library_id,
                library_id=library_id,
                link_method="derived",
            )
        )
    refresh_preferred_connections(db)
    return len(derived_pairs)


def reconcile_connector_mappings(
    db: Session,
    connection_id: int,
    *,
    commit: bool = True,
) -> dict[str, int]:
    connection = db.get(ConnectorConnection, connection_id)
    if connection is None:
        raise LookupError("Connector connection not found")

    if _mode(connection.path_mapping_mode) != "automatic":
        required_links = _refresh_required_links(db, connection)
        if commit:
            db.commit()
        else:
            db.flush()
        return {"created": 0, "verified": 0, "stale": 0, "required_links": required_links}

    libraries = list(
        db.scalars(select(ConnectorLibrary).where(ConnectorLibrary.connection_id == connection_id))
    )
    library_ids = {library.id for library in libraries}
    locations = list(
        db.scalars(
            select(ConnectorLibraryLocation).where(
                ConnectorLibraryLocation.connector_library_id.in_(library_ids)
            )
        )
    ) if library_ids else []
    locations_by_library: dict[int, list[ConnectorLibraryLocation]] = defaultdict(list)
    for location in locations:
        locations_by_library[location.connector_library_id].append(location)
    roots = list(db.scalars(select(LibraryRoot)))
    items = list(
        db.scalars(
            select(ConnectorItem).where(
                ConnectorItem.connection_id == connection_id,
                ConnectorItem.remote_path.is_not(None),
            )
        )
    )
    media_rows = list(
        db.execute(
            select(
                MediaFile.id,
                MediaFile.library_root_id,
                MediaFile.relative_path,
                MediaFile.filename,
                MediaFile.size_bytes,
                MediaFile.duration_seconds,
            )
        )
    )
    candidate_rules = _direct_rules(locations, roots) + _corpus_rules(
        items, locations_by_library, media_rows
    )
    selected = _select_unambiguous_rules(candidate_rules)
    candidate_source_keys = {
        (
            rule.location_id,
            normalize_connector_path(rule.source_prefix, case_mode="insensitive").key,
        )
        for rule in candidate_rules
        if rule.direct or rule.evidence_count >= MIN_CORPUS_EVIDENCE
    }

    existing = list(
        db.scalars(
            select(ConnectorRootBinding)
            .join(ConnectorLibraryLocation)
            .join(ConnectorLibrary)
            .where(ConnectorLibrary.connection_id == connection_id)
        )
    )
    existing_by_identity = {
        (
            binding.location_id,
            binding.library_root_id,
            binding_source_key(binding.source_prefix, binding.case_mode),
            binding.target_subpath,
            binding.case_mode,
        ): binding
        for binding in existing
    }
    matched_counts = dict(
        db.execute(
            select(ConnectorMediaMatch.binding_id, func.count())
            .where(ConnectorMediaMatch.binding_id.is_not(None))
            .group_by(ConnectorMediaMatch.binding_id)
        ).all()
    )
    retained_ids: set[int] = set()
    now = utc_now()
    created = 0
    verified = 0
    for rule in selected:
        binding = existing_by_identity.get(rule.identity)
        if binding is None:
            binding = ConnectorRootBinding(
                location_id=rule.location_id,
                library_root_id=rule.library_root_id,
                source_prefix=rule.source_prefix,
                normalized_source_prefix=binding_source_key(rule.source_prefix, rule.case_mode),
                target_subpath=rule.target_subpath,
                case_mode=rule.case_mode,
                priority=0,
                active=True,
            )
            db.add(binding)
            db.flush()
            created += 1
        binding.origin = "automatic"
        binding.confidence = 1.0
        binding.evidence_count = rule.evidence_count
        binding.verification_status = "verified"
        binding.last_verified_at = now
        binding.active = True
        retained_ids.add(binding.id)
        verified += 1

    location_ids = {location.id for location in locations}
    root_ids = {root.id for root in roots}
    stale = 0
    for binding in existing:
        if binding.id in retained_ids:
            continue
        still_exists = binding.location_id in location_ids and binding.library_root_id in root_ids
        contradicted = (
            binding.location_id,
            normalize_connector_path(binding.source_prefix, case_mode="insensitive").key,
        ) in candidate_source_keys
        was_trusted = binding.verification_status in {"verified", "stale"} or int(
            matched_counts.get(binding.id, 0)
        ) > 0
        if still_exists and was_trusted and not contradicted and binding.origin != "manual":
            binding.origin = "automatic"
            binding.verification_status = "stale"
            binding.active = True
            retained_ids.add(binding.id)
            stale += 1
        else:
            db.delete(binding)
    db.flush()
    required_links = _refresh_required_links(db, connection)
    if commit:
        db.commit()
    else:
        db.flush()
    return {
        "created": created,
        "verified": verified,
        "stale": stale,
        "required_links": required_links,
    }


def accessible_connector_paths(library: ConnectorLibrary, locations: list[ConnectorLibraryLocation]) -> list[str]:
    del library
    return [location.remote_path for location in locations if Path(location.remote_path).expanduser().exists()]


def project_automatic_mapping_to_legacy(
    db: Session,
    connection_id: int,
) -> dict[str, int]:
    """Keep the deprecated Jellyfin readers aligned with the standard connector."""
    connection = db.get(ConnectorConnection, connection_id)
    if connection is None or connection.provider != "jellyfin":
        return {"path_mappings": 0, "library_links": 0}
    if _mode(connection.path_mapping_mode) != "automatic":
        return {"path_mappings": 0, "library_links": 0}

    rows = list(
        db.execute(
            select(ConnectorRootBinding, LibraryRoot)
            .join(LibraryRoot, LibraryRoot.id == ConnectorRootBinding.library_root_id)
            .join(ConnectorLibraryLocation)
            .join(ConnectorLibrary)
            .where(
                ConnectorLibrary.connection_id == connection_id,
                ConnectorRootBinding.active.is_(True),
            )
            .order_by(
                ConnectorRootBinding.priority.desc(),
                ConnectorRootBinding.id,
            )
        )
    )
    seen: set[tuple[str, str]] = set()
    desired_pairs: list[tuple[str, str]] = []
    for binding, root in rows:
        target = str(
            PurePosixPath(root.path.replace("\\", "/"))
            / binding.target_subpath
        ).rstrip("/")
        pair = (binding.source_prefix, target)
        if pair in seen:
            continue
        seen.add(pair)
        desired_pairs.append(pair)

    existing_mappings = list(db.scalars(select(JellyfinPathMapping)))
    existing_pairs = {
        (mapping.jellyfin_path_prefix, mapping.medialyze_path_prefix)
        for mapping in existing_mappings
        if mapping.enabled
    }
    path_mappings_changed = (
        existing_pairs != seen
        or len(existing_mappings) != len(seen)
        or any(not mapping.enabled for mapping in existing_mappings)
    )
    if path_mappings_changed:
        db.execute(delete(JellyfinPathMapping))
        db.add_all(
            [
                JellyfinPathMapping(
                    jellyfin_path_prefix=source,
                    medialyze_path_prefix=target,
                    enabled=True,
                )
                for source, target in desired_pairs
            ]
        )

    links_by_remote: dict[str, list[int]] = defaultdict(list)
    for remote_id, library_id in db.execute(
        select(ConnectorLibrary.remote_id, ConnectorLibraryLink.library_id)
        .join(
            ConnectorLibraryLink,
            ConnectorLibraryLink.connector_library_id == ConnectorLibrary.id,
        )
        .where(ConnectorLibrary.connection_id == connection_id)
        .order_by(ConnectorLibraryLink.link_method, ConnectorLibraryLink.library_id)
    ):
        links_by_remote[remote_id].append(library_id)
    linked_count = 0
    for legacy in db.scalars(select(JellyfinLibrary)):
        remote_id = legacy.remote_item_id or f"legacy:{legacy.id}"
        library_ids = links_by_remote.get(remote_id, [])
        legacy.linked_library_id = library_ids[0] if library_ids else None
        legacy.link_method = "automatic" if library_ids else None
        if library_ids:
            legacy.mapped_status = "linked"
            linked_count += 1
    db.flush()
    return {
        "path_mappings": len(seen),
        "path_mappings_changed": int(path_mappings_changed),
        "library_links": linked_count,
    }


def get_connector_mapping_overview(
    db: Session,
    connection_id: int,
) -> ConnectorMappingOverviewRead:
    connection = db.get(ConnectorConnection, connection_id)
    if connection is None:
        raise LookupError("Connector connection not found")
    libraries = list(
        db.scalars(
            select(ConnectorLibrary)
            .where(ConnectorLibrary.connection_id == connection_id)
            .order_by(func.lower(ConnectorLibrary.name), ConnectorLibrary.id)
        )
    )
    library_ids = {library.id for library in libraries}
    locations = list(
        db.scalars(
            select(ConnectorLibraryLocation)
            .where(ConnectorLibraryLocation.connector_library_id.in_(library_ids))
            .order_by(ConnectorLibraryLocation.connector_library_id, ConnectorLibraryLocation.id)
        )
    ) if library_ids else []
    location_ids = {location.id for location in locations}
    bindings = list(
        db.scalars(
            select(ConnectorRootBinding)
            .where(ConnectorRootBinding.location_id.in_(location_ids))
            .order_by(ConnectorRootBinding.location_id, ConnectorRootBinding.id)
        )
    ) if location_ids else []
    links = list(
        db.scalars(
            select(ConnectorLibraryLink).where(
                ConnectorLibraryLink.connector_library_id.in_(library_ids)
            )
        )
    ) if library_ids else []

    locations_by_library: dict[int, list[ConnectorLibraryLocation]] = defaultdict(list)
    for location in locations:
        locations_by_library[location.connector_library_id].append(location)
    bindings_by_location: dict[int, list[ConnectorRootBinding]] = defaultdict(list)
    for binding in bindings:
        bindings_by_location[binding.location_id].append(binding)
    linked_by_library: dict[int, set[int]] = defaultdict(set)
    required_by_library: dict[int, set[int]] = defaultdict(set)
    for link in links:
        linked_by_library[link.connector_library_id].add(link.library_id)
        if link.link_method == "derived":
            required_by_library[link.connector_library_id].add(link.library_id)

    from backend.app.services.access_context import catalog_match_status
    visible_status = catalog_match_status(db, ConnectorItem)
    counts = {
        str(status): int(count)
        for status, count in db.execute(
            select(visible_status, func.count())
            .where(ConnectorItem.connection_id == connection_id)
            .group_by(visible_status)
        )
    }
    total = sum(counts.values())
    matched = counts.get("matched", 0)
    library_payloads: list[ConnectorMappingLibraryRead] = []
    for library in libraries:
        library_locations = locations_by_library.get(library.id, [])
        linked_ids = sorted(linked_by_library.get(library.id, set()))
        recommendation = None
        if not linked_ids and "access_scope" not in db.info:
            recommendation = ConnectorMappingRecommendationRead(
                suggested_name=library.name,
                suggested_type=_suggested_library_type(library.media_type),
                reason="no_safe_library_assignment",
                accessible_paths=accessible_connector_paths(library, library_locations),
            )
        library_payloads.append(
            ConnectorMappingLibraryRead(
                id=library.id,
                remote_id=library.remote_id,
                name=library.name,
                media_type=library.media_type,
                linked_library_ids=linked_ids,
                required_library_ids=sorted(required_by_library.get(library.id, set())),
                locations=[
                    ConnectorMappingLocationRead(
                        id=location.id,
                        remote_path=location.remote_path,
                        bindings=[
                            ConnectorBindingRead.model_validate(binding)
                            for binding in bindings_by_location.get(location.id, [])
                        ],
                    )
                    for location in library_locations
                ],
                recommendation=recommendation,
            )
        )
    return ConnectorMappingOverviewRead(
        connection_id=connection_id,
        path_mapping_mode=_mode(connection.path_mapping_mode),
        library_mapping_mode=_mode(connection.library_mapping_mode),
        coverage=ConnectorMappingCoverageRead(
            total_items=total,
            matched_items=matched,
            attention_items=max(0, total - matched),
            matched_percent=round((matched / total * 100) if total else 0.0, 1),
        ),
        libraries=library_payloads,
    )
