import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as LucideIcons from "lucide-react";
import ReactECharts from "echarts-for-react";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useTranslation } from "react-i18next";

import type {
  ComparisonFieldId,
  ComparisonRendererId,
  ComparisonResponse,
} from "../lib/api";
import { formatBitrate, formatBytes, formatDuration } from "../lib/format";
import {
  buildComparisonFieldFilterValue,
  COMPARISON_FIELD_DEFINITIONS,
  formatComparisonBucketLabel,
  getAvailableComparisonRenderers,
  isComparisonFieldFilterable,
  type ComparisonSelection,
} from "../lib/statistic-comparisons";
import { AsyncPanel } from "./AsyncPanel";

echarts.use([BarChart, GridComponent, HeatmapChart, ScatterChart, TooltipComponent, VisualMapComponent, CanvasRenderer]);

type ComparisonChartPanelProps = {
  comparison: ComparisonResponse | null;
  selection: ComparisonSelection;
  loading?: boolean;
  error?: string | null;
  onChangeXField: (fieldId: ComparisonFieldId) => void;
  onChangeYField: (fieldId: ComparisonFieldId) => void;
  onSwapAxes: () => void;
  onChangeRenderer: (renderer: ComparisonRendererId) => void;
  onOpenFile?: (fileId: number) => void;
  onSelectFilters?: (filters: Partial<Record<ComparisonFieldId, string>>) => void;
};

type RendererDefinition = {
  id: ComparisonRendererId;
  labelKey: string;
  icon: LucideIcons.LucideIcon;
};

const lucideIconMap = LucideIcons as unknown as Record<string, LucideIcons.LucideIcon | undefined>;
const HeatmapIcon = LucideIcons.Grid2x2;
const BarIcon = lucideIconMap.ChartNoAxesColumn ?? LucideIcons.BarChart3;
const ScatterIcon = lucideIconMap.ChartScatter ?? LucideIcons.CircleDot;

const RENDERER_DEFINITIONS: RendererDefinition[] = [
  { id: "heatmap", labelKey: "comparisonChart.renderers.heatmap", icon: HeatmapIcon },
  { id: "scatter", labelKey: "comparisonChart.renderers.scatter", icon: ScatterIcon },
  { id: "bar", labelKey: "comparisonChart.renderers.bar", icon: BarIcon },
];

function formatNumericValue(fieldId: ComparisonFieldId, value: number): string {
  if (fieldId === "size") {
    return formatBytes(value);
  }
  if (fieldId === "duration") {
    return formatDuration(value);
  }
  if (fieldId === "bitrate" || fieldId === "audio_bitrate") {
    return formatBitrate(value);
  }
  if (fieldId === "resolution_mp") {
    return `${Math.round(value * 100) / 100} MP`;
  }
  return String(Math.round(value * 10) / 10);
}

function ComparisonChartPanelComponent({
  comparison,
  selection,
  loading = false,
  error = null,
  onChangeXField,
  onChangeYField,
  onSwapAxes,
  onChangeRenderer,
  onOpenFile,
  onSelectFilters,
}: ComparisonChartPanelProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const rendererMenuRef = useRef<HTMLDivElement | null>(null);
  const availableRenderers = comparison?.available_renderers ?? getAvailableComparisonRenderers(selection.xField, selection.yField);
  const selectedRenderer = availableRenderers.includes(selection.renderer)
    ? selection.renderer
    : availableRenderers[0];
  const selectedRendererDefinition =
    RENDERER_DEFINITIONS.find((entry) => entry.id === selectedRenderer) ?? RENDERER_DEFINITIONS[0];
  const SelectedRendererIcon = selectedRendererDefinition.icon;
  const hasOpenFileAction = Boolean(onOpenFile);
  const hasFilterAction = Boolean(onSelectFilters);
  const cssVars = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const axisColor = cssVars?.getPropertyValue("--muted").trim() || "#5f5b52";
  const fillColor = cssVars?.getPropertyValue("--accent-2").trim() || "#1b998b";
  const highlightColor = cssVars?.getPropertyValue("--accent").trim() || "#ff6b3d";
  const lineColor = cssVars?.getPropertyValue("--ink").trim() || "#1f1c16";
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
    if (!comparison || comparison.included_files <= 0) {
      return null;
    }

    if (selectedRenderer === "scatter" && comparison.scatter_points) {
      return {
        animation: false,
        grid: { top: 2, right: 2, bottom: 2, left: 2, containLabel: true },
        tooltip: {
          ...tooltipBase,
          trigger: "item",
          position: (point: [number, number], _params: unknown, _dom: unknown, _rect: unknown, size: {
            contentSize: [number, number];
            viewSize: [number, number];
          }) => {
            const [mouseX, mouseY] = point;
            const [contentWidth, contentHeight] = size.contentSize;
            const [viewWidth, viewHeight] = size.viewSize;
            const x = Math.min(Math.max(mouseX + 18, 8), Math.max(8, viewWidth - contentWidth - 8));
            const y = Math.min(Math.max(mouseY - contentHeight - 18, 8), Math.max(8, viewHeight - contentHeight - 8));
            return [x, y];
          },
          formatter: (params: { data?: [number, number] }) => {
            const point = params.data ?? [0, 0];
            return [
              `${t("comparisonChart.axes.x")}: ${formatNumericValue(comparison.x_field, point[0])}`,
              `${t("comparisonChart.axes.y")}: ${formatNumericValue(comparison.y_field, point[1])}`,
            ].join("<br/>");
          },
        },
        xAxis: {
          type: "value",
          axisLabel: {
            color: axisColor,
            fontSize: 12,
            margin: 4,
            formatter: (value: number) => formatNumericValue(comparison.x_field, value),
          },
          splitLine: { lineStyle: { color: lineColor, opacity: 0.08 } },
        },
        yAxis: {
          type: "value",
          axisLabel: {
            color: axisColor,
            fontSize: 12,
            margin: 4,
            formatter: (value: number) => formatNumericValue(comparison.y_field, value),
          },
          splitLine: { lineStyle: { color: lineColor, opacity: 0.08 } },
        },
        series: [
          {
            type: "scatter",
            symbolSize: 11,
            hoverAnimation: false,
            progressive: 0,
            itemStyle: {
              color: fillColor,
              opacity: 0.72,
            },
            emphasis: { disabled: true },
            cursor: hasOpenFileAction ? "pointer" : "default",
            data: comparison.scatter_points.map((point) => [point.x_value, point.y_value]),
          },
        ],
      };
    }

    if (selectedRenderer === "bar" && comparison.bar_entries) {
      const labelsByKey = new Map(
        comparison.x_buckets.map((bucket) => [bucket.key, formatComparisonBucketLabel(comparison.x_field, bucket, t)] as const),
      );
      return {
        animation: false,
        grid: { top: 2, right: 2, bottom: 2, left: 2, containLabel: true },
        tooltip: {
          ...tooltipBase,
          trigger: "item",
          formatter: (params: { dataIndex?: number }) => {
            const entry = comparison.bar_entries?.[params.dataIndex ?? 0];
            if (!entry) {
              return "";
            }
            return [
              `${t("comparisonChart.axes.x")}: ${labelsByKey.get(entry.x_key) ?? entry.x_label}`,
              `${t("comparisonChart.bar.average")}: ${formatNumericValue(comparison.y_field, entry.value)}`,
              `${t("comparisonChart.count")}: ${entry.count}`,
            ].join("<br/>");
          },
        },
        xAxis: {
          type: "category",
          data: comparison.bar_entries.map((entry) => labelsByKey.get(entry.x_key) ?? entry.x_label),
          axisTick: { show: false },
          axisLabel: { color: axisColor, interval: 0, hideOverlap: true, fontSize: 12, margin: 4 },
          axisLine: { lineStyle: { color: lineColor, opacity: 0.12 } },
        },
        yAxis: {
          type: "value",
          axisLabel: {
            color: axisColor,
            fontSize: 12,
            margin: 4,
            formatter: (value: number) => formatNumericValue(comparison.y_field, value),
          },
          splitLine: { lineStyle: { color: lineColor, opacity: 0.08 } },
        },
        series: [
          {
            type: "bar",
            barGap: "0%",
            barCategoryGap: "18%",
            cursor: hasFilterAction ? "pointer" : "default",
            data: comparison.bar_entries.map((entry) => entry.value),
            itemStyle: { color: fillColor, borderRadius: [8, 8, 0, 0] },
            emphasis: { itemStyle: { color: highlightColor } },
          },
        ],
      };
    }

    const xLabels = comparison.x_buckets.map((bucket) => formatComparisonBucketLabel(comparison.x_field, bucket, t));
    const yLabels = comparison.y_buckets.map((bucket) => formatComparisonBucketLabel(comparison.y_field, bucket, t));
    const xIndexByKey = new Map(comparison.x_buckets.map((bucket, index) => [bucket.key, index] as const));
    const yIndexByKey = new Map(comparison.y_buckets.map((bucket, index) => [bucket.key, index] as const));
    const maxCount = Math.max(0, ...comparison.heatmap_cells.map((cell) => cell.count));
    return {
      animation: false,
      grid: { top: 2, right: 2, bottom: 2, left: 2, containLabel: true },
      tooltip: {
        ...tooltipBase,
        trigger: "item",
        formatter: (params: { data?: [number, number, number] }) => {
          const point = params.data ?? [0, 0, 0];
          const xLabel = xLabels[point[0]] ?? "";
          const yLabel = yLabels[point[1]] ?? "";
          return [
            `${t("comparisonChart.axes.x")}: ${xLabel}`,
            `${t("comparisonChart.axes.y")}: ${yLabel}`,
            `${t("comparisonChart.count")}: ${point[2]}`,
          ].join("<br/>");
        },
      },
      xAxis: {
        type: "category",
        data: xLabels,
        axisTick: { show: false },
        axisLabel: { color: axisColor, interval: 0, hideOverlap: true, fontSize: 12, margin: 4 },
        axisLine: { lineStyle: { color: lineColor, opacity: 0.12 } },
      },
      yAxis: {
        type: "category",
        data: yLabels,
        axisTick: { show: false },
        axisLabel: { color: axisColor, interval: 0, hideOverlap: true, fontSize: 12, margin: 4 },
        axisLine: { lineStyle: { color: lineColor, opacity: 0.12 } },
      },
      visualMap: {
        show: false,
        min: 0,
        max: Math.max(1, maxCount),
        inRange: {
          color: ["rgba(27, 153, 139, 0.08)", fillColor, highlightColor],
        },
      },
      series: [
        {
          type: "heatmap",
          cursor: hasFilterAction ? "pointer" : "default",
          data: comparison.heatmap_cells.map((cell) => [
            xIndexByKey.get(cell.x_key) ?? 0,
            yIndexByKey.get(cell.y_key) ?? 0,
            cell.count,
          ]),
          label: { show: false },
          emphasis: {
            itemStyle: {
              borderColor: "rgba(31, 28, 22, 0.16)",
              borderWidth: 1,
            },
          },
        },
      ],
    };
  }, [axisColor, comparison, fillColor, hasFilterAction, hasOpenFileAction, highlightColor, lineColor, selectedRenderer, t, tooltipBase]);

  const onChartClick = useMemo(() => {
    if (!comparison) {
      return undefined;
    }
    if (selectedRenderer === "scatter" && !onOpenFile) {
      return undefined;
    }
    if ((selectedRenderer === "bar" || selectedRenderer === "heatmap") && !onSelectFilters) {
      return undefined;
    }

    return (params: { dataIndex?: number }) => {
      const dataIndex = params.dataIndex ?? -1;
      if (dataIndex < 0) {
        return;
      }

      if (selectedRenderer === "scatter") {
        const point = comparison.scatter_points?.[dataIndex];
        if (point && onOpenFile) {
          onOpenFile(point.media_file_id);
        }
        return;
      }

      if (selectedRenderer === "bar") {
        const entry = comparison.bar_entries?.[dataIndex];
        if (!entry || !onSelectFilters) {
          return;
        }
        const xBucket = comparison.x_buckets.find((bucket) => bucket.key === entry.x_key);
        if (!xBucket || !isComparisonFieldFilterable(comparison.x_field)) {
          return;
        }
        onSelectFilters({
          [comparison.x_field]: buildComparisonFieldFilterValue(comparison.x_field, xBucket),
        });
        return;
      }

      const cell = comparison.heatmap_cells[dataIndex];
      if (!cell || !onSelectFilters) {
        return;
      }

      const xBucket = comparison.x_buckets.find((bucket) => bucket.key === cell.x_key);
      const yBucket = comparison.y_buckets.find((bucket) => bucket.key === cell.y_key);
      if (!xBucket || !yBucket) {
        return;
      }

      const nextFilters: Partial<Record<ComparisonFieldId, string>> = {};
      if (isComparisonFieldFilterable(comparison.x_field)) {
        nextFilters[comparison.x_field] = buildComparisonFieldFilterValue(comparison.x_field, xBucket);
      }
      if (isComparisonFieldFilterable(comparison.y_field)) {
        nextFilters[comparison.y_field] = buildComparisonFieldFilterValue(comparison.y_field, yBucket);
      }
      if (Object.keys(nextFilters).length > 0) {
        onSelectFilters(nextFilters);
      }
    };
  }, [comparison, onOpenFile, onSelectFilters, selectedRenderer]);

  const chartEvents = useMemo(() => (onChartClick ? { click: onChartClick } : undefined), [onChartClick]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (rendererMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <AsyncPanel
      title=""
      loading={loading}
      error={error}
      bodyClassName="async-panel-body-scroll"
      headerAddon={
        <div className="comparison-chart-toolbar-shell" ref={rendererMenuRef}>
          <div className="comparison-chart-toolbar">
            <label className="comparison-chart-select-shell">
              <select
                className="comparison-chart-select"
                aria-label={t("comparisonChart.controls.yField")}
                value={selection.yField}
                onChange={(event) => onChangeYField(event.target.value as ComparisonFieldId)}
              >
                {COMPARISON_FIELD_DEFINITIONS.map((field) => (
                  <option key={field.id} value={field.id} disabled={field.id === selection.xField}>
                    {t(field.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="comparison-chart-swap-button"
              onClick={onSwapAxes}
              aria-label={t("comparisonChart.controls.swapAxes")}
              title={t("comparisonChart.controls.swapAxes")}
            >
              <LucideIcons.ArrowLeftRight className="distribution-chart-mode-icon" aria-hidden="true" />
            </button>
            <label className="comparison-chart-select-shell">
              <select
                className="comparison-chart-select"
                aria-label={t("comparisonChart.controls.xField")}
                value={selection.xField}
                onChange={(event) => onChangeXField(event.target.value as ComparisonFieldId)}
              >
                {COMPARISON_FIELD_DEFINITIONS.map((field) => (
                  <option key={field.id} value={field.id} disabled={field.id === selection.yField}>
                    {t(field.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="comparison-chart-renderer-button"
              aria-label={t("comparisonChart.controls.renderer")}
              aria-expanded={menuOpen}
              title={t(selectedRendererDefinition.labelKey)}
              onClick={() => setMenuOpen((current) => !current)}
            >
              <SelectedRendererIcon className="comparison-chart-renderer-icon" aria-hidden="true" />
              <LucideIcons.ChevronDown className="comparison-chart-renderer-caret" aria-hidden="true" />
            </button>
          </div>
          {menuOpen ? (
            <div className="comparison-chart-renderer-popover" role="menu">
              {RENDERER_DEFINITIONS.map((definition) => {
                const Icon = definition.icon;
                const supported = availableRenderers.includes(definition.id);
                return (
                  <button
                    key={definition.id}
                    type="button"
                    role="menuitem"
                    className={`comparison-chart-renderer-option${definition.id === selectedRenderer ? " active" : ""}`}
                    disabled={!supported}
                    onClick={() => {
                      if (!supported) {
                        return;
                      }
                      onChangeRenderer(definition.id);
                      setMenuOpen(false);
                    }}
                  >
                    <Icon className="distribution-chart-mode-icon" aria-hidden="true" />
                    <span>{t(definition.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      }
    >
      {!comparison || comparison.included_files <= 0 ? (
        <div className="notice">{t("comparisonChart.empty")}</div>
      ) : (
        <div className="stack comparison-chart-content">
          {option ? (
            <ReactECharts
              echarts={echarts}
              option={option}
              onEvents={chartEvents}
              notMerge
              lazyUpdate
              style={{ height: 280, width: "100%" }}
            />
          ) : (
            <div className="notice">{t("comparisonChart.empty")}</div>
          )}
        </div>
      )}
    </AsyncPanel>
  );
}

export const ComparisonChartPanel = memo(
  ComparisonChartPanelComponent,
  (previousProps, nextProps) =>
    previousProps.comparison === nextProps.comparison &&
    previousProps.selection === nextProps.selection &&
    previousProps.loading === nextProps.loading &&
    previousProps.error === nextProps.error &&
    Boolean(previousProps.onOpenFile) === Boolean(nextProps.onOpenFile) &&
    Boolean(previousProps.onSelectFilters) === Boolean(nextProps.onSelectFilters),
);
