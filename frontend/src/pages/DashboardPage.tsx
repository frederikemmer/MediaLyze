import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AsyncPanel } from "../components/AsyncPanel";
import { DistributionList } from "../components/DistributionList";
import { StatCard } from "../components/StatCard";
import { useAppData } from "../lib/app-data";
import { formatBytes, formatCodecLabel, formatDuration } from "../lib/format";
import { useScanJobs } from "../lib/scan-jobs";

export function DashboardPage() {
  const { t } = useTranslation();
  const { dashboard, dashboardLoaded, loadDashboard } = useAppData();
  const [error, setError] = useState<string | null>(null);
  const { hasActiveJobs } = useScanJobs();
  const hadActiveJobsRef = useRef(hasActiveJobs);

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
        <AsyncPanel title={t("dashboard.videoCodecs")} loading={!dashboard && !error} error={error}>
          <DistributionList
            items={(dashboard?.video_codec_distribution ?? []).map((item) => ({
              ...item,
              label: formatCodecLabel(item.label, "video"),
            }))}
          />
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
        <AsyncPanel
          title={t("dashboard.audioLanguages")}
          loading={!dashboard && !error}
          error={error}
          bodyClassName="async-panel-body-scroll"
        >
          <DistributionList
            items={dashboard?.audio_language_distribution ?? []}
            maxVisibleRows={5}
            scrollable
          />
        </AsyncPanel>
      </div>
    </>
  );
}
