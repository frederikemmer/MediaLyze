import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bug, ChevronDown, ChevronRight, House, SearchX, Settings, X } from "lucide-react";
import { motion } from "motion/react";

import { AnimatedSearchIcon } from "./AnimatedSearchIcon";
import { type ScanJob } from "../lib/api";
import { APP_VERSION } from "../lib/app-version";
import { useAppData } from "../lib/app-data";
import {
  getAllReleaseNotes,
  getCurrentReleaseNotes,
  markReleaseNotesSeen,
  normalizeReleaseVersion,
  shouldShowReleaseNotes,
  type ReleaseNotes,
} from "../lib/release-notes";
import { useScanJobs } from "../lib/scan-jobs";

const GITHUB_REPOSITORY_URL = "https://github.com/frederikemmer/MediaLyze/";
const GITHUB_ISSUE_URL = "https://github.com/frederikemmer/MediaLyze/issues/new/choose";

function renderActiveJobDetail(t: (key: string, options?: Record<string, unknown>) => string, job: ScanJob): string {
  if (job.phase_label === "Discovering files") {
    return t("scanBanner.searchingFound", { count: job.discovered_files ?? job.files_total });
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
  const { appSettings, libraries, librariesLoaded, loadDashboard, loadLibraries } = useAppData();
  const currentReleaseVersion = normalizeReleaseVersion(APP_VERSION);
  const [allReleaseNotes] = useState<ReleaseNotes[]>(() => getAllReleaseNotes());
  const [releaseNotes] = useState<ReleaseNotes | null>(() => getCurrentReleaseNotes());
  const [showReleaseNotes, setShowReleaseNotes] = useState(() => shouldShowReleaseNotes(APP_VERSION, releaseNotes));
  const [expandedReleaseVersion, setExpandedReleaseVersion] = useState(currentReleaseVersion);
  const [stoppingScans, setStoppingScans] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const hadActiveJobsRef = useRef(hasActiveJobs);
  const versionLabel = APP_VERSION === "dev" ? "dev" : `v${APP_VERSION}`;
  const showFullWidthAppShell = appSettings.feature_flags.show_full_width_app_shell;

  function dismissReleaseNotes() {
    markReleaseNotesSeen(APP_VERSION);
    setShowReleaseNotes(false);
  }

  function openReleaseNotes() {
    if (allReleaseNotes.length === 0) {
      return;
    }
    setExpandedReleaseVersion(releaseNotes?.version ?? allReleaseNotes[0].version);
    setShowReleaseNotes(true);
  }

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
    <div className={`layout media-app-shell${showFullWidthAppShell ? " media-app-shell-full-width" : ""}`.trim()}>
      <div className="bg-shapes" />
      <header className="panel hero-panel">
        <div className="app-header media-header">
          <div className="app-title-block">
            <h1>{t("app.title")}</h1>
            <button
              type="button"
              className="app-version"
              aria-label={t("releaseNotes.openAria", { version: versionLabel })}
              disabled={allReleaseNotes.length === 0}
              onClick={openReleaseNotes}
            >
              {versionLabel}
            </button>
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
          <div className="scan-banner" title={t("scanBanner.refreshHint")}>
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
                <SearchX aria-hidden="true" className="nav-icon" />
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
      {showReleaseNotes && allReleaseNotes.length > 0 ? (
        <div className="release-notes-backdrop" role="presentation" onMouseDown={dismissReleaseNotes}>
          <section
            className="release-notes-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-notes-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="release-notes-header">
              <div>
                <p className="eyebrow">
                  {releaseNotes
                    ? t("releaseNotes.eyebrow", { version: releaseNotes.version })
                  : t("releaseNotes.allVersions")}
                </p>
                <h2 id="release-notes-title">{t("releaseNotes.title")}</h2>
              </div>
              <div className="release-notes-actions">
                <a
                  className="release-notes-icon-link"
                  href={GITHUB_ISSUE_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("releaseNotes.reportIssueAria")}
                  data-tooltip={t("releaseNotes.reportIssueAria")}
                >
                  <Bug aria-hidden="true" className="nav-icon" />
                </a>
                <a
                  className="release-notes-icon-link"
                  href={GITHUB_REPOSITORY_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("releaseNotes.githubAria")}
                  data-tooltip={t("releaseNotes.githubAria")}
                >
                  <svg viewBox="0 0 1024 1024" fill="none" className="release-notes-github-icon" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"
                      transform="scale(64)"
                      fill="currentColor"
                    />
                  </svg>
                </a>
                <button
                  type="button"
                  className="release-notes-close"
                  aria-label={t("releaseNotes.closeAria")}
                  onClick={dismissReleaseNotes}
                  autoFocus
                >
                  <X aria-hidden="true" className="nav-icon" />
                </button>
              </div>
            </div>
            <div className="release-notes-content">
              {allReleaseNotes.map((versionNotes) => {
                const isExpanded = expandedReleaseVersion === versionNotes.version;
                const ToggleIcon = isExpanded ? ChevronDown : ChevronRight;
                return (
                  <section key={versionNotes.version} className="release-notes-version">
                    <button
                      type="button"
                      className="release-notes-version-toggle"
                      aria-expanded={isExpanded}
                      aria-controls={`release-notes-version-${versionNotes.version}`}
                      onClick={() =>
                        setExpandedReleaseVersion((current) =>
                          current === versionNotes.version ? "" : versionNotes.version,
                        )
                      }
                    >
                      <span className="release-notes-version-title">
                        {t("releaseNotes.versionHeading", { version: versionNotes.version })}
                        {versionNotes.version === currentReleaseVersion ? (
                          <span className="release-notes-current-badge">{t("releaseNotes.current")}</span>
                        ) : null}
                      </span>
                      <span className="release-notes-version-meta">
                        {versionNotes.date ? <span>{versionNotes.date}</span> : null}
                        <ToggleIcon aria-hidden="true" className="nav-icon" />
                      </span>
                    </button>
                    {isExpanded ? (
                      <div id={`release-notes-version-${versionNotes.version}`} className="release-notes-version-body">
                        {versionNotes.sections.map((section, sectionIndex) => (
                          <section key={`${section.title || "changes"}-${sectionIndex}`} className="release-notes-section">
                            {section.title ? <h3>{section.title}</h3> : null}
                            <ul>
                              {section.items.map((item, itemIndex) => (
                                <li key={`${itemIndex}-${item}`}>{item}</li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    ) : null}
                </section>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
      <Outlet />
    </div>
  );
}
