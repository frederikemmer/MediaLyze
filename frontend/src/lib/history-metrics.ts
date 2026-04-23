import type {
  LibraryHistoryResolutionCategory,
  LibraryHistoryTrendMetrics,
  NumericDistributionBin,
  NumericDistributionMetricId,
} from "./api";
import { formatBitrate, formatBytes, formatCodecLabel, formatContainerLabel, formatDuration, formatSpatialAudioProfileLabel } from "./format";
import { formatHdrType, type HdrDisplayOptions } from "./hdr";
import { formatNumericDistributionBinLabel } from "./numeric-distributions";

export type HistoryMetricGroupId = "summary" | "category" | "distribution";
export type HistoryMetricDisplayMode = "count" | "percentage";
export type HistoryMetricValueKind = "count" | "bytes" | "duration" | "bitrate" | "score" | "megapixels";

export type LibraryHistoryMetricId =
  | "file_count"
  | "total_size_bytes"
  | "total_duration_seconds"
  | "average_size_bytes"
  | "average_duration_seconds"
  | "average_bitrate"
  | "average_audio_bitrate"
  | "average_quality_score"
  | "average_resolution_mp"
  | "resolution_mix"
  | "container_mix"
  | "video_codec_mix"
  | "hdr_type_mix"
  | "audio_codecs_mix"
  | "audio_spatial_profiles_mix"
  | "audio_languages_mix"
  | "subtitle_languages_mix"
  | "subtitle_codecs_mix"
  | "subtitle_sources_mix"
  | "scan_status_mix"
  | "resolution_distribution"
  | "quality_score_distribution"
  | "duration_distribution"
  | "size_distribution"
  | "bitrate_distribution"
  | "audio_bitrate_distribution"
  | "resolution_mp_distribution";

export type HistoryMetricDefinition =
  | {
      id: LibraryHistoryMetricId;
      group: "summary";
      labelKey: string;
      valueKind: HistoryMetricValueKind;
      value: (metrics: LibraryHistoryTrendMetrics) => number | null;
    }
  | {
      id: LibraryHistoryMetricId;
      group: "category";
      labelKey: string;
      categoryKey: string;
      formatCategory: (
        value: string,
        resolutionCategories: LibraryHistoryResolutionCategory[],
        options?: HdrDisplayOptions,
      ) => string;
    }
  | {
      id: LibraryHistoryMetricId;
      group: "distribution";
      labelKey: string;
      distributionKey: NumericDistributionMetricId | "resolution_mp";
      formatBin: (bin: NumericDistributionBin) => string;
    }
  | {
      id: LibraryHistoryMetricId;
      group: "distribution";
      labelKey: string;
      categoryKey: string;
      formatCategory: (
        value: string,
        resolutionCategories: LibraryHistoryResolutionCategory[],
        options?: HdrDisplayOptions,
      ) => string;
    };

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;

function totalValue(metrics: LibraryHistoryTrendMetrics, key: string): number | null {
  const value = metrics.totals?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericAverage(metrics: LibraryHistoryTrendMetrics, key: string): number | null {
  const value = metrics.numeric_summaries?.[key]?.average;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatResolutionCategory(value: string, resolutionCategories: LibraryHistoryResolutionCategory[]): string {
  return resolutionCategories.find((category) => category.id === value)?.label ?? value;
}

function formatPlain(value: string): string {
  return value || "unknown";
}

function formatResolutionMpBin(bin: NumericDistributionBin): string {
  if (bin.lower === null && bin.upper === null) {
    return "0 MP";
  }
  if (bin.lower === null) {
    return `< ${bin.upper} MP`;
  }
  if (bin.upper === null) {
    return `${bin.lower}+ MP`;
  }
  return `${bin.lower} - ${bin.upper} MP`;
}

export const HISTORY_METRIC_DEFINITIONS: HistoryMetricDefinition[] = [
  {
    id: "file_count",
    group: "summary",
    labelKey: "libraryDetail.history.metrics.file_count",
    valueKind: "count",
    value: (metrics) => totalValue(metrics, "file_count") ?? metrics.total_files,
  },
  {
    id: "total_size_bytes",
    group: "summary",
    labelKey: "libraryDetail.history.metrics.total_size_bytes",
    valueKind: "bytes",
    value: (metrics) => totalValue(metrics, "total_size_bytes"),
  },
  {
    id: "total_duration_seconds",
    group: "summary",
    labelKey: "libraryDetail.history.metrics.total_duration_seconds",
    valueKind: "duration",
    value: (metrics) => totalValue(metrics, "total_duration_seconds"),
  },
  {
    id: "average_size_bytes",
    group: "summary",
    labelKey: "libraryDetail.history.metrics.average_size_bytes",
    valueKind: "bytes",
    value: (metrics) => numericAverage(metrics, "size"),
  },
  {
    id: "average_duration_seconds",
    group: "summary",
    labelKey: "libraryDetail.history.metrics.average_duration_seconds",
    valueKind: "duration",
    value: (metrics) => metrics.average_duration_seconds ?? numericAverage(metrics, "duration"),
  },
  {
    id: "average_bitrate",
    group: "summary",
    labelKey: "libraryDetail.history.metrics.average_bitrate",
    valueKind: "bitrate",
    value: (metrics) => metrics.average_bitrate ?? numericAverage(metrics, "bitrate"),
  },
  {
    id: "average_audio_bitrate",
    group: "summary",
    labelKey: "libraryDetail.history.metrics.average_audio_bitrate",
    valueKind: "bitrate",
    value: (metrics) => metrics.average_audio_bitrate ?? numericAverage(metrics, "audio_bitrate"),
  },
  {
    id: "average_quality_score",
    group: "summary",
    labelKey: "libraryDetail.history.metrics.average_quality_score",
    valueKind: "score",
    value: (metrics) => metrics.average_quality_score ?? numericAverage(metrics, "quality_score"),
  },
  {
    id: "average_resolution_mp",
    group: "summary",
    labelKey: "libraryDetail.history.metrics.average_resolution_mp",
    valueKind: "megapixels",
    value: (metrics) => numericAverage(metrics, "resolution_mp"),
  },
  {
    id: "resolution_mix",
    group: "category",
    labelKey: "libraryDetail.history.metrics.resolution_mix",
    categoryKey: "resolution",
    formatCategory: formatResolutionCategory,
  },
  {
    id: "container_mix",
    group: "category",
    labelKey: "libraryDetail.history.metrics.container_mix",
    categoryKey: "container",
    formatCategory: (value) => formatContainerLabel(value),
  },
  {
    id: "video_codec_mix",
    group: "category",
    labelKey: "libraryDetail.history.metrics.video_codec_mix",
    categoryKey: "video_codec",
    formatCategory: (value) => formatCodecLabel(value, "video"),
  },
  {
    id: "hdr_type_mix",
    group: "category",
    labelKey: "libraryDetail.history.metrics.hdr_type_mix",
    categoryKey: "hdr_type",
    formatCategory: (value, _resolutionCategories, options) => formatHdrType(value, options) ?? "SDR",
  },
  {
    id: "audio_codecs_mix",
    group: "category",
    labelKey: "libraryDetail.history.metrics.audio_codecs_mix",
    categoryKey: "audio_codecs",
    formatCategory: (value) => formatCodecLabel(value, "audio"),
  },
  {
    id: "audio_spatial_profiles_mix",
    group: "category",
    labelKey: "libraryDetail.history.metrics.audio_spatial_profiles_mix",
    categoryKey: "audio_spatial_profiles",
    formatCategory: (value) => formatSpatialAudioProfileLabel(value),
  },
  {
    id: "audio_languages_mix",
    group: "category",
    labelKey: "libraryDetail.history.metrics.audio_languages_mix",
    categoryKey: "audio_languages",
    formatCategory: formatPlain,
  },
  {
    id: "subtitle_languages_mix",
    group: "category",
    labelKey: "libraryDetail.history.metrics.subtitle_languages_mix",
    categoryKey: "subtitle_languages",
    formatCategory: formatPlain,
  },
  {
    id: "subtitle_codecs_mix",
    group: "category",
    labelKey: "libraryDetail.history.metrics.subtitle_codecs_mix",
    categoryKey: "subtitle_codecs",
    formatCategory: (value) => formatCodecLabel(value, "subtitle"),
  },
  {
    id: "subtitle_sources_mix",
    group: "category",
    labelKey: "libraryDetail.history.metrics.subtitle_sources_mix",
    categoryKey: "subtitle_sources",
    formatCategory: formatPlain,
  },
  {
    id: "scan_status_mix",
    group: "category",
    labelKey: "libraryDetail.history.metrics.scan_status_mix",
    categoryKey: "scan_status",
    formatCategory: formatPlain,
  },
  {
    id: "resolution_distribution",
    group: "distribution",
    labelKey: "libraryDetail.history.metrics.resolution_distribution",
    categoryKey: "resolution",
    formatCategory: formatResolutionCategory,
  },
  {
    id: "quality_score_distribution",
    group: "distribution",
    labelKey: "libraryDetail.history.metrics.quality_score_distribution",
    distributionKey: "quality_score",
    formatBin: (bin) => formatNumericDistributionBinLabel("quality_score", bin),
  },
  {
    id: "duration_distribution",
    group: "distribution",
    labelKey: "libraryDetail.history.metrics.duration_distribution",
    distributionKey: "duration",
    formatBin: (bin) => formatNumericDistributionBinLabel("duration", bin),
  },
  {
    id: "size_distribution",
    group: "distribution",
    labelKey: "libraryDetail.history.metrics.size_distribution",
    distributionKey: "size",
    formatBin: (bin) => formatNumericDistributionBinLabel("size", bin),
  },
  {
    id: "bitrate_distribution",
    group: "distribution",
    labelKey: "libraryDetail.history.metrics.bitrate_distribution",
    distributionKey: "bitrate",
    formatBin: (bin) => formatNumericDistributionBinLabel("bitrate", bin),
  },
  {
    id: "audio_bitrate_distribution",
    group: "distribution",
    labelKey: "libraryDetail.history.metrics.audio_bitrate_distribution",
    distributionKey: "audio_bitrate",
    formatBin: (bin) => formatNumericDistributionBinLabel("audio_bitrate", bin),
  },
  {
    id: "resolution_mp_distribution",
    group: "distribution",
    labelKey: "libraryDetail.history.metrics.resolution_mp_distribution",
    distributionKey: "resolution_mp",
    formatBin: formatResolutionMpBin,
  },
];

export const HISTORY_METRIC_GROUPS: { id: HistoryMetricGroupId; labelKey: string }[] = [
  { id: "summary", labelKey: "libraryDetail.history.groups.summary" },
  { id: "category", labelKey: "libraryDetail.history.groups.category" },
  { id: "distribution", labelKey: "libraryDetail.history.groups.distribution" },
];

const HISTORY_METRIC_MAP = new Map(HISTORY_METRIC_DEFINITIONS.map((definition) => [definition.id, definition]));

export function isLibraryHistoryMetricId(value: string | null | undefined): value is LibraryHistoryMetricId {
  return typeof value === "string" && HISTORY_METRIC_MAP.has(value as LibraryHistoryMetricId);
}

export function getHistoryMetricDefinition(metricId: LibraryHistoryMetricId): HistoryMetricDefinition {
  return HISTORY_METRIC_MAP.get(metricId) ?? HISTORY_METRIC_DEFINITIONS[0];
}

export function formatHistoryMetricValue(
  definition: Extract<HistoryMetricDefinition, { group: "summary" }>,
  value: number | null,
  t: TranslationFn,
): string {
  if (value === null || !Number.isFinite(value)) {
    return t("fileTable.na");
  }
  if (definition.valueKind === "bytes") {
    return formatBytes(value);
  }
  if (definition.valueKind === "duration") {
    return formatDuration(value);
  }
  if (definition.valueKind === "bitrate") {
    return formatBitrate(value);
  }
  if (definition.valueKind === "score") {
    return `${Math.round(value * 10) / 10} / 10`;
  }
  if (definition.valueKind === "megapixels") {
    return `${value.toFixed(value >= 10 ? 1 : 2)} MP`;
  }
  return String(Math.round(value));
}
