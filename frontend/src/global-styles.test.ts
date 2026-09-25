import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const globalStyles = readFileSync(resolve(process.cwd(), "globals.css"), "utf8");
const componentStyles = readFileSync(resolve(process.cwd(), "src/medialyze.css"), "utf8");

describe("global theme styles", () => {
  it("uses compact rectangular action buttons as the global baseline", () => {
    const buttonBaseline = globalStyles.match(/(?:^|\n)button\s*\{[^}]*\}/s)?.[0] ?? "";
    const smallButtonBaseline = globalStyles.match(/(?:^|\n)button\.small\s*\{[^}]*\}/s)?.[0] ?? "";

    expect(buttonBaseline).toMatch(/min-height:\s*32px/);
    expect(buttonBaseline).toMatch(/border-radius:\s*9px/);
    expect(buttonBaseline).toMatch(/padding:\s*0 12px/);
    expect(buttonBaseline).toMatch(/font-size:\s*0\.82rem/);
    expect(buttonBaseline).not.toContain("border-radius: 999px");
    expect(buttonBaseline).not.toContain("padding: 12px 18px");
    expect(smallButtonBaseline).toMatch(/min-height:\s*30px/);
    expect(smallButtonBaseline).toMatch(/padding:\s*0 10px/);
  });

  it("keeps tooltip triggers round and compact beside the rectangular button baseline", () => {
    expect(componentStyles).toMatch(
      /\.tooltip-trigger\s*\{[^}]*width:\s*22px[^}]*height:\s*22px[^}]*min-height:\s*22px[^}]*border-radius:\s*999px/s,
    );
    expect(componentStyles).toMatch(
      /\.file-detail-field-tooltip\.tooltip-trigger\s*\{[^}]*min-height:\s*18px/s,
    );
    expect(componentStyles).toMatch(
      /\.table-heading-with-tooltip \.tooltip-trigger\s*\{[^}]*min-height:\s*18px/s,
    );
  });

  it("keeps disabled async-panel tooltip titles at the normal heading size", () => {
    expect(componentStyles).toMatch(
      /\.async-panel-title-tooltip-wrapper\.tooltip-trigger\s*\{[^}]*font:\s*inherit[^}]*line-height:\s*inherit/s,
    );
  });

  it("keeps symbol-only segmented toggle options square", () => {
    const distributionModeButton = componentStyles.match(
      /\.distribution-chart-mode-button\s*\{[^}]*\}/s,
    )?.[0] ?? "";

    expect(distributionModeButton).toMatch(/box-sizing:\s*border-box/);
    expect(distributionModeButton).toMatch(/width:\s*26px/);
    expect(distributionModeButton).toMatch(/height:\s*26px/);
    expect(distributionModeButton).toMatch(/min-width:\s*26px/);
    expect(distributionModeButton).toMatch(/min-height:\s*26px/);
    expect(componentStyles).toMatch(
      /\.playback-history-display-toggle \.library-history-range-button\.tooltip-trigger\s*\{[^}]*box-sizing:\s*border-box[^}]*width:\s*30px[^}]*height:\s*30px[^}]*min-width:\s*30px[^}]*min-height:\s*30px/s,
    );
  });

  it("keeps library history controls as separate surfaces", () => {
    const libraryHistoryActions = componentStyles.match(
      /(?:^|\n)\.library-history-actions\s*\{[^}]*\}/s,
    )?.[0] ?? "";

    expect(libraryHistoryActions).toMatch(/gap:\s*8px/);
    expect(libraryHistoryActions).not.toContain("background:");
    expect(libraryHistoryActions).not.toContain("border:");
    expect(componentStyles).not.toMatch(
      /\.library-history-panel \.library-history-actions >/,
    );
  });

  it("uses connected rectangular controls for comparison charts", () => {
    const comparisonToolbar = componentStyles.match(
      /(?:^|\n)\.comparison-chart-toolbar\s*\{[^}]*\}/s,
    )?.[0] ?? "";
    const comparisonSelectShell = componentStyles.match(
      /(?:^|\n)\.comparison-chart-select-shell\s*\{[^}]*\}/s,
    )?.[0] ?? "";
    const comparisonSwapButton = componentStyles.match(
      /(?:^|\n)\.comparison-chart-swap-button\s*\{[^}]*\}/s,
    )?.[0] ?? "";
    const comparisonRendererButton = componentStyles.match(
      /(?:^|\n)\.comparison-chart-renderer-button\s*\{[^}]*\}/s,
    )?.[0] ?? "";

    expect(comparisonToolbar).toMatch(/gap:\s*0/);
    expect(comparisonToolbar).toMatch(/border:\s*1px solid/);
    expect(comparisonToolbar).toMatch(/border-radius:\s*10px/);
    expect(comparisonToolbar).toMatch(/background-color:/);
    expect(comparisonToolbar).toMatch(/overflow:\s*hidden/);
    expect(comparisonSelectShell).toMatch(/border:\s*0/);
    expect(comparisonSelectShell).toMatch(/background-color:\s*transparent/);
    expect(componentStyles).toMatch(
      /\.comparison-chart-toolbar > \* \+ \*\s*\{[^}]*border-left:/s,
    );
    expect(comparisonSwapButton).toMatch(/width:\s*36px/);
    expect(comparisonSwapButton).toMatch(/height:\s*36px/);
    expect(comparisonSwapButton).toMatch(/border:\s*0/);
    expect(comparisonSwapButton).toMatch(/border-radius:\s*0/);
    expect(comparisonRendererButton).toMatch(/width:\s*42px/);
    expect(comparisonRendererButton).toMatch(/height:\s*36px/);
    expect(comparisonRendererButton).toMatch(/border:\s*0/);
    expect(comparisonRendererButton).toMatch(/border-radius:\s*0/);
  });

  it("keeps metadata search rows aligned with the compact file search", () => {
    const metadataSearchIconAndRemove = componentStyles.match(
      /\.metadata-search-row \.metadata-search-icon-button,[\s\S]*?\.metadata-search-row \.metadata-search-remove\s*\{[^}]*\}/s,
    )?.[0] ?? "";
    const metadataSearchInput = [...componentStyles.matchAll(
      /\.metadata-search-row \.metadata-search-control input\s*\{[^}]*\}/gs,
    )]
      .map((match) => match[0])
      .find((block) => block.includes("height: 36px")) ?? "";

    expect(metadataSearchIconAndRemove).toMatch(/box-sizing:\s*border-box/);
    expect(metadataSearchIconAndRemove).toMatch(/width:\s*40px/);
    expect(metadataSearchIconAndRemove).toMatch(/height:\s*36px/);
    expect(metadataSearchIconAndRemove).toMatch(/min-width:\s*40px/);
    expect(metadataSearchIconAndRemove).toMatch(/min-height:\s*36px/);
    expect(metadataSearchInput).toMatch(/height:\s*36px/);
    expect(metadataSearchInput).toMatch(/min-height:\s*36px/);
    expect(metadataSearchInput).toMatch(/padding:\s*7px 12px/);
    expect(componentStyles).toMatch(
      /\.search-filter-picker-item\s*\{[^}]*justify-content:\s*flex-start/s,
    );
  });

  it("keeps the application version pill compact beside the header title", () => {
    expect(componentStyles).toMatch(
      /\.app-version\s*\{[^}]*min-height:\s*0[^}]*padding:\s*2px 6px[^}]*font-size:\s*0\.6rem[^}]*line-height:\s*normal/s,
    );
  });

  it("keeps the analyzed-files count badge between the title and version-pill sizes", () => {
    const analyzedFilesCount = componentStyles.match(
      /\.analyzed-files-count\s*\{[^}]*\}/s,
    )?.[0] ?? "";

    expect(analyzedFilesCount).toMatch(/min-height:\s*26px/);
    expect(analyzedFilesCount).toMatch(/padding:\s*0 8px/);
    expect(analyzedFilesCount).toMatch(/font-size:\s*0\.78rem/);
    expect(analyzedFilesCount).toMatch(/line-height:\s*1/);
  });

  it("keeps the Storage Map treemap inset from the panel edge", () => {
    const storageMapStage = componentStyles.match(
      /\.storage-map-stage\s*\{[^}]*\}/s,
    )?.[0] ?? "";

    expect(storageMapStage).toMatch(/margin:\s*0 16px 16px/);
    expect(componentStyles).not.toContain(".storage-map-header-cards");
  });

  it("distinguishes bordered and borderless icon-button surfaces", () => {
    expect(componentStyles).toMatch(
      /button\.icon-button\s*\{[^}]*width:\s*32px[^}]*height:\s*32px[^}]*min-width:\s*32px[^}]*min-height:\s*32px[^}]*border-radius:\s*9px/s,
    );
    expect(componentStyles).toMatch(
      /button\.icon-button-borderless\s*\{[^}]*border-color:\s*transparent[^}]*background:\s*transparent/s,
    );
    expect(componentStyles).toMatch(
      /button\.icon-button-bordered\s*\{[^}]*border-color:\s*var\(--border\)[^}]*background:\s*var\(--surface\)/s,
    );
    expect(componentStyles).toContain(".icon-button-static");
    expect(componentStyles).toContain(".icon-button-animated");
  });

  it("uses the compact control baseline and removes the legacy oversized baseline", () => {
    const compactControlSelector = ':where(input:not([type="checkbox"]):not([type="range"]):not([type="hidden"]), select, textarea)';

    expect(globalStyles).toContain(compactControlSelector);
    expect(globalStyles).toMatch(/min-height:\s*36px/);
    expect(globalStyles).toMatch(/border-radius:\s*9px/);
    expect(globalStyles).toMatch(/padding:\s*5px 12px/);
    expect(globalStyles).not.toMatch(/input,\s*\nselect,\s*\ntextarea\s*\{/);
    expect(globalStyles).not.toMatch(/padding:\s*12px 14px/);
    expect(globalStyles).not.toMatch(/border-radius:\s*12px/);
  });

  it("removes browser-native search reset glyphs from themed text fields", () => {
    expect(globalStyles).toMatch(
      /input\[type="search"\]\s*\{[^}]*appearance:\s*none[^}]*-webkit-appearance:\s*none/s,
    );
    expect(globalStyles).toMatch(
      /input\[type="search"\]::-webkit-search-cancel-button,[\s\S]*?input\[type="search"\]::-webkit-search-decoration\s*\{[^}]*display:\s*none[^}]*appearance:\s*none/s,
    );
    expect(globalStyles).toMatch(
      /input\[type="search"\]::-ms-clear\s*\{[^}]*display:\s*none/s,
    );
  });

  it("keeps native dropdown menus readable in each theme", () => {
    expect(globalStyles).toMatch(/:root\s*\{[^}]*color-scheme:\s*light/s);
    expect(globalStyles).toMatch(/html\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark/s);
    expect(globalStyles).toMatch(
      /select option,\s*select optgroup\s*\{[^}]*background-color:\s*var\(--surface\)[^}]*color:\s*var\(--ink\)/s,
    );
  });

  it("keeps expanded Settings navigation entries left-aligned", () => {
    expect(componentStyles).toMatch(
      /\.settings-navigation-item\s*\{[^}]*justify-content:\s*flex-start/s,
    );
    expect(componentStyles).toMatch(
      /\.settings-layout\.is-settings-nav-collapsed \.settings-navigation-item\s*\{[^}]*justify-content:\s*center/s,
    );
  });

  it("keeps the Settings search close to its navigation heading", () => {
    expect(componentStyles).toMatch(
      /\.settings-navigation-header\s*\{[^}]*padding:\s*2px 2px 0 10px/s,
    );
    expect(componentStyles).toMatch(
      /\.settings-layout\.is-settings-nav-collapsed \.settings-navigation-header\s*\{[^}]*padding:\s*2px 0 0/s,
    );
  });

  it("keeps only the dedicated search visible in the mobile Settings menu", () => {
    expect(componentStyles).toMatch(
      /@media\s*\(max-width:\s*900px\)[\s\S]*?\.settings-navigation-panel\s*>\s*\.settings-navigation-search-stack\s*\{[^}]*display:\s*none/s,
    );
    expect(componentStyles).toMatch(
      /\.settings-mobile-navigation-search-stack\s*\{[^}]*display:\s*grid/s,
    );
  });

  it("left-aligns Settings search result content", () => {
    expect(componentStyles).toMatch(
      /\.settings-search-result\s*\{[^}]*justify-content:\s*flex-start/s,
    );
  });

  it("uses theme-aware surfaces for nested compatibility sections", () => {
    expect(globalStyles).toMatch(/--nested-surface:\s*rgba\(255, 255, 255, 0\.36\)/);
    expect(globalStyles).toMatch(/--nested-surface:\s*rgba\(38, 35, 31, 0\.64\)/);
    expect(componentStyles).toMatch(
      /\.compatibility-capability-section\s*\{[^}]*background-color:\s*var\(--nested-surface\)/s,
    );
    expect(componentStyles).toMatch(
      /\.compatibility-video-capability\s*\{[^}]*background-color:\s*var\(--nested-surface-muted\)/s,
    );
    expect(componentStyles).not.toMatch(
      /\.compatibility-(?:capability-section|video-capability)\s*\{[^}]*background:\s*rgba\(255, 255, 255/s,
    );
  });

  it("provides theme-aware surface aliases and avoids light dark-mode fallbacks", () => {
    expect(globalStyles).toMatch(/--surface:\s*var\(--panel-strong\)/);
    expect(globalStyles).toMatch(/--surface-subtle:\s*var\(--nested-surface-muted\)/);
    expect(globalStyles).toMatch(/--border:\s*var\(--nested-surface-border\)/);
    expect(globalStyles).toMatch(/--text-muted:\s*var\(--muted\)/);
    expect(componentStyles).toMatch(
      /\.ui-elements-variant-card\s*\{[^}]*background:\s*var\(--nested-surface\)/s,
    );
    expect(componentStyles).toMatch(
      /\.jellyfin-create-library-option[^}]*background:\s*var\(--surface\)/s,
    );
    expect(componentStyles).toMatch(
      /\.settings-delete-library-summary\s*\{[^}]*background:\s*var\(--surface\)/s,
    );
    expect(componentStyles).toMatch(
      /\.compatibility-favorite-section\s*\{[^}]*background:\s*var\(--nested-surface\)/s,
    );
    expect(componentStyles).toMatch(
      /\.metadata-search-control input,\s*\.metadata-search-control-base input\s*\{[^}]*background:\s*var\(--surface\)/s,
    );
    expect(componentStyles).toMatch(
      /\.file-detail-cover-button\.secondary\.small\s*\{[^}]*background:\s*var\(--surface\)/s,
    );
    expect(componentStyles).toMatch(
      /\.quality-picker-custom-input\s*\{[^}]*background:\s*var\(--surface\)/s,
    );
    expect(componentStyles).toMatch(
      /\.metadata-search-row\.is-invalid[\s\S]*?background:\s*color-mix\(in srgb, #c95836 12%, var\(--surface\)\)/s,
    );
    expect(componentStyles).not.toContain("background: rgba(255, 245, 240, 0.96)");
    expect(componentStyles).not.toContain("background: var(--surface, #fff)");
  });

  it("uses transparent scrollbar tracks with theme-aware pill thumbs", () => {
    expect(globalStyles).toContain("--scrollbar-thumb: rgba(31, 28, 22, 0.22)");
    expect(globalStyles).toContain("--scrollbar-thumb: rgba(240, 236, 228, 0.26)");
    expect(globalStyles).toContain("scrollbar-color: var(--scrollbar-thumb) transparent;");
    expect(globalStyles).toContain("scrollbar-width: thin;");
    expect(globalStyles).toContain("*::-webkit-scrollbar-track");
    expect(globalStyles).toContain("*::-webkit-scrollbar-button");
    expect(globalStyles).toContain("*::-webkit-scrollbar-corner");
    expect(globalStyles).toContain("background: transparent;");
    expect(globalStyles).toContain("background: var(--scrollbar-thumb);");
    expect(globalStyles).toContain("background: var(--scrollbar-thumb-hover);");
  });

  it("uses one theme-aware chevron pattern for ordinary select controls", () => {
    expect(globalStyles).toContain("--select-chevron: url(");
    expect(componentStyles).toMatch(
      /select\.settings-choice-input\s*\{[^}]*appearance:\s*none[^}]*padding:\s*8px 40px 8px 12px[^}]*background-image:\s*var\(--select-chevron\)[^}]*background-position:\s*right 12px center/s,
    );
    expect(componentStyles).toContain("select.settings-choice-input[multiple]");
    expect(componentStyles).not.toContain(".settings-main-column .field select");
    expect(componentStyles).not.toContain(".quality-profile-boundary-field select");
    expect(componentStyles).not.toContain(".storage-map-select-wrap");
    expect(componentStyles).not.toContain(".transcoding-filter-field > svg");
  });

  it("keeps accelerator matrix rows aligned with compact automation rows", () => {
    expect(componentStyles).toMatch(
      /\.transcode-capability-device-copy\s*\{[^}]*align-items:\s*center/s,
    );
    expect(componentStyles).toMatch(
      /\.transcode-federation-member-pill\s*\{[^}]*min-height:\s*22px[^}]*padding:\s*3px 7px[^}]*font-size:\s*0\.68rem/s,
    );
    expect(componentStyles).toMatch(
      /\.transcode-device-matrix > summary\s*\{[^}]*min-height:\s*38px[^}]*padding:\s*0 6px 0 12px/s,
    );
  });

  it("gives transcoding automation tabs a wider hit area and hover highlight", () => {
    expect(componentStyles).toMatch(
      /\.transcode-automation-tab-button\s*\{[^}]*min-height:\s*30px[^}]*margin:\s*-1px 0 1px[^}]*padding:\s*1px 6px 5px/s,
    );
    expect(componentStyles).toMatch(
      /\.transcode-automation-tab-button:hover,\s*\.transcode-automation-tab-button:focus-visible\s*\{[^}]*background:\s*transparent/s,
    );
    expect(componentStyles).toMatch(
      /\.transcode-automation-tab-button:hover::before,\s*\.transcode-automation-tab-button:focus-visible::before\s*\{[^}]*opacity:\s*1/s,
    );
  });

  it("keeps stream counts pill-shaped and stream action controls evenly inset with a neutral filled default toggle", () => {
    const countBadge = componentStyles.match(/\.transcode-stream-tab-count\s*\{[^}]*\}/s)?.[0] ?? "";
    const actionRow = componentStyles.match(/\.transcode-stream-row-actions\s*\{[^}]*\}/s)?.[0] ?? "";
    const actionField = componentStyles.match(/\.transcode-action-field\s*\{[^}]*\}/s)?.[0] ?? "";
    const defaultButton = componentStyles.match(/\.compatibility-profile-quick-action\.secondary\.icon-only-button\s*\{[^}]*\}/s)?.[0] ?? "";
    const collapsedAction = componentStyles.match(/\.transcode-action-field\.is-collapsed\s*\{[^}]*\}/s)?.[0] ?? "";
    const collapsedSelect = componentStyles.match(/\.transcode-action-field\.is-collapsed\s*>\s*\.transcode-action-select\s*\{[^}]*\}/s)?.[0] ?? "";
    const collapsedIcon = componentStyles.match(/\.transcode-action-field\.is-collapsed\s+\.transcode-stream-action-icon\s*\{[^}]*\}/s)?.[0] ?? "";
    const expandedSelect = componentStyles.match(/\.transcode-action-field\.is-expanded\s*>\s*\.transcode-action-select\s*\{[^}]*\}/s)?.[0] ?? "";
    const copyDetails = componentStyles.match(/\.transcode-stream-copy-details\s*\{[^}]*\}/s)?.[0] ?? "";
    const streamSearch = componentStyles.match(/\.transcode-stream-list\s*>\s*\.transcode-stream-search\s*\{[^}]*\}/s)?.[0] ?? "";
    const streamCatalog = componentStyles.match(/\.transcode-stream-catalog\s*\{[^}]*\}/s)?.[0] ?? "";
    const streamCatalogList = componentStyles.match(/\.transcode-stream-catalog\s+\.transcode-stream-list\s*\{[^}]*\}/s)?.[0] ?? "";
    const automationToggleRow = componentStyles.match(/\.transcode-automation-toggle-row\s*\{[^}]*\}/s)?.[0] ?? "";
    const streamTabs = componentStyles.match(/\.transcode-stream-tabs\s*\{[^}]*\}/s)?.[0] ?? "";
    const favoriteButton = componentStyles.match(/\.compatibility-profile-quick-action\.secondary\.icon-only-button\.is-favorite\s*\{[^}]*\}/s)?.[0] ?? "";
    const formattingHeader = componentStyles.match(/\.transcode-filename-header\s*\{[^}]*\}/s)?.[0] ?? "";
    const formattingChevron = componentStyles.match(/\.transcode-filename-chevron-toggle\.secondary\.icon-only-button\s*\{[^}]*\}/s)?.[0] ?? "";

    expect(countBadge).toMatch(/display:\s*inline-flex/);
    expect(countBadge).toMatch(/min-width:\s*24px/);
    expect(countBadge).toMatch(/height:\s*18px/);
    expect(countBadge).toMatch(/border-radius:\s*999px/);

    expect(actionRow).toMatch(/display:\s*flex/);
    expect(actionRow).toMatch(/gap:\s*2px/);
    expect(actionRow).toMatch(/margin:\s*4px 4px 4px 0/);
    expect(actionField).toMatch(/margin:\s*0/);
    expect(defaultButton).toMatch(/width:\s*28px/);
    expect(defaultButton).toMatch(/border:\s*0/);
    expect(favoriteButton).toMatch(/background:\s*var\(--panel-strong\)/);
    expect(favoriteButton).toMatch(/border:\s*0/);
    expect(favoriteButton).not.toMatch(/var\(--accent\)/);
    expect(formattingHeader).toMatch(/gap:\s*8px/);
    expect(formattingChevron).toMatch(/width:\s*26px/);
    expect(formattingChevron).toMatch(/background:\s*transparent/);
    expect(streamCatalog).toMatch(/min-width:\s*0/);
    expect(streamCatalogList).toMatch(/border:\s*0/);
    expect(streamCatalogList).toMatch(/border-radius:\s*0/);
    expect(automationToggleRow).toMatch(/box-sizing:\s*border-box/);
    expect(automationToggleRow).toMatch(/height:\s*40px/);
    expect(automationToggleRow).toMatch(/min-height:\s*40px/);
    expect(streamTabs).toMatch(/box-sizing:\s*border-box/);
    expect(streamTabs).toMatch(/height:\s*40px/);
    expect(streamTabs).toMatch(/min-height:\s*40px/);
    expect(streamTabs).toMatch(/padding:\s*3px 10px 2px/);
    expect(componentStyles).toMatch(/\.transcode-stream-list-item\.is-dropped\s*\{[^}]*opacity:\s*0\.62/s);
    const languageFirst = componentStyles.match(/\.transcode-stream-row-copy\.is-language-first\s+\.transcode-language-badge\s*\{[^}]*\}/s)?.[0] ?? "";
    const metadataList = componentStyles.match(/\.transcode-metadata-option-list\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(languageFirst).toMatch(/font-size:\s*0\.96rem/);
    expect(metadataList).toMatch(/display:\s*grid/);
    expect(metadataList).toMatch(/border-radius:\s*10px/);
    expect(componentStyles).toMatch(/\.transcode-metadata-option-list \.transcode-global-option \+ \.transcode-global-option\s*\{[^}]*border-top:/s);

    expect(collapsedAction).toMatch(/display:\s*grid/);
    expect(collapsedAction).toMatch(/place-items:\s*center/);
    expect(collapsedAction).toMatch(/width:\s*34px/);
    expect(collapsedAction).toMatch(/height:\s*34px/);
    expect(collapsedSelect).toMatch(/width:\s*34px/);
    expect(collapsedSelect).toMatch(/height:\s*34px/);
    expect(collapsedSelect).toMatch(/border-radius:\s*9px/);
    expect(collapsedIcon).toMatch(/left:\s*50%/);
    expect(collapsedIcon).toMatch(/transform:\s*translate\(-50%, -50%\)/);

    expect(expandedSelect).toMatch(/padding:\s*5px 26px 5px 32px/);
    expect(expandedSelect).toMatch(/background-size:\s*14px 14px/);
    expect(copyDetails).toMatch(/align-items:\s*center/);
    expect(streamSearch).toMatch(/position:\s*sticky/);
    expect(streamSearch).toMatch(/top:\s*0/);
    expect(componentStyles).not.toMatch(/\.transcode-stream-list-item:hover\s+\.transcode-action-field/);
    expect(componentStyles).toMatch(/\.transcode-action-field\s*>\s*\.transcode-action-select:hover\s*\{[^}]*background-color:\s*transparent/s);
  });

  it("keeps compact transcoding guidance small and aligned to the tab labels", () => {
    expect(componentStyles).toMatch(
      /\.transcode-automation-description-tooltip\s*\{[^}]*gap:\s*4px/s,
    );
    expect(componentStyles).toMatch(
      /\.transcode-automation-description-tooltip-portal-compact\s*\{[^}]*max-width:\s*300px[^}]*padding:\s*6px 8px[^}]*font-size:\s*0\.74rem/s,
    );
  });

  it("gives filename metadata tokens a structured, readable tooltip", () => {
    const tokenPill = componentStyles.match(/\.transcode-filename-token-pill\s*\{[^}]*\}/s)?.[0] ?? "";
    const tooltipPortal = componentStyles.match(/\.transcode-filename-token-tooltip-portal\s*\{[^}]*\}/s)?.[0] ?? "";
    const tooltip = componentStyles.match(/\.transcode-filename-token-tooltip\s*\{[^}]*\}/s)?.[0] ?? "";
    const heading = componentStyles.match(/\.transcode-filename-token-tooltip-heading\s*\{[^}]*\}/s)?.[0] ?? "";
    const example = componentStyles.match(/\.transcode-filename-token-tooltip-example\s*\{[^}]*\}/s)?.[0] ?? "";

    expect(tokenPill).toMatch(/width:\s*fit-content/);
    expect(tokenPill).toMatch(/white-space:\s*nowrap/);
    expect(tooltipPortal).toMatch(/padding:\s*12px 14px/);
    expect(tooltip).toMatch(/display:\s*grid/);
    expect(tooltip).toMatch(/gap:\s*8px/);
    expect(heading).toMatch(/display:\s*flex/);
    expect(heading).toMatch(/flex-wrap:\s*wrap/);
    expect(example).toMatch(/border-top:/);
    expect(example).toMatch(/padding-top:\s*7px/);
  });
});
