import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AsyncPanel } from "../components/AsyncPanel";
import { ComparisonChartPanel } from "../components/ComparisonChartPanel";
import { DistributionChartPanel } from "../components/DistributionChartPanel";
import { DistributionList } from "../components/DistributionList";
import { StatCard } from "../components/StatCard";
import { useAppData } from "../lib/app-data";
import { api, type ComparisonResponse } from "../lib/api";
import { formatBytes, formatCodecLabel, formatContainerLabel, formatDuration, formatSpatialAudioProfileLabel } from "../lib/format";
import { collapseHdrDistribution } from "../lib/hdr";
import {
  getDashboardStatisticNumericDistribution,
  getDashboardStatisticPanelItems,
  getLibraryStatisticsSettings,
  getVisibleDashboardStatisticPanels,
} from "../lib/library-statistics-settings";
import {
  getComparisonSelection,
  sanitizeComparisonRenderer,
  saveComparisonSelection,
  type ComparisonSelection,
} from "../lib/statistic-comparisons";
import { useScanJobs } from "../lib/scan-jobs";

const dashboardComparisonCache = new Map<string, ComparisonResponse>();

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

export function DashboardPage() {
  const { t } = useTranslation();
  const { dashboard, dashboardLoaded, loadDashboard } = useAppData();
  const [error, setError] = useState<string | null>(null);
  const [comparisonSelection, setComparisonSelection] = useState<ComparisonSelection>(() => getComparisonSelection("dashboard"));
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [isComparisonLoading, setIsComparisonLoading] = useState(true);
  const { hasActiveJobs } = useScanJobs();
  const hadActiveJobsRef = useRef(hasActiveJobs);
  const statisticsSettings = useState(() => getLibraryStatisticsSettings())[0];
  const visibleDashboardPanels = getVisibleDashboardStatisticPanels(statisticsSettings);
  const comparisonQueryKey = `${comparisonSelection.xField}:${comparisonSelection.yField}`;
  const comparisonAbortRef = useRef<AbortController | null>(null);
  const showComparisonPanel = visibleDashboardPanels.some((panel) => panel.panelKind === "comparison");

  useEffect(() => {
    if (dashboardLoaded) {
      return;
    }
    loadDashboard().catch((reason: Error) => setError(reason.message));
  }, [dashboardLoaded, loadDashboard]);

  useEffect(() => {
    if (!showComparisonPanel) {
      return;
    }

    const cachedComparison = dashboardComparisonCache.get(comparisonQueryKey) ?? null;
    setComparison(cachedComparison);
    setComparisonError(null);
    setIsComparisonLoading(cachedComparison === null);

    const controller = new AbortController();
    comparisonAbortRef.current?.abort();
    comparisonAbortRef.current = controller;

    api.dashboardComparison({
      xField: comparisonSelection.xField,
      yField: comparisonSelection.yField,
      signal: controller.signal,
    })
      .then((payload) => {
        dashboardComparisonCache.set(comparisonQueryKey, payload);
        setComparison(payload);
        setComparisonError(null);
      })
      .catch((reason: Error) => {
        if (reason.name === "AbortError") {
          return;
        }
        setComparisonError(reason.message);
      })
      .finally(() => {
        if (comparisonAbortRef.current === controller) {
          comparisonAbortRef.current = null;
        }
        setIsComparisonLoading(false);
      });
  }, [comparisonQueryKey, comparisonSelection.xField, comparisonSelection.yField, showComparisonPanel]);

  useEffect(() => {
    if (hadActiveJobsRef.current && !hasActiveJobs) {
      loadDashboard(true)
        .then(() => setError(null))
        .catch((reason: Error) => setError(reason.message));
      if (showComparisonPanel) {
        dashboardComparisonCache.delete(comparisonQueryKey);
        setIsComparisonLoading(true);
        const controller = new AbortController();
        comparisonAbortRef.current?.abort();
        comparisonAbortRef.current = controller;
        api.dashboardComparison({
          xField: comparisonSelection.xField,
          yField: comparisonSelection.yField,
          signal: controller.signal,
        })
          .then((payload) => {
            dashboardComparisonCache.set(comparisonQueryKey, payload);
            setComparison(payload);
            setComparisonError(null);
          })
          .catch((reason: Error) => {
            if (reason.name === "AbortError") {
              return;
            }
            setComparisonError(reason.message);
          })
          .finally(() => {
            if (comparisonAbortRef.current === controller) {
              comparisonAbortRef.current = null;
            }
            setIsComparisonLoading(false);
          });
      }
    }
    hadActiveJobsRef.current = hasActiveJobs;
  }, [comparisonQueryKey, comparisonSelection.xField, comparisonSelection.yField, hasActiveJobs, loadDashboard, showComparisonPanel]);

  useEffect(() => {
    return () => {
      comparisonAbortRef.current?.abort();
    };
  }, []);

  function updateComparisonSelection(nextSelection: ComparisonSelection) {
    const normalized = saveComparisonSelection("dashboard", {
      ...nextSelection,
      renderer: sanitizeComparisonRenderer(nextSelection.xField, nextSelection.yField, nextSelection.renderer),
    });
    setComparisonSelection(normalized);
  }

  return (
    <>
      <section className="panel stack">
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

      <div className="media-grid">
        {visibleDashboardPanels.length > 0 ? (
          visibleDashboardPanels.map((panel) => {
            if (panel.panelKind === "comparison") {
              return (
                <ComparisonChartPanel
                  key={panel.id}
                  title={t(panel.dashboardTitleKey ?? panel.nameKey)}
                  comparison={comparison}
                  selection={comparisonSelection}
                  loading={isComparisonLoading && !comparison && !comparisonError}
                  error={comparisonError}
                  onChangeXField={(xField) =>
                    updateComparisonSelection({ ...comparisonSelection, xField })
                  }
                  onChangeYField={(yField) =>
                    updateComparisonSelection({ ...comparisonSelection, yField })
                  }
                  onSwapAxes={() =>
                    updateComparisonSelection({
                      ...comparisonSelection,
                      xField: comparisonSelection.yField,
                      yField: comparisonSelection.xField,
                    })
                  }
                  onChangeRenderer={(renderer) =>
                    updateComparisonSelection({ ...comparisonSelection, renderer })
                  }
                />
              );
            }
            if (panel.panelKind === "numeric-chart" && panel.numericMetricId) {
              const distribution = getDashboardStatisticNumericDistribution(dashboard, panel);
              return (
                <DistributionChartPanel
                  key={panel.id}
                  title={t(panel.dashboardTitleKey ?? panel.nameKey)}
                  distribution={distribution}
                  metricId={panel.numericMetricId}
                  loading={!dashboard && !error}
                  error={error}
                />
              );
            }

            const items = panel.id === "hdr_type"
              ? collapseHdrDistribution(getDashboardStatisticPanelItems(dashboard, panel))
              : getDashboardStatisticPanelItems(dashboard, panel);
            const dashboardFormatKind = panel.dashboardFormatKind;
            const formattedItems = dashboardFormatKind
              ? items.map((item) => ({
                  ...item,
                  label: formatCodecLabel(item.label, dashboardFormatKind),
                }))
              : items.map((item) => ({
                  ...item,
                  label: formatDashboardDistributionLabel(panel.id, item.label, t),
                }));

            return (
              <AsyncPanel
                key={panel.id}
                title={t(panel.dashboardTitleKey ?? panel.nameKey)}
                loading={!dashboard && !error}
                error={error}
                bodyClassName="async-panel-body-scroll"
              >
                <DistributionList items={formattedItems} maxVisibleRows={5} scrollable />
              </AsyncPanel>
            );
          })
        ) : (
          <div className="notice">{t("libraryStatistics.noDashboardSelected")}</div>
        )}
      </div>
    </>
  );
}
