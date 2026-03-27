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

---

# 2. Product Scope

MediaLyze is a **self-hosted technical media analyzer** for video collections.  
It focuses on file analysis, scan orchestration, metadata normalization, and library statistics.

## 2.1 Implemented Now

MediaLyze currently implements:

* library creation, update, rename, and deletion
* safe directory browsing restricted to paths under `MEDIA_ROOT`
* manual, scheduled, and watchdog-based scanning
* full and incremental scans
* per-library duplicate detection with `filename`, `content_hash`, and `perceptual_hash` modes
* scan cancelation
* recent scan logs and detailed scan-job summaries
* deterministic change detection using path, file size, and modification time
* ffprobe-based normalization of media, stream, subtitle, and raw payload data
* internal and external subtitle detection
* configurable per-library quality profiles
* per-file quality score breakdowns
* structured metadata search, filtering, sorting, and pagination
* dashboard and per-library statistics
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
* `scan_config`
* `quality_profile`
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
6. persist detailed scan summaries and file-level failure samples

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
* APScheduler manages scheduled work
* watchdog observers feed filesystem-triggered scans
* active jobs can be canceled globally or per library
* quality recomputation runs as a distinct runtime-managed job type

## 3.6 Scan Logs

Scan-job tracking now includes:

* active-job polling
* recent completed/failed/canceled scan history
* trigger source tracking
* trigger details
* progress state and phase labels
* explicit duplicate-detection phase progress and duplicate-result summaries
* discovery summaries
* change summaries
* analysis failure summaries with sampled error reasons

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
* Dolby Vision profile variants when the feature flag is enabled in the UI

## 4.3 Audio Streams

Current normalized audio stream fields include:

* codec
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
* video codec distribution
* resolution distribution grouped by global resolution categories
* HDR / dynamic range distribution
* audio codec distribution
* audio language distribution
* subtitle language distribution
* subtitle codec distribution
* subtitle source distribution

## 7.2 Statistics Caching

The project currently uses in-process stats caching via `backend/app/services/stats_cache.py` for:

* dashboard payloads
* library lists
* library summaries
* library statistics

Cache invalidation is tied to library changes and scan activity.

## 7.3 File Table Search And Filtering

Library file browsing now supports structured search and field-specific filtering.

Current searchable/filterable dimensions include:

* file / path
* size
* duration
* quality score
* video codec
* resolution
* HDR type
* audio codecs
* audio languages
* subtitle languages
* subtitle codecs
* subtitle source

Resolution search supports both exact `WIDTHxHEIGHT` terms and global resolution-category ids / labels. The analyzed-files table still shows exact stored resolutions, while grouped categories are used for statistics and the file-detail resolution badge.

The backend supports:

* legacy broad search
* field-specific search intersections
* structured numeric expressions such as size, duration, and quality score comparisons
* sorting across supported table columns

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
* virtualized library file table for larger datasets
* infinite paging / paginated loading behavior
* CSV export of the full analyzed-files result set using the current file filters and sort order
* statistic-panel and table-column visibility customization
* per-file quality tooltip and full breakdown view
* persistent app theme preference
* persistent local UI state for selected statistics and some panel/section visibility

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

* `show_dolby_vision_profiles`
* `show_analyzed_files_csv_export`

These flags currently control:

* whether Dolby Vision profile variants are displayed separately in statistics and metadata views
* whether the analyzed-files CSV export button is shown in the library detail view

---

# 9. API Surface

The backend currently exposes a REST-style API under the configured prefix, typically `/api`.

## 9.1 Health And Runtime

* `GET /api/health`
* `GET /api/dashboard`
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
* `feature_flags.show_dolby_vision_profiles`

## 9.4 Libraries

* `GET /api/libraries`
* `POST /api/libraries`
* `GET /api/libraries/{library_id}/summary`
* `GET /api/libraries/{library_id}/statistics`
* `GET /api/libraries/{library_id}/scan-jobs`
* `PATCH /api/libraries/{library_id}`
* `DELETE /api/libraries/{library_id}`
* `GET /api/libraries/{library_id}/files`
* `GET /api/libraries/{library_id}/files/export.csv`
* `POST /api/libraries/{library_id}/scan`

Important library contract concepts:

* `scan_mode`
* `scan_config`
* `quality_profile`
* `path` is relative to `MEDIA_ROOT` in server mode and absolute in desktop mode

## 9.5 Files

* `GET /api/files/{file_id}`
* `GET /api/files/{file_id}/quality-score`

Important file contract concepts:

* `quality_score_raw`
* `quality_score_breakdown`
* `raw_ffprobe_json`
* `resolution_category_id`
* `resolution_category_label`
* `subtitle_type`

## 9.6 Scan Job Contract

Important scan-job contract concepts:

* `trigger_source`
* `trigger_details`
* `scan_summary`

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
* `media_formats`
* `video_streams`
* `audio_streams`
* `subtitle_streams`
* `external_subtitles`
* `scan_jobs`

Important post-`0.0.1` additions that must be treated as real schema surface:

* library `scan_mode`
* library `scan_config`
* library `quality_profile`
* app-level settings storage
* media `quality_score_raw`
* media `quality_score_breakdown`
* media `raw_ffprobe_json`
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
* `backend/app/services/scanner.py` performs discovery, change detection, ffprobe analysis, normalization, and scan-summary generation
* `backend/app/services/runtime.py` orchestrates scheduled scans, watchdog scans, executor-backed execution, and cancelation
* `backend/app/services/stats_cache.py` provides in-memory cache helpers for dashboard and library statistics

## 11.2 Frontend

Implemented frontend structure:

* `frontend/src/App.tsx` wires routing and providers
* `frontend/src/lib/app-data.tsx` manages cached app settings, dashboard, and library data
* `frontend/src/lib/scan-jobs.tsx` manages active scan polling state
* page modules under `frontend/src/pages/` implement dashboard, settings/libraries, library detail, and file detail views
* `frontend/src/lib/desktop.ts` exposes the optional Electron preload bridge used by desktop builds

Desktop packaging structure:

* `desktop/main.cjs` boots Electron, starts the packaged backend, waits for `/api/health`, and opens the local app window
* `desktop/preload.cjs` exposes the safe desktop bridge for native folder selection
* `desktop/scripts/build-backend.mjs` builds the Python backend sidecar for packaging

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
  * a bundled `ffprobe` binary per target platform

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
* `FFMPEG_PATH`
* `SCAN_RUNTIME_WORKER_COUNT`
* `DISABLE_DEFAULT_IGNORE_PATTERNS`
* `PUID`
* `PGID`

Additional behavior:

* the backend defaults to serving on port `8080`
* `PUID` and `PGID` support shared-folder or NAS permission setups
* `FFPROBE_PATH` can override the ffprobe binary
* `FFMPEG_PATH` can override the ffmpeg binary used for perceptual duplicate hashing
* `MEDIALYZE_RUNTIME=desktop` switches the backend to local desktop defaults such as `127.0.0.1` binding and OS-specific config storage
* `FRONTEND_DIST_PATH` can point the backend at an explicit built frontend bundle, which is used by desktop packaging

---

# 13. CI, Releases, And Versioning

## 13.1 GitHub Actions

Current workflows include:

* dev image publishing
* official release publishing
* dev desktop artifact builds
* desktop release artifact publishing
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

* dev images are pushed from `dev` as `linux/amd64` only to keep the development image workflow faster
* official images and GitHub releases are published from `main` only when a push increases the aligned repository version metadata
* official images are published to GHCR as multi-arch images for `linux/amd64` and `linux/arm64`
* the official release workflow creates the matching `vX.Y.Z` tag and GitHub release from that `main` commit
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

Bug-fix expectation:

* when fixing a bug, add or update an automated test that reproduces the failure mode and verifies the fix whenever reasonably possible
* prefer regression tests that would have failed before the fix, so the bug remains reproducible in CI and future refactors cannot silently reintroduce it

---

# 16. Working Rules For Agents

When updating documentation, code, or behavior in this repository:

* describe implemented behavior as implemented behavior
* describe backlog items as backlog
* do not resurrect outdated architectural labels from early versions
* verify claims against code, tests, workflows, or GitHub release metadata
* when a user reports a bug or a runtime/build failure, treat a reproducing or regression test as part of the expected fix unless the issue cannot be meaningfully covered by automation
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
