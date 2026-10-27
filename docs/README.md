# MediaLyze documentation

**Start here.** This is the main entry point for MediaLyze documentation, for users, contributors, and agents. The [repository README](../README.md) provides downloads and quick start; this guide explains which reference to read next and how the pieces fit together.

These references describe the current repository implementation on `dev`, entry points and identity/notification references reviewed against source on 2026-10-27. `dev` can include changes beyond stable releases. For the behavior of a particular installed release, read the documentation at its Git tag and its [release notes](https://github.com/frederikemmer/MediaLyze/releases). Code, tests, and build workflows take precedence over conflicting prose; release metadata establishes what was published. Databases, machine-specific paths, and historical benchmark measurements are not a description of every installation.

## Choose a starting point

| Goal | Start with | Then read |
| --- | --- | --- |
| Install or update the server | [Quick start](../README.md#quick-start) | [Environment and mounts](environment.md), [transcoding hardware requirements](transcoding.md) |
| Run the desktop app or build it | [Desktop downloads](../README.md#desktop-downloads) | [Local packaging](build_desktop.md), [automated artifacts](github_actions.md) |
| Set up and scan a library | [Discovery and pattern rules](patterns.md) | [Supported metadata and scan behavior](supported_metadata.md) |
| Understand statistics, quality, filters, and audio/book support | [Metadata support matrix](supported_metadata.md) | [Discovery rules](patterns.md), [architecture](architecture.md) |
| Create a transcoded video variant | [Transcoding](transcoding.md) | [Environment/output mounts](environment.md), [hardware selection](transcoding.md#hardware-selection-and-ranking) |
| Set up accounts, Guest access and passkeys | [Users and access](user-access.md) | [Environment](environment.md), [access restrictions](user-access.md#current-access-details-and-restrictions) |
| Connect Jellyfin | [Jellyfin setup and permissions](connectors.md#jellyfin-integration) | [Connector mappings and troubleshooting](connectors.md) |
| Assess playback compatibility | [Compatibility profiles](compatibility-profiles.md) | [JSON Schemas](#machine-readable-contracts-and-assets) |
| Understand optional telemetry | [Telemetry](telemetry.md) | [Environment overrides](environment.md#telemetry) |
| Develop a feature or investigate a defect | [Contributor setup](../CONTRIBUTING.md) | [Agent reading path](#reading-path-for-contributors-and-agents) |

## How the workflows connect

1. **Configure storage.** Keep the configuration database persistent. Server library roots live below `MEDIA_ROOT`; desktop libraries use native folder selection. Separate transcoded output has its own writable root. Read [environment settings](environment.md) before changing mounts.
2. **Discover and analyze.** Library type, selected roots, ignore rules, and show/bonus patterns determine the scan inputs. [Patterns](patterns.md) explains discovery; [supported metadata](supported_metadata.md) explains ffprobe normalization, scheduling, failure diagnostics, cancellation, and RAM limits.
3. **Inspect the results.** File tables, statistics, quality profiles, history, Storage Map, and metadata comparisons consume analyzed primary files. Audio and audiobook libraries expose type-aware fields. Dashboard participation and saved page layouts affect what is displayed, not the file's identity.
4. **Add external context if needed.** [Connectors](connectors.md) map remote locations to the same stable `library_root_id + relative_path` identity. [Jellyfin](connectors.md#jellyfin-integration) adds setup, users, playback privacy, and provider limitations. Connectors do not rename or modify local media.
5. **Evaluate or transcode explicitly.** [Compatibility profiles](compatibility-profiles.md) evaluate a hardware/client combination; they do not encode files or guarantee live client performance. [Transcoding](transcoding.md) validates a separate FFmpeg plan, writes output under an explicit policy, and links variants. Variants do not inflate primary library counts.

## Current references

| Document | Scope and relationship |
| --- | --- |
| [Users and access](user-access.md) | Account setup, Guest, permissions, sessions and passkeys. |
| [Environment](environment.md) | Runtime variables, Compose interpolation, persistent paths, permissions, and diagnostic overrides. |
| [Discovery and patterns](patterns.md) | Library roots, type-aware extensions, series/season recognition, duplicates, bonus content, and ignores. |
| [Supported metadata](supported_metadata.md) | Analysis and UI support, music/audiobooks, quality, tables/charts, scan modes, failure reasons, and resource limits. |
| [Transcoding](transcoding.md) | Plans/presets, filename and folder formatting, capability probes, output safety, job center, history, and comparison. |
| [Connectors](connectors.md) | Provider-neutral entities, path inference, exact matching, staging, APIs, and provider-development contract. |
| [Compatibility profiles](compatibility-profiles.md) | Hardware/software/combination documents, schema versions, evaluation precedence, and contribution rules. |
| [Telemetry](telemetry.md) | Opt-in modes, local API, payload contents/rounding, development flags, and external-service boundaries. |
| [Architecture](architecture.md) | Runtime ownership, frontend routes, scan/transcode/connector flows, and source entry points. |
| [Desktop builds](build_desktop.md) | OS-specific local packaging and bundled FFmpeg/ffprobe verification. |
| [GitHub Actions](github_actions.md) | Development/release publication, manual inputs, versions, artifacts, caches, and recovery. |
| [Adding languages](adding-languages.md) | Translation keys, lazy language loading, persistence, selectors, and validation. |
| [UI notifications](notifications.md) | Notification settings, personal history, retention and product integrations. |
| [Visual QA guide](design-qa.md) | Internal checklist for frontend changes: current pattern references and states to recheck; `/ui-elements` is the visual catalog. |
| [Benchmarks](benchmarks.md) | Reproducible synthetic workloads, scripts, measurement limits, and reports. |

## Plans, internal features, and historical evidence

These documents have a different status from current user instructions:

- [Prototyping and feature concepts](prototyping/README.md): early feature plans, design decisions, and prototypes; consult source and current product documentation for behavior that is already implemented.
- [Unreleased transcoding Federation notes](prototyping/unreleased-transcoding.md): retained Federation implementation hidden by the frontend release switch. UI visibility does not disable its backend API; Federation also requires persisted opt-in and its process gate.
- [Unreleased transcoding automation notes](prototyping/unreleased_transcoding_automation.md): retained rule and inventory implementation hidden by the frontend release switch. UI visibility does not disable its API or scan-triggered automation.
- [Raw benchmark results](benchmarks/results/): Historical JSON measurements with recorded environment metadata where available. Old test counts are not current-suite claims.
- [Changelog](../CHANGELOG.md): release notes and accumulated `vUnreleased` work. Consult GitHub releases for publication chronology.

## Machine-readable contracts and assets

| Asset | Purpose |
| --- | --- |
| [Hardware profile schema](schemas/hardware-profile.schema.json) | Portable hardware-profile file contract; explained in [compatibility profiles](compatibility-profiles.md). |
| [Software profile schema](schemas/software-profile.schema.json) | Portable player/client-profile file contract. |
| [Combination profile schema](schemas/compatibility-profile.schema.json) | References one hardware and one software profile. |
| [FFmpeg manifest](ffmpeg-manifest.json) | Concrete pinned versions, sources, and checksums, consumed by desktop packaging; Docker pins matching package arguments in its Dockerfile. This is data, not a JSON Schema. |
| [Current screenshots](images/2026-10-02/) | Live-instance captures used by the repository README. |

## Reading path for contributors and agents

1. Read [AGENTS.md](../AGENTS.md) for repository rules, visual conventions, documentation obligations, and the engineering overview.
2. Use [architecture](architecture.md) to identify data ownership. Choose the relevant domain reference above rather than assuming an older design is still active.
3. Follow the source map below and inspect current tests. Verify assumptions against the actual branch, installed runtime, and feature visibility before editing.
4. Keep shared UI changes represented in `frontend/src/pages/UiElementsPage.tsx`; [Design QA](design-qa.md) describes the visual checks.
5. Update the affected references, cross-links, and this index when behavior or the documentation inventory changes. Use [contributor validation](../CONTRIBUTING.md#validation) and [release instructions](github_actions.md) for the relevant checks.

| Domain | Source entry points |
| --- | --- |
| Runtime defaults and deployment | `backend/app/core/config.py`, `docker/`, `Dockerfile` |
| Discovery, parsing, and scans | `backend/app/services/scanner.py`, `ffprobe_parser.py`, `pattern_recognition.py`, `runtime.py` |
| Persistence and public contracts | `backend/app/models/entities.py`, `backend/app/db/session.py`, `backend/app/schemas/`, `backend/app/api/routes.py` |
| Quality and compatibility | `backend/app/services/quality.py`, `quality_profiles.py`, `compatibility.py`, `compatibility_profiles.py`; `backend/app/profile_catalog/` |
| Statistics and storage | `backend/app/services/library_service.py`, `stat_comparisons.py`, `storage_map.py`, `stats_cache.py` |
| Transcoding | `backend/app/services/transcoding.py`, `transcode_matrix.py`; frontend Transcoding components/pages |
| Connectors | `backend/app/services/connector_contract.py`, `connector_registry.py`, `connector_sync.py`, `connector_mapping.py`, `connector_matching.py` |
| Telemetry and performance | `backend/app/services/telemetry.py`, `performance.py` |
| Frontend visibility and layouts | `frontend/src/App.tsx`, `frontend/src/lib/release-visibility.ts`, `statistic-panel-layout.ts`, `library-statistics-settings.ts`, `statistic-comparisons.ts` |
| Shared visual patterns and localization | `frontend/globals.css`, `frontend/src/medialyze.css`, `frontend/src/components/`, `UiElementsPage.tsx`, `frontend/src/i18n.ts`, `frontend/locales/` |
| Desktop and releases | `desktop/scripts/`, `.github/workflows/`, `.github/scripts/release_metadata.py` |

Run scripts and checks from the repository root unless a guide explicitly changes directories. Use temporary writable configuration/media paths for backend tests and benchmarks; do not point validation at production state.
