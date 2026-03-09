import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { AsyncPanel } from "../components/AsyncPanel";
import { DistributionList } from "../components/DistributionList";
import { StatCard } from "../components/StatCard";
import { api, type DashboardResponse } from "../lib/api";
import { formatBytes, formatDuration } from "../lib/format";
import { useScanJobs } from "../lib/scan-jobs";

export function DashboardPage() {
  const { t } = useTranslation();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { hasActiveJobs } = useScanJobs();

  useEffect(() => {
    let cancelled = false;

    const loadDashboard = () => {
      api
        .dashboard()
        .then((payload) => {
          if (!cancelled) {
            setDashboard(payload);
            setError(null);
          }
        })
        .catch((reason: Error) => {
          if (!cancelled) {
            setError(reason.message);
          }
        });
    };

    loadDashboard();
    if (!hasActiveJobs) {
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setInterval(loadDashboard, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasActiveJobs]);

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
        <AsyncPanel title={t("dashboard.videoCodecs")} loading={!dashboard && !error} error={error}>
          <DistributionList items={dashboard?.video_codec_distribution ?? []} />
        </AsyncPanel>
        <AsyncPanel
          title={t("dashboard.resolutions")}
          loading={!dashboard && !error}
          error={error}
          bodyClassName="async-panel-body-scroll"
        >
          <DistributionList
            items={dashboard?.resolution_distribution ?? []}
            maxVisibleRows={5}
            scrollable
          />
        </AsyncPanel>
        <AsyncPanel title={t("dashboard.hdrCoverage")} loading={!dashboard && !error} error={error}>
          <DistributionList items={dashboard?.hdr_distribution ?? []} />
        </AsyncPanel>
        <AsyncPanel title={t("dashboard.subtitleSources")} loading={!dashboard && !error} error={error}>
          <DistributionList items={dashboard?.subtitle_distribution ?? []} />
        </AsyncPanel>
      </div>
    </>
  );
}
