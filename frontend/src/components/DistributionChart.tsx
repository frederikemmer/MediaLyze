import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import ReactECharts from "echarts-for-react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import type { NumericDistribution, NumericDistributionBin, NumericDistributionMetricId } from "../lib/api";
import {
  formatNumericDistributionBinLabel,
  formatNumericDistributionTooltip,
  formatNumericDistributionYAxisValue,
  type NumericDistributionDisplayMode,
} from "../lib/numeric-distributions";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

type DistributionChartProps = {
  distribution: NumericDistribution;
  metricId: NumericDistributionMetricId;
  mode: NumericDistributionDisplayMode;
  interactive?: boolean;
  onSelectBin?: (bin: NumericDistributionBin) => void;
};

export function DistributionChart({
  distribution,
  metricId,
  mode,
  interactive = false,
  onSelectBin,
}: DistributionChartProps) {
  const { t } = useTranslation();
  const cssVars = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const axisColor = cssVars?.getPropertyValue("--muted").trim() || "#5f5b52";
  const fillColor = cssVars?.getPropertyValue("--accent-2").trim() || "#1b998b";
  const hoverColor = cssVars?.getPropertyValue("--accent").trim() || "#ff6b3d";
  const lineColor = cssVars?.getPropertyValue("--ink").trim() || "#1f1c16";

  const option = useMemo(
    () => ({
      animation: false,
      grid: {
        top: 8,
        right: 8,
        bottom: 28,
        left: 42,
        containLabel: true,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
        backgroundColor: "rgba(31, 28, 22, 0.94)",
        borderWidth: 0,
        textStyle: {
          color: "#fffaf3",
          fontSize: 12,
          lineHeight: 18,
        },
        formatter: (params: Array<{ dataIndex: number }>) => {
          const entry = distribution.bins[params[0]?.dataIndex ?? 0];
          return formatNumericDistributionTooltip(metricId, entry, t).replace(/\n/g, "<br/>");
        },
      },
      xAxis: {
        type: "category",
        data: distribution.bins.map((bin) => formatNumericDistributionBinLabel(metricId, bin)),
        axisTick: {
          show: false,
        },
        axisLine: {
          lineStyle: {
            color: lineColor,
            opacity: 0.12,
          },
        },
        axisLabel: {
          color: axisColor,
          fontSize: 11,
          interval: 0,
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        axisLine: {
          show: false,
        },
        splitLine: {
          lineStyle: {
            color: lineColor,
            opacity: 0.08,
          },
        },
        axisLabel: {
          color: axisColor,
          formatter: (value: number) => formatNumericDistributionYAxisValue(value, mode),
        },
      },
      series: [
        {
          type: "bar",
          barGap: "0%",
          barCategoryGap: "18%",
          data: distribution.bins.map((bin) => (mode === "percentage" ? bin.percentage : bin.count)),
          itemStyle: {
            color: fillColor,
            borderRadius: [8, 8, 0, 0],
          },
          emphasis: {
            itemStyle: {
              color: interactive ? hoverColor : fillColor,
            },
          },
        },
      ],
    }),
    [axisColor, distribution, fillColor, hoverColor, interactive, lineColor, metricId, mode, t],
  );

  const onEvents = interactive && onSelectBin
    ? {
        click: (params: { dataIndex?: number }) => {
          const bin = distribution.bins[params.dataIndex ?? -1];
          if (bin) {
            onSelectBin(bin);
          }
        },
      }
    : undefined;

  return (
    <ReactECharts
      echarts={echarts}
      option={option}
      notMerge
      lazyUpdate
      onEvents={onEvents}
      style={{ height: 240, width: "100%", cursor: interactive ? "pointer" : "default" }}
    />
  );
}
