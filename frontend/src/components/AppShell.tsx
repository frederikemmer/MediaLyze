import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { House, RefreshCwOff, Settings } from "lucide-react";
import { motion } from "motion/react";

import { AnimatedSearchIcon } from "./AnimatedSearchIcon";
import { type ScanJob } from "../lib/api";
import { APP_VERSION } from "../lib/app-version";
import { useAppData } from "../lib/app-data";
import { useScanJobs } from "../lib/scan-jobs";

function renderActiveJobDetail(t: (key: string, options?: Record<string, unknown>) => string, job: ScanJob): string {
  if (job.phase_label === "Discovering files") {
    return t("scanBanner.searchingFound", { count: job.files_total });
  }
  if (job.phase_label === "Analyzing media" && job.files_total > 0) {
    return t("scanBanner.analyzingProgress", {
      scanned: job.files_scanned,
      total: job.files_total,
      percent: Math.round((job.files_scanned / job.files_total) * 100),
    });
  }
  return job.phase_detail ?? job.phase_label;
}

export function AppShell() {
  const { t } = useTranslation();
  const { activeJobs, hasActiveJobs, stopAll } = useScanJobs();
  const { libraries, librariesLoaded, loadDashboard, loadLibraries } = useAppData();
  const [stoppingScans, setStoppingScans] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const hadActiveJobsRef = useRef(hasActiveJobs);
  const versionLabel = APP_VERSION === "dev" ? "dev" : `v${APP_VERSION}`;

  useEffect(() => {
    if (librariesLoaded) {
      return;
    }
    void loadLibraries().catch(() => undefined);
  }, [librariesLoaded, loadLibraries]);

  useEffect(() => {
    if (hadActiveJobsRef.current && !hasActiveJobs) {
      void Promise.all([loadLibraries(true), loadDashboard(true)])
        .then(() => setSyncError(null))
        .catch((reason: Error) => {
          setSyncError(reason.message);
        });
    }
    hadActiveJobsRef.current = hasActiveJobs;
  }, [hasActiveJobs, loadDashboard, loadLibraries]);

  return (
    <div className="layout media-app-shell">
      <div className="bg-shapes" />
      <header className="panel hero-panel">
        <div className="app-header media-header">
          <div className="app-title-block">
            <h1>{t("app.title")}</h1>
            <span className="app-version" aria-label={`Version ${APP_VERSION}`}>
              {versionLabel}
            </span>
          </div>
          <nav className="media-nav-panel" aria-label="Primary">
            <div className="media-nav-icons">
              <NavLink
                to="/"
                end
                aria-label={t("nav.homeAria")}
                className={({ isActive }) => `icon-nav-button ${isActive ? "active" : ""}`.trim()}
              >
                {({ isActive }) => (
                  <>
                    {isActive ? <motion.span layoutId="primary-nav-pill" className="nav-active-pill" /> : null}
                    <span className="nav-link-content">
                      <House aria-hidden="true" className="nav-icon" />
                    </span>
                  </>
                )}
              </NavLink>
              <NavLink
                to="/settings"
                end
                aria-label={t("nav.settingsAria")}
                className={({ isActive }) => `icon-nav-button ${isActive ? "active" : ""}`.trim()}
              >
                {({ isActive }) => (
                  <>
                    {isActive ? <motion.span layoutId="primary-nav-pill" className="nav-active-pill" /> : null}
                    <span className="nav-link-content">
                      <Settings aria-hidden="true" className="nav-icon" />
                    </span>
                  </>
                )}
              </NavLink>
            </div>
            <div className="media-nav-libraries">
              {libraries.map((library) => (
                <NavLink
                  key={library.id}
                  to={`/libraries/${library.id}`}
                  className={({ isActive }) => `library-nav-link ${isActive ? "active" : ""}`.trim()}
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? <motion.span layoutId="library-nav-pill" className="nav-active-pill" /> : null}
                      <span className="nav-link-content">{library.name}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
        {activeJobs.length > 0 ? (
          <div className="scan-banner">
            <div className="scan-banner-header">
              <div className="scan-banner-copy">
                <strong className="scan-banner-status">
                  <AnimatedSearchIcon className="scan-banner-icon" />
                  <span>{t("scanBanner.running")}</span>
                </strong>
              </div>
              <button
                type="button"
                className="scan-banner-stop"
                aria-label={t("scanBanner.stopAria")}
                disabled={stoppingScans}
                onClick={async () => {
                  setStoppingScans(true);
                  await stopAll();
                  setStoppingScans(false);
                }}
              >
                <RefreshCwOff aria-hidden="true" className="nav-icon" />
              </button>
            </div>
            <div className="scan-banner-list">
              {activeJobs.map((job) => (
                <div className="scan-banner-job" key={job.id}>
                  <div className="distribution-copy">
                    <strong>{job.library_name ?? t("scanBanner.libraryFallback", { id: job.library_id })}</strong>
                    <span>{renderActiveJobDetail(t, job)}</span>
                  </div>
                  <div className="progress">
                    <span style={{ width: `${job.progress_percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {syncError ? <div className="alert">{syncError}</div> : null}
      </header>
      <Outlet />
    </div>
  );
}
