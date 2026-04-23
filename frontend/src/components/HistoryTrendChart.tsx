import { memo, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useTranslation } from "react-i18next";

import type { LibraryHistoryPoint, LibraryHistoryResolutionCategory } from "../lib/api";
import {
  formatHistoryMetricValue,
  getHistoryMetricDefinition,
  type HistoryMetricDisplayMode,
  type LibraryHistoryMetricId,
} from "../lib/history-metrics";
import { formatHdrType } from "../lib/hdr";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type HistoryTrendChartProps = {
  points: LibraryHistoryPoint[];
  resolutionCategories: LibraryHistoryResolutionCategory[];
  metricId: LibraryHistoryMetricId;
  displayMode?: HistoryMetricDisplayMode;
  inDepthDolbyVisionProfiles?: boolean;
  resizeToken?: string;
};

function formatAxisCount(value: number): string {
  return String(Math.round(value));
}

function formatAxisPercentage(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function historyPercentageAxisBounds(displayMode: HistoryMetricDisplayMode) {
  return displayMode === "percentage" ? { min: 0, max: 100 } : {};
}

function categoryCounts(
  point: LibraryHistoryPoint,
  categoryKey: string,
  inDepthDolbyVisionProfiles: boolean,
): Record<string, number> {
  const counts =
    categoryKey === "resolution"
      ? point.trend_metrics.category_counts?.resolution ?? point.trend_metrics.resolution_counts
      : point.trend_metrics.category_counts?.[categoryKey] ?? {};

  if (categoryKey !== "hdr_type" || inDepthDolbyVisionProfiles) {
    return counts;
  }

  return Object.entries(counts).reduce<Record<string, number>>((collapsed, [key, value]) => {
    const collapsedKey = formatHdrType(key, { inDepthDolbyVisionProfiles }) ?? key;
    collapsed[collapsedKey] = (collapsed[collapsedKey] ?? 0) + value;
    return collapsed;
  }, {});
}

function categorySeriesKeys(
  points: LibraryHistoryPoint[],
  categoryKey: string,
  resolutionCategories: LibraryHistoryResolutionCategory[],
  inDepthDolbyVisionProfiles: boolean,
): string[] {
  const keys = new Set<string>();
  for (const point of points) {
    for (const key of Object.keys(categoryCounts(point, categoryKey, inDepthDolbyVisionProfiles))) {
      keys.add(key);
    }
  }
  if (categoryKey === "resolution") {
    return [
      ...resolutionCategories.map((category) => category.id).filter((id) => keys.has(id)),
      ...[...keys].filter((id) => !resolutionCategories.some((category) => category.id === id)).sort(),
    ];
  }
  return [...keys].sort((left, right) => {
    const leftTotal = points.reduce(
      (sum, point) => sum + (categoryCounts(point, categoryKey, inDepthDolbyVisionProfiles)[left] ?? 0),
      0,
    );
    const rightTotal = points.reduce(
      (sum, point) => sum + (categoryCounts(point, categoryKey, inDepthDolbyVisionProfiles)[right] ?? 0),
      0,
    );
    return rightTotal - leftTotal || left.localeCompare(right);
  });
}

function distributionSeriesKeys(points: LibraryHistoryPoint[], distributionKey: string): string[] {
  const keys = new Set<string>();
  for (const point of points) {
    const distribution = point.trend_metrics.numeric_distributions?.[distributionKey];
    for (const bin of distribution?.bins ?? []) {
      keys.add(`${bin.lower ?? ""}:${bin.upper ?? ""}`);
    }
  }
  return [...keys].sort((left, right) => {
    const [leftLower, leftUpper] = left.split(":").map((part) => (part === "" ? null : Number(part)));
    const [rightLower, rightUpper] = right.split(":").map((part) => (part === "" ? null : Number(part)));
    return (
      (leftLower ?? Number.NEGATIVE_INFINITY) - (rightLower ?? Number.NEGATIVE_INFINITY) ||
      (leftUpper ?? Number.POSITIVE_INFINITY) - (rightUpper ?? Number.POSITIVE_INFINITY)
    );
  });
}

function findDistributionBin(point: LibraryHistoryPoint, distributionKey: string, key: string) {
  const distribution = point.trend_metrics.numeric_distributions?.[distributionKey];
  return distribution?.bins.find((bin) => `${bin.lower ?? ""}:${bin.upper ?? ""}` === key) ?? null;
}

function HistoryTrendChartComponent({
  points,
  resolutionCategories,
  metricId,
  displayMode = "count",
  inDepthDolbyVisionProfiles = false,
  resizeToken,
}: HistoryTrendChartProps) {
  const { t } = useTranslation();
  const metric = getHistoryMetricDefinition(metricId);
  const cssVars = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const axisColor = cssVars?.getPropertyValue("--muted").trim() || "#5f5b52";
  const lineColor = cssVars?.getPropertyValue("--ink").trim() || "#1f1c16";
  const fillColor = cssVars?.getPropertyValue("--accent-2").trim() || "#1b998b";
  const tooltipBase = useMemo(
    () => ({
      triggerOn: "mousemove|click",
      showDelay: 0,
      hideDelay: 260,
      transitionDuration: 0,
      confine: true,
      enterable: false,
      appendToBody: true,
      extraCssText: "pointer-events:none;",
      backgroundColor: "rgba(31, 28, 22, 0.94)",
      borderWidth: 0,
      textStyle: { color: "#fffaf3", fontSize: 12, lineHeight: 18 },
    }),
    [],
  );

  const option = useMemo(() => {
    const xAxisData = points.map((point) => point.snapshot_day);

    if (metric.group === "summary") {
      return {
        animation: false,
        grid: { top: 10, right: 12, bottom: 12, left: 12, containLabel: true },
        tooltip: {
          ...tooltipBase,
          trigger: "axis",
          axisPointer: { type: "line" },
          formatter: (params: Array<{ axisValueLabel?: string; value?: number | null }>) => {
            const point = Array.isArray(params) ? params[0] : null;
            const rawValue = typeof point?.value === "number" ? point.value : null;
            return [
              point?.axisValueLabel ?? "",
              `${t(metric.labelKey)}: ${formatHistoryMetricValue(metric, rawValue, t)}`,
            ].join("<br/>");
          },
        },
        xAxis: {
          type: "category",
          data: xAxisData,
          boundaryGap: false,
          axisTick: { show: false },
          axisLabel: { color: axisColor, hideOverlap: true, fontSize: 12, margin: 8 },
          axisLine: { lineStyle: { color: lineColor, opacity: 0.12 } },
        },
        yAxis: {
          type: "value",
          axisLabel: {
            color: axisColor,
            fontSize: 12,
            margin: 8,
            formatter: (value: number) => formatHistoryMetricValue(metric, value, t),
          },
          splitLine: { lineStyle: { color: lineColor, opacity: 0.08 } },
        },
        series: [
          {
            name: t(metric.labelKey),
            type: "line",
            showSymbol: true,
            symbolSize: points.length <= 1 ? 9 : 7,
            smooth: false,
            lineStyle: { width: 2.5, color: fillColor },
            itemStyle: { color: fillColor },
            data: points.map((point) => metric.value(point.trend_metrics)),
          },
        ],
      };
    }

    if (metric.group === "distribution") {
      if ("categoryKey" in metric) {
        const seriesKeys = categorySeriesKeys(
          points,
          metric.categoryKey,
          resolutionCategories,
          inDepthDolbyVisionProfiles,
        );
        return {
          animation: false,
          grid: { top: 28, right: 12, bottom: 12, left: 12, containLabel: true },
          legend: {
            top: 0,
            type: "scroll",
            icon: "roundRect",
            textStyle: { color: axisColor, fontSize: 12 },
          },
          tooltip: {
            ...tooltipBase,
            trigger: "axis",
            axisPointer: { type: "line" },
            formatter: (params: Array<{ axisValueLabel?: string; seriesName?: string; value?: number }>) => {
              const rows = Array.isArray(params) ? params : [];
              const day = rows[0]?.axisValueLabel ?? "";
              const total = rows.reduce((sum, item) => sum + (typeof item.value === "number" ? item.value : 0), 0);
              return [
                day,
                ...rows.map((item) => {
                  const value = typeof item.value === "number" ? item.value : 0;
                  return `${item.seriesName}: ${
                    displayMode === "percentage" ? formatAxisPercentage(value) : formatAxisCount(value)
                  }`;
                }),
                displayMode === "count" ? `${t("libraryDetail.history.tooltip.total")}: ${total}` : null,
              ]
                .filter(Boolean)
                .join("<br/>");
            },
          },
          xAxis: {
            type: "category",
            data: xAxisData,
            boundaryGap: false,
            axisTick: { show: false },
            axisLabel: { color: axisColor, hideOverlap: true, fontSize: 12, margin: 8 },
            axisLine: { lineStyle: { color: lineColor, opacity: 0.12 } },
          },
          yAxis: {
            type: "value",
            ...historyPercentageAxisBounds(displayMode),
            axisLabel: {
              color: axisColor,
              fontSize: 12,
              margin: 8,
              formatter: displayMode === "percentage" ? formatAxisPercentage : formatAxisCount,
            },
            splitLine: { lineStyle: { color: lineColor, opacity: 0.08 } },
          },
          series: seriesKeys.map((key) => ({
            name: metric.formatCategory(key, resolutionCategories, { inDepthDolbyVisionProfiles }),
            type: "line",
            stack: metric.id,
            showSymbol: points.length <= 1,
            smooth: false,
            lineStyle: { width: 2 },
            areaStyle: { opacity: 0.22 },
            emphasis: { focus: "series" },
            data: points.map((point) => {
              const counts = categoryCounts(point, metric.categoryKey, inDepthDolbyVisionProfiles);
              const count = counts[key] ?? 0;
              if (displayMode === "count") {
                return count;
              }
              const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
              return total > 0 ? (count / total) * 100 : 0;
            }),
          })),
        };
      }

      const seriesKeys = distributionSeriesKeys(points, metric.distributionKey);
      return {
        animation: false,
        grid: { top: 28, right: 12, bottom: 12, left: 12, containLabel: true },
        legend: {
          top: 0,
          type: "scroll",
          icon: "roundRect",
          textStyle: { color: axisColor, fontSize: 12 },
        },
        tooltip: {
          ...tooltipBase,
          trigger: "axis",
          axisPointer: { type: "line" },
          formatter: (params: Array<{ axisValueLabel?: string; seriesName?: string; value?: number }>) => {
            const rows = Array.isArray(params) ? params : [];
            const day = rows[0]?.axisValueLabel ?? "";
            return [
              day,
              ...rows.map((item) => {
                const value = typeof item.value === "number" ? item.value : 0;
                return `${item.seriesName}: ${
                  displayMode === "percentage" ? formatAxisPercentage(value) : formatAxisCount(value)
                }`;
              }),
            ].join("<br/>");
          },
        },
        xAxis: {
          type: "category",
          data: xAxisData,
          boundaryGap: false,
          axisTick: { show: false },
          axisLabel: { color: axisColor, hideOverlap: true, fontSize: 12, margin: 8 },
          axisLine: { lineStyle: { color: lineColor, opacity: 0.12 } },
        },
        yAxis: {
          type: "value",
          ...historyPercentageAxisBounds(displayMode),
          axisLabel: {
            color: axisColor,
            fontSize: 12,
            margin: 8,
            formatter: displayMode === "percentage" ? formatAxisPercentage : formatAxisCount,
          },
          splitLine: { lineStyle: { color: lineColor, opacity: 0.08 } },
        },
        series: seriesKeys.map((key) => {
          const exampleBin = points
            .map((point) => findDistributionBin(point, metric.distributionKey, key))
            .find(Boolean);
          return {
            name: exampleBin ? metric.formatBin(exampleBin) : key,
            type: "line",
            stack: metric.id,
            showSymbol: points.length <= 1,
            smooth: false,
            lineStyle: { width: 2 },
            areaStyle: { opacity: 0.22 },
            emphasis: { focus: "series" },
            data: points.map((point) => {
              const bin = findDistributionBin(point, metric.distributionKey, key);
              if (!bin) {
                return 0;
              }
              return displayMode === "percentage" ? bin.percentage : bin.count;
            }),
          };
        }),
      };
    }

    const seriesKeys = categorySeriesKeys(
      points,
      metric.categoryKey,
      resolutionCategories,
      inDepthDolbyVisionProfiles,
    );
    return {
      animation: false,
      grid: { top: 28, right: 12, bottom: 12, left: 12, containLabel: true },
      legend: {
        top: 0,
        type: "scroll",
        icon: "roundRect",
        textStyle: { color: axisColor, fontSize: 12 },
      },
      tooltip: {
        ...tooltipBase,
        trigger: "axis",
        axisPointer: { type: "line" },
        formatter: (params: Array<{ axisValueLabel?: string; seriesName?: string; value?: number }>) => {
          const rows = Array.isArray(params) ? params : [];
          const day = rows[0]?.axisValueLabel ?? "";
          const total = rows.reduce((sum, item) => sum + (typeof item.value === "number" ? item.value : 0), 0);
          return [
            day,
            ...rows.map((item) => {
              const value = typeof item.value === "number" ? item.value : 0;
              return `${item.seriesName}: ${
                displayMode === "percentage" ? formatAxisPercentage(value) : formatAxisCount(value)
              }`;
            }),
            displayMode === "count" ? `${t("libraryDetail.history.tooltip.total")}: ${total}` : null,
          ]
            .filter(Boolean)
            .join("<br/>");
        },
      },
      xAxis: {
        type: "category",
        data: xAxisData,
        boundaryGap: false,
        axisTick: { show: false },
        axisLabel: { color: axisColor, hideOverlap: true, fontSize: 12, margin: 8 },
        axisLine: { lineStyle: { color: lineColor, opacity: 0.12 } },
      },
      yAxis: {
        type: "value",
        ...historyPercentageAxisBounds(displayMode),
        axisLabel: {
          color: axisColor,
          fontSize: 12,
          margin: 8,
          formatter: displayMode === "percentage" ? formatAxisPercentage : formatAxisCount,
        },
        splitLine: { lineStyle: { color: lineColor, opacity: 0.08 } },
      },
      series: seriesKeys.map((key) => ({
        name: metric.formatCategory(key, resolutionCategories, { inDepthDolbyVisionProfiles }),
        type: "line",
        stack: metric.id,
        showSymbol: points.length <= 1,
        smooth: false,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.22 },
        emphasis: { focus: "series" },
        data: points.map((point) => {
          const counts = categoryCounts(point, metric.categoryKey, inDepthDolbyVisionProfiles);
          const count = counts[key] ?? 0;
          if (displayMode === "count") {
            return count;
          }
          const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
          return total > 0 ? (count / total) * 100 : 0;
        }),
      })),
    };
  }, [
    axisColor,
    displayMode,
    fillColor,
    inDepthDolbyVisionProfiles,
    lineColor,
    metric,
    points,
    resolutionCategories,
    t,
    tooltipBase,
  ]);

  return (
    <ReactECharts
      key={resizeToken ? `${metricId}-${displayMode}-${resizeToken}` : `${metricId}-${displayMode}`}
      echarts={echarts}
      option={option}
      notMerge
      lazyUpdate
      style={{ height: "100%", width: "100%" }}
    />
  );
}

export const HistoryTrendChart = memo(
  HistoryTrendChartComponent,
  (previousProps, nextProps) =>
    previousProps.points === nextProps.points &&
    previousProps.resolutionCategories === nextProps.resolutionCategories &&
    previousProps.metricId === nextProps.metricId &&
    previousProps.displayMode === nextProps.displayMode &&
    previousProps.inDepthDolbyVisionProfiles === nextProps.inDepthDolbyVisionProfiles &&
    previousProps.resizeToken === nextProps.resizeToken,
);
