import {
  LIBRARY_STATISTIC_DEFINITIONS,
  type LibraryStatisticDefinition,
  type LibraryStatisticId,
} from "./library-statistics-settings";
import type { ComparisonFieldId, ComparisonRendererId } from "./api";
import {
  COMPARISON_FIELD_DEFINITIONS,
  getComparisonSelection,
  sanitizeComparisonRenderer,
  type ComparisonSelection,
} from "./statistic-comparisons";

export type StatisticPanelLayoutScope = "dashboard" | "library";
export type ExtraLibraryStatisticPanelId = "history" | "duplicates" | "analyzed_files";
export type StatisticPanelLayoutId = LibraryStatisticId | ExtraLibraryStatisticPanelId;

export type StatisticPanelLayoutMenuDefinition = {
  id: StatisticPanelLayoutId;
  nameKey: string;
};

export type StatisticPanelLayoutItem = {
  instanceId: string;
  statisticId: StatisticPanelLayoutId;
  width: number;
  height: number;
  comparisonSelection?: ComparisonSelection;
};

export type StatisticPanelLayout = {
  version?: number;
  items: StatisticPanelLayoutItem[];
};

export type StatisticPanelLayoutMigrationIssue =
  | { kind: "invalid_json" }
  | { kind: "invalid_layout" }
  | { kind: "invalid_item"; index: number }
  | { kind: "unsupported_panel"; index: number; statisticId: string }
  | { kind: "duplicate_panel"; statisticId: StatisticPanelLayoutId }
  | { kind: "duplicate_instance"; statisticId: StatisticPanelLayoutId; instanceId: string }
  | {
      kind: "resized_panel";
      statisticId: StatisticPanelLayoutId;
      instanceId: string;
      axis: "width" | "height";
      requested: number;
      applied: number;
    }
  | {
      kind: "comparison_selection_adjusted";
      instanceId: string;
      previousSelection: string;
      appliedSelection: string;
    };

export type StatisticPanelLayoutReadResult = {
  layout: StatisticPanelLayout;
  issues: StatisticPanelLayoutMigrationIssue[];
};

const STORAGE_KEY_PREFIX = "medialyze-statistic-panel-layout";
const STATISTIC_PANEL_LAYOUT_VERSION = 3;
const MAX_PANEL_WIDTH_UNITS = 4;
const COMPARISON_FIELD_IDS = new Set(COMPARISON_FIELD_DEFINITIONS.map((definition) => definition.id));
const COMPARISON_RENDERER_IDS = new Set<ComparisonRendererId>(["heatmap", "scatter", "bar"]);

export type StatisticPanelLayoutOptions = {
  unlimitedHeight?: boolean;
};

type DefaultLayoutBlueprintItem = {
  statisticId: StatisticPanelLayoutId;
  width: number;
  height: number;
  comparisonSelection?: ComparisonSelection;
};

type PanelSizeConfig = {
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  allowWidthResize: boolean;
  allowHeightResize: boolean;
};

const LIBRARY_EXTRA_LAYOUT_DEFINITIONS: StatisticPanelLayoutMenuDefinition[] = [
  { id: "history", nameKey: "libraryDetail.history.title" },
  { id: "duplicates", nameKey: "libraryDetail.duplicates.title" },
  { id: "analyzed_files", nameKey: "libraryDetail.analyzedFiles" },
];

const DASHBOARD_EXTRA_LAYOUT_DEFINITIONS: StatisticPanelLayoutMenuDefinition[] = [
  { id: "history", nameKey: "dashboard.history.title" },
];

const LIBRARY_DEFAULT_LAYOUT_BLUEPRINT: DefaultLayoutBlueprintItem[] = [
  { statisticId: "size", width: 2, height: 2 },
  { statisticId: "resolution", width: 1, height: 2 },
  { statisticId: "video_codec", width: 1, height: 2 },
  { statisticId: "hdr_type", width: 1, height: 2 },
  { statisticId: "audio_languages", width: 1, height: 2 },
  { statisticId: "duration", width: 1, height: 2 },
  {
    statisticId: "comparison",
    width: 1,
    height: 2,
    comparisonSelection: {
      xField: "size",
      yField: "duration",
      renderer: "scatter",
    },
  },
  { statisticId: "history", width: 4, height: 3 },
  { statisticId: "duplicates", width: 4, height: 3 },
  { statisticId: "analyzed_files", width: 4, height: 4 },
];

const DASHBOARD_DEFAULT_LAYOUT_BLUEPRINT: DefaultLayoutBlueprintItem[] = [
  { statisticId: "history", width: 4, height: 3 },
  { statisticId: "size", width: 2, height: 2 },
  { statisticId: "video_codec", width: 1, height: 2 },
  { statisticId: "quality_score", width: 1, height: 2 },
  {
    statisticId: "comparison",
    width: 1,
    height: 2,
    comparisonSelection: {
      xField: "size",
      yField: "duration",
      renderer: "scatter",
    },
  },
  { statisticId: "resolution", width: 1, height: 2 },
  {
    statisticId: "comparison",
    width: 2,
    height: 2,
    comparisonSelection: {
      xField: "video_codec",
      yField: "size",
      renderer: "heatmap",
    },
  },
  { statisticId: "audio_languages", width: 1, height: 2 },
  { statisticId: "bitrate", width: 1, height: 2 },
  { statisticId: "container", width: 1, height: 2 },
  { statisticId: "audio_codecs", width: 1, height: 2 },
  { statisticId: "duration", width: 1, height: 2 },
  { statisticId: "hdr_type", width: 1, height: 2 },
  { statisticId: "audio_bitrate", width: 1, height: 2 },
  { statisticId: "subtitle_languages", width: 1, height: 2 },
];

function buildStorageKey(scope: StatisticPanelLayoutScope, pageKey: string): string {
  return `${STORAGE_KEY_PREFIX}-${scope}-${pageKey}`;
}

function getAllSupportedDefinitions(scope: StatisticPanelLayoutScope): StatisticPanelLayoutMenuDefinition[] {
  const statisticDefinitions = LIBRARY_STATISTIC_DEFINITIONS.filter((definition) =>
    scope === "dashboard" ? definition.supportsDashboard : definition.supportsPanel,
  ).map((definition) => ({ id: definition.id, nameKey: definition.nameKey }));

  if (scope === "library") {
    return [...statisticDefinitions, ...LIBRARY_EXTRA_LAYOUT_DEFINITIONS];
  }

  return [...statisticDefinitions, ...DASHBOARD_EXTRA_LAYOUT_DEFINITIONS];
}

export function getStatisticPanelLayoutPanelNameKey(
  scope: StatisticPanelLayoutScope,
  statisticId: string,
): string | null {
  return getAllSupportedDefinitions(scope).find((definition) => definition.id === statisticId)?.nameKey ?? null;
}

function getDefaultVisibleDefinitions(scope: StatisticPanelLayoutScope): LibraryStatisticDefinition[] {
  return LIBRARY_STATISTIC_DEFINITIONS.filter((definition) =>
    scope === "dashboard"
      ? definition.supportsDashboard && definition.defaultDashboardEnabled
      : definition.supportsPanel && definition.defaultPanelEnabled,
  );
}

function getPanelSizeConfig(
  scope: StatisticPanelLayoutScope,
  statisticId: StatisticPanelLayoutId,
  options?: StatisticPanelLayoutOptions,
): PanelSizeConfig {
  const boundedMaxHeight = options?.unlimitedHeight ? Number.MAX_SAFE_INTEGER : MAX_PANEL_WIDTH_UNITS;

  if ((scope === "library" || scope === "dashboard") && statisticId === "history") {
    return {
      defaultWidth: 4,
      defaultHeight: 3,
      minWidth: 2,
      maxWidth: 4,
      minHeight: 3,
      maxHeight: Math.max(3, boundedMaxHeight),
      allowWidthResize: true,
      allowHeightResize: true,
    };
  }

  if (scope === "library" && statisticId === "duplicates") {
    return {
      defaultWidth: 4,
      defaultHeight: 3,
      minWidth: 4,
      maxWidth: 4,
      minHeight: 1,
      maxHeight: boundedMaxHeight,
      allowWidthResize: false,
      allowHeightResize: true,
    };
  }

  if (scope === "library" && statisticId === "analyzed_files") {
    return {
      defaultWidth: 4,
      defaultHeight: 4,
      minWidth: 4,
      maxWidth: 4,
      minHeight: 2,
      maxHeight: Math.max(4, boundedMaxHeight),
      allowWidthResize: false,
      allowHeightResize: true,
    };
  }

  if (statisticId === "comparison") {
    return {
      defaultWidth: 2,
      defaultHeight: 2,
      minWidth: 1,
      maxWidth: 4,
      minHeight: 1,
      maxHeight: boundedMaxHeight,
      allowWidthResize: true,
      allowHeightResize: true,
    };
  }

  if (
    statisticId === "size" ||
    statisticId === "quality_score" ||
    statisticId === "duration" ||
    statisticId === "bitrate" ||
    statisticId === "audio_bitrate"
  ) {
    return {
      defaultWidth: 2,
      defaultHeight: 1,
      minWidth: 1,
      maxWidth: 4,
      minHeight: 1,
      maxHeight: boundedMaxHeight,
      allowWidthResize: true,
      allowHeightResize: true,
    };
  }

  return {
    defaultWidth: 1,
    defaultHeight: 1,
    minWidth: 1,
    maxWidth: 4,
    minHeight: 1,
    maxHeight: boundedMaxHeight,
    allowWidthResize: true,
    allowHeightResize: true,
  };
}

function clampPanelUnits(
  value: unknown,
  axis: "width" | "height",
  scope: StatisticPanelLayoutScope,
  statisticId: StatisticPanelLayoutId,
  options?: StatisticPanelLayoutOptions,
): number {
  const config = getPanelSizeConfig(scope, statisticId, options);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return axis === "width" ? config.defaultWidth : config.defaultHeight;
  }

  const rounded = Math.round(value);
  if (axis === "width") {
    return Math.min(config.maxWidth, Math.max(config.minWidth, rounded));
  }

  return Math.min(config.maxHeight, Math.max(config.minHeight, rounded));
}

function normalizeComparisonSelection(
  scope: StatisticPanelLayoutScope,
  value: unknown,
): ComparisonSelection {
  const fallback = getComparisonSelection(scope);
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as Partial<ComparisonSelection>;
  const xField = isComparisonFieldId(candidate.xField) ? candidate.xField : fallback.xField;
  const yField = isComparisonFieldId(candidate.yField) ? candidate.yField : fallback.yField;
  const renderer = sanitizeComparisonRenderer(
    xField,
    yField,
    isComparisonRendererId(candidate.renderer) ? candidate.renderer : fallback.renderer,
  );

  return { xField, yField, renderer };
}

function isComparisonFieldId(value: unknown): value is ComparisonFieldId {
  return typeof value === "string" && COMPARISON_FIELD_IDS.has(value as ComparisonFieldId);
}

function isComparisonRendererId(value: unknown): value is ComparisonRendererId {
  return typeof value === "string" && COMPARISON_RENDERER_IDS.has(value as ComparisonRendererId);
}

function buildDefaultInstanceId(statisticId: StatisticPanelLayoutId, comparisonIndex: number): string {
  return statisticId === "comparison" ? `comparison-${comparisonIndex}` : statisticId;
}

function formatStoredComparisonSelection(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<ComparisonSelection>;
  const xField = typeof candidate.xField === "string" ? candidate.xField : "?";
  const yField = typeof candidate.yField === "string" ? candidate.yField : "?";
  const renderer = typeof candidate.renderer === "string" ? candidate.renderer : "?";
  return `${xField} / ${yField} / ${renderer}`;
}

function formatComparisonSelection(selection: ComparisonSelection): string {
  return `${selection.xField} / ${selection.yField} / ${selection.renderer}`;
}

function buildPanelItem(
  scope: StatisticPanelLayoutScope,
  statisticId: StatisticPanelLayoutId,
  instanceId: string,
  comparisonSelection?: unknown,
  width?: unknown,
  height?: unknown,
  options?: StatisticPanelLayoutOptions,
): StatisticPanelLayoutItem {
  const defaultSize = getPanelSizeConfig(scope, statisticId, options);
  return {
    instanceId,
    statisticId,
    width: clampPanelUnits(width ?? defaultSize.defaultWidth, "width", scope, statisticId, options),
    height: clampPanelUnits(height ?? defaultSize.defaultHeight, "height", scope, statisticId, options),
    comparisonSelection:
      statisticId === "comparison"
        ? normalizeComparisonSelection(scope, comparisonSelection)
        : undefined,
  };
}

export function cloneStatisticPanelLayout(layout: StatisticPanelLayout): StatisticPanelLayout {
  return {
    version: STATISTIC_PANEL_LAYOUT_VERSION,
    items: layout.items.map((item) => ({
      ...item,
      comparisonSelection: item.comparisonSelection ? { ...item.comparisonSelection } : undefined,
    })),
  };
}

export function buildDefaultStatisticPanelLayout(
  scope: StatisticPanelLayoutScope,
  options?: StatisticPanelLayoutOptions,
): StatisticPanelLayout {
  if (scope === "library" || scope === "dashboard") {
    const blueprint =
      scope === "library" ? LIBRARY_DEFAULT_LAYOUT_BLUEPRINT : DASHBOARD_DEFAULT_LAYOUT_BLUEPRINT;
    let comparisonIndex = 0;
    return {
      version: STATISTIC_PANEL_LAYOUT_VERSION,
      items: blueprint.map(({ statisticId, width, height, comparisonSelection }) => {
        if (statisticId === "comparison") {
          comparisonIndex += 1;
        }
        return buildPanelItem(
          scope,
          statisticId,
          buildDefaultInstanceId(statisticId, comparisonIndex),
          comparisonSelection,
          width,
          height,
          options,
        );
      }),
    };
  }

  let comparisonIndex = 0;
  return {
    version: STATISTIC_PANEL_LAYOUT_VERSION,
    items: getDefaultVisibleDefinitions(scope).map((definition) => {
      if (definition.id === "comparison") {
        comparisonIndex += 1;
      }
      return buildPanelItem(
        scope,
        definition.id,
        buildDefaultInstanceId(definition.id, comparisonIndex),
        undefined,
        undefined,
        undefined,
        options,
      );
    }),
  };
}

export function normalizeStatisticPanelLayout(
  scope: StatisticPanelLayoutScope,
  value: unknown,
  options?: StatisticPanelLayoutOptions,
): StatisticPanelLayout {
  return normalizeStatisticPanelLayoutWithIssues(scope, value, options).layout;
}

export function normalizeStatisticPanelLayoutWithIssues(
  scope: StatisticPanelLayoutScope,
  value: unknown,
  options?: StatisticPanelLayoutOptions,
): StatisticPanelLayoutReadResult {
  const supportedDefinitions = getAllSupportedDefinitions(scope);
  const supportedIds = new Set(supportedDefinitions.map((definition) => definition.id));
  const issues: StatisticPanelLayoutMigrationIssue[] = [];
  if (!value || typeof value !== "object") {
    return { layout: buildDefaultStatisticPanelLayout(scope, options), issues: [{ kind: "invalid_layout" }] };
  }

  const hasExplicitItems = Array.isArray((value as Partial<StatisticPanelLayout>).items);
  const candidateItems: unknown[] = hasExplicitItems
    ? ((value as Partial<StatisticPanelLayout>).items as unknown[])
    : [];
  const rawLayoutVersion = (value as Partial<StatisticPanelLayout>).version;
  const layoutVersion = typeof rawLayoutVersion === "number" ? rawLayoutVersion : null;
  const seenInstanceIds = new Set<string>();
  const seenSingleStatisticIds = new Set<StatisticPanelLayoutId>();
  const normalizedItems: StatisticPanelLayoutItem[] = [];
  let comparisonIndex = 0;

  for (const [index, candidate] of candidateItems.entries()) {
    if (!candidate || typeof candidate !== "object") {
      issues.push({ kind: "invalid_item", index });
      continue;
    }

    const statisticId = (candidate as Partial<StatisticPanelLayoutItem>).statisticId;
    if (typeof statisticId !== "string" || !supportedIds.has(statisticId as StatisticPanelLayoutId)) {
      issues.push({
        kind: "unsupported_panel",
        index,
        statisticId: typeof statisticId === "string" ? statisticId : `#${index + 1}`,
      });
      continue;
    }

    if (statisticId !== "comparison") {
      if (seenSingleStatisticIds.has(statisticId as StatisticPanelLayoutId)) {
        issues.push({ kind: "duplicate_panel", statisticId: statisticId as StatisticPanelLayoutId });
        continue;
      }
      seenSingleStatisticIds.add(statisticId as StatisticPanelLayoutId);
    } else {
      comparisonIndex += 1;
    }

    const rawInstanceId = (candidate as Partial<StatisticPanelLayoutItem>).instanceId;
    const fallbackInstanceId = buildDefaultInstanceId(statisticId as StatisticPanelLayoutId, comparisonIndex);
    const instanceId =
      typeof rawInstanceId === "string" && rawInstanceId.trim().length > 0
        ? rawInstanceId.trim()
        : fallbackInstanceId;
    if (seenInstanceIds.has(instanceId)) {
      issues.push({
        kind: "duplicate_instance",
        statisticId: statisticId as StatisticPanelLayoutId,
        instanceId,
      });
      continue;
    }
    seenInstanceIds.add(instanceId);

    const normalizedItem = buildPanelItem(
      scope,
      statisticId as StatisticPanelLayoutId,
      instanceId,
      (candidate as Partial<StatisticPanelLayoutItem>).comparisonSelection,
      (candidate as Partial<StatisticPanelLayoutItem>).width,
      (candidate as Partial<StatisticPanelLayoutItem>).height,
      options,
    );

    const rawWidth = (candidate as Partial<StatisticPanelLayoutItem>).width;
    if (typeof rawWidth === "number" && Number.isFinite(rawWidth) && Math.round(rawWidth) !== normalizedItem.width) {
      issues.push({
        kind: "resized_panel",
        statisticId: statisticId as StatisticPanelLayoutId,
        instanceId,
        axis: "width",
        requested: rawWidth,
        applied: normalizedItem.width,
      });
    }

    const rawHeight = (candidate as Partial<StatisticPanelLayoutItem>).height;
    if (typeof rawHeight === "number" && Number.isFinite(rawHeight) && Math.round(rawHeight) !== normalizedItem.height) {
      issues.push({
        kind: "resized_panel",
        statisticId: statisticId as StatisticPanelLayoutId,
        instanceId,
        axis: "height",
        requested: rawHeight,
        applied: normalizedItem.height,
      });
    }

    const previousComparisonSelection = formatStoredComparisonSelection(
      (candidate as Partial<StatisticPanelLayoutItem>).comparisonSelection,
    );
    if (
      statisticId === "comparison" &&
      previousComparisonSelection &&
      normalizedItem.comparisonSelection &&
      previousComparisonSelection !== formatComparisonSelection(normalizedItem.comparisonSelection)
    ) {
      issues.push({
        kind: "comparison_selection_adjusted",
        instanceId,
        previousSelection: previousComparisonSelection,
        appliedSelection: formatComparisonSelection(normalizedItem.comparisonSelection),
      });
    }

    normalizedItems.push(normalizedItem);
  }

  if (normalizedItems.length > 0) {
    return { layout: { version: STATISTIC_PANEL_LAYOUT_VERSION, items: normalizedItems }, issues };
  }
  if (hasExplicitItems) {
    return { layout: { version: STATISTIC_PANEL_LAYOUT_VERSION, items: [] }, issues };
  }
  return { layout: buildDefaultStatisticPanelLayout(scope, options), issues: [{ kind: "invalid_layout" }] };
}

export function getStatisticPanelLayout(
  scope: StatisticPanelLayoutScope,
  pageKey: string,
  options?: StatisticPanelLayoutOptions,
): StatisticPanelLayout {
  return getStatisticPanelLayoutReadResult(scope, pageKey, options).layout;
}

export function getStatisticPanelLayoutReadResult(
  scope: StatisticPanelLayoutScope,
  pageKey: string,
  options?: StatisticPanelLayoutOptions,
): StatisticPanelLayoutReadResult {
  if (typeof window === "undefined") {
    return { layout: buildDefaultStatisticPanelLayout(scope, options), issues: [] };
  }

  const raw = window.localStorage.getItem(buildStorageKey(scope, pageKey));
  if (!raw) {
    return { layout: buildDefaultStatisticPanelLayout(scope, options), issues: [] };
  }

  try {
    return normalizeStatisticPanelLayoutWithIssues(scope, JSON.parse(raw), options);
  } catch {
    return { layout: buildDefaultStatisticPanelLayout(scope, options), issues: [{ kind: "invalid_json" }] };
  }
}

export function saveStatisticPanelLayout(
  scope: StatisticPanelLayoutScope,
  pageKey: string,
  layout: StatisticPanelLayout,
  options?: StatisticPanelLayoutOptions,
): StatisticPanelLayout {
  const normalized = normalizeStatisticPanelLayout(scope, layout, options);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(buildStorageKey(scope, pageKey), JSON.stringify(normalized));
  }
  return normalized;
}

export function getAvailableStatisticPanelDefinitions(
  scope: StatisticPanelLayoutScope,
  layout: StatisticPanelLayout,
): StatisticPanelLayoutMenuDefinition[] {
  const activeSinglePanels = new Set(
    layout.items
      .filter((item) => item.statisticId !== "comparison")
      .map((item) => item.statisticId),
  );

  return getAllSupportedDefinitions(scope).filter(
    (definition) => definition.id === "comparison" || !activeSinglePanels.has(definition.id),
  );
}

export function addStatisticPanelLayoutItem(
  scope: StatisticPanelLayoutScope,
  layout: StatisticPanelLayout,
  statisticId: StatisticPanelLayoutId,
  options?: StatisticPanelLayoutOptions,
): StatisticPanelLayout {
  if (
    statisticId !== "comparison" &&
    layout.items.some((item) => item.statisticId === statisticId)
  ) {
    return layout;
  }

  const comparisonCount = layout.items.filter((item) => item.statisticId === "comparison").length;
  const instanceId =
    statisticId === "comparison"
      ? buildDefaultInstanceId(statisticId, comparisonCount + 1)
      : statisticId;

  return normalizeStatisticPanelLayout(scope, {
    version: layout.version ?? STATISTIC_PANEL_LAYOUT_VERSION,
    items: [
      ...layout.items,
      buildPanelItem(
        scope,
        statisticId,
        instanceId,
        undefined,
        ((scope === "library" &&
          (statisticId === "history" || statisticId === "duplicates" || statisticId === "analyzed_files")) ||
          (scope === "dashboard" && statisticId === "history"))
          ? undefined
          : 1,
        ((scope === "library" &&
          (statisticId === "history" || statisticId === "duplicates" || statisticId === "analyzed_files")) ||
          (scope === "dashboard" && statisticId === "history"))
          ? undefined
          : 2,
        options,
      ),
    ],
  }, options);
}

export function moveStatisticPanelLayoutItem(
  layout: StatisticPanelLayout,
  draggedInstanceId: string,
  targetInstanceId: string,
): StatisticPanelLayout {
  if (draggedInstanceId === targetInstanceId) {
    return layout;
  }

  const nextItems = [...layout.items];
  const draggedIndex = nextItems.findIndex((item) => item.instanceId === draggedInstanceId);
  const targetIndex = nextItems.findIndex((item) => item.instanceId === targetInstanceId);
  if (draggedIndex === -1 || targetIndex === -1) {
    return layout;
  }

  const [draggedItem] = nextItems.splice(draggedIndex, 1);
  nextItems.splice(targetIndex, 0, draggedItem);
  return { version: STATISTIC_PANEL_LAYOUT_VERSION, items: nextItems };
}

export function resizeStatisticPanelLayoutItem(
  scope: StatisticPanelLayoutScope,
  layout: StatisticPanelLayout,
  instanceId: string,
  sizePatch: Partial<Pick<StatisticPanelLayoutItem, "width" | "height">>,
  options?: StatisticPanelLayoutOptions,
): StatisticPanelLayout {
  return {
    version: STATISTIC_PANEL_LAYOUT_VERSION,
    items: layout.items.map((item) =>
      item.instanceId === instanceId
        ? {
            ...item,
            width: clampPanelUnits(sizePatch.width ?? item.width, "width", scope, item.statisticId, options),
            height: clampPanelUnits(sizePatch.height ?? item.height, "height", scope, item.statisticId, options),
          }
        : item,
    ),
  };
}

export function removeStatisticPanelLayoutItem(
  layout: StatisticPanelLayout,
  instanceId: string,
): StatisticPanelLayout {
  return {
    version: STATISTIC_PANEL_LAYOUT_VERSION,
    items: layout.items.filter((item) => item.instanceId !== instanceId),
  };
}

export function updateStatisticPanelLayoutComparisonSelection(
  scope: StatisticPanelLayoutScope,
  layout: StatisticPanelLayout,
  instanceId: string,
  comparisonSelection: ComparisonSelection,
): StatisticPanelLayout {
  const normalizedSelection = normalizeComparisonSelection(scope, comparisonSelection);
  return {
    version: STATISTIC_PANEL_LAYOUT_VERSION,
    items: layout.items.map((item) =>
      item.instanceId === instanceId && item.statisticId === "comparison"
        ? {
            ...item,
            comparisonSelection: normalizedSelection,
          }
        : item,
    ),
  };
}

export function getStatisticPanelSizeConfigForItem(
  scope: StatisticPanelLayoutScope,
  statisticId: StatisticPanelLayoutId,
  options?: StatisticPanelLayoutOptions,
): PanelSizeConfig {
  return getPanelSizeConfig(scope, statisticId, options);
}
