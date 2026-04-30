import {
  PanelBottomClose,
  PanelLeftClose,
  PanelRightClose,
  PanelTopClose,
  Trash2,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { AsyncPanel } from "../components/AsyncPanel";
import { ComparisonChartPanel } from "../components/ComparisonChartPanel";
import { DistributionChartPanel } from "../components/DistributionChartPanel";
import { DistributionList } from "../components/DistributionList";
import { LibraryHistoryPanel } from "../components/LibraryHistoryPanel";
import { StatCard } from "../components/StatCard";
import { StatisticPanelLayoutControls } from "../components/StatisticPanelLayoutControls";
import { StatisticPanelLayoutMigrationNotice } from "../components/StatisticPanelLayoutMigrationNotice";
import { useAppData } from "../lib/app-data";
import { api, type ComparisonResponse, type DashboardHistoryResponse } from "../lib/api";
import { formatBytes, formatCodecLabel, formatContainerLabel, formatDuration, formatSpatialAudioProfileLabel } from "../lib/format";
import { collapseHdrDistribution, formatHdrType } from "../lib/hdr";
import { LruCache } from "../lib/lru-cache";
import {
  getDashboardStatisticNumericDistribution,
  getDashboardStatisticPanelItems,
  isLibraryStatisticDefinitionVisibleForLibraryType,
  LIBRARY_STATISTIC_DEFINITIONS,
  type LibraryStatisticDefinition,
} from "../lib/library-statistics-settings";
import {
  addStatisticPanelLayoutItem,
  buildDefaultStatisticPanelLayout,
  cloneStatisticPanelLayout,
  getAvailableStatisticPanelDefinitions,
  getStatisticPanelLayout,
  getStatisticPanelLayoutReadResult,
  moveStatisticPanelLayoutItem,
  removeStatisticPanelLayoutItem,
  resizeStatisticPanelLayoutItem,
  saveStatisticPanelLayout,
  updateStatisticPanelLayoutComparisonSelection,
  type StatisticPanelLayoutId,
} from "../lib/statistic-panel-layout";
import {
  getComparisonFieldDefinitionsForLibraryType,
  getComparisonSelection,
  normalizeComparisonSelectionForLibraryType,
  sanitizeComparisonRenderer,
  saveComparisonSelection,
  type ComparisonSelection,
} from "../lib/statistic-comparisons";
import { useScanJobs } from "../lib/scan-jobs";
import { isLibraryHistoryMetricId, type LibraryHistoryMetricId } from "../lib/history-metrics";

const DASHBOARD_LAYOUT_KEY = "main";
const DASHBOARD_HISTORY_PANEL_COLLAPSE_STORAGE_KEY = "medialyze-dashboard-history-collapsed";
const DASHBOARD_HISTORY_SELECTED_METRIC_STORAGE_KEY = "medialyze-dashboard-history-selected-metric";
const DASHBOARD_HISTORY_RANGE_STORAGE_KEY = "medialyze-dashboard-history-range-selection";
const DEFAULT_HISTORY_METRIC: LibraryHistoryMetricId = "resolution_mix";
const dashboardComparisonCache = new LruCache<string, ComparisonResponse>(24);
type DashboardLayoutPanelDefinition =
  | {
      id: LibraryStatisticDefinition["id"];
      kind: "statistic";
      statisticDefinition: LibraryStatisticDefinition;
    }
  | {
      id: "history";
      kind: "history";
    };

const dashboardLayoutPanelDefinitionMap = new Map<StatisticPanelLayoutId, DashboardLayoutPanelDefinition>(
  [
    ...LIBRARY_STATISTIC_DEFINITIONS.map(
      (definition) =>
        [
          definition.id,
          {
            id: definition.id,
            kind: "statistic",
            statisticDefinition: definition,
          },
        ] as const,
    ),
    ["history", { id: "history", kind: "history" }] as const,
  ],
);

function formatDashboardDistributionLabel(
  panelId: string,
  label: string,
  t: (key: string, options?: Record<string, unknown>) => string,
  options?: { inDepthDolbyVisionProfiles?: boolean },
): string {
  if (panelId === "container") {
    return formatContainerLabel(label);
  }
  if (panelId === "audio_spatial_profiles") {
    return formatSpatialAudioProfileLabel(label);
  }
  if (panelId === "subtitle_sources") {
    if (label === "internal") {
      return t("streamDetails.internal");
    }
    if (label === "external") {
      return t("streamDetails.external");
    }
  }
  if (panelId === "hdr_type") {
    return formatHdrType(label, options) ?? label;
  }
  return label;
}

function buildComparisonQueryKey(selection: ComparisonSelection): string {
  return `${selection.xField}:${selection.yField}`;
}

function readDashboardHistoryPanelCollapsedPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const storedPreference = window.localStorage.getItem(DASHBOARD_HISTORY_PANEL_COLLAPSE_STORAGE_KEY);
  if (storedPreference === null) {
    return false;
  }
  return storedPreference === "true";
}

function readDashboardHistoryMetricPreference(): LibraryHistoryMetricId {
  if (typeof window === "undefined") {
    return DEFAULT_HISTORY_METRIC;
  }
  const storedPreference = window.localStorage.getItem(DASHBOARD_HISTORY_SELECTED_METRIC_STORAGE_KEY);
  if (isLibraryHistoryMetricId(storedPreference)) {
    return storedPreference;
  }
  return DEFAULT_HISTORY_METRIC;
}

type VisibleDashboardPanel = {
  item: ReturnType<typeof getStatisticPanelLayout>["items"][number];
  definition: DashboardLayoutPanelDefinition;
};

export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { appSettings, dashboard, dashboardLoaded, libraries, loadDashboard } = useAppData();
  const dashboardLibraryTypes = useMemo(
    () => [...new Set(libraries.filter((library) => library.show_on_dashboard).map((library) => library.type))],
    [libraries],
  );
  const effectiveDashboardLibraryType = dashboardLibraryTypes.length === 1 ? dashboardLibraryTypes[0] : null;
  const availableComparisonFields = useMemo(
    () => getComparisonFieldDefinitionsForLibraryType(effectiveDashboardLibraryType),
    [effectiveDashboardLibraryType],
  );
  const inDepthDolbyVisionProfiles = appSettings.feature_flags.in_depth_dolby_vision_profiles;
  const [error, setError] = useState<string | null>(null);
  const layoutOptions = useMemo(
    () => ({ unlimitedHeight: appSettings.feature_flags.unlimited_panel_size }),
    [appSettings.feature_flags.unlimited_panel_size],
  );
  const initialLayoutResultRef = useRef<ReturnType<typeof getStatisticPanelLayoutReadResult> | null>(null);
  if (initialLayoutResultRef.current === null) {
    initialLayoutResultRef.current = getStatisticPanelLayoutReadResult(
      "dashboard",
      DASHBOARD_LAYOUT_KEY,
      layoutOptions,
    );
  }
  const [savedLayout, setSavedLayout] = useState(() => initialLayoutResultRef.current!.layout);
  const [draftLayout, setDraftLayout] = useState(() =>
    cloneStatisticPanelLayout(initialLayoutResultRef.current!.layout),
  );
  const [layoutMigrationIssues, setLayoutMigrationIssues] = useState(
    () => initialLayoutResultRef.current!.issues,
  );
  const [isEditingLayout, setIsEditingLayout] = useState(false);
  const [draggedPanelId, setDraggedPanelId] = useState<string | null>(null);
  const [dropTargetPanelId, setDropTargetPanelId] = useState<string | null>(null);
  const [comparisonByPanel, setComparisonByPanel] = useState<Record<string, ComparisonResponse | null>>({});
  const [comparisonErrorByPanel, setComparisonErrorByPanel] = useState<Record<string, string | null>>({});
  const [comparisonLoadingByPanel, setComparisonLoadingByPanel] = useState<Record<string, boolean>>({});
  const [dashboardHistory, setDashboardHistory] = useState<DashboardHistoryResponse | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [isHistoryPanelCollapsed, setIsHistoryPanelCollapsed] = useState(() =>
    readDashboardHistoryPanelCollapsedPreference(),
  );
  const [selectedHistoryMetric, setSelectedHistoryMetric] = useState<LibraryHistoryMetricId>(() =>
    readDashboardHistoryMetricPreference(),
  );
  const { hasActiveJobs } = useScanJobs();
  const hadActiveJobsRef = useRef(hasActiveJobs);
  const comparisonAbortRef = useRef<Map<string, AbortController>>(new Map());
  const historyAbortRef = useRef<AbortController | null>(null);
  const activeLayout = isEditingLayout ? draftLayout : savedLayout;
  const visiblePanels = useMemo(
    () =>
      activeLayout.items
        .map((item) => {
          const definition = dashboardLayoutPanelDefinitionMap.get(item.statisticId);
          if (!definition) {
            return null;
          }
          if (
            definition.kind === "statistic" &&
            !isLibraryStatisticDefinitionVisibleForLibraryType(definition.statisticDefinition, effectiveDashboardLibraryType)
          ) {
            return null;
          }
          return { item, definition };
        })
        .filter((entry): entry is VisibleDashboardPanel => Boolean(entry)),
    [activeLayout.items, effectiveDashboardLibraryType],
  );
  const comparisonPanels = useMemo(
    () => visiblePanels.filter((panel) => panel.item.statisticId === "comparison"),
    [visiblePanels],
  );
  const visibleDashboardPanelIds = useMemo(
    () => [...new Set(visiblePanels.map((panel) => panel.item.statisticId))],
    [visiblePanels],
  );
  const visibleDashboardPanelIdsKey = useMemo(
    () => visibleDashboardPanelIds.slice().sort().join("|"),
    [visibleDashboardPanelIds],
  );
  const comparisonPanelsKey = useMemo(
    () =>
      comparisonPanels
        .map(({ item }) => {
          const selection = normalizeComparisonSelectionForLibraryType(
            item.comparisonSelection ?? getComparisonSelection("dashboard"),
            effectiveDashboardLibraryType,
          );
          return `${item.instanceId}:${selection.xField}:${selection.yField}`;
        })
        .join("|"),
    [comparisonPanels, effectiveDashboardLibraryType],
  );
  const availablePanelDefinitions = useMemo(
    () =>
      getAvailableStatisticPanelDefinitions("dashboard", draftLayout).filter((definition) => {
        if (definition.kind !== "statistic") {
          return true;
        }
        return isLibraryStatisticDefinitionVisibleForLibraryType(
          definition.statisticDefinition,
          effectiveDashboardLibraryType,
        );
      }),
    [draftLayout, effectiveDashboardLibraryType],
  );

  useEffect(() => {
    loadDashboard(false, visibleDashboardPanelIds)
      .then(() => setError(null))
      .catch((reason: Error) => setError(reason.message));
  }, [dashboardLoaded, loadDashboard, visibleDashboardPanelIdsKey]);

  const loadDashboardHistory = useEffectEvent(async (showLoading = false) => {
    historyAbortRef.current?.abort();
    const controller = new AbortController();
    historyAbortRef.current = controller;

    if (showLoading) {
      setIsHistoryLoading(true);
    }

    try {
      const payload = await api.dashboardHistory(controller.signal);
      setDashboardHistory(payload);
      setHistoryError(null);
    } catch (reason) {
      if ((reason as Error).name === "AbortError") {
        return;
      }
      setHistoryError((reason as Error).message);
    } finally {
      if (historyAbortRef.current === controller) {
        historyAbortRef.current = null;
      }
      if (showLoading) {
        setIsHistoryLoading(false);
      }
    }
  });

  useEffect(() => {
    setIsHistoryLoading(true);
    void loadDashboardHistory(true);
  }, []);

  useEffect(() => {
    const nextLayoutResult = getStatisticPanelLayoutReadResult("dashboard", DASHBOARD_LAYOUT_KEY, layoutOptions);
    setSavedLayout(nextLayoutResult.layout);
    setDraftLayout(cloneStatisticPanelLayout(nextLayoutResult.layout));
    setLayoutMigrationIssues(nextLayoutResult.issues);
    setIsEditingLayout(false);
    setDraggedPanelId(null);
    setDropTargetPanelId(null);
  }, [layoutOptions]);

  useEffect(() => {
    window.localStorage.setItem(
      DASHBOARD_HISTORY_PANEL_COLLAPSE_STORAGE_KEY,
      isHistoryPanelCollapsed ? "true" : "false",
    );
  }, [isHistoryPanelCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_HISTORY_SELECTED_METRIC_STORAGE_KEY, selectedHistoryMetric);
  }, [selectedHistoryMetric]);

  const syncComparisonPanels = useEffectEvent((force = false) => {
    const activeIds = new Set(comparisonPanels.map(({ item }) => item.instanceId));
    for (const [instanceId, controller] of comparisonAbortRef.current.entries()) {
      if (!activeIds.has(instanceId)) {
        controller.abort();
        comparisonAbortRef.current.delete(instanceId);
      }
    }

    if (comparisonPanels.length === 0) {
      return;
    }

    for (const { item } of comparisonPanels) {
      const selection = normalizeComparisonSelectionForLibraryType(
        item.comparisonSelection ?? getComparisonSelection("dashboard"),
        effectiveDashboardLibraryType,
      );
      const queryKey = buildComparisonQueryKey(selection);
      const cachedComparison = !force ? dashboardComparisonCache.get(queryKey) ?? null : null;

      setComparisonErrorByPanel((current) => ({ ...current, [item.instanceId]: null }));
      setComparisonByPanel((current) =>
        current[item.instanceId] === cachedComparison ? current : { ...current, [item.instanceId]: cachedComparison },
      );
      setComparisonLoadingByPanel((current) => ({
        ...current,
        [item.instanceId]: cachedComparison === null,
      }));

      if (cachedComparison) {
        continue;
      }

      const controller = new AbortController();
      comparisonAbortRef.current.get(item.instanceId)?.abort();
      comparisonAbortRef.current.set(item.instanceId, controller);

      api.dashboardComparison({
        xField: selection.xField,
        yField: selection.yField,
        signal: controller.signal,
      })
        .then((payload) => {
          dashboardComparisonCache.set(queryKey, payload);
          setComparisonByPanel((current) => ({ ...current, [item.instanceId]: payload }));
          setComparisonErrorByPanel((current) => ({ ...current, [item.instanceId]: null }));
        })
        .catch((reason: Error) => {
          if (reason.name === "AbortError") {
            return;
          }
          setComparisonErrorByPanel((current) => ({ ...current, [item.instanceId]: reason.message }));
        })
        .finally(() => {
          if (comparisonAbortRef.current.get(item.instanceId) === controller) {
            comparisonAbortRef.current.delete(item.instanceId);
          }
          setComparisonLoadingByPanel((current) => ({ ...current, [item.instanceId]: false }));
        });
    }
  });

  useEffect(() => {
    syncComparisonPanels();
  }, [comparisonPanelsKey]);

  useEffect(() => {
    if (hadActiveJobsRef.current && !hasActiveJobs) {
      loadDashboard(true, visibleDashboardPanelIds)
        .then(() => setError(null))
        .catch((reason: Error) => setError(reason.message));
      void loadDashboardHistory(false);
      for (const { item } of comparisonPanels) {
        const selection = normalizeComparisonSelectionForLibraryType(
          item.comparisonSelection ?? getComparisonSelection("dashboard"),
          effectiveDashboardLibraryType,
        );
        dashboardComparisonCache.delete(buildComparisonQueryKey(selection));
      }
      syncComparisonPanels(true);
    }
    hadActiveJobsRef.current = hasActiveJobs;
  }, [comparisonPanelsKey, hasActiveJobs, loadDashboard, visibleDashboardPanelIdsKey]);

  useEffect(() => {
    return () => {
      historyAbortRef.current?.abort();
      for (const controller of comparisonAbortRef.current.values()) {
        controller.abort();
      }
      comparisonAbortRef.current.clear();
    };
  }, []);

  function persistLayout(nextLayout: typeof savedLayout) {
    const normalized = saveStatisticPanelLayout("dashboard", DASHBOARD_LAYOUT_KEY, nextLayout, layoutOptions);
    setSavedLayout(normalized);
    setDraftLayout(cloneStatisticPanelLayout(normalized));
    setLayoutMigrationIssues([]);
  }

  function updateLayout(transform: (current: typeof activeLayout) => typeof activeLayout, persistWhenViewing = false) {
    if (isEditingLayout) {
      setDraftLayout((current) => transform(current));
      return;
    }
    const nextLayout = transform(savedLayout);
    if (persistWhenViewing) {
      persistLayout(nextLayout);
      return;
    }
    setSavedLayout(nextLayout);
    setDraftLayout(cloneStatisticPanelLayout(nextLayout));
  }

  function updateComparisonSelection(instanceId: string, nextSelection: ComparisonSelection) {
    const normalized = saveComparisonSelection(
      "dashboard",
      normalizeComparisonSelectionForLibraryType(
        {
          ...nextSelection,
          renderer: sanitizeComparisonRenderer(nextSelection.xField, nextSelection.yField, nextSelection.renderer),
        },
        effectiveDashboardLibraryType,
      ),
    );
    updateLayout(
      (current) =>
        updateStatisticPanelLayoutComparisonSelection("dashboard", current, instanceId, normalized),
      true,
    );
  }

  function handlePanelDrop(targetInstanceId: string) {
    if (!draggedPanelId) {
      return;
    }
    updateLayout((current) => moveStatisticPanelLayoutItem(current, draggedPanelId, targetInstanceId));
    setDraggedPanelId(null);
    setDropTargetPanelId(null);
  }

  function renderResizeControls(panel: VisibleDashboardPanel) {
    const { item } = panel;
    return (
      <>
        <div className="statistic-layout-size-controls statistic-layout-size-controls-top-left">
          <button
            type="button"
            className="statistic-layout-size-button"
            aria-label={t("panelLayout.remove")}
            title={t("panelLayout.remove")}
            onClick={() =>
              updateLayout((current) => removeStatisticPanelLayoutItem(current, item.instanceId))
            }
          >
            <Trash2 className="nav-icon" aria-hidden="true" />
          </button>
        </div>
        <div className="statistic-layout-size-controls statistic-layout-size-controls-right">
          {item.width < 4 ? (
            <button
              type="button"
              className="statistic-layout-size-button"
              aria-label={t("panelLayout.expandWidth")}
              title={t("panelLayout.expandWidth")}
                onClick={() =>
                  updateLayout((current) =>
                    resizeStatisticPanelLayoutItem("dashboard", current, item.instanceId, { width: item.width + 1 }),
                  )
                }
            >
              <PanelRightClose className="nav-icon" aria-hidden="true" />
            </button>
          ) : null}
          {item.width > 1 ? (
            <button
              type="button"
              className="statistic-layout-size-button"
              aria-label={t("panelLayout.shrinkWidth")}
              title={t("panelLayout.shrinkWidth")}
                onClick={() =>
                  updateLayout((current) =>
                    resizeStatisticPanelLayoutItem("dashboard", current, item.instanceId, { width: item.width - 1 }),
                  )
                }
            >
              <PanelLeftClose className="nav-icon" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="statistic-layout-size-controls statistic-layout-size-controls-bottom">
          {layoutOptions.unlimitedHeight || item.height < 4 ? (
            <button
              type="button"
              className="statistic-layout-size-button"
              aria-label={t("panelLayout.expandHeight")}
              title={t("panelLayout.expandHeight")}
              onClick={() =>
                updateLayout((current) =>
                  resizeStatisticPanelLayoutItem(
                    "dashboard",
                    current,
                    item.instanceId,
                    { height: item.height + 1 },
                    layoutOptions,
                  ),
                )
              }
            >
              <PanelBottomClose className="nav-icon" aria-hidden="true" />
            </button>
          ) : null}
          {item.height > 1 ? (
            <button
              type="button"
              className="statistic-layout-size-button"
              aria-label={t("panelLayout.shrinkHeight")}
              title={t("panelLayout.shrinkHeight")}
              onClick={() =>
                updateLayout((current) =>
                  resizeStatisticPanelLayoutItem(
                    "dashboard",
                    current,
                    item.instanceId,
                    { height: item.height - 1 },
                    layoutOptions,
                  ),
                )
              }
            >
              <PanelTopClose className="nav-icon" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <section className="panel stack statistic-layout-header-panel">
        <div className="panel-title-row panel-title-row-with-actions">
          <h2>{t("nav.dashboard")}</h2>
          <StatisticPanelLayoutControls
            availableDefinitions={availablePanelDefinitions}
            isEditing={isEditingLayout}
            onStartEditing={() => {
              setDraftLayout(cloneStatisticPanelLayout(savedLayout));
              setIsEditingLayout(true);
            }}
            onCancelEditing={() => {
              setDraftLayout(cloneStatisticPanelLayout(savedLayout));
              setDraggedPanelId(null);
              setDropTargetPanelId(null);
              setIsEditingLayout(false);
            }}
            onRestoreDefault={() => {
              setDraftLayout(buildDefaultStatisticPanelLayout("dashboard", layoutOptions));
              setDraggedPanelId(null);
              setDropTargetPanelId(null);
            }}
            onSaveEditing={() => {
              persistLayout(draftLayout);
              setDraggedPanelId(null);
              setDropTargetPanelId(null);
              setIsEditingLayout(false);
            }}
            onAddPanel={(statisticId) =>
              updateLayout((current) =>
                addStatisticPanelLayoutItem("dashboard", current, statisticId, layoutOptions)
              )
            }
          />
        </div>
        <div className="card-grid grid">
          <StatCard label={t("dashboard.libraries")} value={String(dashboard?.totals.libraries ?? 0)} />
          <StatCard label={t("dashboard.files")} value={String(dashboard?.totals.files ?? 0)} tone="teal" />
          <StatCard
            label={t("dashboard.storage")}
            value={formatBytes(dashboard?.totals.storage_bytes ?? 0)}
            tone="blue"
          />
          <StatCard
            label={t("dashboard.duration")}
            value={formatDuration(dashboard?.totals.duration_seconds ?? 0)}
          />
        </div>
        <StatisticPanelLayoutMigrationNotice scope="dashboard" issues={layoutMigrationIssues} />
      </section>

      <div className={`media-grid statistic-layout-grid${isEditingLayout ? " is-editing" : ""}`}>
        {(() => {
          let collapsedPanelsBefore = 0;
          return visiblePanels.map((panel) => {
            const collapsedPanelOffsetCount = collapsedPanelsBefore;
            const isCollapsedHistoryPanel = panel.definition.kind === "history" && isHistoryPanelCollapsed;
            if (isCollapsedHistoryPanel) {
              collapsedPanelsBefore += 1;
            }
            const shellClassName = [
              "statistic-layout-panel-shell",
              `span-x-${panel.item.width}`,
              `span-y-${panel.item.height}`,
              panel.definition.kind === "history" ? "library-layout-panel-history" : "",
              isCollapsedHistoryPanel ? "is-collapsed-panel" : "",
              draggedPanelId === panel.item.instanceId ? "is-dragging" : "",
              dropTargetPanelId === panel.item.instanceId ? "is-drop-target" : "",
            ]
              .filter(Boolean)
              .join(" ");

            let content: ReactNode;
            if (panel.definition.kind === "history") {
              content = (
                <LibraryHistoryPanel
                  history={dashboardHistory}
                  loading={isHistoryLoading && !dashboardHistory && !historyError}
                  error={historyError}
                  selectedMetric={selectedHistoryMetric}
                  onChangeMetric={setSelectedHistoryMetric}
                  collapsed={isHistoryPanelCollapsed}
                  onToggleCollapsed={() => setIsHistoryPanelCollapsed((current) => !current)}
                  currentResolutionCategoryIds={appSettings.resolution_categories?.map((category) => category.id) ?? []}
                  title={t("dashboard.history.title")}
                  emptyMessage={t("dashboard.history.empty")}
                  rangeStorageKey={DASHBOARD_HISTORY_RANGE_STORAGE_KEY}
                  bodyId="dashboard-history-panel-body"
                  inDepthDolbyVisionProfiles={inDepthDolbyVisionProfiles}
                />
              );
            } else if (panel.definition.statisticDefinition.panelKind === "comparison") {
              const selection = normalizeComparisonSelectionForLibraryType(
                panel.item.comparisonSelection ?? getComparisonSelection("dashboard"),
                effectiveDashboardLibraryType,
              );
              content = (
                <ComparisonChartPanel
                  comparison={comparisonByPanel[panel.item.instanceId] ?? null}
                  selection={selection}
                  availableFields={availableComparisonFields}
                  resizeToken={`${panel.item.width}:${panel.item.height}`}
                  loading={Boolean(comparisonLoadingByPanel[panel.item.instanceId])}
                  error={comparisonErrorByPanel[panel.item.instanceId] ?? null}
                  onChangeXField={(xField) =>
                    updateComparisonSelection(panel.item.instanceId, { ...selection, xField })
                  }
                  onChangeYField={(yField) =>
                    updateComparisonSelection(panel.item.instanceId, { ...selection, yField })
                  }
                  onSwapAxes={() =>
                    updateComparisonSelection(panel.item.instanceId, {
                      ...selection,
                      xField: selection.yField,
                      yField: selection.xField,
                    })
                  }
                  onChangeRenderer={(renderer) =>
                    updateComparisonSelection(panel.item.instanceId, { ...selection, renderer })
                  }
                  onOpenFile={
                    selection.renderer === "scatter"
                      ? (fileId) => navigate(`/files/${fileId}`)
                      : undefined
                  }
                  inDepthDolbyVisionProfiles={inDepthDolbyVisionProfiles}
                />
              );
            } else if (panel.definition.statisticDefinition.panelKind === "numeric-chart") {
              const statisticDefinition = panel.definition.statisticDefinition;
              if (!statisticDefinition.numericMetricId) {
                return null;
              }
              const distribution = getDashboardStatisticNumericDistribution(dashboard, statisticDefinition);
              content = (
                <DistributionChartPanel
                  title={t(statisticDefinition.dashboardTitleKey ?? statisticDefinition.nameKey)}
                  distribution={distribution}
                  metricId={statisticDefinition.numericMetricId}
                  resizeToken={`${panel.item.width}:${panel.item.height}`}
                  loading={!dashboard && !error}
                  error={error}
                />
              );
            } else {
              const statisticDefinition = panel.definition.statisticDefinition;
              const items =
                statisticDefinition.id === "hdr_type"
                  ? collapseHdrDistribution(getDashboardStatisticPanelItems(dashboard, statisticDefinition), {
                      inDepthDolbyVisionProfiles,
                    })
                  : getDashboardStatisticPanelItems(dashboard, statisticDefinition);
              const formattedItems = statisticDefinition.dashboardFormatKind
                ? items.map((item) => ({
                    ...item,
                    label: formatCodecLabel(item.label, statisticDefinition.dashboardFormatKind!),
                  }))
                : items.map((item) => ({
                    ...item,
                    label: formatDashboardDistributionLabel(statisticDefinition.id, item.label, t, {
                      inDepthDolbyVisionProfiles,
                    }),
                  }));
              content = (
                <AsyncPanel
                  title={t(statisticDefinition.dashboardTitleKey ?? statisticDefinition.nameKey)}
                  loading={!dashboard && !error}
                  error={error}
                  bodyClassName="async-panel-body-scroll"
                >
                  <DistributionList items={formattedItems} maxVisibleRows={5} scrollable />
                </AsyncPanel>
              );
            }

            return (
              <div
                key={panel.item.instanceId}
                className={shellClassName}
                draggable={isEditingLayout}
                onDragStart={() => {
                  if (!isEditingLayout) {
                    return;
                  }
                  setDraggedPanelId(panel.item.instanceId);
                  setDropTargetPanelId(null);
                }}
                onDragOver={(event) => {
                  if (!isEditingLayout || draggedPanelId === panel.item.instanceId) {
                    return;
                  }
                  event.preventDefault();
                  setDropTargetPanelId(panel.item.instanceId);
                }}
                onDragLeave={() => {
                  if (dropTargetPanelId === panel.item.instanceId) {
                    setDropTargetPanelId(null);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!isEditingLayout) {
                    return;
                  }
                  handlePanelDrop(panel.item.instanceId);
                }}
                onDragEnd={() => {
                  setDraggedPanelId(null);
                  setDropTargetPanelId(null);
                }}
                style={
                  {
                    "--collapsed-panel-offset-count": String(collapsedPanelOffsetCount),
                    "--statistic-panel-row-span": String(panel.item.height),
                  } as CSSProperties
                }
              >
                {content}
                {isEditingLayout ? (
                  <div className="statistic-layout-overlay">
                    <div className="statistic-layout-overlay-sheen" />
                    {renderResizeControls(panel)}
                  </div>
                ) : null}
              </div>
            );
          });
        })()}
      </div>
    </>
  );
}
