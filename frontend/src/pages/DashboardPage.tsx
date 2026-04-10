import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AsyncPanel } from "../components/AsyncPanel";
import { DistributionList } from "../components/DistributionList";
import { StatCard } from "../components/StatCard";
import { useAppData } from "../lib/app-data";
import { formatBytes, formatCodecLabel, formatContainerLabel, formatDuration, formatSpatialAudioProfileLabel } from "../lib/format";
import { collapseHdrDistribution } from "../lib/hdr";
import {
  getDashboardStatisticPanelItems,
  getLibraryStatisticsSettings,
  getVisibleDashboardStatisticPanels,
} from "../lib/library-statistics-settings";
import { useScanJobs } from "../lib/scan-jobs";

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
  const { hasActiveJobs } = useScanJobs();
  const hadActiveJobsRef = useRef(hasActiveJobs);
  const statisticsSettings = useState(() => getLibraryStatisticsSettings())[0];
  const visibleDashboardPanels = getVisibleDashboardStatisticPanels(statisticsSettings);

  useEffect(() => {
    if (dashboardLoaded) {
      return;
    }
    loadDashboard().catch((reason: Error) => setError(reason.message));
  }, [dashboardLoaded, loadDashboard]);

  useEffect(() => {
    if (hadActiveJobsRef.current && !hasActiveJobs) {
      loadDashboard(true)
        .then(() => setError(null))
        .catch((reason: Error) => setError(reason.message));
    }
    hadActiveJobsRef.current = hasActiveJobs;
  }, [hasActiveJobs, loadDashboard]);

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
