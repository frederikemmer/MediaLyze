# AGENTS.md

**Project:** MediaLyze  
**Repository Type:** Open-source self-hosted media analysis tool  
**Primary Goal:** Analyze large video media collections with `ffprobe`, persist normalized technical metadata in SQLite, and expose performant inspection, statistics, and scan-management workflows through a FastAPI + React application.

---

# 1. Current State Snapshot

MediaLyze is no longer a greenfield v1 concept document. This file describes the **current `dev` branch implementation state** and should be treated as an engineering overview for agents working in this repository.

Current baseline:

* main branch: `main`
* branch basis: `dev`
* primary development branch: `dev`
* stack: **Python 3.12**, **FastAPI**, **SQLAlchemy**, **SQLite**, **React 19**, **Vite**, **TypeScript**, **i18next**, **APScheduler**, **watchdog**, **Electron**, **Docker**, **GHCR**

Current `dev` already includes unreleased additions beyond `v0.2.0`, including:

* path-browser filtering for placeholder directories such as `cdrom`, `floppy`, and `usb` when they are only container-exposed shadow directories
* broader HDR10+ detection from additional ffprobe side-data metadata variants

Important documentation rule:

* prefer the actual repository code and GitHub release metadata over `CHANGELOG.md` when they disagree
* `CHANGELOG.md` is currently incomplete on `dev` and does **not** fully reflect the already published `v0.2.0` release
* `main` is the primary stable / release branch, while `dev` is the primary ongoing development branch
* when changing user-visible behavior, fixes, migrations, or release-relevant internals, add a concise entry under `CHANGELOG.md` `vUnreleased` before finishing the task

---

# 2. Product Scope

MediaLyze is a **self-hosted technical media analyzer** for video collections.  
It focuses on file analysis, scan orchestration, metadata normalization, and library statistics.

## 2.1 Implemented Now

MediaLyze currently implements:

* library creation, update, rename, and deletion
* per-library dashboard visibility toggles that can exclude selected libraries from dashboard statistics and comparison panels
* safe directory browsing restricted to paths under `MEDIA_ROOT`
* manual, scheduled, and watchdog-based scanning
* full and incremental scans
* scan cancelation
* recent scan logs and detailed scan-job summaries
* deterministic change detection using path, file size, and modification time
* ffprobe-based normalization of media, stream, subtitle, and raw payload data
* internal and external subtitle detection
* configurable per-library quality profiles
* per-file quality score breakdowns
* per-library duplicate detection using filename signatures, exact file hashes, or both together
* structured metadata search, filtering, sorting, and pagination
* dashboard and per-library statistics
* dashboard and per-library metric-comparison panels with selectable X/Y dimensions and heatmap, scatter, or bar renderers where supported
* theme selection and feature flags
* English and German UI translations
* Docker-first deployment and GHCR image publishing
* native desktop packaging for Windows, macOS, and Linux with a local backend sidecar

## 2.2 Explicit Non-Goals

MediaLyze does **not** currently:

* play media
* scrape movie or TV metadata
* connect to external metadata APIs
* modify, rename, or transcode media files
* manage authentication internally

## 2.3 Backlog / Not Yet Implemented

Open or clearly future-facing work includes:

* improved broken-file reporting and diagnostics
* additional future analysis and recommendation workflows

These items should be treated as backlog, not current behavior.

---

# 3. Core Runtime Behavior

## 3.1 Libraries

Libraries represent directories below `MEDIA_ROOT` in server mode and absolute filesystem paths in desktop mode.

Each library currently stores:

* name
* absolute resolved path
* library type
* `scan_mode`
* `duplicate_detection_mode`
* `scan_config`
* `quality_profile`
* `show_on_dashboard`
* timestamps such as `created_at`, `updated_at`, and `last_scan_at`

Supported library types:

```text
movies
series
mixed
other
```

Important correction:

* the current code preserves the library type enum but does **not** implement special series-specific parsing that should be documented as an active feature

## 3.2 Path Browsing Safety

The server-mode UI path browser is constrained to `MEDIA_ROOT`.

Current behavior includes:

* rejecting paths outside `MEDIA_ROOT`
* skipping symlinks that resolve outside `MEDIA_ROOT`
* hiding placeholder container directories like `cdrom`, `floppy`, and `usb` when they are not real intended media targets
* keeping explicit mounted directories visible when they are valid browse targets
* desktop builds using a native OS folder picker plus absolute-path validation instead of the backend browse tree

## 3.3 Scan Modes

Libraries support three active scan modes:

```text
manual
scheduled
watch
```

Behavior:

* `manual`: scans run only when requested
* `scheduled`: APScheduler creates interval-based scan jobs
* `watch`: watchdog observers debounce filesystem events and queue scans
* desktop network paths fall back to `scheduled`; watch observers are only created for local desktop paths

## 3.4 Scan Types

The current API and runtime support:

```text
full
incremental
```

Current scan execution behavior:

1. traverse the library directory deterministically
2. apply ignore-pattern filtering during discovery
3. compare discovered files against stored records
4. detect new, modified, deleted, or newly ignored files
5. reanalyze files with incomplete metadata when needed
6. reanalyze unchanged media files when detected external subtitle sidecars were added or removed
7. stream discovered files into a runtime work queue for analysis and duplicate-signature processing instead of waiting for full discovery to finish first
8. persist detailed scan summaries and file-level failure samples

Change detection uses:

* relative path
* file size
* modification time

## 3.5 Scan Job Runtime

The project does **not** currently use a separate abstract background-queue architecture from the early documentation.

Actual implementation:

* scan jobs are persisted in SQLite
* the runtime is managed by `ScanRuntimeManager`
* jobs are queued and deduplicated per library
* execution is backed by a `ThreadPoolExecutor`
* file discovery stays single-threaded, while worker threads are used for per-file analysis and duplicate processing only
* APScheduler manages scheduled work
* watchdog observers feed filesystem-triggered scans
* active jobs can be canceled globally or per library
* quality recomputation runs as a distinct runtime-managed job type
* startup no longer auto-queues quality-recompute backfill jobs; recomputation is queued only from explicit follow-up actions such as library profile updates
* old `queued` and `running` jobs from previous processes are canceled during startup instead of being resumed
* startup also runs one history-retention maintenance pass, APScheduler registers a daily history-retention maintenance job, and deferred SQLite compaction is retried automatically once scans are idle

## 3.6 Scan Logs

Scan-job tracking now includes:

* active-job polling
* recent completed/failed/canceled scan history
* trigger source tracking
* trigger details
* progress state and phase labels
* separate live discovery counts and worker-queue progress counts for active scans
* discovery summaries
* change summaries
* analysis failure summaries with sampled short reasons plus copyable detailed diagnostics per failed file
* duplicate-processing summaries including mode, failure samples, and grouped duplicate counts
* retention cleanup for terminal scan-job history based on the app-level `history_retention.scan_history` settings, while queued or running jobs are never pruned

---

# 4. Media Analysis And Normalization

## 4.1 ffprobe Integration

MediaLyze analyzes video files with `ffprobe` and stores both:

* normalized structured metadata
* raw ffprobe JSON payloads

Normalized storage covers:

* container / format data
* video streams
* audio streams
* subtitle streams
* external subtitle sidecars

## 4.2 Video Streams

Current normalized video stream fields include:

* codec
* profile
* width
* height
* pixel format
* color space
* color transfer
* color primaries
* frame rate
* bitrate
* HDR / dynamic range type

Current HDR handling includes:

* SDR
* HDR10
* HDR10+
* HLG
* Dolby Vision
* Dolby Vision profile variants as stored values, without a separate UI feature flag

## 4.3 Audio Streams

Current normalized audio stream fields include:

* codec
* profile
* spatial audio profile for supported immersive formats such as Dolby Atmos and DTS:X
* channels
* channel layout
* sample rate
* bitrate
* language
* default flag
* forced flag

## 4.4 Subtitle Streams

Current normalized subtitle stream fields include:

* codec
* language
* default flag
* forced flag
* `subtitle_type`

`subtitle_type` distinguishes the parsed subtitle class at the schema level and is part of the current contract.

## 4.5 External Subtitles

External subtitle detection is implemented for sidecar files near media files.

Supported extensions:

```text
srt
ass
ssa
sub
idx
```

Stored fields include:

* relative sidecar path
* language
* format
* sidecar additions or removals trigger media reanalysis on the next scan even when the video file itself is unchanged

## 4.6 Duplicate Detection

Duplicate detection is persisted per media file and configured per library.

Current modes:

```text
off
filename
filehash
both
```

Current behavior:

* `off` disables duplicate detection for the library and duplicate-group queries return an empty result
* `filename` stores a normalized filename signature based on the lowercase stem with whitespace, dot, dash, and underscore runs collapsed to a single space
* `filehash` stores a full-file `sha256` content hash plus its algorithm label
* `both` stores both the normalized filename signature and the `sha256` content hash, and duplicate-group responses expose which method each returned group came from
* new libraries default to `off`
* unchanged files can be queued for duplicate-only backfill when the active mode's persisted signature is missing
* duplicate groups are aggregated on demand per library from stored signatures or hashes instead of being materialized as a dedicated table

---

# 5. Ignore Patterns

Ignore rules are a current first-class feature.

Current implementation supports:

* built-in default ignore patterns
* user-managed custom ignore patterns
* separate persisted storage of `user_ignore_patterns` and `default_ignore_patterns`
* merged effective `ignore_patterns`
* optional seeding disablement via `DISABLE_DEFAULT_IGNORE_PATTERNS=true`

Built-in default patterns currently target common temporary, system, and NAS-generated files such as:

* `*/.DS_Store`
* `*/@eaDir/*`
* `*.part`
* `*.tmp`
* `*.temp`
* `*thumbs.db`

Ignore rules are applied during discovery against normalized library-relative paths.

---

# 6. Quality Scoring

The original static example score table is outdated and should not be used as the current description.

MediaLyze now implements a **configurable quality-profile system** per library.

## 6.1 Quality Profile Categories

Current categories:

* resolution
* visual density
* video codec
* audio channels
* audio codec
* dynamic range
* language preferences

## 6.2 Quality Data Stored Per File

Current media-file quality fields include:

* `quality_score`
* `quality_score_raw`
* `quality_score_breakdown`

The file detail view also exposes detailed category-level scoring.

## 6.3 Quality Profile Behavior

Current behavior:

* every library stores a `quality_profile`
* library updates can modify the profile
* profile changes can queue quality recomputation jobs
* the `resolution` quality category is now backed by global app-level resolution categories rather than a fixed hard-coded set
* visual density scoring uses actual file size and explicit bounds, not only bitrate metadata
* dynamic range scoring normalizes Dolby Vision variants to the intended score tier

---

# 7. Statistics And Search

## 7.1 Statistics

Current aggregated statistics include:

* dashboard totals for libraries, files, storage, and duration
* optional dashboard distributions for containers, video codecs, resolutions, HDR / dynamic range, audio codecs, audio spatial profiles, audio languages, subtitle languages, subtitle codecs, and subtitle sources based on the dashboard page's persisted inline panel layout
* optional dashboard histogram-based numeric distributions for quality score, runtime, file size, bitrate, and audio bitrate based on the dashboard page's persisted inline panel layout
* optional dashboard metric-comparison panels for pairs of single-value fields such as file size, runtime, bitrate, numeric resolution in megapixels, container, codec, resolution category, and HDR type based on the dashboard page's persisted inline panel layout
* dashboard aggregates and comparison panels only include libraries whose `show_on_dashboard` flag is enabled
* container distribution in library statistics
* video codec distribution
* resolution distribution grouped by global resolution categories
* HDR / dynamic range distribution
* audio codec distribution
* audio spatial profile distribution
* audio language distribution
* subtitle language distribution
* subtitle codec distribution
* subtitle source distribution
* histogram-based numeric distributions in library statistics for quality score, runtime, file size, bitrate, and audio bitrate
* metric-comparison panels in library statistics for pairs of single-value fields, with server-provided heatmap data and optional scatter or bar views depending on the selected axis kinds

## 7.2 Statistics Caching

The project currently uses in-process stats caching via `backend/app/services/stats_cache.py` for:

* dashboard payloads
* dashboard comparison payloads keyed by selected X/Y fields
* library lists
* library summaries
* library statistics
* library comparison payloads keyed by library id plus selected X/Y fields

Cache invalidation is tied to library changes and scan activity.

## 7.3 File Table Search And Filtering

Library file browsing now supports structured search and field-specific filtering.

Current searchable/filterable dimensions include:

* file / path
* container
* size
* duration
* quality score
* bitrate
* audio bitrate
* video codec
* resolution
* HDR type
* audio codecs
* audio spatial profiles
* audio languages
* subtitle languages
* subtitle codecs
* subtitle source

Resolution search supports both exact `WIDTHxHEIGHT` terms and global resolution-category ids / labels. The analyzed-files table still shows exact stored resolutions, while grouped categories are used for statistics and the file-detail resolution badge.

The backend supports:

* legacy broad search
* field-specific search intersections
* negated text terms in field-specific filters via a leading `!`
* comma-separated field-specific text terms, with each term intersected as an `AND`
* structured numeric expressions such as size, duration, quality score, bitrate, and audio bitrate comparisons
* comma-separated `AND` ranges for numeric filters, for example `>=4GB,<8GB` or `>=8Mb/s,<12Mb/s`
* sorting across supported table columns

The analyzed-files table and table-view settings can also expose container, bitrate, and audio bitrate as configurable columns, using the normalized file extension as the user-facing container key.

---

# 8. Web Interface

## 8.1 Frontend Overview

The frontend is a React SPA built with Vite and served by the backend from `frontend/dist` in production.

Current route model:

* `/` dashboard
* `/settings` libraries page plus app settings
* `/libraries/:libraryId` library detail
* `/files/:fileId` file detail

## 8.2 Current UX Features

Implemented UI behavior includes:

* live scan banner for active jobs
* active scan polling with cancel-all support
* library navigation in the main shell
* path browser for safe library creation
* collapsible settings panels
* recent scan-log browsing and detailed scan summaries
* duplicate-group browsing per library
* virtualized library file table for larger datasets
* infinite paging / paginated loading behavior
* CSV export of the full analyzed-files result set using the current file filters and sort order
* table-column visibility and per-column tooltip customization in the settings page's `Table View` section
* inline statistic-panel layout editing on the dashboard and library detail pages, including add-panel menus, drag-and-drop reordering, per-panel resizing, and persisted per-page panel selections that are now managed directly on those pages instead of in Settings
* dashboard and library layout migration notices that list saved panel layout entries, sizes, and comparison selections that could not be carried over exactly after an update
* reusable histogram-style numeric statistic panels powered by Apache ECharts for quality score, duration, file size, bitrate, and audio bitrate
* reusable comparison statistic panels with persisted per-view X/Y selections and renderer choices, plus heatmap, scatter, and bar visualizations where the selected field pair supports them
* local count / percent toggles on numeric statistic charts
* clickable numeric histogram bins in the library detail view that apply matching analyzed-files range filters
* curated default statistic-panel layouts for first-time dashboard and library views plus inline reset-to-default controls on both statistic-layout pages
* user-resizable analyzed-files table columns with persisted widths in browser storage
* lightweight hover tooltips on analyzed-files codec, language, subtitle-source, and quality-score cells that lazy-load per-file details, stay exclusive while hovering or scrolling, and can be enabled or disabled per table statistic column in App Settings
* globally persisted collapse and drag-order preferences for the file-detail panels, including the structured `Format` metadata panel
* per-file quality tooltip and full breakdown view
* persistent app theme preference
* persistent local UI state for selected statistics, per-dashboard and per-library statistic-panel layouts, analyzed-files column widths, file-detail panel layout, and some panel/section visibility

## 8.3 Internationalization

Current translation state:

* default language: English
* additional shipped language: German
* translation assets stored under `frontend/locales/`
* frontend uses `i18next`

## 8.4 Theme And Feature Flags

Current theme support:

```text
system
light
dark
```

Theme behavior:

* stored in browser `localStorage`
* `system` follows OS/browser preference
* applied through a `data-theme` attribute on `<html>`

Current app feature flags include:

* `show_analyzed_files_csv_export`
* `show_full_width_app_shell`
* `hide_quality_score_meter`
* `unlimited_panel_size`
* `in_depth_dolby_vision_profiles`

These flags currently control:

* whether the analyzed-files CSV export button is shown in the library detail view
* whether the main `.media-app-shell` container expands to the full available page width
* whether the analyzed-files quality-score bar meter is hidden while keeping the numeric score visible
* whether dashboard and library statistic panels may grow beyond the default 4-row height cap while panel width still remains limited by the underlying 4-column grid
* whether Dolby Vision profile variants and deeper details such as Profile 8 compatibility and Profile 7 layer metadata are displayed directly instead of being grouped as plain Dolby Vision

---

# 9. API Surface

The backend currently exposes a REST-style API under the configured prefix, typically `/api`.

## 9.1 Health And Runtime

* `GET /api/health`
* `GET /api/dashboard`
* `GET /api/dashboard/comparison`
* `GET /api/scan-jobs/active`
* `POST /api/scan-jobs/active/cancel`
* `GET /api/scan-jobs/recent`
* `GET /api/scan-jobs/{job_id}`

## 9.2 Safe Filesystem Browsing

* `GET /api/browse`

Desktop-only path inspection:

* `POST /api/paths/inspect`

This endpoint is used for selecting library paths below `MEDIA_ROOT`.

## 9.3 App Settings

* `GET /api/app-settings`
* `PATCH /api/app-settings`

Important current payload concepts:

* `ignore_patterns`
* `user_ignore_patterns`
* `default_ignore_patterns`
* `resolution_categories`
* `scan_performance.scan_worker_count`
* `scan_performance.parallel_scan_jobs`
* `scan_performance.comparison_scatter_point_limit`
* `history_retention.file_history.days`
* `history_retention.file_history.storage_limit_gb`
* `history_retention.library_history.days`
* `history_retention.library_history.storage_limit_gb`
* `history_retention.scan_history.days`
* `history_retention.scan_history.storage_limit_gb`
* `feature_flags.show_analyzed_files_csv_export`
* `feature_flags.show_full_width_app_shell`
* `feature_flags.hide_quality_score_meter`
* `feature_flags.unlimited_panel_size`
* `feature_flags.in_depth_dolby_vision_profiles`

`history_retention` currently applies to three buckets:

* `file_history`: persisted per-file analyzed snapshots, default `90` days and `0` GB unlimited
* `library_history`: one compact per-library UTC-day snapshot, default `365` days and `0` GB unlimited
* `scan_history`: terminal `scan_jobs` records, default `30` days and `0` GB unlimited

`0` means unlimited for both days and storage.
Age and storage limits are both active at the same time, with oldest-first pruning until both limits are satisfied.

## 9.4 History Storage

* `GET /api/history-storage`

Important current contract concepts:

* `database_file_bytes`
* `reclaimable_file_bytes`
* `categories.file_history.current_estimated_bytes`
* `categories.file_history.average_daily_bytes`
* `categories.file_history.projected_bytes_30d`
* `categories.file_history.projected_bytes_for_configured_days`
* matching fields for `library_history` and `scan_history`

Storage figures are logical estimates based on persisted payload sizes, not exact per-table SQLite file usage.

## 9.5 Libraries

* `GET /api/libraries`
* `POST /api/libraries`
* `GET /api/libraries/{library_id}/summary`
* `GET /api/libraries/{library_id}/statistics`
* `GET /api/libraries/{library_id}/statistics/comparison`
* `GET /api/libraries/{library_id}/duplicates`
* `GET /api/libraries/{library_id}/scan-jobs`
* `PATCH /api/libraries/{library_id}`
* `DELETE /api/libraries/{library_id}`
* `GET /api/libraries/{library_id}/files`
* `GET /api/libraries/{library_id}/files/export.csv`
* `POST /api/libraries/{library_id}/scan`

Important library contract concepts:

* `scan_mode`
* `duplicate_detection_mode`
* `scan_config`
* `quality_profile`
* `show_on_dashboard`
* `numeric_distributions`
* comparison responses expose `x_field`, `y_field`, field kinds, available renderers, bucket metadata, heatmap cells, optional scatter points, optional bar aggregates, and the active scatter sample limit
* `path` is relative to `MEDIA_ROOT` in server mode and absolute in desktop mode

## 9.6 Files

* `GET /api/files/{file_id}`
* `GET /api/files/{file_id}/streams`
* `GET /api/files/{file_id}/quality-score`

Important file contract concepts:

* `quality_score_raw`
* `quality_score_breakdown`
* `raw_ffprobe_json`
* `resolution_category_id`
* `resolution_category_label`
* `audio_spatial_profiles`
* `subtitle_type`
* lightweight stream-detail responses expose `video_streams`, `audio_streams`, `subtitle_streams`, and `external_subtitles` without the full raw ffprobe payload

## 9.7 Scan Job Contract

Important scan-job contract concepts:

* `trigger_source`
* `trigger_details`
* `scan_summary`
* `scan_summary.duplicates`

Supported trigger sources currently include:

```text
manual
scheduled
watchdog
```

---

# 10. Database Schema Overview

MediaLyze uses SQLite with WAL mode and additive migration logic during initialization.

Current logical schema includes:

* `libraries`
* `app_settings`
* `media_files`
* `media_file_history`
* `media_formats`
* `video_streams`
* `audio_streams`
* `subtitle_streams`
* `external_subtitles`
* `library_history`
* `scan_jobs`

Important post-`0.0.1` additions that must be treated as real schema surface:

* library `scan_mode`
* library `duplicate_detection_mode`
* library `scan_config`
* library `quality_profile`
* library `show_on_dashboard`
* app-level settings storage
* media `filename_signature`
* media `content_hash`
* media `content_hash_algorithm`
* media `quality_score_raw`
* media `quality_score_breakdown`
* media `raw_ffprobe_json`
* media-file history snapshots keyed by `(library_id, relative_path)` over time
* library daily history snapshots keyed by `(library_id, snapshot_day)`
* subtitle `subtitle_type`
* scan job `trigger_source`
* scan job `trigger_details`
* scan job `scan_summary`

Current database behavior:

* SQLite foreign keys enabled
* WAL mode enabled
* additive column migrations on startup
* index creation for actively queried fields
* `PRAGMA optimize` run during initialization

---

# 11. System Architecture

## 11.1 Backend

Implemented backend structure:

* `backend/app/main.py` boots FastAPI, initializes the database, starts the scan runtime, and serves the built frontend
* `backend/app/api/routes.py` defines the public HTTP API
* `backend/app/models/entities.py` defines the ORM schema
* the session module under `backend/app/db` configures SQLite, WAL, additive migrations, and sessions
* `backend/app/services/duplicates.py` provides duplicate-signature strategies and duplicate-group queries
* `backend/app/services/history_snapshots.py` builds persisted media-file and library history snapshots
* `backend/app/services/history_storage.py` estimates history bucket usage, growth, projections, and database reclaimable bytes
* `backend/app/services/history_retention.py` applies age/storage cleanup and SQLite compaction for history buckets
* `backend/app/services/numeric_distributions.py` builds histogram-ready numeric statistics for dashboard and library payloads
* `backend/app/services/stat_comparisons.py` builds cached comparison datasets for dashboard and library views from the normalized per-file metadata model, including numeric megapixel resolution comparisons and app-configured scatter-point sampling
* `backend/app/services/scanner.py` performs discovery, change detection, ffprobe analysis, normalization, and scan-summary generation
* `backend/app/services/runtime.py` orchestrates scheduled scans, watchdog scans, executor-backed execution, and cancelation
* `backend/app/services/stats_cache.py` provides in-memory cache helpers for dashboard and library statistics

## 11.2 Frontend

Implemented frontend structure:

* `frontend/src/App.tsx` wires routing and providers
* `frontend/src/lib/app-data.tsx` manages cached app settings, dashboard, and library data
* `frontend/src/lib/statistic-comparisons.ts` manages comparison field definitions, renderer compatibility, and persisted per-view selections
* `frontend/src/lib/scan-jobs.tsx` manages active scan polling state
* page modules under `frontend/src/pages/` implement dashboard, settings/libraries, library detail, and file detail views, including separate comparison-data loading on dashboard and library pages; the Settings page also exposes history-retention controls and `GET /api/history-storage` forecast data
* `frontend/src/lib/desktop.ts` exposes the optional Electron preload bridge used by desktop builds

Desktop packaging structure:

* `desktop/main.cjs` boots Electron, starts the packaged backend, waits for `/api/health`, and opens the local app window
* `desktop/preload.cjs` exposes the safe desktop bridge for native folder selection
* `desktop/scripts/build-backend.mjs` builds the Python backend sidecar for packaging and bundles the packaged `ffprobe`; macOS packaging also copies non-system `dylib` dependencies into the app bundle and rewrites them to relative loader paths

## 11.3 Deployment Shape

Current deployment models are:

* a **single container** that includes:

  * backend API
  * scan runtime
  * scheduler
  * watchdog integration
  * SQLite database
  * served frontend bundle

* a **native desktop app** that includes:

  * an Electron shell
  * a local backend sidecar process
  * a local SQLite database under the user-data directory
  * a bundled frontend build
  * a bundled `ffprobe` binary per target platform, with macOS desktop builds also bundling the non-system shared libraries that the packaged `ffprobe` depends on

---

# 12. Deployment And Configuration

## 12.1 Docker Model

MediaLyze is distributed as a Docker image, with GHCR as the primary registry target.

Current public image naming:

```text
ghcr.io/frederikemmer/medialyze
```

Current repository layout includes:

* root `Dockerfile`
* `docker/docker-compose.yaml`
* `docker/env.example`
* `docker/entrypoint.sh`

## 12.2 Runtime Paths

Expected container paths:

```text
/app
/config
/media
```

`MEDIA_ROOT` should be mounted read-only in production.

Additional media mounts can be exposed under `/media/...` when needed, and the path browser should only surface valid targets inside that tree.

## 12.3 Important Environment Variables

Current documented runtime configuration includes:

* `CONFIG_PATH`
* `MEDIA_ROOT`
* `APP_PORT`
* `HOST_PORT`
* `TZ`
* `FFPROBE_PATH`
* `DISABLE_DEFAULT_IGNORE_PATTERNS`
* `PUID`
* `PGID`

Additional behavior:

* the backend defaults to serving on port `8080`
* `PUID` and `PGID` support shared-folder or NAS permission setups
* `FFPROBE_PATH` can override the ffprobe binary
* scan concurrency is configured through the UI under App Settings and persisted in `app_settings`, including both per-scan analysis workers and parallel-library job limits
* history retention and storage budgets are configured through the UI under App Settings and persisted in `app_settings.history_retention`
* `MEDIALYZE_RUNTIME=desktop` switches the backend to local desktop defaults such as `127.0.0.1` binding and OS-specific config storage
* `FRONTEND_DIST_PATH` can point the backend at an explicit built frontend bundle, which is used by desktop packaging

---

# 13. CI, Releases, And Versioning

## 13.1 GitHub Actions

Current workflows include:

* dev image publishing
* official release publishing
* manually triggered dev desktop artifact builds
* desktop release artifact publishing, including manual rebuilds for an existing release tag from an alternate code ref when only build logic needs to be corrected
* release metadata validation for pull requests

## 13.2 Release Metadata Rules

The repository currently validates version alignment across:

* `Dockerfile`
* `pyproject.toml`
* `frontend/package.json`
* `desktop/package.json`

Release metadata is enforced through `.github/scripts/release_metadata.py`.

## 13.3 Release Publishing Model

Current release behavior:

* dev images are pushed from `dev`
* official images and GitHub releases are published from `main` only when a push increases the aligned repository version metadata
* official images are published to GHCR
* the official release workflow creates the matching `vX.Y.Z` tag and GitHub release from that `main` commit
* the desktop-release workflow can also be dispatched manually for an existing release tag, optionally building from a different git ref while still uploading assets to the original release tag
* GitHub releases use extracted release notes based on repository metadata
* upcoming release notes should be accumulated under `CHANGELOG.md` in `vUnreleased`
* when a new version is released, the relevant `vUnreleased` entries should be moved into the new version section instead of being rewritten from scratch

Important current nuance:

* version files on `dev` are **not** the authoritative source for the latest public release history
* GitHub release data currently shows `v0.2.0` as latest public release even though the local `CHANGELOG.md` on `dev` is incomplete

---

# 14. Repository Layout

Current top-level layout:

```text
backend/        FastAPI app, ORM models, DB init, scanner, runtime, services
desktop/        Electron shell, preload bridge, desktop packaging scripts
frontend/       React + Vite application, translations, tests
docs/           Supporting project documentation and screenshots
docker/         Compose file, env example, entrypoint
tests/          Python test suite
.github/        Workflows, issue templates, helper scripts, agent metadata

Dockerfile
pyproject.toml
CHANGELOG.md
README.md
AGENTS.md
```

Important correction:

* older documentation that references removed top-level scan, worker, or database folders is outdated and should not be reused

---

# 15. Testing And Validation

Current automated coverage includes backend and frontend test suites.

Repository-level test coverage areas include:

* app settings
* path browsing
* ffprobe parsing
* glob matching
* library services
* media services and search
* path safety
* quality scoring
* runtime behavior
* scan jobs
* scanner behavior
* statistics
* subtitles
* frontend API helpers and page behavior

When documenting or extending behavior, prefer tests and code over stale prose.

---

# 16. Working Rules For Agents

When updating documentation, code, or behavior in this repository:

* describe implemented behavior as implemented behavior
* describe backlog items as backlog
* do not resurrect outdated architectural labels from early versions
* verify claims against code, tests, workflows, or GitHub release metadata
* do not document unverified scale claims as benchmarked facts; treat large-library support as a design goal unless there is measured evidence
* prefer concrete current file paths and interfaces over speculative future structure
* if a larger change affects architecture, runtime behavior, public interfaces, release flow, repository structure, or other information relevant for future development, update `AGENTS.md` in the same work
* if a change is relevant for the next release, add it to `CHANGELOG.md` under `vUnreleased`
* when a changelog entry corresponds to a tracked GitHub issue, include the GitHub issue link in the `CHANGELOG.md` entry, for example `[#66](https://github.com/frederikemmer/MediaLyze/issues/66)`
* when preparing or publishing a new version, move the accumulated `vUnreleased` entries into the new version section so the release history remains complete

If documentation conflicts with code:

1. trust code and tests first
2. use GitHub release metadata for public-release chronology
3. treat `CHANGELOG.md` as advisory unless it matches the current repository and release state
