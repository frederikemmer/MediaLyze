import type { NumericDistributionBin, NumericDistributionMetricId } from "./api";
import { formatBitrate, formatBytes, formatDuration } from "./format";

export type NumericDistributionDisplayMode = "count" | "percentage";
export type NumericDistributionUnitKind = "score" | "duration" | "bytes" | "bitrate";

export type NumericDistributionConfig = {
  metricId: NumericDistributionMetricId;
  labelKey: string;
  unitKind: NumericDistributionUnitKind;
  discrete?: boolean;
};

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;

export const NUMERIC_DISTRIBUTION_CONFIGS: Record<NumericDistributionMetricId, NumericDistributionConfig> = {
  quality_score: {
    metricId: "quality_score",
    labelKey: "libraryStatistics.items.qualityScore",
    unitKind: "score",
    discrete: true,
  },
  duration: {
    metricId: "duration",
    labelKey: "libraryStatistics.items.duration",
    unitKind: "duration",
  },
  size: {
    metricId: "size",
    labelKey: "libraryStatistics.items.size",
    unitKind: "bytes",
  },
  bitrate: {
    metricId: "bitrate",
    labelKey: "libraryStatistics.items.bitrate",
    unitKind: "bitrate",
  },
  audio_bitrate: {
    metricId: "audio_bitrate",
    labelKey: "libraryStatistics.items.audioBitrate",
    unitKind: "bitrate",
  },
};

function formatRangeBoundary(value: number, unitKind: NumericDistributionUnitKind): string {
  if (unitKind === "score") {
    return String(Math.round(value));
  }
  if (unitKind === "duration") {
    return formatDuration(value);
  }
  if (unitKind === "bytes") {
    return formatBytes(value);
  }
  return formatBitrate(value);
}

function formatSearchBoundary(value: number, unitKind: NumericDistributionUnitKind): string {
  if (unitKind === "score") {
    return String(Math.round(value));
  }
  if (unitKind === "duration") {
    if (value >= 3600) {
      const hours = Math.floor(value / 3600);
      const minutes = Math.floor((value % 3600) / 60);
      if (minutes > 0) {
        return `${hours}h ${minutes}m`;
      }
      return `${hours}h`;
    }
    if (value % 3600 === 0) {
      return `${value / 3600}h`;
    }
    if (value % 60 === 0) {
      return `${value / 60}m`;
    }
    return `${value}s`;
  }
  if (unitKind === "bytes") {
    const units = [
      { suffix: "TB", value: 1000 ** 4 },
      { suffix: "GB", value: 1000 ** 3 },
      { suffix: "MB", value: 1000 ** 2 },
      { suffix: "KB", value: 1000 },
    ];
    for (const unit of units) {
      if (value >= unit.value && value % unit.value === 0) {
        return `${value / unit.value}${unit.suffix}`;
      }
    }
    return `${Math.round(value)}B`;
  }

  const units = [
    { suffix: "Tb/s", value: 1000 ** 4 },
    { suffix: "Gb/s", value: 1000 ** 3 },
    { suffix: "Mb/s", value: 1000 ** 2 },
    { suffix: "kb/s", value: 1000 },
  ];
  for (const unit of units) {
    if (value >= unit.value && value % unit.value === 0) {
      return `${value / unit.value}${unit.suffix}`;
    }
  }
  return `${Math.round(value)}b/s`;
}

export function formatNumericDistributionBinLabel(metricId: NumericDistributionMetricId, bin: NumericDistributionBin): string {
  const config = NUMERIC_DISTRIBUTION_CONFIGS[metricId];
  if (config.discrete && bin.lower !== null) {
    return formatRangeBoundary(bin.lower, config.unitKind);
  }
  if (bin.lower !== null && bin.upper !== null) {
    return `${formatRangeBoundary(bin.lower, config.unitKind)} - ${formatRangeBoundary(bin.upper, config.unitKind)}`;
  }
  if (bin.lower !== null) {
    return `${formatRangeBoundary(bin.lower, config.unitKind)}+`;
  }
  if (bin.upper !== null) {
    return `< ${formatRangeBoundary(bin.upper, config.unitKind)}`;
  }
  return "";
}

export function formatNumericDistributionTooltip(
  metricId: NumericDistributionMetricId,
  bin: NumericDistributionBin,
  t: TranslationFn,
): string {
  return [
    `${t("distributionChart.binRange")}: ${formatNumericDistributionBinLabel(metricId, bin)}`,
    `${t("distributionChart.count")}: ${bin.count}`,
    `${t("distributionChart.percentage")}: ${bin.percentage.toFixed(1)}%`,
  ].join("\n");
}

export function formatNumericDistributionYAxisValue(
  value: number,
  mode: NumericDistributionDisplayMode,
): string {
  if (mode === "percentage") {
    return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
  }
  return String(Math.round(value));
}

export function buildNumericDistributionFilterExpression(
  metricId: NumericDistributionMetricId,
  bin: NumericDistributionBin,
): string {
  const config = NUMERIC_DISTRIBUTION_CONFIGS[metricId];
  if (config.discrete && bin.lower !== null) {
    return `=${formatSearchBoundary(bin.lower, config.unitKind)}`;
  }

  const parts: string[] = [];
  if (bin.lower !== null) {
    parts.push(`>=${formatSearchBoundary(bin.lower, config.unitKind)}`);
  }
  if (bin.upper !== null) {
    parts.push(`<${formatSearchBoundary(bin.upper, config.unitKind)}`);
  }
  return parts.join(",");
}
