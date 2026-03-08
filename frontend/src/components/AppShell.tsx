import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { House, Settings } from "lucide-react";

import { api, type LibrarySummary } from "../lib/api";
import { useScanJobs } from "../lib/scan-jobs";

export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const { activeJobs } = useScanJobs();
  const [libraries, setLibraries] = useState<LibrarySummary[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadLibraries() {
      try {
        const items = await api.libraries();
        if (!cancelled) {
          setLibraries(items);
        }
      } catch {
        // Keep the last known library navigation state on transient errors.
      }
    }

    void loadLibraries();
    const timer = window.setInterval(() => {
      void loadLibraries();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [location.pathname]);

  return (
    <div className="layout media-app-shell">
      <div className="bg-shapes" />
      <header className="panel hero-panel">
        <div className="app-header media-header">
          <div>
            <h1>{t("app.title")}</h1>
          </div>
          <nav className="media-nav-panel" aria-label="Primary">
            <div className="media-nav-icons">
              <NavLink
                to="/"
                end
                aria-label="Home"
                className={({ isActive }) => `icon-nav-button ${isActive ? "active" : ""}`.trim()}
              >
                <House aria-hidden="true" className="nav-icon" />
              </NavLink>
              <NavLink
                to="/libraries"
                end
                aria-label="Settings"
                className={({ isActive }) => `icon-nav-button ${isActive ? "active" : ""}`.trim()}
              >
                <Settings aria-hidden="true" className="nav-icon" />
              </NavLink>
            </div>
            <div className="media-nav-libraries">
              {libraries.map((library) => (
                <NavLink
                  key={library.id}
                  to={`/libraries/${library.id}`}
                  className={({ isActive }) => `library-nav-link ${isActive ? "active" : ""}`.trim()}
                >
                  {library.name}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
        {activeJobs.length > 0 ? (
          <div className="scan-banner">
            <div className="scan-banner-copy">
              <strong>Scan running in background</strong>
            </div>
            <div className="scan-banner-list">
              {activeJobs.map((job) => (
                <div className="scan-banner-job" key={job.id}>
                  <div className="distribution-copy">
                    <strong>{job.library_name ?? `Library #${job.library_id}`}</strong>
                    <span>{job.files_total > 0 ? `${job.files_scanned}/${job.files_total}` : job.phase_label}</span>
                  </div>
                  <div className="progress">
                    <span style={{ width: `${job.progress_percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </header>
      <Outlet />
    </div>
  );
}
