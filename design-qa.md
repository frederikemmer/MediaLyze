# Design QA: Organic Storage Map folder fields

## Visual truth and evidence

- Selected ImageGen source: `/Users/frederikemmer/.codex/generated_images/019fa7af-1da8-7832-a28e-5c7502c6ca4b/call_IhsivhxZTStdef16VQhS55B7.png`
- Source size: 1672 × 941; normalized comparison size: 1280 × 720.
- Desktop implementation: `/Users/frederikemmer/.codex/visualizations/2026/07/28/019fa7af-1da8-7832-a28e-5c7502c6ca4b/storage-map-organic-folder-gradient-implementation.jpg`
- Focused source/implementation comparison: `/Users/frederikemmer/.codex/visualizations/2026/07/28/019fa7af-1da8-7832-a28e-5c7502c6ca4b/storage-map-organic-folder-gradient-focus-comparison.png`
- Full source/live-data comparison: `/Users/frederikemmer/.codex/visualizations/2026/07/28/019fa7af-1da8-7832-a28e-5c7502c6ca4b/storage-map-organic-folder-gradient-full-comparison.png`
- Responsive evidence: `storage-map-tablet-implementation.jpg` at 768 × 900 and `storage-map-mobile-implementation.jpg` at 390 × 844 in the same visualization directory.

The connected test library currently contains files but no folder nodes. The real route therefore verifies the production layout, metric colors, and controls; the canonical `/ui-elements` fixture verifies the mixed-folder visual state. Backend and frontend tests verify that the fixture behavior is driven by the real byte-weighted distribution contract.

## Fidelity surfaces

- Layout and spacing: the field stays clipped to the exact folder tile and introduces no gaps, borders, or extra layout space.
- Color: folders with multiple represented colors render seven soft, overlapping fields across all four corners and interior positions. Field allocation is storage-weighted. Single-color folders and all files retain the existing solid metric color.
- Shape and image quality: a blurred, saturated color-field layer creates smooth organic transitions without raster assets, hard bands, or a horizontal directional bias.
- Typography and icons: tile labels, file/folder icons, adaptive text behavior, and the contextual up action remain unchanged and sit above the color layer.
- Responsiveness: desktop, tablet, and mobile captures show no overlap, clipping, or unusable controls. The field scales with the tile rather than the viewport.
- Accessibility and behavior: the decorative field is `aria-hidden` and pointer-events are disabled. The semantic button, keyboard focus, rich tooltip, folder drill-down, and file-detail navigation remain intact.

## Interaction and data checks

- 17 grouped color metrics remain available on the live page.
- Live audio-codec mode showed AAC and Dolby Digital Plus with distinct file colors and no alert state.
- Backend storage-map test verifies byte-weighted codec and dynamic-range distributions.
- Frontend tests verify mixed-folder radial fields, tooltip content, folder drill-down, file-detail navigation, and Jellyfin-name fallback behavior.
- Production build completed successfully.

## Comparison history

1. P2: the first implementation read as a broad horizontal ellipse and did not match the selected organic field direction.
2. P2: a nine-layer low-opacity pass removed the band but washed the categories into a muted surface.
3. Fix: moved the gradient to a dedicated blurred color-field layer, reduced field radii, placed distinct anchors at four corners and three interior positions, and retained deterministic storage weighting.
4. Post-fix evidence: the focused comparison shows separate but smoothly blended interior and corner regions with no directional stripe. No P0, P1, or P2 findings remain.

final result: passed

# Design QA: Transcoding automation navigation refinement (2026-09-09)

## Requested adjustment

- Implement the first selected concept as a compact horizontal navigation for Profiles, Rules, Accelerators, and Members.
- Keep the navigation slightly taller than the first compact pass, remove the extra line directly under the tabs, and retain the separator between the navigation row and its content.
- Replace the moving shared pill with a subtle per-tab active highlight.

## Visual truth and evidence

- Selected ImageGen source: `C:\Users\frede\.codex\generated_images\01a0850c-58ec-72b3-aa3f-1bc72c9f59db\exec-4d65c52d-4305-4c4b-8dd9-6e8c182bc509.png` (1417 × 1110).
- Implementation: `http://localhost:5175/settings?section=transcoding` in the Codex In-app Browser.
- Implementation capture: final In-app Browser screenshot at a 1624 × 1272 viewport; the browser surface exposes the capture inline rather than as a filesystem path.
- State: dark theme, Profiles selected, Federation expanded, with the same compact MediaLyze settings composition visible in the source reference.

## Fidelity surfaces

- Layout and spacing: the four destinations remain in one horizontal row, the row is compact but not flattened, and the `New profile` action stays aligned at the far right.
- Active state: the selected tab uses the MediaLyze accent underline and a restrained accent-tinted surface; the full-width tab-list line is removed.
- Content separation: the lower divider on the automation row remains, preserving a clear boundary before the active menu content.
- Typography and icons: existing MediaLyze typography, tooltip control, button treatment, profile actions, and Federation icons are preserved; no new raster or SVG assets were introduced.
- Responsiveness: the narrow-width overflow rules remain scoped to the tab list and keep the navigation usable without changing the page-level overflow behavior. A separate narrow browser capture was not available through the current In-app Browser surface.

## Interaction and accessibility checks

- All four destinations render as semantic `tab` controls inside a labeled horizontal `tablist`.
- Clicking tabs updates the selected state and swaps the active workspace content.
- Arrow-key navigation was checked in the browser; `Rules` advanced to `Accelerators` and focus/selection moved with it.
- Focus-visible styling remains available, inactive tabs are removed from the tab sequence, and the navigation keeps its existing tooltip and action controls.
- Console inspection was not exposed by the current In-app Browser surface; no console-specific claim is made here.

## Validation

- Full frontend suite: 42 test files, 417 tests passed.
- Production build: passed with `npm run build`.
- The stale test queries were updated from `button` to the new semantic `tab` role.
- The `/ui-elements` fixtures, `CHANGELOG.md`, and the frontend design decision history remain aligned with the new navigation pattern.

No P0, P1, or P2 findings remain.

final result: passed

# Design QA: Transcoding table fit and responsive chart refinement (2026-09-07)

## Requested adjustments

- Reduce the default Actions column and compact the left inset of the file status icon.
- Let the compact Speed chart follow the available Speed column width.
- Hide horizontal overflow when the table fits and use a transparent scrollbar track with only a rounded thumb when scrolling is required.

## Verification

- The default column distribution now totals 100%; the Actions column is 6% and the last resize handle stays inside the table boundary, so the desktop table has no horizontal overflow.
- A live Speed-column drag widened the column from about 177px to 342px and the chart from about 157px to 322px; double-click restored the standard width.
- At 390 × 844 the page remains within the viewport while the table alone exposes the required horizontal overflow. The computed scrollbar track is transparent and the thumb remains visible.
- The dark desktop preview at `http://127.0.0.1:5174/transcoding` shows the compact Actions column, reduced file inset, and expanded speed graphs. The `/ui-elements` fixture, changelog, and focused tests were updated.
- Final frontend validation passed: 41 test files, 407 tests, and production build.

final result: passed

# Design QA: Transcoding source-to-target metadata (2026-09-07)

## Requested adjustments

- Remove the Source → output, Time range, and Hardware status detail headings.
- Show which video codec and dynamic range are transformed from source to output.

## Verification

- Source video codec and dynamic range are supplied by the job API from the analyzed source file; target values come from the persisted transcoding plan.
- The dark preview at `http://127.0.0.1:5174/transcoding` shows compact Codec and Dynamic range mappings without the three removed headings.

final result: passed

# Design QA: Transcoding job center browser feedback refinement (2026-09-07)

## Requested adjustments

- Added visible separation between the status icon and the filename in each job row.
- Changed cancel and retry controls to borderless icon-only actions with a focus-visible outline and subtle hover surface.
- Removed the standalone expand/collapse chevron. The complete job row is now the disclosure target; clicking another row closes the previous detail row so exactly one job remains open.

## Verification

- Dark desktop preview at `http://127.0.0.1:5173/transcoding` shows the revised spacing, borderless action icon, and single-open-row behavior with the isolated QA data set.
- Clicking the second running row collapsed the first detail row and opened the second. The action button's computed style was `border: 0`, transparent background, and no box shadow.
- Light theme was checked through the existing App Settings control, then restored to dark for the deliverable preview.
- Narrow preview was checked at 390 × 844. The page itself stayed at viewport width while the 1050px job table remained contained in its horizontal scroll region (`pageScrollWidth=pageClientWidth=375`).
- The `/ui-elements` Transcoding job center fixture and targeted tests were updated to represent the new row interaction.

final result: passed

# Design QA: Transcoding job center (2026-09-07)

## Visual truth and evidence

- Source visual truth: `C:\Users\frede\AppData\Local\Temp\codex-clipboard-cea0c2a2-1430-4c42-8f0d-d5bef7bf8090.png`.
- Source size: 1471 × 1062.
- Implementation: `http://127.0.0.1:5173/transcoding` in the Codex In-app Browser.
- Implementation capture: final `tab.screenshot({ fullPage: false })` at an explicit 1471 × 1062 viewport; the CUA browser exposes the capture inline rather than as a filesystem path.
- State: dark theme, copied production SQLite data, one real `Test` library with eight real media records, and an isolated QA-only set of 3 running, 5 queued, 18 completed, and 1 failed transcode jobs. The source production database was not modified.

## Fidelity surfaces

- The new route uses the existing MediaLyze shell, panel surfaces, spacing tokens, typography, border radii, icon language, tabs, filters, and status colors. Existing routes and their layout were not changed.
- The primary navigation receives one additional Activity-style Transcoding entry; the icon-only treatment intentionally follows the current MediaLyze shell, while the supplied concept's labeled navigation remains reference material rather than a replacement for the existing structure.
- The page follows the supplied composition: status counters and add-jobs CTA, Active/History tabs, search and filters, a sortable-feeling job table, expanded speed/source/output/hardware detail, and a hardware-load strip.
- Long production filenames are clipped within their table cells, long hardware names truncate before the progress column, and the table remains horizontally scrollable at narrow widths.
- Lucide icons and Apache ECharts are reused; no invented raster, logo, or handcrafted SVG assets were introduced.

## Interaction and runtime evidence

- Add jobs opened against production media records in the copied database, allowed selecting multiple files, exposed the existing compatibility/storage/modern profiles, and enabled `Start 2 jobs` after two selections. The final submit was intentionally not clicked during QA because the copied records still point at real UNC source paths.
- Active polling showed 3 running and 5 queued jobs, live percent values, speed samples, ETA, detected NVIDIA/AMD hardware paths, CPU/software paths, cancellation controls, and an initially expanded job.
- History showed 18 completed and 1 failed job. The failed filter reduced the view to one item, and the expanded failed job exposed its retry action and NVENC diagnostic message.
- The speed chart collected repeated samples while the page stayed open and rendered a visible line in the compact and expanded forms.
- Final reload rendered the route and navigation successfully. Earlier ECharts disposal warnings were emitted only during hot-reload/theme/route iteration; none recurred in the final page load.

## Comparison history

1. P2: the first browser capture showed body table cells stacked inside the first column because cell elements themselves were changed to `display: flex/grid`.
   - Fix: retain `display: table-cell` on table cells and apply layout rules to their inner content.
2. P2: long hardware labels could visually reach into the adjacent progress column because a more-specific direct-span selector overrode the hardware flex row.
   - Fix: scope the direct-span rule to the secondary hardware line and preserve the hardware-main flex row.
3. P3: active queues initially sorted newer queued jobs above running jobs.
   - Fix: order running jobs first, then queued jobs, while retaining updated-time ordering within a state.
4. P3: a single unchanged speed sample produced an empty-looking line chart.
   - Fix: append a sample on each active polling refresh, capped to the recent 36 points.
5. Post-fix evidence: the matched-viewport comparison shows the running-job table, expanded detail, live speed chart, filters, status counts, and hardware identifiers in the same dark MediaLyze visual language as the supplied concept. No P0, P1, or P2 findings remain.

final result: passed

# Design QA: Transcoding detail surface refinement (2026-09-07)

## Requested adjustment

- Removed the nested visual panel around the expanded job details. The speed, source/output, elapsed-time, and hardware information now sit directly below the selected job row with the table's existing spacing and full available width.

## Verification

- The detail structure remains the same and row expansion behavior is unchanged; only the nested border, radius, background, and extra inner padding were removed.

# Design QA: Transcoding detail information refinement (2026-09-07)

## Requested adjustments

- Moved the source-file navigation into the main row actions as a borderless icon-only control beside stop/retry.
- Moved the FFmpeg log disclosure to the former source-link position and made its open state span the full detail width.
- Reduced source/output display values to filenames while retaining the complete paths in tooltips.
- Replaced the single elapsed value with a time range containing start time, duration so far, and ETA.
- Removed the speed-chart heading and page-open sampling copy so the chart has more room.

## Verification

- Targeted Transcoding tests, frontend build, and `git diff --check` passed.
- The dark preview at `http://127.0.0.1:5174/transcoding` shows the new row action, filename-only paths, time range, unobstructed chart, and full-width expanded FFmpeg log.

final result: passed

# Design QA: Transcoding default detail states (2026-09-07)

## Requested adjustments

- Keep the FFmpeg log collapsed on initial render.
- Stretch the expanded speed chart to the full size of its detail column so the row height is used instead of leaving unused space below the graph.

## Verification

- The catalog fixture now represents the closed default log state.
- The expanded chart wrapper, inner ECharts container, and SVG are configured to fill the speed-detail column in the live Transcoding page.

final result: passed

# Design QA: Transcoding table column resizing (2026-09-07)

## Requested adjustment

- Make the Transcoding table headers resizable like the Library Detail table.

## Verification

- All seven Transcoding columns expose the shared `column-resize-handle` with translated accessible labels and the same visible focus/hover treatment as the Library Detail table.
- A live drag on the File column changed its measured width from 470px to 570px; a double-click restored the 26% default width at 470px.
- Width overrides are stored under a Transcoding-specific browser-storage key so Library Detail preferences remain isolated.
- The `/ui-elements` Transcoding fixture and a focused persistence/drag test cover the new interaction.

final result: passed

# Design QA: Transcoding header and hardware-load refinement (2026-09-07)

## Requested adjustments

- Removed the redundant helper description and the separate job-summary group.
- Reused the shared status-metric pattern for running, queued, completed, and failed counts.
- Moved Hardware load beside the page title and reduced it to compact backend icons, labels, and slot dots with matrix-style detail tooltips.

## Verification

- The dark desktop preview at `http://127.0.0.1:5174/transcoding` shows the compact hardware controls and four status indicators in the Transcoding header; the old subtitle, summary box, and bottom hardware panel are absent.
- Clicking the NVIDIA hardware control opens a tooltip with status, slots, runtime backend, device, driver, encoder codecs, and decoder codecs.
- The 390 × 844 preview keeps the header content stacked without horizontal page overflow; the hardware controls remain available above the filters.
- The targeted Transcoding tests and build passed. The final full frontend run passed all 407 tests; an earlier transient failure in the unrelated Library Detail duplicate-reload test also passed when repeated in isolation.

final result: passed

# Design QA: Transcoding filename navigation and column minimums (2026-09-07)

## Requested adjustments

- Make the filename in each job row informational text rather than an asset link; keep asset navigation on the trailing icon action.
- Lower the resize minimums for the content columns so users can choose compact widths while long values remain ellipsized.

## Verification

- The live desktop preview renders the filename as a `strong` without an `href`; the trailing Open source file icon remains the only asset link in each row.
- Resize minimums are now 160px for File, 110px for Target, 120px for Hardware, 100px for Progress, 88px for Speed, and 72px for Time left. Actions remains at 100px for its two icon actions.
- Target, hardware, progress, speed, and time values retain overflow ellipses where space is intentionally reduced; static filenames no longer receive link hover styling.
- The `/ui-elements` fixture already represents the non-link filename and trailing icon action. Focused Transcoding tests, the full frontend suite, and the production build passed.

final result: passed

# Design QA: Transcoding speed-chart tooltip refinement (2026-09-07)

## Requested adjustment

- Reduce the expanded speed-chart hover tooltip and keep it within the chart so the table edge cannot cover it.

## Verification

- The live dark desktop preview now shows only the current speed value in a compact themed tooltip; the measured box was 44 × 27 px and remained fully inside the 685 × 141 px chart area.
- The chart-fill CSS is scoped to ECharts' actual canvas wrapper, so the tooltip is no longer stretched to the full chart size.
- The narrow 390 × 844 preview keeps the page free of global horizontal overflow, and the tooltip retains its compact size when the table's own horizontal scrolling is used.
- The focused Transcoding test and `git diff --check` passed.

final result: passed

# Design QA: Transcoding combined progress status (2026-09-07)

## Requested adjustment

- Merge the Progress, Time left, and Speed columns into one resizable status cell using the supplied metric, chart, and progress-track composition.

## Verification

- The live dark desktop preview shows the three values in one status cell, with the speed chart below and a full-width progress track at the bottom.
- Queued rows retain compact waiting states; file, target, hardware, actions, filters, row expansion, and the collapsed FFmpeg log remain unchanged.
- The `/ui-elements` fixture represents the merged five-column structure and the new status-cell pattern.
- The combined status column uses a 280px minimum and ellipsizes metric content when narrowed; the other existing column minimums remain unchanged.
- Focused and full frontend tests, the production build, locale parsing, and `git diff --check` passed.

final result: passed

# Design QA: Transcoding combined status density (2026-09-07)

## Requested adjustment

- Reduce the vertical height of the combined progress, time-left, and speed status cell so it aligns with surrounding Transcoding rows while keeping all three metrics, the chart, and progress track.

## Verification

- The live dark desktop preview shows the compact metrics/chart/track composition; the running row is reduced from the previous 193px to approximately 132px.
- Narrow preview remains free of global page overflow; only the table's own horizontal scroll remains.
- The speed tooltip remains compact and fully contained inside the shortened chart area.
- The UI catalog continues to represent the same compact five-column component.
- The focused Transcoding test, full frontend suite (41 files / 407 tests), production build, locale parsing, and `git diff --check` passed; the duplicate-groups test also passed in an isolated retry after one transient first-run timing failure.

final result: passed

# Design QA: Transcoding automation navigation height and accent fade (2026-09-09)

## Requested adjustment

- Keep the automation navigation consistently sized while moving through Profiles, Rules, Accelerators, and Members.
- Make the row slightly taller and soften the orange active-state glow so it fades rather than ending at a hard rectangular edge; extend the underline's falloff so it does not drop too quickly.

## Visual truth and evidence

- Selected ImageGen source: `C:\Users\frede\.codex\generated_images\01a0850c-58ec-72b3-aa3f-1bc72c9f59db\exec-4d65c52d-4305-4c4b-8dd9-6e8c182bc509.png` (1417 × 1110).
- Implementation: `http://localhost:5173/settings?section=transcoding` in the Codex In-app Browser.
- Implementation capture: final In-app Browser screenshot at a 1624 × 1272 viewport; the browser surface exposes the capture inline rather than as a filesystem path.
- Comparison state: dark theme, Profiles selected, Federation expanded; the reference and final implementation were opened and reviewed in the same QA pass.

## Fidelity surfaces

- Typography and icons: existing MediaLyze type scale, weights, tooltip icon, refresh icon, and action icons remain unchanged and aligned.
- Spacing and layout: the automation row now has a 40px minimum height, so trailing actions and tab content cannot make the top navigation jump between views; the separator before the content remains.
- Colors and tokens: the selected tab uses the existing accent token with a broader blurred radial fade behind the label and a longer, gradual underline whose ends taper into transparency; inactive tabs retain the muted token.
- Content and surfaces: Profiles, Rules, Accelerators, and Members remain visible in the same order, with the selected state isolated to the active tab and no extra tab-list border.
- Responsiveness: the existing narrow-width rule keeps the tab list horizontally scrollable and the action group usable. A separate narrow browser capture was not available through the current In-app Browser surface.
- Image quality and asset fidelity: no new image assets were needed; existing MediaLyze logo and icon assets remain in use.

## Interaction and accessibility checks

- Semantic `tablist`/`tab` structure remains intact with one selected tab and roving tab focus.
- Clicked through Rules, Accelerators, and Members in the browser; each active accent followed the selected tab and the content changed without row-height drift.
- Arrow-key navigation was previously verified for the same control group; focus and selection move together.
- Focus-visible styling remains available, and the active glow is pointer-events-free.
- Console inspection was not exposed by the current In-app Browser surface; no console-specific claim is made here.

## Validation

- Focused frontend tests: 2 test files, 10 tests passed.
- Full frontend suite: 42 test files, 417 tests passed.
- Production build: passed with `npm run build`.
- `git diff --check`: no whitespace errors; only the repository's existing line-ending normalization warnings.

No P0, P1, or P2 findings remain.

final result: passed

# Design QA: Federation member pairing control parity (2026-09-09)

## Requested adjustment

- Give the manual federation pairing row the same spacing and compact pairing-code/Connect grouping as automatically discovered peers, including the small vertical divider.

## Visual truth and evidence

- Source: the user-supplied Members-tab screenshots and selected pairing-code/Connect controls at `http://localhost:5173/settings?section=transcoding` (1624 × 1272).
- Reference context: the existing MediaLyze Transcoding layout and the ImageGen source at `C:\Users\frede\.codex\generated_images\01a0850c-58ec-72b3-aa3f-1bc72c9f59db\exec-4d65c52d-4305-4c4b-8dd9-6e8c182bc509.png` (1417 × 1110).
- Implementation: the same route in the Codex In-app Browser; final capture at a 1624 × 1272 viewport with Members selected and Federation expanded.

## Fidelity surfaces

- Layout: the manual form now keeps the endpoint flexible on the left and places pairing code plus Connect in an auto-sized group on the right, separated by the same 12px gap used by discovered peers.
- Group styling: the manual code input reuses `.transcode-federation-peer-code-input`, so it shares the discovered-peer container border, radius, background, and compact height.
- Divider: the manual Connect button reuses `.transcode-federation-peer-connect-control .transcode-federation-connect-button`, including its subtle left border.
- Typography, icons, and tokens: existing settings inputs, shared Connect button styling, animated connection icon, and MediaLyze color tokens remain in use; no new assets were added.
- Responsiveness: the mobile rule keeps the manual pairing group full-width when the form stacks; no separate narrow browser capture was available through the current In-app Browser surface.

## Interaction and accessibility checks

- The manual pairing input retains its accessible `Pairing code` label, numeric input constraints, validation state, and existing state handlers.
- Connect remains a semantic button with its existing disabled and pairing behavior; no pairing action was triggered during visual QA.
- The live Members tab shows the manual and discovered controls with matching compact grouping and the vertical divider visible.

## Validation

- Focused frontend tests: 2 test files, 10 tests passed.
- Vite production bundle: passed with `npx vite build`.
- `npm run build` remains blocked by unrelated pre-existing TypeScript errors in `frontend/src/lib/settings-search.ts:79`; the requested component bundle itself completed successfully.
- `git diff --check`: no whitespace errors; only the repository's existing line-ending normalization warnings.

No P0, P1, or P2 findings remain for this requested UI change.

final result: passed

# Design QA: Federation manual plus marker separation (2026-09-09)

## Requested adjustment

- Keep the manual plus marker vertically centered and remove the grouped field border/background from around it.

## Visual truth and evidence

- Source: user-supplied Members-tab screenshot and selected manual `Connect` control at `http://localhost:5173/settings?section=transcoding` (1624 × 1272).
- Reference context: existing MediaLyze flat Federation list rows and inspected ImageGen source at `C:\Users\frede\.codex\generated_images\01a0850c-58ec-72b3-aa3f-1bc72c9f59db\exec-4d65c52d-4305-4c4b-8dd9-6e8c182bc509.png` (1417 × 1110).
- Implementation: same route in the Codex In-app Browser with Members selected, Federation expanded, and manual pairing row visible after the local dev server was restored.

## Fidelity surfaces

- The plus marker is now a direct sibling of the grouped address/code/Connect control, so no rounded/bordered segment surrounds it.
- Desktop marker uses the row's centered alignment; the grouped control remains 32px high and the address input still begins at the shared name column.
- Narrow-width rules keep the marker beside the stacked group and align it with the first address segment.

## Interaction and accessibility checks

- Plus remains `aria-hidden` decorative icon; address and pairing fields retain existing accessible labels and behavior.
- No pairing, disconnect, or persistent Federation mutation was triggered during QA.

## Validation

- Focused frontend test: `TranscodeProfilesRulesPanel.test.tsx`, 4 tests passed.
- Vite production bundle: passed with `npx vite build`.
- Browser measurement: marker is a direct child of `.transcode-federation-manual-item`, the grouped control has no marker child, and the desktop marker is vertically centered.
- `git diff --check`: no whitespace errors; only repository line-ending normalization warnings.

No P0, P1, or P2 findings remain for this requested UI change.

final result: passed

# Design QA: Federation member row height parity (2026-09-09)

## Requested adjustment

- Make the trusted Federation member entries match the discovered-peer and manual-pairing entries in height so the shared Members workspace reads as one consistent list.

## Visual truth and evidence

- Source: the user-supplied Members-tab screenshot and selected `MacBook Pro` row at `http://localhost:5173/settings?section=transcoding` (1624 × 1272).
- Reference context: the existing MediaLyze compact list-row pattern and the ImageGen source at `C:\Users\frede\.codex\generated_images\01a0850c-58ec-72b3-aa3f-1bc72c9f59db\exec-4d65c52d-4305-4c4b-8dd9-6e8c182bc509.png` (1417 × 1110).
- Implementation: the same route in the Codex In-app Browser; final capture with Members selected and Federation expanded.

## Fidelity surfaces

- Row sizing: the three visible Federation entries now share a measured 38px outer row shell.
- Inner alignment: the trusted member trigger shell and trigger use the same 32px compact content height as the discovered pairing control and manual pairing control.
- Spacing and content: status marker, member name, summary, chevron, quick actions, plus markers, pairing fields, and Connect actions retain their existing positions and tokens.
- Responsiveness: the fixed inner height is limited to the compact trigger shell; expanded details remain outside that shell and the existing narrow-width rules remain unchanged. No separate narrow browser capture was available through the current In-app Browser surface.

## Interaction and accessibility checks

- The member remains a semantic expandable button with its existing `aria-expanded` state and keyboard behavior.
- Status tooltip, sync, disconnect, discovered pairing, and manual pairing controls remain available; no pairing or disconnect action was triggered during QA.
- Browser measurement confirmed `outerRows: [38, 38, 38]`, `memberShell: 32`, and `peerControl: 32` for the visible list.

## Validation

- Focused frontend test: `TranscodeProfilesRulesPanel.test.tsx`, 4 tests passed.
- Vite production bundle: passed with `npx vite build`.
- The adjacent two-file test command still has 2 existing failures in `TranscodingSettingsPanel.test.tsx` caused by stale manual-pairing selectors and fixture expectations outside this CSS-only adjustment.
- `git diff --check`: no whitespace errors; only the repository's existing line-ending normalization warnings.

No P0, P1, or P2 findings remain for this requested UI change.

final result: passed

# Design QA: Federation manual address field parity (2026-09-09)

## Requested adjustment

- Match the manual Federation address field to the Pairing code field and make its visible/text start align with the name column used by the other Federation entries.

## Visual truth and evidence

- Source: the user-supplied Members-tab screenshot and selected manual `Connect` control at `http://localhost:5173/settings?section=transcoding` (1624 × 1272).
- Reference context: the existing MediaLyze compact segmented-control treatment and the inspected ImageGen source at `C:\Users\frede\.codex\generated_images\01a0850c-58ec-72b3-aa3f-1bc72c9f59db\exec-4d65c52d-4305-4c4b-8dd9-6e8c182bc509.png` (1417 × 1110).
- Implementation: the same route in the Codex In-app Browser with Members selected, Federation expanded, and the manual pairing row visible.

## Fidelity surfaces

- The manual address input now uses the same compact segment class, dark/light surface cascade, border, shadow, typography, and 30px height as the Pairing code input.
- The plus marker remains in its own leading slot; the address field starts at x=403, matching the discovered Federation name start at x=403.
- The manual code and Connect segments, their divider, and the shared 32px control height remain unchanged.
- The existing narrow-width rules still stack the manual controls without changing their shared segment treatment; no separate narrow browser capture was available through the current In-app Browser surface.

## Interaction and accessibility checks

- The address field keeps `type="url"`, its existing placeholder and accessible label, and the existing disabled/onChange behavior.
- Pairing-code validation and Connect behavior remain unchanged.
- No pairing, disconnect, or federation mutation was triggered during QA.

## Validation

- Focused frontend test: `TranscodeProfilesRulesPanel.test.tsx`, 4 tests passed.
- Vite production bundle: passed with `npx vite build`.
- The adjacent `TranscodingSettingsPanel.test.tsx` suite still has 2 existing stale selector/fixture failures outside this styling change.
- Browser measurement confirmed identical address/code background and metrics, plus `addressStart - peerNameStart = 0`.
- `git diff --check`: no whitespace errors; only the repository's existing line-ending normalization warnings.

No P0, P1, or P2 findings remain for this requested UI change.

final result: passed

# Design QA: Federation invalid pairing-code contour (2026-09-09)

## Requested adjustment

- Keep the red empty-code feedback on the discovered Pairing code field, but make its left corners follow the grouped control instead of ending as a clipped rectangle.

## Visual truth and evidence

- Source: the user-supplied Members-tab screenshot and selected empty `Pairing code` field at `http://localhost:5173/settings?section=transcoding` (1624 × 1272).
- Reference context: the existing MediaLyze compact segmented-control treatment and the inspected ImageGen source at `C:\Users\frede\.codex\generated_images\01a0850c-58ec-72b3-aa3f-1bc72c9f59db\exec-4d65c52d-4305-4c4b-8dd9-6e8c182bc509.png` (1417 × 1110).
- Implementation: the same route in the Codex In-app Browser with Members selected, Federation expanded, and the discovered Connect action pressed while its Pairing code is empty.

## Fidelity surfaces

- The first segment's invalid state now uses an 8px inner top-left and bottom-left radius, matching the 9px outer grouped control minus its 1px border.
- The animated red border and glow remain local to the Pairing code segment; the neighboring Connect segment keeps its normal surface and divider.
- The manual middle Pairing code segment remains square at its segment joins, while the existing narrow-width stacking rules remain unchanged.

## Interaction and accessibility checks

- Empty-code validation still adds `is-invalid` and keeps the existing `aria-invalid` state; no pairing request is sent for an empty code.
- The reduced-motion invalid-state rule retains the same rounded first-segment geometry.
- No federation connection, disconnect, or other persistent mutation was triggered during QA.

## Validation

- Focused frontend test: `TranscodeProfilesRulesPanel.test.tsx`, 4 tests passed.
- Vite production bundle: passed with `npx vite build`.
- Browser reproduction before the fix showed `borderRadius: 0px` on the invalid first segment and a clipped rectangular glow; after the fix it measured `8px 0px 0px 8px` with the same 2px glow and the parent remained `9px`/`overflow: hidden`.
- `git diff --check`: no whitespace errors; only the repository's existing line-ending normalization warnings.

No P0, P1, or P2 findings remain for this requested UI change.

final result: passed

# Design QA: Quality profile metric surface refinement (2026-09-09)

## Requested adjustment

- Remove the redundant inner panel around the metric rows inside an expanded quality profile.

## Visual truth and evidence

- Source: the user-supplied annotated screenshot at `http://localhost:5173/settings?section=quality-profiles` (1624 × 1272), with the nested metric list selected.
- Implementation: the same local route in the Codex In-app Browser after the CSS refinement, at the same 1624 × 1272 viewport.
- State: dark theme, Video tab selected, Default video expanded, metric sections collapsed after the hot reload; Resolution was also expanded once to verify the nested editor state.
- The browser surface exposed the implementation captures inline rather than as filesystem paths; source and implementation use the same viewport and page chrome, so no density normalization was required.

## Fidelity surfaces

- Fonts and typography: existing MediaLyze heading, profile metadata, metric labels, weights, and helper text remain unchanged; only the unnecessary nested surface was removed.
- Spacing and layout: metric rows now sit directly inside the expanded profile details with their existing row padding and separators; the outer profile list remains the single enclosing surface.
- Colors and visual tokens: the metric list is transparent in both themes, so the profile surface and existing theme-aware separators provide the visual grouping without a second dark card.
- Image quality and asset fidelity: no raster or custom visual asset is used; existing Lucide icons and shared controls remain intact.
- Copy and content: profile names, media tabs, metric labels, weights, and action labels are unchanged.
- Responsiveness: the change is surface-only and preserves the existing compact metric-row and transcode-tab responsive rules; a separate narrow browser capture was not available through the current In-app Browser surface.

## Interaction and accessibility checks

- The accessibility tree still exposes every metric as a separate `Configure … metric` disclosure button.
- Clicking `Configure Resolution metric` visibly opened the three resolution controls; the profile row and metric disclosure states remained semantic and keyboard-addressable.
- No profile save, duplicate, delete, rename, or other persistent mutation was triggered during QA.

## Comparison history

1. P2: the first implementation wrapped the metric list in a second bordered, rounded surface inside the already bordered expanded profile.
2. Fix: removed the metric-list border, radius, and background while retaining the metric row separators and expanded settings styling.
3. Post-fix evidence: the revised browser capture shows the metric rows flush within the expanded profile surface, with no redundant inner panel and no loss of the expandable editor affordance. No P0, P1, or P2 findings remain.

## Validation

- Focused frontend tests: `LibrariesPage.test.tsx` and `App.test.tsx`, 81 tests passed.
- Vite production bundle: passed with `npx vite build`.
- The full TypeScript build remains blocked by the unrelated pre-existing `api.testTranscodeFederationNetwork` type mismatch in `TranscodingSettingsPanel.tsx`; the targeted Quality profiles/App tests and Vite bundle pass.
- `git diff --check`: no whitespace errors; only the repository's existing line-ending normalization warnings.

final result: passed

# Design QA: Quality profile metadata alignment (2026-09-09)

## Requested adjustment

- Place profile metadata such as `Default · Built-in` beside the profile name instead of stacking it below the name.

## Visual truth and evidence

- Source: the user-supplied annotated screenshot at `http://localhost:5173/settings?section=quality-profiles` (1624 × 1272), with the `Default · Built-in` metadata selected.
- Implementation: the same local route in the Codex In-app Browser after the layout refinement, with Video selected and `Default video` expanded.
- State: dark theme, the compact media-type tabs visible, and the profile list using the shared Transcoding workspace row treatment.

## Fidelity surfaces

- Layout: the profile name and metadata now share one flex line with the existing chevron and quick-action columns unchanged.
- Typography and color: the existing profile-name weight, muted metadata styling, ellipsis behavior, and compact spacing remain intact.
- Responsiveness: the metadata and name can wrap as separate flex items only when the available row width is too narrow, preventing horizontal overflow while keeping the inline treatment at normal widths.
- Interaction: the profile row remains one semantic disclosure button, and no action controls or expanded metric behavior changed.

## Validation

- Focused frontend tests: `LibrariesPage.test.tsx` and `App.test.tsx`, 81 tests passed.
- Vite production bundle: passed with `npx vite build`.
- The full TypeScript build remains blocked by the unrelated pre-existing `api.testTranscodeFederationNetwork` type mismatch in `TranscodingSettingsPanel.tsx`.
- `git diff --check`: no whitespace errors; only the repository's existing line-ending normalization warnings.

No P0, P1, or P2 findings remain for this requested UI change.

final result: passed

# Design QA: Compatibility profile development guidance tooltip (2026-09-09)

## Requested adjustment

- Move the persistent compatibility-profile development note into a tooltip beside the `Hardware & software profiles` panel heading.

## Visual truth and evidence

- Source: the user-supplied annotated screenshot at `http://localhost:5173/settings?section=compatibility-profiles` (1624 × 1272), with the heading and development note selected.
- Implementation: the same local route in the Codex In-app Browser after the tooltip refinement.
- State: dark theme, Hardware selected, with the profile catalog list and compact tab controls visible.

## Fidelity surfaces

- Layout: the profile catalog heading now owns the compact `?` trigger; the persistent paragraph is removed and the tabs move into the freed vertical space.
- Tooltip: the existing shared `TooltipTrigger` supplies the same hover, focus, keyboard, pinned-click, and viewport-aware portal behavior used by other settings headings.
- Typography and color: heading and tab styling remain unchanged; the development copy retains its localized text and is shown only on demand in the standard tooltip surface.
- Responsiveness: the panel title row remains wrapping-capable, so the tooltip trigger stays usable beside the heading without forcing horizontal overflow.

## Interaction and accessibility checks

- The trigger is a semantic button with a localized accessible label and `aria-expanded` / `aria-describedby` state from the shared tooltip component.
- The development note is absent from the persistent panel body and appears after activating the heading tooltip.
- No profile edits, saves, deletes, or external links were triggered during QA.

## Validation

- Focused frontend tests: `CompatibilityProfilesPanel.test.tsx` and `App.test.tsx`, 26 tests passed, including the heading tooltip interaction.
- Vite production bundle: passed with `npx vite build`.
- `git diff --check`: no whitespace errors; only the repository's existing line-ending normalization warnings.

No P0, P1, or P2 findings remain for this requested UI change.

final result: passed

# Design QA: Hardware and software profile surface alignment (2026-09-09)

## Requested adjustment

- Apply the compact Quality profiles treatment to Hardware & Software Profiles: underline tabs, one unified list surface, and expandable profile rows with the existing profile actions and editors preserved.

## Visual truth and evidence

- Source: the user-supplied annotated screenshot at `http://localhost:5173/settings?section=compatibility-profiles` (1624 × 1272), with the Hardware & software profiles catalog selected.
- Implementation: Codex In-app Browser tab 4 at `http://localhost:5174/settings?section=compatibility-profiles`, captured after the refactor in the same dark theme. The browser capture exposed a 1624 × 992 CSS viewport; the source attachment includes the surrounding 1624 × 1272 page frame, so the comparison was normalized to the shared content region rather than browser height.
- State: Hardware selected, search row visible, profile rows collapsed; a separate interaction capture opened the first hardware profile to verify the expanded detail state.

## Fidelity surfaces

- Layout: the old sliding-pill selector is replaced by the shared Transcoding underline tab row; the tab row, search, profile rows, and expandable details now live in one bordered surface like Quality profiles.
- Typography and spacing: profile names use the shared `transcode-automation-list-copy` treatment and Quality profile row rhythm, while the existing compact quick-action column remains aligned on the right.
- Color and tokens: active tab underline, borders, hover/focus surfaces, dark theme contrast, and action icon treatment reuse the existing Transcoding and compatibility-list tokens; no new visual system was introduced.
- Copy and content: Hardware, Software / Player, and Combination remain localized; search labels change with the active tab, and the development guidance stays available through the heading tooltip rather than returning to a persistent paragraph.
- Responsiveness and accessibility: tabs use `role="tab"`, `aria-selected`, roving `tabIndex`, and Arrow/Home/End navigation; the mobile Transcoding tab-row rules keep the controls horizontally scrollable and move the create action below when needed. Profile disclosure buttons expose expanded state and controls for their detail surfaces.

## Interaction and browser checks

- Browser capture showed all three tabs, the right-aligned Profile action, the search field, and the profile rows in the unified surface.
- Software / Player switched correctly and updated its search label and profile list.
- ArrowRight moved from Software / Player to Combination and selected the corresponding tab.
- Clicking the first Hardware profile expanded its read-only detail editor and the profile-specific capability subsections; clicking it again collapsed the row.
- Browser console error log was empty for the verified route.

## Validation

- Focused frontend tests: `CompatibilityProfilesPanel.test.tsx` and `App.test.tsx`, 26 tests passed.
- Full frontend suite: 43 test files, 443 tests passed, including the updated nested Settings tab assertion.
- Full frontend build: passed with `npm run build` (`tsc -b` and Vite production bundle).
- `git diff --check`: no whitespace errors; only the repository's existing line-ending normalization warnings.

No P0, P1, or P2 findings remain for this requested UI change.

final result: passed
