import type {
  DashboardResponse,
  LibraryType,
  LibraryStatistics,
  MediaFileSortKey,
  NumericDistribution,
  NumericDistributionMetricId,
} from "./api";

export type LibraryStatisticId =
  | "size"
  | "comparison"
  | "container"
  | "video_codec"
  | "resolution"
  | "video_bit_depth"
  | "hdr_type"
  | "duration"
  | "audio_codecs"
  | "audio_spatial_profiles"
  | "audio_languages"
  | "subtitle_languages"
  | "subtitle_codecs"
  | "subtitle_sources"
  | "quality_score"
  | "bitrate"
  | "audio_bitrate"
  | "bit_depth"
  | "audio_artists"
  | "audio_albums"
  | "audio_genres"
  | "audio_years"
  | "audio_channels"
  | "sample_rates"
  | "track_numbers"
  | "bit_rate_modes"
  | "embedded_covers"
  | "audiobook_narrators"
  | "audiobook_authors"
  | "audiobook_publishers"
  | "audiobook_series"
  | "audiobook_series_parts"
  | "chapter_counts"
  | "chapter_titles"
  | "audio_title"
  | "audio_artist"
  | "audio_album"
  | "audio_album_artist"
  | "audio_genre"
  | "audio_date"
  | "audio_disc"
  | "audio_composer"
  | "sample_rate"
  | "track_number"
  | "bit_rate_mode"
  | "has_embedded_cover"
  | "chapter_count"
  | "audiobook_narrator"
  | "audiobook_author"
  | "audiobook_publisher"
  | "audiobook_series"
  | "audiobook_series_part"
  | "audiobook_description"
  | "audiobook_copyright"
  | "audiobook_language"
  | "audiobook_abridged"
  | "audiobook_asin"
  | "audiobook_isbn";

type LibraryStatisticPanelDataKey =
  | "container_distribution"
  | "video_codec_distribution"
  | "resolution_distribution"
  | "video_bit_depth_distribution"
  | "hdr_distribution"
  | "bit_depth_distribution"
  | "audio_codec_distribution"
  | "audio_spatial_profile_distribution"
  | "audio_language_distribution"
  | "audio_artist_distribution"
  | "audio_album_distribution"
  | "audio_genre_distribution"
  | "audio_year_distribution"
  | "audio_channel_distribution"
  | "sample_rate_distribution"
  | "track_number_distribution"
  | "bit_rate_mode_distribution"
  | "embedded_cover_distribution"
  | "audiobook_narrator_distribution"
  | "audiobook_author_distribution"
  | "audiobook_publisher_distribution"
  | "audiobook_series_distribution"
  | "audiobook_series_part_distribution"
  | "chapter_count_distribution"
  | "subtitle_language_distribution"
  | "subtitle_codec_distribution"
  | "subtitle_source_distribution";

type DashboardStatisticPanelDataKey =
  | "container_distribution"
  | "video_codec_distribution"
  | "resolution_distribution"
  | "video_bit_depth_distribution"
  | "hdr_distribution"
  | "bit_depth_distribution"
  | "audio_codec_distribution"
  | "audio_spatial_profile_distribution"
  | "audio_language_distribution"
  | "audio_artist_distribution"
  | "audio_album_distribution"
  | "audio_genre_distribution"
  | "audio_year_distribution"
  | "audio_channel_distribution"
  | "sample_rate_distribution"
  | "track_number_distribution"
  | "bit_rate_mode_distribution"
  | "embedded_cover_distribution"
  | "audiobook_narrator_distribution"
  | "audiobook_author_distribution"
  | "audiobook_publisher_distribution"
  | "audiobook_series_distribution"
  | "audiobook_series_part_distribution"
  | "chapter_count_distribution"
  | "subtitle_distribution"
  | "subtitle_codec_distribution"
  | "subtitle_source_distribution";

type DistributionFormatKind = "video" | "audio" | "subtitle";
type StatisticPanelKind = "list" | "numeric-chart" | "comparison";

export type LibraryStatisticDefinition = {
  id: LibraryStatisticId;
  nameKey: string;
  supportsPanel: boolean;
  supportsTable: boolean;
  supportsTableTooltip: boolean;
  supportsDashboard: boolean;
  defaultPanelEnabled: boolean;
  defaultTableEnabled: boolean;
  defaultTableTooltipEnabled: boolean;
  defaultDashboardEnabled: boolean;
  panelKind?: StatisticPanelKind;
  panelTitleKey?: string;
  panelDataKey?: LibraryStatisticPanelDataKey;
  numericMetricId?: NumericDistributionMetricId;
  panelFormatKind?: DistributionFormatKind;
  tableColumnKey?: MediaFileSortKey;
  tableNameKey?: string;
  dashboardTitleKey?: string;
  dashboardDataKey?: DashboardStatisticPanelDataKey;
  dashboardFormatKind?: DistributionFormatKind;
};

export type LibraryStatisticVisibility = {
  panelEnabled: boolean;
  tableEnabled: boolean;
  tableTooltipEnabled: boolean;
  dashboardEnabled: boolean;
};

export type LibraryStatisticsSettings = {
  order: LibraryStatisticId[];
  visibility: Record<LibraryStatisticId, LibraryStatisticVisibility>;
};

const STORAGE_KEY = "medialyze-library-statistics-settings";
const MUSIC_HIDDEN_STATISTIC_IDS = new Set<LibraryStatisticId>([
  "video_codec",
  "resolution",
  "video_bit_depth",
  "hdr_type",
  "bitrate",
  "audio_bitrate",
  "subtitle_languages",
  "subtitle_codecs",
  "subtitle_sources",
  "audio_languages",
]);
const AUDIOBOOK_ONLY_STATISTIC_IDS = new Set<LibraryStatisticId>([
  "audiobook_narrators",
  "audiobook_authors",
  "audiobook_publishers",
  "audiobook_series",
  "audiobook_series_parts",
  "audiobook_series_part",
  "chapter_counts",
  "chapter_titles",
]);
type MusicVisibilityOptions = {
  showMusicQualityScore?: boolean;
  hasVideoMetadata?: boolean;
};

function buildStorageKey(storageScope?: string): string {
  return storageScope ? `${STORAGE_KEY}-${storageScope}` : STORAGE_KEY;
}

export const LIBRARY_STATISTIC_DEFINITIONS: LibraryStatisticDefinition[] = [
  {
    id: "size",
    nameKey: "libraryStatistics.items.size",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: false,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: true,
    panelKind: "numeric-chart",
    numericMetricId: "size",
    panelTitleKey: "libraryDetail.sizeDistribution",
    tableColumnKey: "size",
    dashboardTitleKey: "dashboard.sizeDistribution",
  },
  {
    id: "quality_score",
    nameKey: "libraryStatistics.items.qualityScore",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: true,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultTableTooltipEnabled: true,
    defaultDashboardEnabled: true,
    panelKind: "numeric-chart",
    numericMetricId: "quality_score",
    panelTitleKey: "libraryDetail.qualityScoreDistribution",
    tableColumnKey: "quality_score",
    dashboardTitleKey: "dashboard.qualityScoreDistribution",
  },
  {
    id: "comparison",
    nameKey: "libraryStatistics.items.comparison",
    supportsPanel: true,
    supportsTable: false,
    supportsTableTooltip: false,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: true,
    panelKind: "comparison",
    panelTitleKey: "libraryDetail.comparisonPanel",
    dashboardTitleKey: "dashboard.comparisonPanel",
  },
  {
    id: "video_codec",
    nameKey: "libraryStatistics.items.videoCodec",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: true,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultTableTooltipEnabled: true,
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
    supportsTableTooltip: false,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.resolutions",
    panelDataKey: "resolution_distribution",
    tableColumnKey: "resolution",
    dashboardTitleKey: "dashboard.resolutions",
    dashboardDataKey: "resolution_distribution",
  },
  {
    id: "video_bit_depth",
    nameKey: "libraryStatistics.items.videoBitDepth",
    supportsPanel: true,
    supportsTable: false,
    supportsTableTooltip: false,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: false,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.videoBitDepth",
    panelDataKey: "video_bit_depth_distribution",
    dashboardTitleKey: "dashboard.videoBitDepth",
    dashboardDataKey: "video_bit_depth_distribution",
  },
  {
    id: "hdr_type",
    nameKey: "libraryStatistics.items.hdrProfile",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: false,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.hdrProfile",
    panelDataKey: "hdr_distribution",
    tableColumnKey: "hdr_type",
    dashboardTitleKey: "dashboard.hdrProfile",
    dashboardDataKey: "hdr_distribution",
  },
  {
    id: "duration",
    nameKey: "libraryStatistics.items.duration",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: false,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: true,
    panelKind: "numeric-chart",
    numericMetricId: "duration",
    panelTitleKey: "libraryDetail.durationDistribution",
    tableColumnKey: "duration",
    dashboardTitleKey: "dashboard.durationDistribution",
  },
  {
    id: "bitrate",
    nameKey: "libraryStatistics.items.bitrate",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: false,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: false,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: false,
    panelKind: "numeric-chart",
    numericMetricId: "bitrate",
    panelTitleKey: "libraryDetail.bitrateDistribution",
    tableColumnKey: "bitrate",
    dashboardTitleKey: "dashboard.bitrateDistribution",
  },
  {
    id: "audio_bitrate",
    nameKey: "libraryStatistics.items.audioBitrate",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: false,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: false,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: false,
    panelKind: "numeric-chart",
    numericMetricId: "audio_bitrate",
    panelTitleKey: "libraryDetail.audioBitrateDistribution",
    tableColumnKey: "audio_bitrate",
    dashboardTitleKey: "dashboard.audioBitrateDistribution",
  },
  {
    id: "bit_depth",
    nameKey: "libraryStatistics.items.audioBitDepth",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: false,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: false,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: false,
    panelTitleKey: "libraryDetail.audioBitDepth",
    panelDataKey: "bit_depth_distribution",
    tableColumnKey: "bit_depth",
    dashboardTitleKey: "dashboard.audioBitDepth",
    dashboardDataKey: "bit_depth_distribution",
  },
  {
    id: "container",
    nameKey: "libraryStatistics.items.container",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: false,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: false,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.containers",
    panelDataKey: "container_distribution",
    tableColumnKey: "container",
    dashboardTitleKey: "dashboard.containers",
    dashboardDataKey: "container_distribution",
  },
  {
    id: "audio_codecs",
    nameKey: "libraryStatistics.items.audioCodecs",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: true,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultTableTooltipEnabled: true,
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
    id: "audio_spatial_profiles",
    nameKey: "libraryStatistics.items.audioSpatialProfiles",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: true,
    supportsDashboard: true,
    defaultPanelEnabled: false,
    defaultTableEnabled: false,
    defaultTableTooltipEnabled: true,
    defaultDashboardEnabled: false,
    panelTitleKey: "libraryDetail.audioSpatialProfiles",
    panelDataKey: "audio_spatial_profile_distribution",
    tableColumnKey: "audio_spatial_profiles",
    dashboardTitleKey: "dashboard.audioSpatialProfiles",
    dashboardDataKey: "audio_spatial_profile_distribution",
  },
  {
    id: "audio_languages",
    nameKey: "libraryStatistics.items.audioLanguages",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: true,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultTableTooltipEnabled: true,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.audioLanguages",
    panelDataKey: "audio_language_distribution",
    tableColumnKey: "audio_languages",
    dashboardTitleKey: "dashboard.audioLanguages",
    dashboardDataKey: "audio_language_distribution",
  },
  ...([
    ["audio_artists", "audio_artist_distribution"],
    ["audio_albums", "audio_album_distribution"],
    ["audio_genres", "audio_genre_distribution"],
    ["audio_years", "audio_year_distribution"],
    ["audio_channels", "audio_channel_distribution"],
    ["sample_rates", "sample_rate_distribution"],
    ["track_numbers", "track_number_distribution"],
    ["bit_rate_modes", "bit_rate_mode_distribution"],
    ["embedded_covers", "embedded_cover_distribution"],
    ["audiobook_narrators", "audiobook_narrator_distribution"],
    ["audiobook_authors", "audiobook_author_distribution"],
    ["audiobook_publishers", "audiobook_publisher_distribution"],
    ["audiobook_series", "audiobook_series_distribution"],
    ["audiobook_series_parts", "audiobook_series_part_distribution"],
  ] as const).map(([id, dataKey]) => ({
    id,
    nameKey: `libraryStatistics.items.${id}`,
    tableNameKey: (
      id === "audio_artists" ? "libraryStatistics.items.audio_artist"
      : id === "audio_albums" ? "libraryStatistics.items.audio_album"
      : id === "audio_genres" ? "libraryStatistics.items.audio_genre"
      : id === "audio_years" ? "libraryStatistics.items.audio_date"
      : id === "audio_channels" ? "libraryStatistics.items.audio_channels"
      : id === "sample_rates" ? "libraryStatistics.items.sample_rate"
      : id === "track_numbers" ? "libraryStatistics.items.track_number"
      : id === "bit_rate_modes" ? "libraryStatistics.items.bit_rate_mode"
      : id === "audiobook_narrators" ? "libraryStatistics.items.audiobook_narrator"
      : id === "audiobook_authors" ? "libraryStatistics.items.audiobook_author"
      : id === "audiobook_publishers" ? "libraryStatistics.items.audiobook_publisher"
      : id === "audiobook_series" ? "libraryStatistics.items.audiobook_series"
      : id === "audiobook_series_parts" ? "libraryStatistics.items.audiobook_series_part"
      : "libraryStatistics.items.has_embedded_cover"
    ),
    supportsPanel: true,
    supportsTable: id !== "audiobook_series_parts",
    supportsTableTooltip: false,
    supportsDashboard: true,
    defaultPanelEnabled:
      id === "audio_artists" ||
      id === "audio_albums" ||
      id === "audio_genres" ||
      id === "audiobook_narrators" ||
      id === "audiobook_authors" ||
      id === "audiobook_publishers" ||
      id === "audiobook_series",
    defaultTableEnabled:
      id === "audiobook_narrators" ||
      id === "audiobook_authors" ||
      id === "audiobook_publishers" ||
      id === "audiobook_series",
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: false,
    panelTitleKey: `libraryDetail.${id}`,
    panelDataKey: dataKey,
    tableColumnKey: (
      id === "audio_artists" ? "audio_artist"
      : id === "audio_albums" ? "audio_album"
      : id === "audio_genres" ? "audio_genre"
      : id === "audio_years" ? "audio_date"
      : id === "audio_channels" ? "audio_channels"
      : id === "sample_rates" ? "sample_rate"
      : id === "track_numbers" ? "track_number"
      : id === "bit_rate_modes" ? "bit_rate_mode"
      : id === "audiobook_narrators" ? "audiobook_narrator"
      : id === "audiobook_authors" ? "audiobook_author"
      : id === "audiobook_publishers" ? "audiobook_publisher"
      : id === "audiobook_series" ? "audiobook_series"
      : id === "audiobook_series_parts" ? "audiobook_series_part"
      : "has_embedded_cover"
    ) as MediaFileSortKey,
    dashboardTitleKey: `dashboard.${id}`,
    dashboardDataKey: dataKey,
  })),
  {
    id: "chapter_counts",
    nameKey: "libraryStatistics.items.chapter_count",
    tableNameKey: "libraryStatistics.items.chapter_count",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: false,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: true,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: false,
    panelKind: "numeric-chart",
    numericMetricId: "chapter_count",
    panelTitleKey: "libraryDetail.chapter_counts",
    panelDataKey: "chapter_count_distribution",
    tableColumnKey: "chapter_count",
    dashboardTitleKey: "dashboard.chapter_counts",
    dashboardDataKey: "chapter_count_distribution",
  },
  {
    id: "audiobook_series_part",
    nameKey: "libraryStatistics.items.audiobook_series_part",
    supportsPanel: false,
    supportsTable: true,
    supportsTableTooltip: false,
    supportsDashboard: false,
    defaultPanelEnabled: false,
    defaultTableEnabled: true,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: false,
    tableColumnKey: "audiobook_series_part",
  },
  ...([
    "audiobook_description",
    "audiobook_copyright",
    "audiobook_language",
    "audiobook_abridged",
    "audiobook_asin",
    "audiobook_isbn",
  ] as const).map((id) => ({
    id,
    nameKey: `libraryStatistics.items.${id}`,
    supportsPanel: false,
    supportsTable: true,
    supportsTableTooltip: false,
    supportsDashboard: false,
    defaultPanelEnabled: false,
    defaultTableEnabled: false,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: false,
    tableColumnKey: id,
  })),
  {
    id: "chapter_titles",
    nameKey: "libraryStatistics.items.chapter_titles",
    supportsPanel: false,
    supportsTable: false,
    supportsTableTooltip: false,
    supportsDashboard: false,
    defaultPanelEnabled: false,
    defaultTableEnabled: false,
    defaultTableTooltipEnabled: false,
    defaultDashboardEnabled: false,
  },
  {
    id: "subtitle_languages",
    nameKey: "libraryStatistics.items.subtitleLanguages",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: true,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: false,
    defaultTableTooltipEnabled: true,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.subtitleLanguages",
    panelDataKey: "subtitle_language_distribution",
    tableColumnKey: "subtitle_languages",
    dashboardTitleKey: "dashboard.subtitleLanguages",
    dashboardDataKey: "subtitle_distribution",
  },
  {
    id: "subtitle_codecs",
    nameKey: "libraryStatistics.items.subtitleCodecs",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: true,
    supportsDashboard: true,
    defaultPanelEnabled: true,
    defaultTableEnabled: false,
    defaultTableTooltipEnabled: true,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.subtitleCodecs",
    panelDataKey: "subtitle_codec_distribution",
    panelFormatKind: "subtitle",
    tableColumnKey: "subtitle_codecs",
    dashboardTitleKey: "dashboard.subtitleCodecs",
    dashboardDataKey: "subtitle_codec_distribution",
    dashboardFormatKind: "subtitle",
  },
  {
    id: "subtitle_sources",
    nameKey: "libraryStatistics.items.subtitleSources",
    supportsPanel: true,
    supportsTable: true,
    supportsTableTooltip: true,
    supportsDashboard: true,
    defaultPanelEnabled: false,
    defaultTableEnabled: false,
    defaultTableTooltipEnabled: true,
    defaultDashboardEnabled: true,
    panelTitleKey: "libraryDetail.subtitleSources",
    panelDataKey: "subtitle_source_distribution",
    tableColumnKey: "subtitle_sources",
    dashboardTitleKey: "dashboard.subtitleSources",
    dashboardDataKey: "subtitle_source_distribution",
  },
];

const STATISTIC_DEFINITION_MAP = new Map(
  LIBRARY_STATISTIC_DEFINITIONS.map((definition) => [definition.id, definition]),
);

function buildDefaultSettings(): LibraryStatisticsSettings {
  const visibility = {} as Record<LibraryStatisticId, LibraryStatisticVisibility>;
  for (const definition of LIBRARY_STATISTIC_DEFINITIONS) {
    visibility[definition.id] = {
      panelEnabled: definition.supportsPanel ? definition.defaultPanelEnabled : false,
      tableEnabled: definition.supportsTable ? definition.defaultTableEnabled : false,
      tableTooltipEnabled: definition.supportsTableTooltip ? definition.defaultTableTooltipEnabled : false,
      dashboardEnabled: definition.supportsDashboard ? definition.defaultDashboardEnabled : false,
    };
  }

  return {
    order: LIBRARY_STATISTIC_DEFINITIONS.map((definition) => definition.id),
    visibility,
  };
}

export function buildDefaultLibraryStatisticsSettings(): LibraryStatisticsSettings {
  return buildDefaultSettings();
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
      tableTooltipEnabled:
        definition.supportsTableTooltip && typeof stored?.tableTooltipEnabled === "boolean"
          ? stored.tableTooltipEnabled
          : defaults.visibility[definition.id].tableTooltipEnabled,
      dashboardEnabled:
        definition.supportsDashboard && typeof stored?.dashboardEnabled === "boolean"
          ? stored.dashboardEnabled
          : defaults.visibility[definition.id].dashboardEnabled,
    };
  }

  return { order, visibility };
}

export function cloneLibraryStatisticsSettings(settings: LibraryStatisticsSettings): LibraryStatisticsSettings {
  return {
    order: [...settings.order],
    visibility: Object.fromEntries(
      Object.entries(settings.visibility).map(([key, value]) => [key, { ...value }]),
    ) as LibraryStatisticsSettings["visibility"],
  };
}

export function getLibraryStatisticsSettings(storageScope?: string): LibraryStatisticsSettings {
  if (typeof window === "undefined") {
    return buildDefaultSettings();
  }

  const raw = window.localStorage.getItem(buildStorageKey(storageScope));
  if (!raw) {
    return buildDefaultSettings();
  }

  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return buildDefaultSettings();
  }
}

export function saveLibraryStatisticsSettings(
  settings: LibraryStatisticsSettings,
  storageScope?: string,
): LibraryStatisticsSettings {
  const normalized = normalizeSettings(settings);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(buildStorageKey(storageScope), JSON.stringify(normalized));
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
  libraryType?: LibraryType | null,
  options?: MusicVisibilityOptions,
): LibraryStatisticDefinition[] {
  return getOrderedLibraryStatisticDefinitions(settings).filter(
    (definition) =>
      definition.supportsPanel &&
      settings.visibility[definition.id].panelEnabled &&
      isLibraryStatisticDefinitionVisibleForLibraryType(definition, libraryType, options),
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
  libraryType?: LibraryType | null,
  options?: MusicVisibilityOptions,
): MediaFileSortKey[] {
  return getOrderedLibraryStatisticDefinitions(settings)
    .filter(
      (definition) =>
        definition.supportsTable &&
        settings.visibility[definition.id].tableEnabled &&
        isLibraryStatisticDefinitionVisibleForLibraryType(definition, libraryType, options),
    )
    .map((definition) => definition.tableColumnKey)
    .filter((column): column is MediaFileSortKey => typeof column === "string");
}

export function getEnabledLibraryStatisticTableTooltipColumns(
  settings: LibraryStatisticsSettings,
  libraryType?: LibraryType | null,
  options?: MusicVisibilityOptions,
): MediaFileSortKey[] {
  return getOrderedLibraryStatisticDefinitions(settings)
    .filter(
      (definition) =>
        definition.supportsTableTooltip &&
        settings.visibility[definition.id].tableTooltipEnabled &&
        isLibraryStatisticDefinitionVisibleForLibraryType(definition, libraryType, options),
    )
    .map((definition) => definition.tableColumnKey)
    .filter((column): column is MediaFileSortKey => typeof column === "string");
}

export function isLibraryStatisticDefinitionVisibleForLibraryType(
  definition: LibraryStatisticDefinition,
  libraryType?: LibraryType | null,
  options?: MusicVisibilityOptions,
): boolean {
  if (definition.id === "video_bit_depth" && options?.hasVideoMetadata === false) {
    return false;
  }
  if (libraryType !== "music" && libraryType !== "audiobooks") {
    return !AUDIOBOOK_ONLY_STATISTIC_IDS.has(definition.id);
  }
  if (libraryType !== "audiobooks" && AUDIOBOOK_ONLY_STATISTIC_IDS.has(definition.id)) {
    return false;
  }
  if (definition.id === "quality_score" && options?.showMusicQualityScore !== true) {
    return false;
  }
  return !MUSIC_HIDDEN_STATISTIC_IDS.has(definition.id);
}

export function getLibraryStatisticPanelItems(
  library: LibraryStatistics | null,
  definition: LibraryStatisticDefinition,
) {
  if (!library || (definition.panelKind && definition.panelKind !== "list") || !definition.panelDataKey) {
    return [];
  }
  return library[definition.panelDataKey];
}

export function getDashboardStatisticPanelItems(
  dashboard: DashboardResponse | null,
  definition: LibraryStatisticDefinition,
) {
  if (!dashboard || (definition.panelKind && definition.panelKind !== "list") || !definition.dashboardDataKey) {
    return [];
  }
  return dashboard[definition.dashboardDataKey];
}

export function getLibraryStatisticNumericDistribution(
  library: LibraryStatistics | null,
  definition: LibraryStatisticDefinition,
): NumericDistribution | null {
  if (!library || definition.panelKind !== "numeric-chart" || !definition.numericMetricId) {
    return null;
  }
  return library.numeric_distributions[definition.numericMetricId] ?? null;
}

export function getDashboardStatisticNumericDistribution(
  dashboard: DashboardResponse | null,
  definition: LibraryStatisticDefinition,
): NumericDistribution | null {
  if (!dashboard || definition.panelKind !== "numeric-chart" || !definition.numericMetricId) {
    return null;
  }
  return dashboard.numeric_distributions[definition.numericMetricId] ?? null;
}
