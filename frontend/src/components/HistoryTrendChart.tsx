import { memo, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useTranslation } from "react-i18next";

import type {
  LibraryHistoryPoint,
  LibraryHistoryResolutionCategory,
  LibraryHistoryTrendMetrics,
} from "../lib/api";
import { formatBitrate, formatDuration } from "../lib/format";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export type LibraryHistoryMetricId =
  | "resolution_mix"
  | "average_bitrate"
  | "average_audio_bitrate"
  | "average_duration_seconds"
  | "average_quality_score";

type HistoryTrendChartProps = {
  points: LibraryHistoryPoint[];
  resolutionCategories: LibraryHistoryResolutionCategory[];
  metricId: LibraryHistoryMetricId;
  resizeToken?: string;
};

function formatMetricValue(metricId: Exclude<LibraryHistoryMetricId, "resolution_mix">, value: number): string {
  if (metricId === "average_bitrate" || metricId === "average_audio_bitrate") {
    return formatBitrate(value);
  }
  if (metricId === "average_duration_seconds") {
    return formatDuration(value);
  }
  return `${Math.round(value * 10) / 10} / 10`;
}

function numericMetricValue(metricId: Exclude<LibraryHistoryMetricId, "resolution_mix">, metrics: LibraryHistoryTrendMetrics) {
  if (metricId === "average_bitrate") {
    return metrics.average_bitrate;
  }
  if (metricId === "average_audio_bitrate") {
    return metrics.average_audio_bitrate;
  }
  if (metricId === "average_duration_seconds") {
    return metrics.average_duration_seconds;
  }
  return metrics.average_quality_score;
}

function HistoryTrendChartComponent({
  points,
  resolutionCategories,
  metricId,
  resizeToken,
}: HistoryTrendChartProps) {
  const { t } = useTranslation();
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

    if (metricId === "resolution_mix") {
      return {
        animation: false,
        grid: { top: 28, right: 12, bottom: 12, left: 12, containLabel: true },
        legend: {
          top: 0,
          type: "scroll",
          icon: "roundRect",
          textStyle: {
            color: axisColor,
            fontSize: 12,
          },
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
              ...rows.map((item) => `${item.seriesName}: ${typeof item.value === "number" ? item.value : 0}`),
              `${t("libraryDetail.history.tooltip.total")}: ${total}`,
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
          axisLabel: { color: axisColor, fontSize: 12, margin: 8 },
          splitLine: { lineStyle: { color: lineColor, opacity: 0.08 } },
        },
        series: resolutionCategories.map((category) => ({
          name: category.label,
          type: "line",
          stack: "resolution_mix",
          showSymbol: points.length <= 1,
          smooth: false,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.22 },
          emphasis: { focus: "series" },
          data: points.map((point) => point.trend_metrics.resolution_counts[category.id] ?? 0),
        })),
      };
    }

    const numericSeriesMetric = metricId;
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
            `${t(`libraryDetail.history.metrics.${numericSeriesMetric}`)}: ${
              rawValue === null ? t("fileTable.na") : formatMetricValue(numericSeriesMetric, rawValue)
            }`,
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
          formatter: (value: number) => formatMetricValue(numericSeriesMetric, value),
        },
        splitLine: { lineStyle: { color: lineColor, opacity: 0.08 } },
      },
      series: [
        {
          name: t(`libraryDetail.history.metrics.${numericSeriesMetric}`),
          type: "line",
          showSymbol: true,
          symbolSize: points.length <= 1 ? 9 : 7,
          smooth: false,
          lineStyle: { width: 2.5, color: fillColor },
          itemStyle: { color: fillColor },
          data: points.map((point) => numericMetricValue(numericSeriesMetric, point.trend_metrics)),
        },
      ],
    };
  }, [axisColor, fillColor, lineColor, metricId, points, resolutionCategories, t, tooltipBase]);

  return (
    <ReactECharts
      key={resizeToken ? `${metricId}-${resizeToken}` : metricId}
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
    previousProps.resizeToken === nextProps.resizeToken,
);
