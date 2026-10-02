from __future__ import annotations

from collections import defaultdict

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.models.entities import (
    ConnectorConnection,
    ConnectorLibrary,
    ConnectorLibraryLink,
    ConnectorLibraryLocation,
    ConnectorRootBinding,
    ConnectorSyncStageItem,
    ConnectorSyncStageLibrary,
    ConnectorSyncStageLocation,
    Library,
    LibraryRoot,
    JellyfinConnection,
)
from backend.app.utils.time import utc_now
from backend.app.schemas.connectors import (
    ConnectorBindingBatchUpdate,
    ConnectorConnectionCreate,
    ConnectorConnectionRead,
    ConnectorConnectionUpdate,
    ConnectorLibraryLinkBatchUpdate,
    ConnectorLibraryRead,
    ConnectorLocationRead,
)
from backend.app.services.connector_credentials import (
    delete_connector_secret,
    read_connector_secret,
    write_connector_secret,
)
from backend.app.services.connector_pathing import (
    binding_source_key,
    normalize_connector_path,
    normalize_target_subpath,
)
from backend.app.services.connector_registry import connector_registry
from backend.app.services.connector_security import (
    contains_sensitive_connector_key,
    public_connector_payload,
)
from backend.app.services.stats_cache import stats_cache


def is_legacy_default_connection(connection: ConnectorConnection) -> bool:
    return bool(
        connection.provider == "jellyfin"
        and (connection.config or {}).get("legacy_default") is True
    )


def serialize_connector_connection(db: Session, connection: ConnectorConnection) -> ConnectorConnectionRead:
    payload = ConnectorConnectionRead.model_validate(connection)
    payload.config = public_connector_payload(payload.config)
    payload.has_secret = bool(read_connector_secret(db, connection.id))
    return payload


def mirror_legacy_jellyfin_connection(
    db: Session,
    legacy: JellyfinConnection,
    secret: str,
) -> ConnectorConnection:
    connection = db.scalar(
        select(ConnectorConnection).where(
            ConnectorConnection.provider == "jellyfin",
            ConnectorConnection.name == "Jellyfin",
        )
    )
    if connection is None:
        connection = ConnectorConnection(provider="jellyfin", name="Jellyfin")
        db.add(connection)
        db.flush()
    connection.base_url = legacy.base_url
    connection.enabled = legacy.enabled
    connection.sync_interval_minutes = legacy.sync_interval_minutes
    connection.server_name = legacy.server_name
    connection.server_version = legacy.server_version
    connection.last_status = legacy.last_status
    connection.last_error = legacy.last_error
    connection.last_sync_started_at = legacy.last_sync_started_at
    connection.last_sync_finished_at = legacy.last_sync_finished_at
    connection.last_successful_sync_at = legacy.last_successful_sync_at
    connection.capabilities = {
        "users": True,
        "user_states": True,
        "playback_events": True,
        "images": True,
    }
    connection.config = {**(connection.config or {}), "legacy_default": True}
    if secret:
        write_connector_secret(db, connection.id, secret)
    db.commit()
    return connection


def create_connector_connection(
    db: Session,
    payload: ConnectorConnectionCreate,
) -> ConnectorConnection:
    provider = payload.provider.strip().casefold()
    if provider not in connector_registry.providers():
        raise ValueError(f"Unsupported connector provider: {payload.provider}")
    if (payload.config or {}).get("legacy_default") is not None:
        raise ValueError("legacy_default is a reserved connector setting")
    if contains_sensitive_connector_key(payload.config):
        raise ValueError("Secrets must be supplied through the dedicated secret field")
    if provider == "jellyfin" and payload.name.strip() == "Jellyfin":
        raise ValueError("The name Jellyfin is reserved for the migrated standard connection")
    connection = ConnectorConnection(
        provider=provider,
        name=payload.name.strip(),
        base_url=payload.base_url.strip(),
        config=payload.config,
        capabilities={
            capability: True
            for capability in (
                connector_registry.descriptor(provider).optional_capabilities
                if connector_registry.descriptor(provider) is not None
                else ()
            )
        },
        enabled=payload.enabled,
        path_mapping_mode=payload.path_mapping_mode,
        library_mapping_mode=payload.library_mapping_mode,
        sync_interval_minutes=payload.sync_interval_minutes,
    )
    db.add(connection)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("A connector with this provider and name already exists") from exc
    if payload.secret:
        write_connector_secret(db, connection.id, payload.secret)
    db.commit()
    db.refresh(connection)
    return connection


def update_connector_connection(
    db: Session,
    connection: ConnectorConnection,
    payload: ConnectorConnectionUpdate,
) -> ConnectorConnection:
    if payload.config is not None and payload.config.get("legacy_default") is not None:
        raise ValueError("legacy_default is a reserved connector setting")
    if payload.config is not None and contains_sensitive_connector_key(payload.config):
        raise ValueError("Secrets must be supplied through the dedicated secret field")
    if (
        payload.name is not None
        and connection.provider == "jellyfin"
        and payload.name.strip() == "Jellyfin"
    ):
        raise ValueError("The name Jellyfin is reserved for the migrated standard connection")
    previous_path_mode = str(getattr(connection.path_mapping_mode, "value", connection.path_mapping_mode))
    for field in (
        "name",
        "base_url",
        "config",
        "enabled",
        "sync_interval_minutes",
        "path_mapping_mode",
        "library_mapping_mode",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(connection, field, value.strip() if isinstance(value, str) else value)
    next_path_mode = str(getattr(connection.path_mapping_mode, "value", connection.path_mapping_mode))
    if previous_path_mode != "manual" and next_path_mode == "manual":
        for binding in db.scalars(
            select(ConnectorRootBinding)
            .join(ConnectorLibraryLocation)
            .join(ConnectorLibrary)
            .where(ConnectorLibrary.connection_id == connection.id)
        ):
            binding.origin = "manual"
            binding.verification_status = "verified"
    if payload.secret is not None:
        write_connector_secret(db, connection.id, payload.secret)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("A connector with this provider and name already exists") from exc
    db.refresh(connection)
    return connection


def update_legacy_default_connection(
    db: Session,
    connection: ConnectorConnection,
    legacy: JellyfinConnection,
    payload: ConnectorConnectionUpdate,
    *,
    external_secret_available: bool = False,
) -> ConnectorConnection:
    if not is_legacy_default_connection(connection):
        raise ValueError("Connector connection is not the migrated Jellyfin connection")
    if payload.name is not None and payload.name.strip() != "Jellyfin":
        raise ValueError("The migrated Jellyfin connection cannot be renamed")
    if payload.base_url is not None:
        connection.base_url = payload.base_url.strip()
        legacy.base_url = connection.base_url
    if payload.enabled is not None:
        connection.enabled = payload.enabled
        legacy.enabled = payload.enabled
    if payload.sync_interval_minutes is not None:
        connection.sync_interval_minutes = payload.sync_interval_minutes
        legacy.sync_interval_minutes = payload.sync_interval_minutes
    previous_path_mode = str(
        getattr(connection.path_mapping_mode, "value", connection.path_mapping_mode)
    )
    if payload.path_mapping_mode is not None:
        connection.path_mapping_mode = payload.path_mapping_mode
    if payload.library_mapping_mode is not None:
        connection.library_mapping_mode = payload.library_mapping_mode
    if payload.config is not None:
        if contains_sensitive_connector_key(payload.config):
            raise ValueError("Secrets must be supplied through the dedicated secret field")
        connection.config = {**payload.config, "legacy_default": True}
    else:
        connection.config = {**(connection.config or {}), "legacy_default": True}
    next_path_mode = str(
        getattr(connection.path_mapping_mode, "value", connection.path_mapping_mode)
    )
    if previous_path_mode != "manual" and next_path_mode == "manual":
        for binding in db.scalars(
            select(ConnectorRootBinding)
            .join(ConnectorLibraryLocation)
            .join(ConnectorLibrary)
            .where(ConnectorLibrary.connection_id == connection.id)
        ):
            binding.origin = "manual"
            binding.verification_status = "verified"
    if payload.secret is not None:
        normalized = payload.secret.strip()
        legacy.api_key = normalized
        if normalized:
            write_connector_secret(db, connection.id, normalized)
        else:
            delete_connector_secret(db, connection.id)
    effective_secret = bool(
        read_connector_secret(db, connection.id)
        or legacy.api_key.strip()
        or external_secret_available
    )
    if connection.enabled and (not connection.base_url or not effective_secret):
        db.rollback()
        raise ValueError("Jellyfin URL and API key are required before enabling sync")
    db.commit()
    db.refresh(connection)
    return connection


def delete_connector_connection(
    db: Session,
    connection: ConnectorConnection,
    *,
    commit: bool = True,
) -> None:
    connection_id = connection.id
    for stage_model in (
        ConnectorSyncStageItem,
        ConnectorSyncStageLocation,
        ConnectorSyncStageLibrary,
    ):
        db.execute(delete(stage_model).where(stage_model.connection_id == connection_id))
    db.delete(connection)
    db.flush()
    refresh_preferred_connections(db)
    if commit:
        db.commit()
        stats_cache.invalidate_connectors(str(id(db.get_bind())))


def list_connector_libraries(db: Session, connection_id: int) -> list[ConnectorLibraryRead]:
    libraries = list(
        db.scalars(
            select(ConnectorLibrary)
            .where(ConnectorLibrary.connection_id == connection_id)
            .order_by(func.lower(ConnectorLibrary.name), ConnectorLibrary.id)
        )
    )
    location_rows = db.scalars(
        select(ConnectorLibraryLocation).where(
            ConnectorLibraryLocation.connector_library_id.in_([library.id for library in libraries])
        )
    ).all() if libraries else []
    links = db.execute(
        select(ConnectorLibraryLink.connector_library_id, ConnectorLibraryLink.library_id).where(
            ConnectorLibraryLink.connector_library_id.in_([library.id for library in libraries])
        )
    ).all() if libraries else []
    locations_by_library: dict[int, list[ConnectorLocationRead]] = defaultdict(list)
    for location in location_rows:
        locations_by_library[location.connector_library_id].append(
            ConnectorLocationRead.model_validate(location)
        )
    links_by_library: dict[int, list[int]] = defaultdict(list)
    for connector_library_id, library_id in links:
        links_by_library[connector_library_id].append(library_id)
    return [
        ConnectorLibraryRead(
            **ConnectorLibraryRead.model_validate(library).model_dump(
                exclude={"locations", "linked_library_ids", "provider_payload"}
            ),
            provider_payload=public_connector_payload(library.provider_payload or {}),
            locations=locations_by_library[library.id],
            linked_library_ids=sorted(links_by_library[library.id]),
        )
        for library in libraries
    ]


def replace_connector_bindings(
    db: Session,
    connection_id: int,
    payload: ConnectorBindingBatchUpdate,
) -> list[ConnectorRootBinding]:
    connection = db.get(ConnectorConnection, connection_id)
    if connection is None:
        raise LookupError("Connector connection not found")
    if str(getattr(connection.path_mapping_mode, "value", connection.path_mapping_mode)) != "manual":
        raise PermissionError("Path mappings can only be edited in manual mode")
    location_ids = {binding.location_id for binding in payload.bindings}
    locations = {
        location.id: location
        for location in db.scalars(
            select(ConnectorLibraryLocation)
            .join(ConnectorLibrary)
            .where(
                ConnectorLibrary.connection_id == connection_id,
                ConnectorLibraryLocation.id.in_(location_ids),
            )
        )
    } if location_ids else {}
    if set(locations) != location_ids:
        raise ValueError("Every binding location must belong to the connector connection")
    root_ids = {binding.library_root_id for binding in payload.bindings}
    roots = {
        root.id: root
        for root in db.scalars(select(LibraryRoot).where(LibraryRoot.id.in_(root_ids)))
    } if root_ids else {}
    if set(roots) != root_ids:
        raise ValueError("Every binding must reference an existing MediaLyze root")

    normalized_rows: list[dict] = []
    tie_keys: set[tuple[int, str, int]] = set()
    for binding in payload.bindings:
        source = normalize_connector_path(binding.source_prefix, case_mode=binding.case_mode)
        location = normalize_connector_path(
            locations[binding.location_id].remote_path,
            case_mode=binding.case_mode,
        )
        if source.key != location.key and not source.key.startswith(f"{location.key}/"):
            raise ValueError("Binding source prefixes must be inside their external library location")
        target_subpath = normalize_target_subpath(binding.target_subpath)
        tie_key = (
            locations[binding.location_id].connector_library_id,
            source.key,
            binding.priority,
        )
        if binding.active and tie_key in tie_keys:
            raise ValueError("Equivalent active binding rules are not allowed")
        tie_keys.add(tie_key)
        normalized_rows.append(
            {
                "id": binding.id,
                "location_id": binding.location_id,
                "library_root_id": binding.library_root_id,
                "source_prefix": source.display,
                "normalized_source_prefix": binding_source_key(
                    binding.source_prefix, binding.case_mode
                ),
                "target_subpath": target_subpath,
                "case_mode": binding.case_mode,
                "priority": binding.priority,
                "active": binding.active,
                "origin": "manual",
                "confidence": 1.0,
                "evidence_count": 0,
                "verification_status": "verified",
                "last_verified_at": utc_now(),
            }
        )

    existing_ids = set(
        db.scalars(
            select(ConnectorRootBinding.id)
            .join(ConnectorLibraryLocation)
            .join(ConnectorLibrary)
            .where(ConnectorLibrary.connection_id == connection_id)
        )
    )
    supplied_ids = {row["id"] for row in normalized_rows if row["id"] is not None}
    if not supplied_ids.issubset(existing_ids):
        raise ValueError("A binding id does not belong to this connector connection")
    db.execute(delete(ConnectorRootBinding).where(ConnectorRootBinding.id.in_(existing_ids - supplied_ids)))
    result: list[ConnectorRootBinding] = []
    for row in normalized_rows:
        binding_id = row.pop("id")
        model = db.get(ConnectorRootBinding, binding_id) if binding_id else None
        if model is None:
            model = ConnectorRootBinding(**row)
            db.add(model)
        else:
            for key, value in row.items():
                setattr(model, key, value)
        result.append(model)
    db.flush()

    # Root bindings imply logical links, but do not remove manual/imported links.
    derived_pairs = {
        (locations[row["location_id"]].connector_library_id, roots[row["library_root_id"]].library_id)
        for row in normalized_rows
        if row["active"]
    }
    db.execute(
        delete(ConnectorLibraryLink).where(
            ConnectorLibraryLink.link_method == "derived",
            ConnectorLibraryLink.connector_library_id.in_(
                select(ConnectorLibrary.id).where(ConnectorLibrary.connection_id == connection_id)
            ),
        )
    )
    existing_link_pairs = set(
        db.execute(
            select(
                ConnectorLibraryLink.connector_library_id,
                ConnectorLibraryLink.library_id,
            ).where(
                ConnectorLibraryLink.connector_library_id.in_(
                    {
                        connector_library_id
                        for connector_library_id, _library_id in derived_pairs
                    }
                )
            )
        )
    ) if derived_pairs else set()
    for connector_library_id, library_id in derived_pairs:
        if (connector_library_id, library_id) not in existing_link_pairs:
            db.add(
                ConnectorLibraryLink(
                    connector_library_id=connector_library_id,
                    library_id=library_id,
                    link_method="derived",
                )
            )
    db.commit()
    refresh_preferred_connections(db)
    db.commit()
    return result


def replace_connector_library_links(
    db: Session,
    connection_id: int,
    payload: ConnectorLibraryLinkBatchUpdate,
) -> list[ConnectorLibraryRead]:
    connection = db.get(ConnectorConnection, connection_id)
    if connection is None:
        raise LookupError("Connector connection not found")
    if str(getattr(connection.library_mapping_mode, "value", connection.library_mapping_mode)) != "manual":
        raise PermissionError("Library assignments can only be edited in manual mode")
    connector_library_ids = {entry.connector_library_id for entry in payload.links}
    owned_ids = set(
        db.scalars(
            select(ConnectorLibrary.id).where(
                ConnectorLibrary.connection_id == connection_id,
                ConnectorLibrary.id.in_(connector_library_ids),
            )
        )
    ) if connector_library_ids else set()
    if owned_ids != connector_library_ids:
        raise ValueError("Every connector library must belong to the connection")
    desired_pairs = {
        (entry.connector_library_id, library_id)
        for entry in payload.links
        for library_id in entry.library_ids
    }
    library_ids = {library_id for _connector_library_id, library_id in desired_pairs}
    existing_library_ids = set(
        db.scalars(select(Library.id).where(Library.id.in_(library_ids)))
    ) if library_ids else set()
    if existing_library_ids != library_ids:
        raise ValueError("Every link must reference an existing MediaLyze library")

    current_links = list(
        db.scalars(
            select(ConnectorLibraryLink)
            .join(ConnectorLibrary)
            .where(ConnectorLibrary.connection_id == connection_id)
        )
    )
    current_by_pair = {
        (link.connector_library_id, link.library_id): link
        for link in current_links
    }
    derived_pairs = set(
        db.execute(
            select(
                ConnectorLibraryLocation.connector_library_id,
                LibraryRoot.library_id,
            )
            .join(
                ConnectorRootBinding,
                ConnectorRootBinding.location_id == ConnectorLibraryLocation.id,
            )
            .join(
                ConnectorLibrary,
                ConnectorLibrary.id == ConnectorLibraryLocation.connector_library_id,
            )
            .join(
                LibraryRoot,
                LibraryRoot.id == ConnectorRootBinding.library_root_id,
            )
            .where(
                ConnectorLibrary.connection_id == connection_id,
                ConnectorRootBinding.active.is_(True),
            )
        )
    )
    for pair, link in current_by_pair.items():
        if link.link_method == "manual" and pair not in desired_pairs:
            if pair in derived_pairs:
                link.link_method = "derived"
            else:
                db.delete(link)
    for pair in desired_pairs:
        link = current_by_pair.get(pair)
        if link is None:
            db.add(
                ConnectorLibraryLink(
                    connector_library_id=pair[0],
                    library_id=pair[1],
                    link_method="derived" if pair in derived_pairs else "manual",
                )
            )
        else:
            link.link_method = "derived" if pair in derived_pairs else "manual"
    for pair in derived_pairs - set(current_by_pair) - desired_pairs:
        db.add(
            ConnectorLibraryLink(
                connector_library_id=pair[0],
                library_id=pair[1],
                link_method="derived",
            )
        )
    db.commit()
    refresh_preferred_connections(db)
    db.commit()
    stats_cache.invalidate_connectors(str(id(db.get_bind())))
    return list_connector_libraries(db, connection_id)


def refresh_preferred_connections(db: Session) -> None:
    libraries = list(db.scalars(select(Library)))
    for library in libraries:
        connection_ids = set(
            db.scalars(
                select(ConnectorLibrary.connection_id)
                .join(
                    ConnectorLibraryLink,
                    ConnectorLibraryLink.connector_library_id == ConnectorLibrary.id,
                )
                .where(ConnectorLibraryLink.library_id == library.id)
            )
        )
        if len(connection_ids) == 1:
            library.preferred_connector_connection_id = next(iter(connection_ids))
        elif library.preferred_connector_connection_id not in connection_ids:
            library.preferred_connector_connection_id = None
