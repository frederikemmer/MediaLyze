import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Database, Frame, Hash, Percent } from "lucide-react";
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
type HistoryRangeMode = "7d" | "30d" | "1y" | "all" | "custom";
type HistoryRangeSelection = {
  mode: HistoryRangeMode;
  startDate?: string;
  endDate?: string;
};

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
  rangeStorageKey?: string;
  bodyId?: string;
};

const HISTORY_GROUP_ICONS = {
  summary: Database,
  category: Frame,
  distribution: BarChart3,
} as const;
const DEFAULT_HISTORY_RANGE_STORAGE_KEY = "medialyze-history-range-selection";
const DEFAULT_HISTORY_RANGE_SELECTION: HistoryRangeSelection = { mode: "30d" };
const HISTORY_RANGE_OPTIONS: Array<{ mode: HistoryRangeMode; labelKey: string }> = [
  { mode: "7d", labelKey: "libraryDetail.history.range.last7Days" },
  { mode: "30d", labelKey: "libraryDetail.history.range.last30Days" },
  { mode: "1y", labelKey: "libraryDetail.history.range.lastYear" },
  { mode: "all", labelKey: "libraryDetail.history.range.all" },
  { mode: "custom", labelKey: "libraryDetail.history.range.custom" },
];

function isHistoryRangeMode(value: unknown): value is HistoryRangeMode {
  return value === "7d" || value === "30d" || value === "1y" || value === "all" || value === "custom";
}

function readHistoryRangeSelection(storageKey: string): HistoryRangeSelection {
  if (typeof window === "undefined") {
    return DEFAULT_HISTORY_RANGE_SELECTION;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !isHistoryRangeMode(parsed.mode)) {
      return DEFAULT_HISTORY_RANGE_SELECTION;
    }
    return {
      mode: parsed.mode,
      startDate: typeof parsed.startDate === "string" ? parsed.startDate : undefined,
      endDate: typeof parsed.endDate === "string" ? parsed.endDate : undefined,
    };
  } catch {
    return DEFAULT_HISTORY_RANGE_SELECTION;
  }
}

function saveHistoryRangeSelection(storageKey: string, selection: HistoryRangeSelection) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(selection));
}

function parseDateKey(value: string | undefined): Date | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function latestHistoryDate(points: HistoryResponse["points"]): Date | null {
  return points.reduce<Date | null>((latest, point) => {
    const date = parseDateKey(point.snapshot_day);
    if (!date) {
      return latest;
    }
    return !latest || date > latest ? date : latest;
  }, null);
}

function rangeBoundsFromSelection(
  points: HistoryResponse["points"],
  selection: HistoryRangeSelection,
): { start: string | null; end: string | null } {
  if (selection.mode === "all") {
    return { start: null, end: null };
  }
  if (selection.mode === "custom") {
    const start = parseDateKey(selection.startDate);
    const end = parseDateKey(selection.endDate ?? selection.startDate);
    if (!start || !end) {
      return { start: null, end: null };
    }
    return start <= end
      ? { start: formatDateKey(start), end: formatDateKey(end) }
      : { start: formatDateKey(end), end: formatDateKey(start) };
  }
  const latestDate = latestHistoryDate(points);
  if (!latestDate) {
    return { start: null, end: null };
  }
  const dayCount = selection.mode === "7d" ? 7 : selection.mode === "30d" ? 30 : 365;
  return {
    start: formatDateKey(addUtcDays(latestDate, -(dayCount - 1))),
    end: formatDateKey(latestDate),
  };
}

function filterHistoryPoints(points: HistoryResponse["points"], selection: HistoryRangeSelection) {
  const bounds = rangeBoundsFromSelection(points, selection);
  if (!bounds.start || !bounds.end) {
    return points;
  }
  return points.filter((point) => point.snapshot_day >= bounds.start! && point.snapshot_day <= bounds.end!);
}

function buildCalendarDays(month: Date) {
  const firstDay = startOfUtcMonth(month);
  const gridStart = addUtcDays(firstDay, -firstDay.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => addUtcDays(gridStart, index));
}

function formatMonthLabel(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatRangeLabel(startDate: string | undefined, endDate: string | undefined, locale: string): string | null {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate ?? startDate);
  if (!start || !end) {
    return null;
  }
  const normalizedStart = start <= end ? start : end;
  const normalizedEnd = start <= end ? end : start;
  const monthDayFormatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const fullFormatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (formatDateKey(normalizedStart) === formatDateKey(normalizedEnd)) {
    return fullFormatter.format(normalizedStart);
  }
  return `${monthDayFormatter.format(normalizedStart)} - ${fullFormatter.format(normalizedEnd)}`;
}

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
  rangeStorageKey = DEFAULT_HISTORY_RANGE_STORAGE_KEY,
  bodyId = "library-history-panel-body",
}: LibraryHistoryPanelProps) {
  const { t, i18n } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<HistoryMetricDisplayMode>("count");
  const [rangeSelection, setRangeSelection] = useState<HistoryRangeSelection>(() =>
    readHistoryRangeSelection(rangeStorageKey),
  );
  const [draftStartDate, setDraftStartDate] = useState<string | null>(rangeSelection.startDate ?? null);
  const [draftEndDate, setDraftEndDate] = useState<string | null>(rangeSelection.endDate ?? null);
  const [calendarCursor, setCalendarCursor] = useState<Date>(() =>
    startOfUtcMonth(parseDateKey(rangeSelection.startDate) ?? new Date()),
  );
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const rangePickerRef = useRef<HTMLDivElement | null>(null);
  const pickerId = useId();
  const rangePickerId = useId();
  const toggleId = useId();
  const rangeToggleId = useId();
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
  const filteredHistoryPoints = useMemo(
    () => filterHistoryPoints(history?.points ?? [], rangeSelection),
    [history?.points, rangeSelection],
  );
  const activeRangeLabel = useMemo(
    () =>
      rangeSelection.mode === "custom"
        ? formatRangeLabel(rangeSelection.startDate, rangeSelection.endDate, i18n.language)
        : null,
    [i18n.language, rangeSelection],
  );

  function openCustomRangePicker(selection = rangeSelection) {
    const bounds = rangeBoundsFromSelection(history?.points ?? [], selection);
    const nextStart = selection.startDate ?? bounds.start ?? history?.oldest_snapshot_day ?? null;
    const nextEnd = selection.endDate ?? bounds.end ?? history?.newest_snapshot_day ?? nextStart;
    setDraftStartDate(nextStart);
    setDraftEndDate(nextEnd);
    setCalendarCursor(startOfUtcMonth(parseDateKey(nextStart ?? undefined) ?? latestHistoryDate(history?.points ?? []) ?? new Date()));
    setRangePickerOpen(true);
  }

  function updateRangeSelection(nextSelection: HistoryRangeSelection) {
    setRangeSelection(nextSelection);
    saveHistoryRangeSelection(rangeStorageKey, nextSelection);
    if (nextSelection.mode !== "custom") {
      setRangePickerOpen(false);
    }
  }

  function selectRangePreset(mode: HistoryRangeMode) {
    if (mode === "custom") {
      const bounds = rangeBoundsFromSelection(history?.points ?? [], rangeSelection);
      const nextSelection =
        rangeSelection.mode === "custom"
          ? rangeSelection
          : {
              mode: "custom" as const,
              startDate: bounds.start ?? undefined,
              endDate: bounds.end ?? undefined,
            };
      updateRangeSelection(nextSelection);
      openCustomRangePicker(nextSelection);
      return;
    }
    updateRangeSelection({ mode });
  }

  function selectDraftDate(dateKey: string) {
    if (!draftStartDate || (draftStartDate && draftEndDate)) {
      setDraftStartDate(dateKey);
      setDraftEndDate(null);
      return;
    }
    if (dateKey < draftStartDate) {
      setDraftEndDate(draftStartDate);
      setDraftStartDate(dateKey);
      return;
    }
    setDraftEndDate(dateKey);
  }

  function applyCustomRange() {
    if (!draftStartDate) {
      return;
    }
    const startDate = draftEndDate && draftEndDate < draftStartDate ? draftEndDate : draftStartDate;
    const endDate = draftEndDate && draftEndDate >= draftStartDate ? draftEndDate : draftStartDate;
    updateRangeSelection({ mode: "custom", startDate, endDate });
    setRangePickerOpen(false);
  }

  function renderCalendarMonth(month: Date) {
    const monthKey = formatDateKey(month).slice(0, 7);
    const selectedStart = draftStartDate;
    const selectedEnd = draftEndDate ?? draftStartDate;
    const normalizedStart = selectedStart && selectedEnd && selectedEnd < selectedStart ? selectedEnd : selectedStart;
    const normalizedEnd = selectedStart && selectedEnd && selectedEnd >= selectedStart ? selectedEnd : selectedStart;
    return (
      <div className="history-range-calendar-month">
        <div className="history-range-calendar-title">{formatMonthLabel(month, i18n.language)}</div>
        <div className="history-range-calendar-weekdays" aria-hidden="true">
          {Array.from({ length: 7 }, (_, index) => (
            <span key={`${monthKey}-weekday-${index}`}>
              {new Intl.DateTimeFormat(i18n.language, { weekday: "short", timeZone: "UTC" }).format(
                addUtcDays(new Date(Date.UTC(2026, 0, 4)), index),
              )}
            </span>
          ))}
        </div>
        <div className="history-range-calendar-grid">
          {buildCalendarDays(month).map((date) => {
            const dateKey = formatDateKey(date);
            const isOutsideMonth = date.getUTCMonth() !== month.getUTCMonth();
            const isSelectedStart = dateKey === normalizedStart;
            const isSelectedEnd = dateKey === normalizedEnd;
            const isInRange = Boolean(normalizedStart && normalizedEnd && dateKey > normalizedStart && dateKey < normalizedEnd);
            const className = [
              "history-range-calendar-day",
              isOutsideMonth ? "is-muted" : "",
              isInRange ? "is-in-range" : "",
              isSelectedStart ? "is-selected-start" : "",
              isSelectedEnd ? "is-selected-end" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={`${monthKey}-${dateKey}`}
                type="button"
                className={className}
                onClick={() => selectDraftDate(dateKey)}
                aria-pressed={isSelectedStart || isSelectedEnd}
              >
                {date.getUTCDate()}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

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

  useEffect(() => {
    if (!rangePickerOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (rangePickerRef.current?.contains(event.target as Node)) {
        return;
      }
      setRangePickerOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRangePickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [rangePickerOpen]);

  return (
    <AsyncPanel
      title={title ?? t("libraryDetail.history.title")}
      subtitle={subtitle}
      loading={loading}
      error={error}
      className="library-history-panel"
      bodyClassName="async-panel-body-scroll"
      collapseActions={
        !collapsed ? (
          <div className="library-history-actions">
            <div
              className="library-history-range-toggle"
              role="group"
              aria-label={t("libraryDetail.history.controls.range")}
            >
              {HISTORY_RANGE_OPTIONS.map((option) => {
                const isActive = rangeSelection.mode === option.mode;
                const label =
                  option.mode === "custom" && activeRangeLabel
                    ? activeRangeLabel
                    : t(option.labelKey);
                const content = (
                  <>
                    {isActive ? (
                      <motion.span
                        layoutId={`library-history-range-pill-${rangeToggleId}`}
                        className="nav-active-pill library-history-range-pill"
                      />
                    ) : null}
                    <span className="library-history-range-button-content">
                      {option.mode === "custom" ? <CalendarDays aria-hidden="true" className="distribution-chart-mode-icon" /> : null}
                      <span>{label}</span>
                    </span>
                  </>
                );
                if (option.mode === "custom") {
                  return (
                    <div key={option.mode} ref={rangePickerRef} className="library-history-range-custom-shell">
                      <button
                        type="button"
                        className={`library-history-range-button${isActive ? " active" : ""} library-history-range-button-custom`}
                        onClick={() => selectRangePreset(option.mode)}
                        aria-pressed={isActive}
                        aria-haspopup="dialog"
                        aria-expanded={rangePickerOpen}
                        aria-controls={rangePickerId}
                      >
                        {content}
                      </button>
                      {rangePickerOpen ? (
                        <div
                          id={rangePickerId}
                          className="history-range-picker-popover"
                          role="dialog"
                          aria-label={t("libraryDetail.history.range.custom")}
                        >
                          <div className="history-range-picker-header">
                            <button
                              type="button"
                              className="history-range-picker-nav"
                              aria-label={t("libraryDetail.history.range.previousMonth")}
                              onClick={() => setCalendarCursor((current) => addUtcMonths(current, -1))}
                            >
                              <ChevronLeft aria-hidden="true" className="distribution-chart-mode-icon" />
                            </button>
                            <button
                              type="button"
                              className="history-range-picker-nav"
                              aria-label={t("libraryDetail.history.range.nextMonth")}
                              onClick={() => setCalendarCursor((current) => addUtcMonths(current, 1))}
                            >
                              <ChevronRight aria-hidden="true" className="distribution-chart-mode-icon" />
                            </button>
                          </div>
                          <div className="history-range-calendar-months">
                            {renderCalendarMonth(calendarCursor)}
                            {renderCalendarMonth(addUtcMonths(calendarCursor, 1))}
                          </div>
                          <div className="history-range-picker-footer">
                            <button
                              type="button"
                              className="secondary history-range-picker-action"
                              onClick={() => setRangePickerOpen(false)}
                            >
                              {t("libraryDetail.history.range.cancel")}
                            </button>
                            <button
                              type="button"
                              className="history-range-picker-action"
                              disabled={!draftStartDate}
                              onClick={applyCustomRange}
                            >
                              {t("libraryDetail.history.range.apply")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                }
                return (
                  <button
                    key={option.mode}
                    type="button"
                    className={`library-history-range-button${isActive ? " active" : ""}`}
                    onClick={() => selectRangePreset(option.mode)}
                    aria-pressed={isActive}
                  >
                    {content}
                  </button>
                );
              })}
            </div>
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
          </div>
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
      ) : filteredHistoryPoints.length === 0 ? (
        <div className="notice">{t("libraryDetail.history.range.empty")}</div>
      ) : (
        <div className="comparison-chart-content library-history-chart-shell">
          <HistoryTrendChart
            points={filteredHistoryPoints}
            resolutionCategories={resolutionCategories}
            metricId={selectedMetric}
            displayMode={displayMode}
            resizeToken={`${selectedMetric}:${displayMode}:${rangeSelection.mode}:${filteredHistoryPoints.length}`}
          />
        </div>
      )}
    </AsyncPanel>
  );
}
