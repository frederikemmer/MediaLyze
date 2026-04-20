import {
  LIBRARY_STATISTIC_DEFINITIONS,
  type LibraryStatisticDefinition,
  type LibraryStatisticId,
} from "./library-statistics-settings";
import {
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

const STORAGE_KEY_PREFIX = "medialyze-statistic-panel-layout";
const STATISTIC_PANEL_LAYOUT_VERSION = 3;
const MAX_PANEL_WIDTH_UNITS = 4;

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
  const xField = typeof candidate.xField === "string" ? candidate.xField : fallback.xField;
  const yField = typeof candidate.yField === "string" ? candidate.yField : fallback.yField;
  const renderer = sanitizeComparisonRenderer(
    xField,
    yField,
    typeof candidate.renderer === "string" ? candidate.renderer : fallback.renderer,
  );

  return { xField, yField, renderer };
}

function buildDefaultInstanceId(statisticId: StatisticPanelLayoutId, comparisonIndex: number): string {
  return statisticId === "comparison" ? `comparison-${comparisonIndex}` : statisticId;
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
  const supportedDefinitions = getAllSupportedDefinitions(scope);
  const supportedIds = new Set(supportedDefinitions.map((definition) => definition.id));
  if (!value || typeof value !== "object") {
    return buildDefaultStatisticPanelLayout(scope, options);
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

  for (const candidate of candidateItems) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const statisticId = (candidate as Partial<StatisticPanelLayoutItem>).statisticId;
    if (typeof statisticId !== "string" || !supportedIds.has(statisticId as StatisticPanelLayoutId)) {
      continue;
    }

    if (statisticId !== "comparison") {
      if (seenSingleStatisticIds.has(statisticId as StatisticPanelLayoutId)) {
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
      continue;
    }
    seenInstanceIds.add(instanceId);

    normalizedItems.push(
      buildPanelItem(
        scope,
        statisticId as StatisticPanelLayoutId,
        instanceId,
        (candidate as Partial<StatisticPanelLayoutItem>).comparisonSelection,
        (candidate as Partial<StatisticPanelLayoutItem>).width,
        (candidate as Partial<StatisticPanelLayoutItem>).height,
        options,
      ),
    );
  }

  if (normalizedItems.length > 0) {
    if (
      scope === "dashboard" &&
      (layoutVersion === null || layoutVersion < STATISTIC_PANEL_LAYOUT_VERSION) &&
      !normalizedItems.some((item) => item.statisticId === "history")
    ) {
      normalizedItems.unshift(
        buildPanelItem(scope, "history", "history", undefined, undefined, undefined, options),
      );
    }

    if (scope === "library" && layoutVersion === null) {
      const hasAnyExtraLibraryPanel = normalizedItems.some(
        (item) =>
          item.statisticId === "history" ||
          item.statisticId === "duplicates" ||
          item.statisticId === "analyzed_files",
      );

      if (!hasAnyExtraLibraryPanel) {
        for (const extraDefinition of LIBRARY_EXTRA_LAYOUT_DEFINITIONS) {
          normalizedItems.push(
            buildPanelItem(scope, extraDefinition.id, extraDefinition.id, undefined, undefined, undefined, options),
          );
        }
      }
    }

    return { version: STATISTIC_PANEL_LAYOUT_VERSION, items: normalizedItems };
  }
  if (hasExplicitItems && candidateItems.length === 0) {
    if (scope === "dashboard" && (layoutVersion === null || layoutVersion < STATISTIC_PANEL_LAYOUT_VERSION)) {
      return {
        version: STATISTIC_PANEL_LAYOUT_VERSION,
        items: [buildPanelItem(scope, "history", "history", undefined, undefined, undefined, options)],
      };
    }
    return { version: STATISTIC_PANEL_LAYOUT_VERSION, items: [] };
  }
  return buildDefaultStatisticPanelLayout(scope, options);
}

export function getStatisticPanelLayout(
  scope: StatisticPanelLayoutScope,
  pageKey: string,
  options?: StatisticPanelLayoutOptions,
): StatisticPanelLayout {
  if (typeof window === "undefined") {
    return buildDefaultStatisticPanelLayout(scope, options);
  }

  const raw = window.localStorage.getItem(buildStorageKey(scope, pageKey));
  if (!raw) {
    return buildDefaultStatisticPanelLayout(scope, options);
  }

  try {
    return normalizeStatisticPanelLayout(scope, JSON.parse(raw), options);
  } catch {
    return buildDefaultStatisticPanelLayout(scope, options);
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
