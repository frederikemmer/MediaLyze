import {
  getLibraryStatisticsSettings,
  getVisibleDashboardStatisticPanels,
  getVisibleLibraryStatisticPanels,
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

export type StatisticPanelLayoutItem = {
  instanceId: string;
  statisticId: LibraryStatisticId;
  width: number;
  height: number;
  comparisonSelection?: ComparisonSelection;
};

export type StatisticPanelLayout = {
  items: StatisticPanelLayoutItem[];
};

const STORAGE_KEY_PREFIX = "medialyze-statistic-panel-layout";
const MIN_PANEL_UNITS = 1;
const MAX_PANEL_UNITS = 4;

function buildStorageKey(scope: StatisticPanelLayoutScope, pageKey: string): string {
  return `${STORAGE_KEY_PREFIX}-${scope}-${pageKey}`;
}

function getAllSupportedDefinitions(scope: StatisticPanelLayoutScope): LibraryStatisticDefinition[] {
  return LIBRARY_STATISTIC_DEFINITIONS.filter((definition) =>
    scope === "dashboard" ? definition.supportsDashboard : definition.supportsPanel,
  );
}

function getDefaultVisibleDefinitions(scope: StatisticPanelLayoutScope): LibraryStatisticDefinition[] {
  return scope === "dashboard"
    ? getVisibleDashboardStatisticPanels(getLibraryStatisticsSettings())
    : getVisibleLibraryStatisticPanels(getLibraryStatisticsSettings());
}

function getDefaultPanelSize(statisticId: LibraryStatisticId): Pick<StatisticPanelLayoutItem, "width" | "height"> {
  if (statisticId === "comparison") {
    return { width: 2, height: 2 };
  }
  if (statisticId === "size" || statisticId === "quality_score" || statisticId === "duration" || statisticId === "bitrate" || statisticId === "audio_bitrate") {
    return { width: 2, height: 1 };
  }
  return { width: 1, height: 1 };
}

function clampPanelUnits(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MIN_PANEL_UNITS;
  }
  return Math.min(MAX_PANEL_UNITS, Math.max(MIN_PANEL_UNITS, Math.round(value)));
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

function buildDefaultInstanceId(statisticId: LibraryStatisticId, comparisonIndex: number): string {
  return statisticId === "comparison" ? `comparison-${comparisonIndex}` : statisticId;
}

function buildPanelItem(
  scope: StatisticPanelLayoutScope,
  statisticId: LibraryStatisticId,
  instanceId: string,
  comparisonSelection?: unknown,
  width?: unknown,
  height?: unknown,
): StatisticPanelLayoutItem {
  const defaultSize = getDefaultPanelSize(statisticId);
  return {
    instanceId,
    statisticId,
    width: clampPanelUnits(width ?? defaultSize.width),
    height: clampPanelUnits(height ?? defaultSize.height),
    comparisonSelection:
      statisticId === "comparison"
        ? normalizeComparisonSelection(scope, comparisonSelection)
        : undefined,
  };
}

export function cloneStatisticPanelLayout(layout: StatisticPanelLayout): StatisticPanelLayout {
  return {
    items: layout.items.map((item) => ({
      ...item,
      comparisonSelection: item.comparisonSelection ? { ...item.comparisonSelection } : undefined,
    })),
  };
}

export function buildDefaultStatisticPanelLayout(scope: StatisticPanelLayoutScope): StatisticPanelLayout {
  let comparisonIndex = 0;
  return {
    items: getDefaultVisibleDefinitions(scope).map((definition) => {
      if (definition.id === "comparison") {
        comparisonIndex += 1;
      }
      return buildPanelItem(
        scope,
        definition.id,
        buildDefaultInstanceId(definition.id, comparisonIndex),
      );
    }),
  };
}

export function normalizeStatisticPanelLayout(
  scope: StatisticPanelLayoutScope,
  value: unknown,
): StatisticPanelLayout {
  const supportedDefinitions = getAllSupportedDefinitions(scope);
  const supportedIds = new Set(supportedDefinitions.map((definition) => definition.id));
  if (!value || typeof value !== "object") {
    return buildDefaultStatisticPanelLayout(scope);
  }

  const candidateItems: unknown[] = Array.isArray((value as Partial<StatisticPanelLayout>).items)
    ? (value as Partial<StatisticPanelLayout>).items as unknown[]
    : [];
  const seenInstanceIds = new Set<string>();
  const seenSingleStatisticIds = new Set<LibraryStatisticId>();
  const normalizedItems: StatisticPanelLayoutItem[] = [];
  let comparisonIndex = 0;

  for (const candidate of candidateItems) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const statisticId = (candidate as Partial<StatisticPanelLayoutItem>).statisticId;
    if (typeof statisticId !== "string" || !supportedIds.has(statisticId as LibraryStatisticId)) {
      continue;
    }

    if (statisticId !== "comparison") {
      if (seenSingleStatisticIds.has(statisticId as LibraryStatisticId)) {
        continue;
      }
      seenSingleStatisticIds.add(statisticId as LibraryStatisticId);
    } else {
      comparisonIndex += 1;
    }

    const rawInstanceId = (candidate as Partial<StatisticPanelLayoutItem>).instanceId;
    const fallbackInstanceId = buildDefaultInstanceId(statisticId as LibraryStatisticId, comparisonIndex);
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
        statisticId as LibraryStatisticId,
        instanceId,
        (candidate as Partial<StatisticPanelLayoutItem>).comparisonSelection,
        (candidate as Partial<StatisticPanelLayoutItem>).width,
        (candidate as Partial<StatisticPanelLayoutItem>).height,
      ),
    );
  }

  return normalizedItems.length > 0 ? { items: normalizedItems } : buildDefaultStatisticPanelLayout(scope);
}

export function getStatisticPanelLayout(
  scope: StatisticPanelLayoutScope,
  pageKey: string,
): StatisticPanelLayout {
  if (typeof window === "undefined") {
    return buildDefaultStatisticPanelLayout(scope);
  }

  const raw = window.localStorage.getItem(buildStorageKey(scope, pageKey));
  if (!raw) {
    return buildDefaultStatisticPanelLayout(scope);
  }

  try {
    return normalizeStatisticPanelLayout(scope, JSON.parse(raw));
  } catch {
    return buildDefaultStatisticPanelLayout(scope);
  }
}

export function saveStatisticPanelLayout(
  scope: StatisticPanelLayoutScope,
  pageKey: string,
  layout: StatisticPanelLayout,
): StatisticPanelLayout {
  const normalized = normalizeStatisticPanelLayout(scope, layout);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(buildStorageKey(scope, pageKey), JSON.stringify(normalized));
  }
  return normalized;
}

export function getAvailableStatisticPanelDefinitions(
  scope: StatisticPanelLayoutScope,
  layout: StatisticPanelLayout,
): LibraryStatisticDefinition[] {
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
  statisticId: LibraryStatisticId,
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
    items: [...layout.items, buildPanelItem(scope, statisticId, instanceId)],
  });
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
  return { items: nextItems };
}

export function resizeStatisticPanelLayoutItem(
  layout: StatisticPanelLayout,
  instanceId: string,
  sizePatch: Partial<Pick<StatisticPanelLayoutItem, "width" | "height">>,
): StatisticPanelLayout {
  return {
    items: layout.items.map((item) =>
      item.instanceId === instanceId
        ? {
            ...item,
            width: clampPanelUnits(sizePatch.width ?? item.width),
            height: clampPanelUnits(sizePatch.height ?? item.height),
          }
        : item,
    ),
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
