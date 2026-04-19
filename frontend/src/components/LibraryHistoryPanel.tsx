import { AudioLines, Clock3, Frame, Gauge } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { DashboardHistoryResponse, LibraryHistoryResponse } from "../lib/api";
import { AsyncPanel } from "./AsyncPanel";
import { HistoryTrendChart, type LibraryHistoryMetricId } from "./HistoryTrendChart";

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

const HISTORY_METRICS = [
  { id: "resolution_mix", icon: Frame },
  { id: "average_bitrate", icon: Gauge },
  { id: "average_audio_bitrate", icon: AudioLines },
  { id: "average_duration_seconds", icon: Clock3 },
  { id: "average_quality_score", icon: Gauge },
] as const satisfies ReadonlyArray<{ id: LibraryHistoryMetricId; icon: typeof Frame }>;

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
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const pickerId = useId();
  const currentResolutionCategoryIdSet = useMemo(
    () => new Set(currentResolutionCategoryIds),
    [currentResolutionCategoryIds],
  );
  const selectedMetricOption = useMemo(
    () => HISTORY_METRICS.find((option) => option.id === selectedMetric) ?? HISTORY_METRICS[0],
    [selectedMetric],
  );
  const SelectedMetricIcon = selectedMetricOption.icon;
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
      titleAddon={history ? <span className="badge">{history.points.length}</span> : null}
      bodyClassName="async-panel-body-scroll"
      headerAddon={
        !collapsed ? (
          <div ref={pickerRef} className="library-history-toolbar search-filter-picker">
            <button
              type="button"
              className={`search-filter-picker-button search-filter-picker-button-standalone${pickerOpen ? " is-open" : ""}`}
              aria-label={metricLabel ?? t("libraryDetail.history.controls.metric")}
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
              aria-controls={pickerId}
              title={t(`libraryDetail.history.metrics.${selectedMetricOption.id}`)}
              onClick={() => setPickerOpen((current) => !current)}
            >
              <SelectedMetricIcon size={18} aria-hidden="true" />
            </button>
            {pickerOpen ? (
              <div
                id={pickerId}
                className="search-filter-picker-popover search-filter-picker-popover-scroll library-history-picker-popover"
                role="menu"
              >
                {HISTORY_METRICS.map((option) => {
                  const Icon = option.icon;
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
                      <Icon size={16} aria-hidden="true" />
                      <span>{t(`libraryDetail.history.metrics.${option.id}`)}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null
      }
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
            resizeToken={`${selectedMetric}:${history.points.length}`}
          />
        </div>
      )}
    </AsyncPanel>
  );
}
