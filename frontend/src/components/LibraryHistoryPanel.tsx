import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { LibraryHistoryResponse } from "../lib/api";
import { AsyncPanel } from "./AsyncPanel";
import { HistoryTrendChart, type LibraryHistoryMetricId } from "./HistoryTrendChart";

type LibraryHistoryPanelProps = {
  history: LibraryHistoryResponse | null;
  loading?: boolean;
  error?: string | null;
  selectedMetric: LibraryHistoryMetricId;
  onChangeMetric: (metricId: LibraryHistoryMetricId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  currentResolutionCategoryIds: string[];
};

const HISTORY_METRICS: LibraryHistoryMetricId[] = [
  "resolution_mix",
  "average_bitrate",
  "average_audio_bitrate",
  "average_duration_seconds",
  "average_quality_score",
];

export function LibraryHistoryPanel({
  history,
  loading = false,
  error = null,
  selectedMetric,
  onChangeMetric,
  collapsed,
  onToggleCollapsed,
  currentResolutionCategoryIds,
}: LibraryHistoryPanelProps) {
  const { t } = useTranslation();
  const currentResolutionCategoryIdSet = useMemo(
    () => new Set(currentResolutionCategoryIds),
    [currentResolutionCategoryIds],
  );
  const resolutionCategories = useMemo(
    () =>
      (history?.resolution_categories ?? []).map((category) => ({
        ...category,
        label:
          !currentResolutionCategoryIdSet.has(category.id) && category.label === category.id
            ? t("libraryDetail.history.unknownLegacyResolutionCategory", { id: category.id })
            : category.label,
      })),
    [currentResolutionCategoryIdSet, history?.resolution_categories, t],
  );

  return (
    <AsyncPanel
      title={t("libraryDetail.history.title")}
      subtitle={t("libraryDetail.history.subtitle")}
      loading={loading}
      error={error}
      titleAddon={history ? <span className="badge">{history.points.length}</span> : null}
      bodyClassName="async-panel-body-scroll"
      headerAddon={
        !collapsed ? (
          <div className="comparison-chart-toolbar-shell">
            <div className="comparison-chart-toolbar library-history-toolbar">
              <label className="comparison-chart-select-shell">
                <select
                  className="comparison-chart-select"
                  aria-label={t("libraryDetail.history.controls.metric")}
                  value={selectedMetric}
                  onChange={(event) => onChangeMetric(event.target.value as LibraryHistoryMetricId)}
                >
                  {HISTORY_METRICS.map((metricId) => (
                    <option key={metricId} value={metricId}>
                      {t(`libraryDetail.history.metrics.${metricId}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : null
      }
      collapseState={{
        collapsed,
        onToggle: onToggleCollapsed,
        bodyId: "library-history-panel-body",
      }}
    >
      {!history || history.points.length === 0 ? (
        <div className="notice">{t("libraryDetail.history.empty")}</div>
      ) : (
        <div className="comparison-chart-content library-history-chart-shell">
          <HistoryTrendChart
            points={history.points}
            resolutionCategories={resolutionCategories}
            metricId={selectedMetric}
            resizeToken={`${selectedMetric}:${history.points.length}`}
          />
        </div>
      )}
    </AsyncPanel>
  );
}
