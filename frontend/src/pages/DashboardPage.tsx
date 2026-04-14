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
import { StatCard } from "../components/StatCard";
import { StatisticPanelLayoutControls } from "../components/StatisticPanelLayoutControls";
import { useAppData } from "../lib/app-data";
import { api, type ComparisonResponse } from "../lib/api";
import { formatBytes, formatCodecLabel, formatContainerLabel, formatDuration, formatSpatialAudioProfileLabel } from "../lib/format";
import { collapseHdrDistribution } from "../lib/hdr";
import {
  getDashboardStatisticNumericDistribution,
  getDashboardStatisticPanelItems,
  LIBRARY_STATISTIC_DEFINITIONS,
  type LibraryStatisticDefinition,
} from "../lib/library-statistics-settings";
import {
  addStatisticPanelLayoutItem,
  buildDefaultStatisticPanelLayout,
  cloneStatisticPanelLayout,
  getAvailableStatisticPanelDefinitions,
  getStatisticPanelLayout,
  moveStatisticPanelLayoutItem,
  removeStatisticPanelLayoutItem,
  resizeStatisticPanelLayoutItem,
  saveStatisticPanelLayout,
  updateStatisticPanelLayoutComparisonSelection,
} from "../lib/statistic-panel-layout";
import {
  getComparisonSelection,
  sanitizeComparisonRenderer,
  saveComparisonSelection,
  type ComparisonSelection,
} from "../lib/statistic-comparisons";
import { useScanJobs } from "../lib/scan-jobs";

const DASHBOARD_LAYOUT_KEY = "main";
const dashboardComparisonCache = new Map<string, ComparisonResponse>();
const statisticDefinitionMap = new Map(
  LIBRARY_STATISTIC_DEFINITIONS.map((definition) => [definition.id, definition] as const),
);

function formatDashboardDistributionLabel(
  panelId: string,
  label: string,
  t: (key: string, options?: Record<string, unknown>) => string,
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
  return label;
}

function buildComparisonQueryKey(selection: ComparisonSelection): string {
  return `${selection.xField}:${selection.yField}`;
}

type VisibleDashboardPanel = {
  item: ReturnType<typeof getStatisticPanelLayout>["items"][number];
  definition: LibraryStatisticDefinition;
};

export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { appSettings, dashboard, dashboardLoaded, loadDashboard } = useAppData();
  const [error, setError] = useState<string | null>(null);
  const layoutOptions = useMemo(
    () => ({ unlimitedHeight: appSettings.feature_flags.unlimited_panel_size }),
    [appSettings.feature_flags.unlimited_panel_size],
  );
  const [savedLayout, setSavedLayout] = useState(() =>
    getStatisticPanelLayout("dashboard", DASHBOARD_LAYOUT_KEY, layoutOptions),
  );
  const [draftLayout, setDraftLayout] = useState(() =>
    cloneStatisticPanelLayout(getStatisticPanelLayout("dashboard", DASHBOARD_LAYOUT_KEY, layoutOptions)),
  );
  const [isEditingLayout, setIsEditingLayout] = useState(false);
  const [draggedPanelId, setDraggedPanelId] = useState<string | null>(null);
  const [dropTargetPanelId, setDropTargetPanelId] = useState<string | null>(null);
  const [comparisonByPanel, setComparisonByPanel] = useState<Record<string, ComparisonResponse | null>>({});
  const [comparisonErrorByPanel, setComparisonErrorByPanel] = useState<Record<string, string | null>>({});
  const [comparisonLoadingByPanel, setComparisonLoadingByPanel] = useState<Record<string, boolean>>({});
  const { hasActiveJobs } = useScanJobs();
  const hadActiveJobsRef = useRef(hasActiveJobs);
  const comparisonAbortRef = useRef<Map<string, AbortController>>(new Map());
  const activeLayout = isEditingLayout ? draftLayout : savedLayout;
  const visiblePanels = useMemo(
    () =>
      activeLayout.items
        .map((item) => {
          const definition = statisticDefinitionMap.get(item.statisticId);
          if (!definition) {
            return null;
          }
          return { item, definition };
        })
        .filter((entry): entry is VisibleDashboardPanel => Boolean(entry)),
    [activeLayout.items],
  );
  const comparisonPanels = useMemo(
    () => visiblePanels.filter((panel) => panel.item.statisticId === "comparison"),
    [visiblePanels],
  );
  const comparisonPanelsKey = useMemo(
    () =>
      comparisonPanels
        .map(({ item }) => {
          const selection = item.comparisonSelection ?? getComparisonSelection("dashboard");
          return `${item.instanceId}:${selection.xField}:${selection.yField}`;
        })
        .join("|"),
    [comparisonPanels],
  );
  const availablePanelDefinitions = useMemo(
    () => getAvailableStatisticPanelDefinitions("dashboard", draftLayout),
    [draftLayout],
  );

  useEffect(() => {
    if (dashboardLoaded) {
      return;
    }
    loadDashboard().catch((reason: Error) => setError(reason.message));
  }, [dashboardLoaded, loadDashboard]);

  useEffect(() => {
    const nextLayout = saveStatisticPanelLayout(
      "dashboard",
      DASHBOARD_LAYOUT_KEY,
      getStatisticPanelLayout("dashboard", DASHBOARD_LAYOUT_KEY, layoutOptions),
      layoutOptions,
    );
    setSavedLayout(nextLayout);
    setDraftLayout(cloneStatisticPanelLayout(nextLayout));
    setIsEditingLayout(false);
    setDraggedPanelId(null);
    setDropTargetPanelId(null);
  }, [layoutOptions]);

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
      const selection = item.comparisonSelection ?? getComparisonSelection("dashboard");
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
      loadDashboard(true)
        .then(() => setError(null))
        .catch((reason: Error) => setError(reason.message));
      for (const { item } of comparisonPanels) {
        const selection = item.comparisonSelection ?? getComparisonSelection("dashboard");
        dashboardComparisonCache.delete(buildComparisonQueryKey(selection));
      }
      syncComparisonPanels(true);
    }
    hadActiveJobsRef.current = hasActiveJobs;
  }, [comparisonPanelsKey, hasActiveJobs, loadDashboard]);

  useEffect(() => {
    return () => {
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
    const normalized = saveComparisonSelection("dashboard", {
      ...nextSelection,
      renderer: sanitizeComparisonRenderer(nextSelection.xField, nextSelection.yField, nextSelection.renderer),
    });
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
                  resizeStatisticPanelLayoutItem(current, item.instanceId, { width: item.width + 1 }),
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
                  resizeStatisticPanelLayoutItem(current, item.instanceId, { width: item.width - 1 }),
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
      </section>

      <div className={`media-grid statistic-layout-grid${isEditingLayout ? " is-editing" : ""}`}>
        {visiblePanels.map((panel) => {
            const shellClassName = [
              "statistic-layout-panel-shell",
              `span-x-${panel.item.width}`,
              `span-y-${panel.item.height}`,
              draggedPanelId === panel.item.instanceId ? "is-dragging" : "",
              dropTargetPanelId === panel.item.instanceId ? "is-drop-target" : "",
            ]
              .filter(Boolean)
              .join(" ");

            let content: ReactNode;
            if (panel.definition.panelKind === "comparison") {
              const selection = panel.item.comparisonSelection ?? getComparisonSelection("dashboard");
              content = (
                <ComparisonChartPanel
                  comparison={comparisonByPanel[panel.item.instanceId] ?? null}
                  selection={selection}
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
                />
              );
            } else if (panel.definition.panelKind === "numeric-chart" && panel.definition.numericMetricId) {
              const distribution = getDashboardStatisticNumericDistribution(dashboard, panel.definition);
              content = (
                <DistributionChartPanel
                  title={t(panel.definition.dashboardTitleKey ?? panel.definition.nameKey)}
                  distribution={distribution}
                  metricId={panel.definition.numericMetricId}
                  resizeToken={`${panel.item.width}:${panel.item.height}`}
                  loading={!dashboard && !error}
                  error={error}
                />
              );
            } else {
              const items =
                panel.definition.id === "hdr_type"
                  ? collapseHdrDistribution(getDashboardStatisticPanelItems(dashboard, panel.definition))
                  : getDashboardStatisticPanelItems(dashboard, panel.definition);
              const formattedItems = panel.definition.dashboardFormatKind
                ? items.map((item) => ({
                    ...item,
                    label: formatCodecLabel(item.label, panel.definition.dashboardFormatKind!),
                  }))
                : items.map((item) => ({
                    ...item,
                    label: formatDashboardDistributionLabel(panel.definition.id, item.label, t),
                  }));
              content = (
                <AsyncPanel
                  title={t(panel.definition.dashboardTitleKey ?? panel.definition.nameKey)}
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
          })}
      </div>
    </>
  );
}
