import { BarChart3, Database, Frame, Hash, Percent } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { DashboardHistoryResponse, LibraryHistoryResponse } from "../lib/api";
import {
  getHistoryMetricDefinition,
  HISTORY_METRIC_DEFINITIONS,
  HISTORY_METRIC_GROUPS,
  type HistoryMetricDisplayMode,
  type LibraryHistoryMetricId,
} from "../lib/history-metrics";
import { AsyncPanel } from "./AsyncPanel";
import { HistoryTrendChart } from "./HistoryTrendChart";

type HistoryResponse = LibraryHistoryResponse | DashboardHistoryResponse;

type LibraryHistoryPanelProps = {
  history: HistoryResponse | null;
  loading?: boolean;
  error?: string | null;
  selectedMetric: LibraryHistoryMetricId;
  onChangeMetric: (metricId: LibraryHistoryMetricId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  currentResolutionCategoryIds: string[];
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  metricLabel?: string;
  bodyId?: string;
};

const HISTORY_GROUP_ICONS = {
  summary: Database,
  category: Frame,
  distribution: BarChart3,
} as const;

export function LibraryHistoryPanel({
  history,
  loading = false,
  error = null,
  selectedMetric,
  onChangeMetric,
  collapsed,
  onToggleCollapsed,
  currentResolutionCategoryIds,
  title,
  subtitle,
  emptyMessage,
  metricLabel,
  bodyId = "library-history-panel-body",
}: LibraryHistoryPanelProps) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<HistoryMetricDisplayMode>("count");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const pickerId = useId();
  const toggleId = useId();
  const currentResolutionCategoryIdSet = useMemo(
    () => new Set(currentResolutionCategoryIds),
    [currentResolutionCategoryIds],
  );
  const selectedMetricDefinition = useMemo(
    () => getHistoryMetricDefinition(selectedMetric),
    [selectedMetric],
  );
  const SelectedMetricIcon = HISTORY_GROUP_ICONS[selectedMetricDefinition.group];
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

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) {
        return;
      }
      setPickerOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [pickerOpen]);

  return (
    <AsyncPanel
      title={title ?? t("libraryDetail.history.title")}
      subtitle={subtitle}
      loading={loading}
      error={error}
      bodyClassName="async-panel-body-scroll"
      collapseActions={
        !collapsed ? (
          <>
            {selectedMetricDefinition.group !== "summary" ? (
              <div
                className="distribution-chart-mode-toggle"
                role="group"
                aria-label={t("distributionChart.displayMode")}
              >
                <button
                  type="button"
                  className={`distribution-chart-mode-button${displayMode === "count" ? " active" : ""}`}
                  onClick={() => setDisplayMode("count")}
                  aria-label={t("distributionChart.countMode")}
                  title={t("distributionChart.countMode")}
                >
                  {displayMode === "count" ? (
                    <motion.span
                      layoutId={`library-history-mode-pill-${toggleId}`}
                      className="nav-active-pill distribution-chart-mode-pill"
                    />
                  ) : null}
                  <span className="distribution-chart-mode-button-content">
                    <Hash aria-hidden="true" className="distribution-chart-mode-icon" />
                  </span>
                </button>
                <button
                  type="button"
                  className={`distribution-chart-mode-button${displayMode === "percentage" ? " active" : ""}`}
                  onClick={() => setDisplayMode("percentage")}
                  aria-label={t("distributionChart.percentMode")}
                  title={t("distributionChart.percentMode")}
                >
                  {displayMode === "percentage" ? (
                    <motion.span
                      layoutId={`library-history-mode-pill-${toggleId}`}
                      className="nav-active-pill distribution-chart-mode-pill"
                    />
                  ) : null}
                  <span className="distribution-chart-mode-button-content">
                    <Percent aria-hidden="true" className="distribution-chart-mode-icon" />
                  </span>
                </button>
              </div>
            ) : null}
            <div ref={pickerRef} className="library-history-toolbar search-filter-picker">
              <button
                type="button"
                className={`search-filter-picker-button search-filter-picker-button-standalone library-history-picker-button${pickerOpen ? " is-open" : ""}`}
                aria-label={metricLabel ?? t("libraryDetail.history.controls.metric")}
                aria-haspopup="menu"
                aria-expanded={pickerOpen}
                aria-controls={pickerId}
                title={t(selectedMetricDefinition.labelKey)}
                onClick={() => setPickerOpen((current) => !current)}
              >
                <SelectedMetricIcon size={18} aria-hidden="true" />
                <span className="library-history-picker-button-label">
                  {t(selectedMetricDefinition.labelKey)}
                </span>
              </button>
              {pickerOpen ? (
                <div
                  id={pickerId}
                  className="search-filter-picker-popover search-filter-picker-popover-scroll library-history-picker-popover"
                  role="menu"
                >
                  {HISTORY_METRIC_GROUPS.map((group) => {
                    const GroupIcon = HISTORY_GROUP_ICONS[group.id];
                    const metrics = HISTORY_METRIC_DEFINITIONS.filter((definition) => definition.group === group.id);
                    return (
                      <div key={group.id} className="library-history-picker-group">
                        <div className="library-history-picker-group-label">
                          <GroupIcon size={14} aria-hidden="true" />
                          <span>{t(group.labelKey)}</span>
                        </div>
                        {metrics.map((option) => {
                          const isSelected = option.id === selectedMetric;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              role="menuitemradio"
                              aria-checked={isSelected}
                              className={`search-filter-picker-item${isSelected ? " is-selected" : ""}`}
                              onClick={() => {
                                onChangeMetric(option.id);
                                setPickerOpen(false);
                              }}
                            >
                              <span>{t(option.labelKey)}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </>
        ) : null
      }
      collapseButtonClassName={!collapsed ? "async-panel-toggle-icon-button-flat" : undefined}
      collapseState={{
        collapsed,
        onToggle: onToggleCollapsed,
        bodyId,
      }}
    >
      {!history || history.points.length === 0 ? (
        <div className="notice">{emptyMessage ?? t("libraryDetail.history.empty")}</div>
      ) : (
        <div className="comparison-chart-content library-history-chart-shell">
          <HistoryTrendChart
            points={history.points}
            resolutionCategories={resolutionCategories}
            metricId={selectedMetric}
            displayMode={displayMode}
            resizeToken={`${selectedMetric}:${displayMode}:${history.points.length}`}
          />
        </div>
      )}
    </AsyncPanel>
  );
}
