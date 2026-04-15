# Changelog

All notable changes to this project will be documented in this file.

## vUnreleased

## v0.7.1

>2026-04-15

### ✨ New

- add a `full scan` header action to the `Configured libraries` settings panel so all configured libraries can be queued for a manual full rescan at once
- move configured-library path and summary metadata into a title tooltip in Settings and reposition the library type / scan-mode badges beside the title with responsive wrapping
- add a per-library dashboard visibility toggle in Settings so selected libraries can be excluded from dashboard totals, distributions, and comparison panels

### 🐛 Bug fixes

- broaden ffprobe-based spatial-audio detection so additional explicit Atmos metadata variants beyond `stream.profile` are recognized during analysis; existing libraries may need a full rescan to refresh previously analyzed files ([#107](https://github.com/frederikemmer/MediaLyze/issues/107))

## v0.7.0

>2026-04-14

### ✨ New

- add configurable metric-comparison statistic panels on the dashboard and library detail pages, with two-axis selection, heatmap / scatter / bar renderers, and dedicated comparison API endpoints for direct context such as `size` versus `duration` ([#102](https://github.com/frederikemmer/MediaLyze/issues/102))
- extend metric-comparison charts with a numeric `Resolution - MP` axis option, show the active renderer icon directly in the toolbar button, and add an App Settings control for the scatter-plot sample limit ([#102](https://github.com/frederikemmer/MediaLyze/issues/102))
- add inline statistic-panel layout editing on the dashboard and per-library detail pages, including a visible `Dashboard` page title, animated edit controls, add-panel menus, drag-and-drop reordering, per-panel resize controls, and browser-persisted layouts for each page context
- add curated first-run default layouts for dashboard and library statistic panels, allow intentionally empty saved panel layouts, and add a `History` restore-default action to the inline layout toolbar
- add a new `unlimited panel size` feature flag that removes the current 4-row height cap for dashboard and library statistic panels while still keeping panel width constrained by the underlying 4-column grid
- simplify the former `Library statistics` settings block into a `Table View` section that now only manages analyzed-files table columns and tooltips, while `Bitrate` and `Audio bitrate` can also be enabled as table columns

### 🐛 Bug fixes

- remount statistic charts when resized smaller so comparison and histogram panels redraw correctly after inline panel-size changes, restore top-aligned list panels, and make newly added statistic panels default to `1x2`
- align dashboard and library statistic layout controls with the existing header-style button design language so Darkmode no longer renders bright low-contrast white action circles
- bundle macOS desktop `ffprobe` dependencies into the packaged app and rewrite non-system `dylib` loader paths so scans no longer fail on machines without the original Homebrew cellar layout
- make dashboard statistic panels behave as non-interactive read-only summaries again instead of hinting at missing cross-library drill-downs; only scatter points in dashboard comparison panels still open file details ([#104](https://github.com/frederikemmer/MediaLyze/issues/104))

## v0.6.0

>2026-04-12

### ✨ New

- add reusable Apache ECharts histogram panels for `Quality score`, `Runtime`, `File size`, `Bitrate`, and `Audio bitrate` in both the dashboard and library statistics, with local count/percent toggles and clickable library bins that apply matching analyzed-files range filters

### 🐛 Bug fixes

- extend structured numeric analyzed-files filters to support comma-separated `AND` ranges such as `>=4GB,<8GB`, including the new bitrate-based search fields used by the histogram panels
- include `desktop/ffprobe-paths.cjs` in packaged Electron app builds and add desktop packaging regression tests so macOS startup no longer fails with `Cannot find module './ffprobe-paths.cjs'` ([#99](https://github.com/frederikemmer/MediaLyze/issues/99))

## v0.5.0

>2026-04-10

### ✨ New

- add lightweight analyzed-files codec tooltips that lazy-load per-file video, audio, and subtitle stream details, including language, codec, channel layout, and subtitle source metadata, and make table tooltip visibility configurable per statistic column in App Settings ([#93](https://github.com/frederikemmer/MediaLyze/issues/93))
- add first-class spatial-audio support for `Dolby Atmos` and `DTS:X`, including ffprobe profile detection, analyzed-files filtering and sorting, library statistics, CSV export, and audio tooltip/detail rendering ([#94](https://github.com/frederikemmer/MediaLyze/issues/94))
- add container statistics and analyzed-files container filtering, sorting, CSV export, and configurable table/panel visibility for library views ([#97](https://github.com/frederikemmer/MediaLyze/issues/97))
- rework the file-detail page so the `Format` panel renders structured metadata rows instead of raw format JSON, and make all detail panels globally collapsible and reorderable with browser-persisted state
- allow `Container`, `Spatial audio`, `Subtitle codecs`, and `Subtitle sources` to be enabled as optional dashboard statistic panels through the existing statistics settings
- update the default statistics preset for fresh installs to match the expanded dashboard/table layout while preserving already stored statistic settings on upgrades and only appending newly introduced options

### 🐛 Bug fixes

- keep analyzed-files tooltips exclusive so opening or scrolling to another table area closes stale codec and score tooltips instead of leaving multiple overlays on screen
- fix the desktop release build after `v0.4.1` by completing strict frontend test app-settings mocks for the new feature flags and replacing the Windows `ffprobe` bundle step's brittle Chocolatey install with a direct archive download plus retries
- reanalyze unchanged media files when external subtitle sidecars are added or removed so subtitle statistics and quality scoring stay in sync with internal subtitles ([#95](https://github.com/frederikemmer/MediaLyze/issues/95))

## v0.4.1

>2026-03-30

### ✨ New

- support `!` negation and comma-separated `AND` terms in analyzed-files metadata search filters ([#85](https://github.com/frederikemmer/MediaLyze/issues/85))
- add feature flags for a full-width `.media-app-shell` layout and hiding the analyzed-files quality score meter ([#91](https://github.com/frederikemmer/MediaLyze/issues/91))
- add Excel-like drag resizing for analyzed-files table columns, with widths persisted in browser storage ([#91](https://github.com/frederikemmer/MediaLyze/issues/91))

### 🐛 Bug fixes

- show complete audio and subtitle language lists in analyzed-files table cells and truncate them visually with ellipses when a resized column becomes too narrow

## v0.4.0

>2026-03-30

First "rough" implementation for detecting duplicate files. May break desktop install use v0.3.0 if it's not working properly.

### ✨ New

- add per-library duplicate detection with `off` (default), `filename`, `filehash`, `both` modes ([#16](https://github.com/frederikemmer/MediaLyze/issues/16))
- view and search through duplicates on library page
- scan performance tuning in `App settings` with separate controls for per-scan analysis workers and parallel library scans

### 🐛 Bug fixes

- rework scan execution so discovery streams files directly into analysis and duplicate workers, live progress reflects worker completion, and configured worker counts now affect real throughput
- stop auto-resuming or auto-queuing stale startup jobs, clear pending watchdog debounce requests on cancel, and improve failed scan diagnostics with copyable detailed error payloads
- tighten the duplicate and library-settings UI by capping visible duplicate variants with internal scrolling, aligning scan controls consistently, and making the `dev` desktop artifact build manual-only

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
