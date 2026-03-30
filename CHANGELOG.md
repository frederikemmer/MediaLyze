# Changelog

All notable changes to this project will be documented in this file.

## vUnreleased

### ✨ New

- add per-library duplicate detection with configurable `filename`, exact `filehash`, and combined `both` modes, persist both signatures in SQLite when needed, and expose duplicate groups with their originating detection method in the library detail view
- make the library duplicate panel collapsible, add inline duplicate search in the panel header, and tighten duplicate-group rendering to use less vertical space
- cap each duplicate group's visible variant list to roughly two and a half entries and keep the remaining matches available via internal scrolling
- move scan worker tuning into App Settings with separate limits for per-scan analysis workers and parallel library scans, including UI tooltips about RAM impact and enforced maximum values
- reorganize the App Settings layout into separated language, theme, scan-settings, and feature-flag sections, switch scan worker controls to dropdowns, and default parallel library scans to `2`

### 🐛 Bug fixes

- stop resuming stale `queued` and `running` scan jobs on app startup; previous-process leftovers are now marked `canceled` with a finish timestamp instead of becoming ghost resumes
- stop auto-queuing startup quality-recompute jobs in server mode so containers no longer begin with a stuck queued scan banner before the user explicitly triggers work
- clear pending watchdog debounce requests when active scans are canceled so stop actions do not immediately requeue replacement scans
- include per-file detailed failure diagnostics in scan logs and add a copyable troubleshooting payload for failed analysis or duplicate-processing entries
- make scan worker tuning actually drive scan throughput by applying the persisted App Settings limits to both per-library job concurrency and in-scan `ffprobe` worker pools
- stop auto-running the `dev` desktop artifact workflow on every push; desktop dev builds are now manual-only via `workflow_dispatch`
- stream discovered files directly into the analysis / duplicate worker queue so scans no longer wait for full discovery before processing, and report live discovery counts separately from worker progress in the active scan UI

## v0.3.0

>2026-03-26

### 🐛 Bug fixes
- restrict `main` release publishing to real version bumps so unchanged-version commits no longer try to recreate existing tags and releases
- allow adding new resolution categories from the settings UI without tripping the backend's immutable-id validation ([#71](https://github.com/frederikemmer/MediaLyze/issues/71))
- fix resolution quality-boundary updates in the library quality settings when `minimum` / `ideal` values are changed ([#72](https://github.com/frederikemmer/MediaLyze/pull/72)) - by [@eivarin](https://github.com/eivarin)
- keep Windows UNC network-share paths in their normal form for `ffprobe` so desktop scans analyze files on network shares instead of only listing them
- lower the default resolution-category minimum width and height thresholds by 5% so cropped widescreen encodes stay in their expected buckets, and document the relaxed defaults in the settings tooltip ([#79](https://github.com/frederikemmer/MediaLyze/issues/79))
- make desktop packaging always create the bundled `backend/ffprobe` structure, auto-detect `ffprobe` on the build machine, and use more robust packaged-path fallbacks at runtime before failing ([#80](https://github.com/frederikemmer/MediaLyze/issues/80))
- treat NAS snapshot symlink loops under `MEDIA_ROOT` as invalid paths so browse and library setup return `400` or skip the entry instead of crashing with a `500` ([#81](https://github.com/frederikemmer/MediaLyze/issues/81))

## v0.2.5

>2026-03-24

### ✨ New
- The browser now renders scan and library times in the user's local timezone

### 🐛 Bug fixes
- serialize API timestamps as explicit UTC `Z` values and restore SQLite datetime fields as UTC ([#66](https://github.com/frederikemmer/MediaLyze/issues/66))
- align clickable statistics with table - counted streams instead of files ([#67](https://github.com/frederikemmer/MediaLyze/issues/67))

## v0.2.4

>2026-03-23

### ✨ New
- feat: global, **configurable resolution categories** in App Settings
- feat: backend now uses the **shared resolution-category** configuration

### 🐛 Bug fixes
- show scan banner earlier through better polling
- lower default resolution-category minimum heights so cinema-scope and letterboxed releases still map to the expected width-based buckets

## v0.2.3

>2026-03-21

### ✨ New

- feat: native Electron-based desktop app 
- github: release workflows for Windows, macOS and Linux
- github: Docker images for `linux/amd64` & `linux/arm64` - by [@patrickjmcd](https://github.com/patrickjmcd)
- feat: Add `*/.deletedByTMM/*` default ignore pattern for Tiny Media Manager users

### 🐛 Bug fixes
- various bug related to desktop distribution

### 📚 Documentation
- local desktop build and packaging documentation
- expanded README with desktop setup, runtime behavior, and desktop deployment details

### New Contributors

[@patrickjmcd](https://github.com/patrickjmcd) in [#57](https://github.com/frederikemmer/MediaLyze/pull/57)

## v0.2.2

>2026-03-18

### ✨ New

- Added **clickable library statistic** counts so matching analyzed-files table filters can be applied directly from the Library detail page
- Added **CSV export** for the full analyzed-files result set, including the active filters and sort order in the exported file header
- Added a feature flag for the analyzed-files CSV export button, disabled by default and positioned below the title on smaller screens
- **Expanded HDR10+ detection** so more `ffprobe` metadata variants are recognized during analysis

### 🐛 Bug fixes

- Closed the metadata search picker immediately after choosing a filter, so it no longer stays open until an extra outside click
- Replaced existing analyzed-files metadata values when a new statistic filter from the same category is selected, instead of duplicating the search field
- Improved the scan-log failures UI so failed files stay readable and show their analysis error on demand
- Hid container placeholder directories like `cdrom`, `floppy`, and `usb` in the path browser while keeping explicit mounted media paths visible

### 📚 Documentation

- Refreshed the README with current screenshots, updated project-status copy, and a star-history chart
- Reworked `AGENTS.md` to document the actual current `dev` branch behavior, release chronology, runtime architecture, and repository layout

## v0.2.0

>2026-03-16

### ✨ New

- Added detailed **scan logs** with recent-job history with rich details
- Collapsible settings panels

### 🐛 Bug fixes

- Hid nested mount points and symlinks outside `MEDIA_ROOT` in the path browser so multi-directory Docker setups no longer expose invalid library targets
- Fixed visual-density scoring to accept both `,` and `.` decimals, support an explicit maximum threshold, and use actual file size to penalize bloated media even when bitrate metadata is misleading
- Fixed incremental scans to reanalyze files with incomplete metadata, remove files that became ignored or disappeared, and preserve short actionable ffprobe failure reasons in stored scan summaries

## v0.1.3

>2026-03-15

### ✨ New

- [@MSCodeDev](https://github.com/MSCodeDev) added a color theme setting with `System`, `Light`, and `Dark` modes, including persistent browser-side preference storage and automatic OS theme following in `System` mode.
- Tightened the analyzed-files table layout so audio language and subtitle language columns use less horizontal space.

### New Contributors

[@MSCodeDev](https://github.com/MSCodeDev) in [#40](https://github.com/frederikemmer/MediaLyze/pull/40)

## v0.1.2

>2026-03-13

### ✨ New

- Added a new `Feature flags` section under `App settings`.
- Added the `Show Dolby Vision Profiles` feature flag so Dolby Vision profile variants can be shown separately in Dynamic Range statistics and metadata views when explicitly enabled
- Added Dolby Vision profile extraction during `ffprobe` parsing for new scans, storing values like `Dolby Vision Profile 5/7/8` instead of only the generic Dolby Vision label
- Added a rescan tooltip for the Dolby Vision profile feature flag to clarify that installations used before `v0.1.1` may need a fresh scan

### 🐛 Bug fixes

- Preserved quality-score dynamic range normalization so stored Dolby Vision profile variants still map to the existing Dolby Vision quality tier

## v0.1.1

>2026-03-13

### ✨ New

- Added official GitHub release support with tag-driven publishing and curated release notes
- Added a release metadata validation script to keep Docker, backend, and frontend versions aligned
- Added release PR validation in GitHub Actions so version and changelog mismatches fail before merge

### 🐛 Bug fixes

- Switched official Docker publishing for `main` from branch-triggered builds to SemVer tag releases
- Updated the dev image workflow to derive its base version from Git tags instead of GHCR package APIs
- Normalized the repository version metadata to `0.1.1` ahead of the first official public release

## v0.1.0

>2026-03-13

### ✨ New

### 🐛 Bug fixes
