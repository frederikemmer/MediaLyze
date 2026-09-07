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
