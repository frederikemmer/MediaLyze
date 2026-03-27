import type { DashboardResponse, LibraryStatistics, MediaFileSortKey } from "./api";

export type LibraryStatisticId =
  | "size"
  | "video_codec"
  | "resolution"
  | "hdr_type"
  | "duration"
  | "audio_codecs"
  | "audio_languages"
  | "subtitle_languages"
  | "subtitle_codecs"
  | "subtitle_sources"
  | "duplicates"
  | "quality_score";

type LibraryStatisticPanelDataKey =
  | "video_codec_distribution"
  | "resolution_distribution"
  | "hdr_distribution"
  | "audio_codec_distribution"
  | "audio_language_distribution"
  | "subtitle_language_distribution"
  | "subtitle_codec_distribution"
  | "subtitle_source_distribution"
  | "duplicate_distribution";

type DashboardStatisticPanelDataKey =
  | "video_codec_distribution"
  | "resolution_distribution"
  | "hdr_distribution"
  | "audio_codec_distribution"
  | "audio_language_distribution"
  | "subtitle_distribution";

type DistributionFormatKind = "video" | "audio" | "subtitle";

export type LibraryStatisticDefinition = {
  id: LibraryStatisticId;
  nameKey: string;
  supportsPanel: boolean;
  supportsTable: boolean;
  supportsDashboard: boolean;
  defaultPanelEnabled: boolean;
  defaultTableEnabled: boolean;
  defaultDashboardEnabled: boolean;
  panelTitleKey?: string;
  panelDataKey?: LibraryStatisticPanelDataKey;
  panelFormatKind?: DistributionFormatKind;
  tableColumnKey?: MediaFileSortKey;
  dashboardTitleKey?: string;
  dashboardDataKey?: DashboardStatisticPanelDataKey;
  dashboardFormatKind?: DistributionFormatKind;
};

export type LibraryStatisticVisibility = {
  panelEnabled: boolean;
  tableEnabled: boolean;
  dashboardEnabled: boolean;
};

export type LibraryStatisticsSettings = {
  order: LibraryStatisticId[];
  visibility: Record<LibraryStatisticId, LibraryStatisticVisibility>;
};

const STORAGE_KEY = "medialyze-library-statistics-settings";

export const LIBRARY_STATISTIC_DEFINITIONS: LibraryStatisticDefinition[] = [
  {
    id: "size",
    nameKey: "libraryStatistics.items.size",
    supportsPanel: false,
    supportsTable: true,
    supportsDashboard: false,
    defaultPanelEnabled: false,
    defaultTableEnabled: true,
    defaultDashboardEnabled: false,
    tableColumnKey: "size",
  },
  {
    id: "duplicates",
    nameKey: "libraryStatistics.items.duplicates",
    supportsPanel: true,
    supportsTable: false,
    supportsDashboard: false,
    defaultPanelEnabled: true,
    defaultTableEnabled: false,
    defaultDashboardEnabled: false,
    panelTitleKey: "libraryDetail.duplicates",
    panelDataKey: "duplicate_distribution",
  },
  {
    id: "quality_score",
    nameKey: "libraryStatistics.items.qualityScore",
    supportsPanel: false,
    supportsTable: true,
    supportsDashboard: false,
    defaultPanelEnabled: false,
    defaultTableEnabled: true,
    defaultDashboardEnabled: false,
    tableColumnKey: "quality_score",
  },
  {
    id: "video_codec",
    nameKey: "libraryStatistics.items.videoCodec",
    supportsPanel: true,
    supportsTable: true,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.videoCodecs",
    panelDataKey: "video_codec_distribution",
    panelFormatKind: "video",
    tableColumnKey: "video_codec",
    dashboardTitleKey: "dashboard.videoCodecs",
    dashboardDataKey: "video_codec_distribution",
    dashboardFormatKind: "video",
  },
  {
    id: "resolution",
    nameKey: "libraryStatistics.items.resolution",
    supportsPanel: true,
    supportsTable: true,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.resolutions",
    panelDataKey: "resolution_distribution",
    tableColumnKey: "resolution",
    dashboardTitleKey: "dashboard.resolutions",
    dashboardDataKey: "resolution_distribution",
  },
  {
    id: "hdr_type",
    nameKey: "libraryStatistics.items.dynamicRange",
    supportsPanel: true,
    supportsTable: true,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.hdrCoverage",
    panelDataKey: "hdr_distribution",
    tableColumnKey: "hdr_type",
    dashboardTitleKey: "dashboard.hdrCoverage",
    dashboardDataKey: "hdr_distribution",
  },
  {
    id: "duration",
    nameKey: "libraryStatistics.items.duration",
    supportsPanel: false,
    supportsTable: true,
    supportsDashboard: false,
    defaultPanelEnabled: false,
    defaultTableEnabled: true,
    defaultDashboardEnabled: false,
    tableColumnKey: "duration",
  },
  {
    id: "audio_codecs",
    nameKey: "libraryStatistics.items.audioCodecs",
    supportsPanel: true,
    supportsTable: true,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: false,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.audioCodecs",
    panelDataKey: "audio_codec_distribution",
    panelFormatKind: "audio",
    tableColumnKey: "audio_codecs",
    dashboardTitleKey: "dashboard.audioCodecs",
    dashboardDataKey: "audio_codec_distribution",
    dashboardFormatKind: "audio",
  },
  {
    id: "audio_languages",
    nameKey: "libraryStatistics.items.audioLanguages",
    supportsPanel: true,
    supportsTable: true,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.audioLanguages",
    panelDataKey: "audio_language_distribution",
    tableColumnKey: "audio_languages",
    dashboardTitleKey: "dashboard.audioLanguages",
    dashboardDataKey: "audio_language_distribution",
  },
  {
    id: "subtitle_languages",
    nameKey: "libraryStatistics.items.subtitleLanguages",
    supportsPanel: true,
    supportsTable: true,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.subtitleLanguages",
    panelDataKey: "subtitle_language_distribution",
    tableColumnKey: "subtitle_languages",
    dashboardTitleKey: "dashboard.subtitleSources",
    dashboardDataKey: "subtitle_distribution",
  },
  {
    id: "subtitle_codecs",
    nameKey: "libraryStatistics.items.subtitleCodecs",
    supportsPanel: true,
    supportsTable: true,
    supportsDashboard: false,
    defaultPanelEnabled: true,
    defaultTableEnabled: false,
    defaultDashboardEnabled: false,
    panelTitleKey: "libraryDetail.subtitleCodecs",
    panelDataKey: "subtitle_codec_distribution",
    panelFormatKind: "subtitle",
    tableColumnKey: "subtitle_codecs",
  },
  {
    id: "subtitle_sources",
    nameKey: "libraryStatistics.items.subtitleSources",
    supportsPanel: true,
    supportsTable: true,
    supportsDashboard: false,
    defaultPanelEnabled: false,
    defaultTableEnabled: false,
    defaultDashboardEnabled: false,
    panelTitleKey: "libraryDetail.subtitleSources",
    panelDataKey: "subtitle_source_distribution",
    tableColumnKey: "subtitle_sources",
  },
];

const STATISTIC_DEFINITION_MAP = new Map(
  LIBRARY_STATISTIC_DEFINITIONS.map((definition) => [definition.id, definition]),
);

const LEGACY_DEFAULT_SETTINGS: LibraryStatisticsSettings = {
  order: [
    "size",
    "video_codec",
    "resolution",
    "hdr_type",
    "duration",
    "audio_codecs",
    "audio_languages",
    "subtitle_languages",
    "subtitle_codecs",
    "subtitle_sources",
    "duplicates",
    "quality_score",
  ],
  visibility: {
    size: { panelEnabled: false, tableEnabled: true, dashboardEnabled: false },
    video_codec: { panelEnabled: true, tableEnabled: true, dashboardEnabled: true },
    resolution: { panelEnabled: true, tableEnabled: true, dashboardEnabled: true },
    hdr_type: { panelEnabled: true, tableEnabled: false, dashboardEnabled: true },
    duration: { panelEnabled: false, tableEnabled: true, dashboardEnabled: false },
    audio_codecs: { panelEnabled: true, tableEnabled: true, dashboardEnabled: true },
    audio_languages: { panelEnabled: true, tableEnabled: true, dashboardEnabled: true },
    subtitle_languages: { panelEnabled: true, tableEnabled: true, dashboardEnabled: true },
    subtitle_codecs: { panelEnabled: true, tableEnabled: true, dashboardEnabled: false },
    subtitle_sources: { panelEnabled: false, tableEnabled: false, dashboardEnabled: false },
    duplicates: { panelEnabled: true, tableEnabled: false, dashboardEnabled: false },
    quality_score: { panelEnabled: false, tableEnabled: true, dashboardEnabled: false },
  },
};

function buildDefaultSettings(): LibraryStatisticsSettings {
  const visibility = {} as Record<LibraryStatisticId, LibraryStatisticVisibility>;
  for (const definition of LIBRARY_STATISTIC_DEFINITIONS) {
    visibility[definition.id] = {
      panelEnabled: definition.supportsPanel ? definition.defaultPanelEnabled : false,
      tableEnabled: definition.supportsTable ? definition.defaultTableEnabled : false,
      dashboardEnabled: definition.supportsDashboard ? definition.defaultDashboardEnabled : false,
    };
  }

  return {
    order: LIBRARY_STATISTIC_DEFINITIONS.map((definition) => definition.id),
    visibility,
  };
}

function normalizeSettings(value: unknown): LibraryStatisticsSettings {
  const defaults = buildDefaultSettings();
  if (!value || typeof value !== "object") {
    return defaults;
  }

  const candidate = value as Partial<LibraryStatisticsSettings>;
  const candidateOrder = Array.isArray(candidate.order) ? candidate.order : [];
  const order = candidateOrder
    .filter((entry): entry is LibraryStatisticId => typeof entry === "string" && STATISTIC_DEFINITION_MAP.has(entry as LibraryStatisticId))
    .filter((entry, index, entries) => entries.indexOf(entry) === index);

  for (const definition of LIBRARY_STATISTIC_DEFINITIONS) {
    if (!order.includes(definition.id)) {
      order.push(definition.id);
    }
  }

  const visibility = {} as Record<LibraryStatisticId, LibraryStatisticVisibility>;
  const candidateVisibility =
    candidate.visibility && typeof candidate.visibility === "object"
      ? (candidate.visibility as Partial<Record<LibraryStatisticId, Partial<LibraryStatisticVisibility>>>)
      : {};

  for (const definition of LIBRARY_STATISTIC_DEFINITIONS) {
    const stored = candidateVisibility[definition.id];
    visibility[definition.id] = {
      panelEnabled:
        definition.supportsPanel && typeof stored?.panelEnabled === "boolean"
          ? stored.panelEnabled
          : defaults.visibility[definition.id].panelEnabled,
      tableEnabled:
        definition.supportsTable && typeof stored?.tableEnabled === "boolean"
          ? stored.tableEnabled
          : defaults.visibility[definition.id].tableEnabled,
      dashboardEnabled:
        definition.supportsDashboard && typeof stored?.dashboardEnabled === "boolean"
          ? stored.dashboardEnabled
          : defaults.visibility[definition.id].dashboardEnabled,
    };
  }

  return { order, visibility };
}

function settingsEqual(left: LibraryStatisticsSettings, right: LibraryStatisticsSettings): boolean {
  if (left.order.length !== right.order.length) {
    return false;
  }

  for (let index = 0; index < left.order.length; index += 1) {
    if (left.order[index] !== right.order[index]) {
      return false;
    }
  }

  for (const definition of LIBRARY_STATISTIC_DEFINITIONS) {
    if (left.visibility[definition.id].panelEnabled !== right.visibility[definition.id].panelEnabled) {
      return false;
    }
    if (left.visibility[definition.id].tableEnabled !== right.visibility[definition.id].tableEnabled) {
      return false;
    }
    if (left.visibility[definition.id].dashboardEnabled !== right.visibility[definition.id].dashboardEnabled) {
      return false;
    }
  }

  return true;
}

export function getLibraryStatisticsSettings(): LibraryStatisticsSettings {
  if (typeof window === "undefined") {
    return buildDefaultSettings();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return buildDefaultSettings();
  }

  try {
    const normalized = normalizeSettings(JSON.parse(raw));
    if (settingsEqual(normalized, LEGACY_DEFAULT_SETTINGS)) {
      const defaults = buildDefaultSettings();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
      return defaults;
    }
    return normalized;
  } catch {
    return buildDefaultSettings();
  }
}

export function saveLibraryStatisticsSettings(settings: LibraryStatisticsSettings): LibraryStatisticsSettings {
  const normalized = normalizeSettings(settings);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function moveLibraryStatistic(
  settings: LibraryStatisticsSettings,
  draggedId: LibraryStatisticId,
  targetId: LibraryStatisticId,
): LibraryStatisticsSettings {
  if (draggedId === targetId) {
    return settings;
  }

  const nextOrder = [...settings.order];
  const draggedIndex = nextOrder.indexOf(draggedId);
  const targetIndex = nextOrder.indexOf(targetId);

  if (draggedIndex === -1 || targetIndex === -1) {
    return settings;
  }

  nextOrder.splice(draggedIndex, 1);
  nextOrder.splice(targetIndex, 0, draggedId);

  return {
    ...settings,
    order: nextOrder,
  };
}

export function updateLibraryStatisticVisibility(
  settings: LibraryStatisticsSettings,
  statisticId: LibraryStatisticId,
  patch: Partial<LibraryStatisticVisibility>,
): LibraryStatisticsSettings {
  return {
    ...settings,
    visibility: {
      ...settings.visibility,
      [statisticId]: {
        ...settings.visibility[statisticId],
        ...patch,
      },
    },
  };
}

export function getOrderedLibraryStatisticDefinitions(settings: LibraryStatisticsSettings): LibraryStatisticDefinition[] {
  return settings.order
    .map((id) => STATISTIC_DEFINITION_MAP.get(id))
    .filter((definition): definition is LibraryStatisticDefinition => Boolean(definition));
}

export function getVisibleLibraryStatisticPanels(
  settings: LibraryStatisticsSettings,
): LibraryStatisticDefinition[] {
  return getOrderedLibraryStatisticDefinitions(settings).filter(
    (definition) => definition.supportsPanel && settings.visibility[definition.id].panelEnabled,
  );
}

export function getVisibleDashboardStatisticPanels(
  settings: LibraryStatisticsSettings,
): LibraryStatisticDefinition[] {
  return getOrderedLibraryStatisticDefinitions(settings).filter(
    (definition) => definition.supportsDashboard && settings.visibility[definition.id].dashboardEnabled,
  );
}

export function getVisibleLibraryStatisticTableColumns(
  settings: LibraryStatisticsSettings,
): MediaFileSortKey[] {
  return getOrderedLibraryStatisticDefinitions(settings)
    .filter((definition) => definition.supportsTable && settings.visibility[definition.id].tableEnabled)
    .map((definition) => definition.tableColumnKey)
    .filter((column): column is MediaFileSortKey => typeof column === "string");
}

export function getLibraryStatisticPanelItems(
  library: LibraryStatistics | null,
  definition: LibraryStatisticDefinition,
) {
  if (!library || !definition.panelDataKey) {
    return [];
  }
  return library[definition.panelDataKey];
}

export function getDashboardStatisticPanelItems(
  dashboard: DashboardResponse | null,
  definition: LibraryStatisticDefinition,
) {
  if (!dashboard || !definition.dashboardDataKey) {
    return [];
  }
  return dashboard[definition.dashboardDataKey];
}
