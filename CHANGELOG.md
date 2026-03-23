# Changelog

All notable changes to this project will be documented in this file.

## vUnreleased

### ✨ New
- Added global, configurable resolution categories in App Settings so grouped buckets like `4k`, `1080p`, or custom labels can be renamed, reordered, added, and removed
- Switched resolution statistics, metadata resolution search, file-detail resolution badges, and resolution quality scoring to use the shared resolution-category configuration

### 🐛 Bug fixes
- Fixed the release automation so desktop installers are built from the tagged release ref and the desktop release workflow is triggered explicitly after publishing a GitHub release, ensuring `.dmg`, `.exe`, and `AppImage` assets attach reliably
- Refreshed active scan jobs immediately when the web UI loads and tightened scan polling so Docker/server scans show their banner and progress sooner
- Switched SQLite runtime sessions to `NullPool` to avoid connection-pool exhaustion during scans and concurrent API polling
- Changed `ffprobe` failures to use `-v error` and a cleaner fallback message so scan logs no longer collapse to `RuntimeError: {`

## v0.2.3

>2026-03-21

### ✨ New
- Added a native Electron-based desktop distribution path for Windows, macOS, and Linux that runs the existing FastAPI + React stack locally with a bundled backend sidecar
- Added desktop path inspection and absolute-path library support so local folders, mounted network shares, and Windows UNC paths can be selected outside Docker
- Added release metadata and GitHub Actions scaffolding for desktop packaging, including per-platform release artifacts and dev desktop build jobs
- Added generated desktop app icons for Windows, macOS, and Linux from the shared `frontend/public/favicon.svg` source asset so release builds attach branded installers instead of default Electron icons
- Added Tiny Media Manager recycle folders under `*/.deletedByTMM/*` to the built-in default ignore patterns

### 🐛 Bug fixes
- Restricted desktop watch mode to local paths and automatically fell back to scheduled scans for network locations
- Suppressed per-file `ffprobe` console windows on Windows desktop scans so analysis no longer flashes terminal windows for each media file
- Improved Windows desktop `ffprobe` handling for network-path scans and surfaced the actual `ffprobe` error text in scan failures
- Forced packaged desktop builds to prefer the bundled `ffprobe` over any inherited `FFPROBE_PATH` environment override
- Fixed local Windows desktop backend builds to use the active virtualenv Python instead of failing on a missing `python3` alias

## v0.2.2

>2026-03-18

### ✨ New

- Added **clickable library statistic** counts so matching analyzed-files table filters can be applied directly from the Library detail page
- Added **CSV export** for the full analyzed-files result set, including the active filters and sort order in the exported file header
- Added a feature flag for the analyzed-files CSV export button, disabled by default and positioned below the title on smaller screens
- **Expanded HDR10+ detection** so more `ffprobe` metadata variants are recognized during analysis

### 📚 Documentation

- Refreshed the README with current screenshots, updated project-status copy, and a star-history chart
- Reworked `AGENTS.md` to document the actual current `dev` branch behavior, release chronology, runtime architecture, and repository layout

### 🐛 Bug fixes

- Closed the metadata search picker immediately after choosing a filter, so it no longer stays open until an extra outside click
- Replaced existing analyzed-files metadata values when a new statistic filter from the same category is selected, instead of duplicating the search field
- Improved the scan-log failures UI so failed files stay readable and show their analysis error on demand
- Hid container placeholder directories like `cdrom`, `floppy`, and `usb` in the path browser while keeping explicit mounted media paths visible

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

[@MSCodeDev](https://github.com/MSCodeDev)

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
