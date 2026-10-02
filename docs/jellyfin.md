# Jellyfin integration

[Documentation home](README.md)

Jellyfin is the first adapter for MediaLyze's [provider-neutral connector architecture](connectors.md). MediaLyze reads Jellyfin catalogs and never changes Jellyfin items. Multiple Jellyfin connections are supported for catalog import, matching, users, and playback history.

## Connection and permissions

Create a dedicated Jellyfin API key and make the server reachable from the MediaLyze runtime. The key must read system information, virtual folders, items, users, per-user item data, and playback activity. The migrated standard connection also reads item images through the compatibility path.

Secrets entered in Settings are stored locally in MediaLyze's SQLite database but never returned by the API or written to logs. Protect `CONFIG_PATH` so only the MediaLyze service account can read it. `JELLYFIN_API_KEY_FILE` remains available for the migrated standard connection named `Jellyfin`; a file-backed key takes precedence there and does not apply to additional Jellyfin connections.

Connection configuration is separate from activation. Each connection has its own name, URL, schedule, enabled state, capabilities, status, catalog, users, playback data, mappings, and sync job. Connector Settings shows all connections as shared accordions and can create any number of uniquely named Jellyfin connections. The generic and legacy settings APIs mirror the marked standard connection, so they are not two independent configurations. That migrated connection remains named `Jellyfin`; other connections can be renamed. Removing the standard connection clears both compatibility and connector state atomically; an empty legacy singleton does not recreate it on restart. It cannot remove a secret maintained in an external file and never deletes MediaLyze libraries or files.

## Libraries, locations, and path mappings

An imported Jellyfin library may expose multiple filesystem locations. Logical links between Jellyfin and MediaLyze libraries are many-to-many. Physical matching is controlled exclusively by the connector backend's location-to-root bindings; both mappings and assignments are managed centrally in the connection accordion.

Path and library assignment modes are independently automatic or manual and default to automatic. The automatic pass accepts direct path topology or infers a mount transformation only when at least three unique assets agree by filename plus size or near duration and no equally strong target competes. Verified rules may remain active as stale during temporary evidence loss. Manual mode exposes source prefix, target subpath, case mode, and priority behind expandable technical details. The longest valid prefix wins and equal best rules are rejected instead of guessed.

Jellyfin and MediaLyze may see the same hierarchy through different mount points, for example `/media/movies` and `/mnt/nas/films`. The binding removes the Jellyfin source prefix, applies the safe target subpath, and matches the remainder only against `LibraryRoot.id + MediaFile.relative_path`.

## Preferred connection and history

A MediaLyze library can link several external libraries and chooses `preferred_connector_connection_id` for scalar metadata, connector-added dates, and the compatibility Jellyfin fields. MediaLyze selects it automatically when exactly one connection is linked. With several linked connections, select it explicitly in the expanded library settings.

The old `jellyfin` added-date source migrates to `connector`. If the preferred connection has no matched creation date, history falls back to the MediaLyze date.

## Users, playback, and images

Users, per-user state, and playback events are provider-neutral optional capabilities implemented by every Jellyfin connection. Remote identifiers are scoped by connection, so two servers may use the same user, item, or event IDs without collisions. Connector Settings retains enabled-user selection per connection in a collapsed-by-default, searchable `Analyzed users` section with selected and unselected groups. Newly discovered users are enabled by default while later explicit user choices remain unchanged. A successful generic sync stages catalog and playback data by connection and run, then promotes the complete snapshot atomically. File details combine every matched capable source chronologically and do not deduplicate events between servers.

Only enabled users contribute playback information. Disabling a user removes that user's locally cached state and events on the next successful synchronization. A failed or canceled synchronization preserves the last complete state. The legacy `/api/jellyfin/*` endpoints retain their response shapes for the first connector release and remain backed by the standard connection's compatibility cache. Cover selection, aggregate playback statistics, and Jellyfin catalog pages also keep their existing preferred/standard behavior for now.

## Synchronization, migration, and Shadow Mode

Generic connections use persisted, single-flight, connection-scoped jobs. Binding changes use the same job model with `job_type=recompute`. Validated catalog, user, state, and event pages are written to run-scoped staging tables and promoted atomically only after a complete successful fetch. Failure or cancellation discards the current run and preserves the last successful snapshot. Startup removes abandoned staging rows. All Jellyfin connector work runs on the dedicated connector executor, and different connections may synchronize concurrently without consuming scan or maintenance capacity.

On upgrade, MediaLyze idempotently creates the standard `provider=jellyfin`, `name=Jellyfin` connection and backfills the legacy catalog, locations, links, users, user state, playback events, credentials, and unambiguous path rules. Existing rules begin as imported; manual file matches, ignored states, and file suggestions are removed. Existing Jellyfin tables are intentionally retained. Standard legacy syncs mirror their catalog and playback snapshot into connector tables, project automatic bindings back to the compatibility path-mapping table, and execute both exact-path matchers. Job summaries report Shadow Mode counters so unexplained differences can be diagnosed before the compatibility facade is removed in a later release.

Startup cancels orphaned connector jobs rather than promoting partial state. Remote deletions are applied only during a successful promote. The repository includes [documented large-catalog benchmarks](benchmarks.md). Run the connector benchmarks from the repository root:

```bash
.venv/bin/python docs/benchmarks/benchmark_jellyfin_bulk_promote.py --items 100000
.venv/bin/python docs/benchmarks/benchmark_connector_bulk_promote.py --items 100000
.venv/bin/python docs/benchmarks/benchmark_connector_matching.py --items 100000
```

The automated contract tests cover Jellyfin 10.10 and 10.11 response shapes. A running Jellyfin server exposes its exact API documentation at `/api-docs/swagger/index.html`; verify other versions with Test connection and a complete sync.
