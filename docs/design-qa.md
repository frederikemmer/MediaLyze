# Design QA: current reference

[Documentation home](README.md)

This page consolidates the former root `design-qa.md` and this file. It describes the current implementation rather than preserving a sequence of completed visual reviews. The hidden `/ui-elements` route is the canonical visual inventory; the frontend source and tests are authoritative for behavior. The design decisions in `AGENTS.md` record the wider migration history.

The earlier QA reports referred to local browser captures, `prototypes/` images, and machine-specific ImageGen paths that are not available in this repository. Their historical pass counts and "no findings" conclusions are not claims about the current build. The sections below retain the useful design and interaction checks, reconciled with the current source.

## Storage Map

**Current implementation:** `frontend/src/pages/StorageMapPage.tsx`, the `.storage-map-*` rules in `frontend/src/medialyze.css`, `frontend/src/pages/StorageMapPage.test.tsx`, and the `Storage map explorer` entry in `/ui-elements`.

- The treemap assigns each tile an area based on storage use. The selected color metric supplies `--storage-map-tile-color`. Folder tiles with multiple represented colors can add a blurred, clipped color field; single-color folders and files use their solid metric color. Tile copy stays above the decorative field.
- The tile button has an accessible name while its visual copy is decorative. File tiles open file details; folder tiles descend into that folder. Hover and keyboard focus keep a visible outline and preserve the tile's metric color, including in dark theme.
- Container queries progressively remove size and metric text as a tile shrinks. The name remains while it fits; all visible copy is hidden below 42 px width or 28 px height. Long names wrap where space permits and fade at the right edge.
- The shared `TooltipTrigger` displays a structured metadata card after an 80 ms hover delay. It is not pinned on click and uses automatic viewport placement. The card gives the full name, active metric, and available technical details without changing tile navigation.
- The `/ui-elements` example includes mixed-color folder, compact file, and tooltip states. When this pattern changes, compare those states in light and dark themes and at a narrow viewport; also check folder/file navigation and keyboard focus.

The old reports document two resolved implementation traps: an all-or-nothing label measurement hid usable names, and a generic dark-theme tooltip background overrode tile colors. The current container-query rules and scoped `.storage-map-treemap .storage-map-tile.tooltip-trigger` background rule address them. Do not reintroduce either behavior while simplifying styles.

## Transcoding workspace and job views

**Current implementation:** `frontend/src/components/TranscodingPanel.tsx`, `frontend/src/components/TranscodingSettingsPanel.tsx`, `frontend/src/components/TranscodeProfilesRulesPanel.tsx`, their related tests and styles, and the Transcoding examples in `/ui-elements`.

- The workspace uses compact underline tabs for Presets and Accelerators. Rules and Members remain implemented but hidden by the current release switches; internal implementation terminology may still use Profiles. Its heading help is contextual to the selected tab. The capability matrix owns accelerator details rather than duplicating them in the Members view.
- The transcoding job view keeps status, progress, source-to-target details, and speed history readable at desktop and narrow widths. Table cells retain table layout semantics; content inside cells handles long hardware labels and filenames. Column resizing and links to file details remain available where applicable.
- Job detail disclosures start in the state defined by the current component, not by the early September screenshots. Verify collapsed and expanded content, status changes, sparse speed samples, and long values against current fixtures before changing those views.
- Shared controls, spacing, typography, and focus treatment come from `frontend/globals.css`, `frontend/src/medialyze.css`, neighboring pages, and `/ui-elements`. Avoid reviving the former sliding-pill treatment for the automation tabs; it remains intentional for other toggle groups.

## Federation members and pairing

**Release visibility:** retained implementation, hidden in the shipped frontend. Refer to [unreleased implementation notes](internal/unreleased-transcoding.md) before testing or enabling it.

**Current implementation:** `frontend/src/components/TranscodeFederationPanel.tsx`, `frontend/src/components/TranscodingSettingsPanel.tsx`, the relevant styles and tests, the `Federation members tab` example in `/ui-elements`, and the Federation design decision in `AGENTS.md`.

- Trusted members live in the Members tab. The Federation panel holds connection, discovery, local address, and pairing controls. Member rows use the same compact expandable-list language as profiles and rules, with status and quick actions kept visible.
- Discovered peers ask for a pairing code next to Connect. Manual pairing adds an address field before the code and Connect action. The address and code fields share a compact segmented treatment; the manual plus marker sits outside the group. Missing-code feedback stays on the code segment, including its rounded first-position corners.
- Local addresses use a flat list with copy actions. Member details show available accelerators with links into the matrix; endpoint and connection-status fields are intentionally absent from that detail view.
- Recheck focus, `aria-expanded`/`aria-invalid`, empty-code validation, long names/addresses, narrow stacking, and light/dark contrast whenever the pairing controls or rows change. Historical pixel measurements from one browser capture are not a current layout contract.

## Quality and compatibility profiles

**Current implementation:** `renderQualityProfilesPanel()` in `frontend/src/pages/LibrariesPage.tsx`, `frontend/src/components/CompatibilityProfilesPanel.tsx`, their tests and styles, and the profile-list examples in `/ui-elements`.

- Quality profiles use compact media-type tabs and an expandable profile list. Profile metadata sits beside the name when space permits. Metric sections expand inside the profile surface without a second bordered panel.
- Hardware, software, and combination profiles use the same compact underline navigation and one searchable, expandable list surface. Their existing profile actions and editors remain available.
- Development guidance for compatibility profiles is available from the heading's shared tooltip instead of occupying permanent page space. Check the tooltip through keyboard focus as well as pointer hover.
- Keep profile rows compact, preserve readable names and metadata when they wrap, and compare expanded/collapsed, empty, disabled, hover, focus, light/dark, and narrow states in `/ui-elements` when editing these patterns.

## Table scores and grouped media

`TableQualityScore.tsx` renders a colored numerator with neutral `/10` in library and metadata-comparison tables. Score meters and their UI toggle have been retired; the stored flag remains for configuration compatibility. Series and season buttons align left, use file-name font size, and center their text beside the chevron. The ordinary/grouped table examples in `/ui-elements` are the reference.

## Verification for future visual changes

The reports merged here were snapshots of earlier work, not a substitute for fresh QA. For a visual change, inspect the affected route and matching `/ui-elements` entry, run the relevant frontend checks and build, and record any unavailable visual or runtime verification in that change's report. Update the catalog entry in the same change set as the component or style.
