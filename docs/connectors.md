# Connector architecture

MediaLyze imports external media-server catalogs through a provider-neutral connector layer. Jellyfin is the first adapter. Plex and other providers must integrate through the same adapter contract; provider code must not read, rewrite, or derive `MediaFile` paths directly.

Connector Settings uses a shared accordion for every connection. Multiple Jellyfin servers have the same lifecycle and capability-gated user controls; Plex is visible only as a disabled `Soon™` option. Library assignments and path mappings live in two independently collapsible automatic/manual sections. Read-only catalog diagnostics remain staged on the [Connector UI roadmap](connector-ui-deferred.md).

The physical identity of a local file is always:

```text
LibraryRoot.id + MediaFile.relative_path
```

Names shown in the UI are derived from the editable `LibraryRoot.display_name` and the relative path. They are never persisted as file identity.

## Entity model

```mermaid
erDiagram
    Library ||--o{ LibraryRoot : contains
    Library ||--o{ ConnectorLibraryLink : links
    ConnectorConnection ||--|| ConnectorCredential : owns
    ConnectorConnection ||--o{ ConnectorLibrary : imports
    ConnectorConnection ||--o{ ConnectorItem : imports
    ConnectorConnection ||--o{ ConnectorUser : imports
    ConnectorConnection ||--o{ ConnectorPlaybackEvent : imports
    ConnectorConnection ||--o{ ConnectorSyncJob : runs
    ConnectorLibrary ||--o{ ConnectorLibraryLocation : exposes
    ConnectorLibrary ||--o{ ConnectorLibraryLink : links
    ConnectorLibraryLocation ||--o{ ConnectorRootBinding : maps
    LibraryRoot ||--o{ ConnectorRootBinding : targets
    ConnectorItem ||--o| ConnectorMediaMatch : resolves
    ConnectorItem ||--o{ ConnectorUserItemData : records
    ConnectorUser ||--o{ ConnectorUserItemData : owns
    ConnectorUser ||--o{ ConnectorPlaybackEvent : generates
    MediaFile ||--o{ ConnectorMediaMatch : receives
    LibraryRoot ||--o{ MediaFile : identifies
```

All catalog, user, user-state, and playback staging tables are isolated by both `connection_id` and `sync_run_id`. They are not public data tables.

## Invariants

- A provider is an extensible lowercase string, not a database enum.
- `(provider, name)` uniquely identifies a connection. Multiple connections of one provider are allowed.
- `(connection_id, remote_id)` uniquely identifies a remote library, item, or user. Playback event IDs are likewise unique only within a connection.
- A connector item has zero or one match. A local file may receive any number of matches, including several items from one server and items from different providers.
- Library links are optional and many-to-many. They provide logical context; they never decide physical paths.
- Root bindings are the only authoritative remote-location-to-local-root mapping.
- One connection has at most one active sync job. Different connections may synchronize concurrently.
- Individual files are never manually matched or ignored. Exact-path matching is recalculated solely from active root bindings.
- Every connection has independent `path_mapping_mode` and `library_mapping_mode` values. Both default to `automatic` for new and upgraded connections.
- Every active root binding implies a mandatory library link to the target root's library. Additional links are allowed only in manual library mode.
- The migrated standard Jellyfin connection is identified by the reserved `config.legacy_default` marker. Generic and legacy configuration endpoints update the same persisted connection state.
- Provider payloads are diagnostic input owned by the adapter. Core services operate on normalized DTO fields and must not depend on Jellyfin or Plex field names.
- Deleting a connection deletes only its connector catalog, users, user states, playback events, credentials, bindings, links, matches, staging data, and jobs. It never deletes MediaLyze libraries, roots, files, or analysis data.

## Data ownership and dependency boundaries

| Data | Owner | May be consumed by |
| --- | --- | --- |
| URL, schedule, enabled state, capabilities, sync status | Connector core | Runtime, API, UI |
| Secret payload | Credential store | Selected adapter during a call only |
| Remote identifiers and provider payload | Provider adapter/catalog | Connector diagnostics and provider extensions |
| Normalized title, kind, size, duration, paths | Connector core DTO/catalog | Matcher, API, overlays |
| Root aliases and local relative paths | MediaLyze library/scanner core | Matcher as read-only identity |
| Binding rules | Connector core | Path resolver and mapping UI |
| Normalized users, user state, and playback | Connector core via capable adapter | Connector UI/API and file timeline |
| Provider image behavior | Jellyfin compatibility extension | Preferred/standard Jellyfin overlays |

Allowed dependency direction is `runtime/API -> connector core -> adapter contract -> provider adapter`. Provider adapters may depend on their own clients, but connector core modules must not import provider response types. Provider code must never mutate `LibraryRoot`, `MediaFile.library_root_id`, or `MediaFile.relative_path`.

## Adapter contract and capabilities

Adapters are registered in `backend/app/services/connector_registry.py` and implement the protocol in `connector_contract.py`:

- `test_connection`: authenticate and return normalized server information.
- `get_server_info`: return the provider/server identity used for diagnostics.
- `iter_libraries`: yield normalized libraries with zero or more normalized locations.
- `iter_items`: yield validated, normalized catalog items page by page.
- `iter_users`: yield normalized provider users when advertised.
- `iter_user_item_data`: yield normalized state for one enabled user when advertised.
- `iter_playback_events`: yield normalized playback events for enabled users when advertised.

Core DTOs include `ConnectorServerInfo`, `RemoteLibrary`, `RemoteLocation`, `RemoteItem`, `RemoteUser`, `RemoteUserItemData`, and `RemotePlaybackEvent`. Provider descriptors declare configuration fields separately from runtime capabilities. Optional features are advertised as capabilities. The initial optional capability vocabulary includes users, user states, playback events, and images. A UI or service must check a capability before offering a provider-specific action; unsupported provider-neutral endpoints return a clear capability error. Every Jellyfin connection advertises users, user states, and playback events. Authenticated images remain on the preferred/standard compatibility behavior for now.

To keep the boundary real, normalize provider-specific media types, identifiers, dates, sizes, duration, and paths inside the adapter. Retain the raw provider payload only for diagnostics and provider extensions.

## Credentials

Jellyfin requests send the API key using `Authorization: MediaBrowser Token="..."`. This works with Jellyfin 12's legacy authentication disabled; existing server URLs and API keys do not need to change.

Each connection may own exactly one opaque secret payload in `connector_credentials`. API serializers expose only `has_secret`; they never return the payload. Secret-like configuration keys are rejected in favor of the dedicated credential field. Adapter payloads are scrubbed before persistence, normal catalog/file responses omit raw item payloads, and the explicit provider-payload diagnostic route recursively removes secret-like fields. Exceptions are sanitized before persistence, API responses, or logging.

Secrets currently remain local to MediaLyze's SQLite database and therefore inherit the protection of `CONFIG_PATH`. Restrict that directory to the service account. `JELLYFIN_API_KEY_FILE` remains a compatibility-only override for the migrated standard Jellyfin connection named `Jellyfin`; it does not supply credentials to additional connections.

## Location-to-root resolution

A binding belongs to one connection and one imported library location. It maps a remote `source_prefix` to a `LibraryRoot`, optionally below a safe `target_subpath`.

Resolution is deterministic:

1. Normalize separators while retaining the original remote path for display and diagnostics. POSIX roots, drive-letter paths, and UNC paths are supported.
2. Restrict candidates to the item's connection, connector library, and location.
3. Apply the binding's `sensitive` or `insensitive` comparison mode.
4. Select the longest matching source prefix. Priority breaks matches of different preference; an equivalent top-ranked tie is rejected as `ambiguous_binding`.
5. Append the unmatched suffix below `target_subpath` and reject absolute suffixes, `..`, and root escapes.
6. Return the structured locator `(library_root_id, relative_path, binding_id)`.
7. Match only the exact `(library_root_id, relative_path)` local identity.

Migrated Jellyfin rules start as `imported` and are validated by the first automatic pass. Automatic inference first accepts direct normalized location/root topology. For different mount prefixes it builds an in-memory filename index, requires exact size or at most three seconds of duration deviation, and derives transformations only from unique candidate pairs. At least three distinct assets must support the same location/source-prefix/root/target-subpath transformation; equally supported competing targets are rejected. Candidate file IDs are never persisted. Verified rules remain active as `stale` during temporary evidence loss and are removed only when their location/root disappears or conflicting evidence takes over.

Automatic mapping is run after catalog promotion and before exact-path matching. Successful MediaLyze scans and root changes enqueue the same connection-scoped recompute job on the connector executor. In manual mode the current binding snapshot can be edited as an atomic batch. Switching back to automatic retains the active snapshot until the persisted recompute succeeds, then gives the inference engine full control.

Root availability is evaluated once per binding during one matching run, not once per item. Bindings are loaded and normalized once per run. The matcher resolves items in one pass, persists each last resolved locator, loads a compact media-file projection in bulk, and uses in-memory sensitive/insensitive indexes instead of issuing database queries per item.

## Match states

| State | Meaning / next action |
| --- | --- |
| `matched` | One exact local identity was found. |
| `unmapped` | No active binding covers the remote path; add or adjust a binding. |
| `root_unavailable` | The mapped root is not reachable from the MediaLyze runtime; check mounts and permissions. |
| `ambiguous_binding` | Equally valid binding rules remain; remove the tie. |
| `ambiguous_file` | More than one local candidate remains; refine roots or path mappings. |
| `no_local_file` | The binding resolved, but no scanned local file exists at that identity. |
| `unsupported_item_type` | The adapter supplied a catalog type the matcher intentionally ignores. |

Filename, size, and duration are used transiently to infer a path transformation, never to persist a file suggestion or create a fuzzy file match. Scan changes compare the complete pre/post root locator set, so additions, modifications, deletions, and renames enqueue a persisted connection recompute without blocking the scan worker.

## Synchronization and staging lifecycle

```mermaid
flowchart LR
    A["Request sync"] --> B["Single-flight job per connection"]
    B --> C["Adapter validates and normalizes pages"]
    C --> D["Write run-scoped staging rows"]
    D --> E{"All pages successful?"}
    E -- No --> F["Discard this run; retain live snapshot"]
    E -- Yes --> G["Atomic connection-scoped promote"]
    G --> H["Infer bindings and required links"]
    H --> I["Exact-path match and invalidate caches"]
```

Jobs persist type, run ID, phase, progress, cancellation state, heartbeat, and summary. A queued job is atomically claimed with a conditional update, so a canceled queued job cannot start later. Startup marks orphaned active jobs as canceled and removes all abandoned generic staging rows before workers start. Cancellation or failure removes only that run's staging rows. Remote deletions become visible only after a complete successful promote. Connector work, including the standard Jellyfin sync, runs on a dedicated executor; it does not consume scan or single-threaded maintenance capacity. Different connections may use that executor concurrently while one connection remains single-flight.

The default Jellyfin connection remains special during the compatibility release: the established Jellyfin sync continues to collect users, playback state, events, and images, mirrors its catalog and playback data into the generic tables, then runs the generic matcher and records Shadow Mode counters. Its generic CRUD/sync/cancel/status facade and the legacy endpoints operate on one marked standard connection; deleting it clears both sides atomically and a blank legacy singleton does not recreate it on restart. Other connections use the generic adapter and connection-scoped staging runtime directly for catalog, users, state, and playback.

## Jellyfin migration and Shadow Mode

Database initialization idempotently creates `connector_connection(provider="jellyfin", name="Jellyfin")` from the legacy singleton and backfills libraries, locations, logical links, items, users, user state, playback events, credentials, and unambiguous path mappings. Existing mappings become imported rules. Manual generic and Jellyfin match rows are removed, ignored/error states are reset, and stored file suggestions are cleared. The migration status is stored in versioned app-setting payloads.

Global legacy mappings are converted only when their target uniquely identifies a root and optional subpath. Ambiguous mappings are not guessed. Existing Jellyfin tables remain in place for the first connector release.

Each default Jellyfin sync records `same_match`, `old_only`, `new_only`, `different_media_file`, `ambiguous`, and `unmapped` comparison counters in its summary. The generic tables are the source for connector APIs and external-source lists. Legacy `/api/jellyfin/*` responses retain their shape and the established tables remain synchronized for playback compatibility. Removal of that facade is backlog for a later release.

`history_added_date_source=jellyfin` is migrated to `connector`. A library uses `preferred_connector_connection_id` for scalar metadata, the file-detail compatibility overlay, external-source emphasis, and connector-added history. It is assigned automatically when exactly one connection is linked; with several linked connections the user must choose explicitly. If several items from the preferred connection match one file, the lowest stable item ID breaks the display tie; added-date reconstruction uses the earliest available date. When no preferred matched connector date exists, history falls back to the MediaLyze date.

## API overview

- `GET/POST /api/connectors` and `GET/PATCH/DELETE /api/connectors/{connection_id}`
- `GET /api/connectors/providers`
- `GET /api/connectors/provider-descriptors`
- `POST /api/connectors/{connection_id}/test`
- `POST /api/connectors/{connection_id}/sync`, `POST .../sync/cancel`, and `GET .../sync/status`
- `GET /api/connectors/{connection_id}/libraries`
- `GET /api/connectors/{connection_id}/mapping-overview`
- `POST /api/connectors/{connection_id}/libraries/{connector_library_id}/create-medialyze-library`
- `GET/PUT /api/connectors/{connection_id}/users`; the PUT replaces that connection's enabled user IDs
- `PUT /api/connectors/{connection_id}/library-links`
- `GET /api/connectors/{connection_id}/locations`
- `GET/PUT /api/connectors/{connection_id}/bindings`; the PUT is a fully validated atomic replacement
- `GET /api/connectors/{connection_id}/items`
- `GET /api/connectors/{connection_id}/item-status-summary`
- `GET /api/connectors/{connection_id}/items/{item_id}/provider-payload` for explicit sanitized diagnostics
- `GET /api/files/{file_id}/connectors`
- `GET /api/files/{file_id}/connector-playback`, grouped by connection and matched connector item

Library summaries expose `connector_links[]` and `preferred_connector_connection_id`. Root payloads expose stable root IDs and editable aliases. Existing `path` and `paths` request forms continue to work; new clients should use structured `roots` entries.

## Cache invalidation

Catalog promotion, inferred or manual binding replacement, connection deletion, and scan-driven recomputation invalidate connector-dependent library and file statistics. When adding a new connector-derived aggregate, register it with the same targeted invalidation boundary; do not clear unrelated cached views by default.

## Troubleshooting

- **`unmapped`:** verify the remote location and source prefix, then bind it to the root that contains the same file hierarchy.
- **`root_unavailable`:** verify the container/desktop mount from the MediaLyze process, not from the browser machine.
- **`ambiguous_binding`:** compare normalized prefixes, case mode, and priority; submit one unambiguous batch.
- **`no_local_file`:** scan the MediaLyze library and confirm `target_subpath` does not duplicate or omit a directory segment.
- **Test works but sync fails:** inspect the persisted job phase/summary; a malformed provider page is rejected without replacing the prior live catalog.
- **A connection has no users or playback:** verify its advertised capabilities and complete a successful sync; unsupported capability endpoints return an explicit conflict response.
- **File-backed Jellyfin key:** `JELLYFIN_API_KEY_FILE` is intentionally limited to the standard legacy-backed connection.

## Adding a provider checklist

1. Add a provider adapter implementing the existing DTO protocol; do not add provider fields to matcher or sync core.
2. Register its lowercase provider key and `ConnectorProviderDescriptor` in `connector_registry.py`.
3. Normalize server info, libraries, locations, items, paths, media kinds, dates, size, and duration in the adapter.
4. Declare only capabilities the adapter actually implements.
5. Define provider-specific secret input fields while returning only `has_secret` through APIs.
6. Declare provider configuration fields in the descriptor. Integrate the provider into the shared add dialog and gate every optional accordion section by actual capabilities.
7. Add contract tests for paging, malformed responses, secret redaction, multiple connections, and deletion isolation.
8. Run the resolver matrix for POSIX, Windows drive, UNC, case modes, longest-prefix selection, ties, target subpaths, and escapes.
9. Run sync tests for single-flight, concurrent different connections, cancellation, recovery, atomic promote, and remote deletion.
10. Add UI catalog examples and update every shipped locale.
11. Document provider-specific permissions and limitations without weakening these core invariants.

## Required test matrix

Every connector change should cover a new database and an upgraded Jellyfin database; single- and multi-root libraries; multiple locations and connections; conservative inference thresholds and conflicting candidates; automatic/manual mode changes; atomic binding/link batches; sync cancellation/recovery; connection deletion isolation; secret redaction; preferred metadata; legacy Jellyfin read compatibility; and focused frontend tests. Large catalog changes must also run `benchmark_jellyfin_bulk_promote.py`, `benchmark_connector_bulk_promote.py`, and `benchmark_connector_matching.py` with 100,000 items and compare three representative runs.
