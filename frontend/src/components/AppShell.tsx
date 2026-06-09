import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bug, ChevronDown, ChevronRight, Download, GitCompare, House, Settings, X } from "lucide-react";
import { FilePlusCorner, FileXCorner, File, FileDiff, FileExclamationPoint, FileSearchCorner, FileCheckCorner } from "lucide-react";
import { AnimatePresence, motion, useAnimation, type Transition } from "motion/react";

import { AnimatedSearchIcon } from "./AnimatedSearchIcon";
import { BanIcon } from "./BanIcon";
import { FolderInputIcon } from "./FolderInputIcon";
import { FolderOutputIcon } from "./FolderOutputIcon";
import { GithubIcon } from "./GithubIcon";
import { HandCoinsIcon } from "./HandCoinsIcon";
import { TelemetryModeToggle } from "./TelemetryModeToggle";
import { api, type ScanJob, type TelemetryMode, type UpdateStatus } from "../lib/api";
import { APP_VERSION } from "../lib/app-version";
import { useAppData } from "../lib/app-data";
import {
  getAllReleaseNotes,
  getCurrentReleaseNotes,
  isDevelopmentVersion,
  isFirstOpenAfterUpdate,
  markReleaseNotesSeen,
  mergeReleaseNotes,
  normalizeReleaseVersion,
  shouldShowReleaseNotes,
  type ReleaseNotes,
} from "../lib/release-notes";
import { getDesktopBridge, isDesktopApp } from "../lib/desktop";
import { useScanJobs } from "../lib/scan-jobs";

const GITHUB_REPOSITORY_URL = "https://github.com/frederikemmer/MediaLyze/";
const GITHUB_ISSUE_URL = "https://github.com/frederikemmer/MediaLyze/issues/new/choose";
const GITHUB_SPONSORS_URL = "https://github.com/sponsors/frederikemmer";
const UI_ELEMENTS_CLICK_WINDOW_MS = 1500;
const UI_ELEMENTS_CLICK_COUNT = 3;
const RELEASE_NOTE_LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

const CIRCLE_CHEVRON_TRANSITION: Transition = {
  times: [0, 0.4, 1],
  duration: 0.5,
};

function renderReleaseNoteItem(item: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of item.matchAll(RELEASE_NOTE_LINK_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const [fullMatch, label, href] = match;
    if (matchIndex > lastIndex) {
      parts.push(item.slice(lastIndex, matchIndex));
    }
    parts.push(
      <a key={`${href}-${matchIndex}`} href={href} target="_blank" rel="noreferrer">
        {label}
      </a>,
    );
    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < item.length) {
    parts.push(item.slice(lastIndex));
  }

  return parts.length > 0 ? parts.map((part, index) => <Fragment key={index}>{part}</Fragment>) : item;
}

function ReleaseNotesMenuIcon({ open, size = 24 }: { open: boolean; size?: number }) {
  const controls = useAnimation();

  return (
    <span
      className="release-notes-menu-icon"
      aria-hidden="true"
      onMouseEnter={() => void controls.start("animate")}
      onMouseLeave={() => void controls.start("normal")}
    >
      <svg
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="12" cy="12" r="10" />
        <motion.path
          animate={controls}
          d={open ? "m10 8 4 4-4 4" : "m14 16-4-4 4-4"}
          transition={CIRCLE_CHEVRON_TRANSITION}
          variants={{
            normal: { x: 0 },
            animate: { x: open ? [0, 2, 0] : [0, -2, 0] },
          }}
        />
      </svg>
    </span>
  );
}

function isDeterminateScanProgress(job: ScanJob): boolean {
  if (job.progress_mode) {
    return job.progress_mode === "determinate";
  }
  return job.files_total > 0 && job.phase_label !== "Discovering files";
}

type ScanMetric = {
  key: string;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: number;
};

function ScanJobCard({
  job,
  onStop,
  stopping,
}: {
  job: ScanJob;
  onStop: () => void;
  stopping: boolean;
}) {
  const { t } = useTranslation();
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(max-width: 500px)").matches;
  });
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
    return !window.matchMedia("(max-width: 500px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 500px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const metrics: ScanMetric[] = [
    { key: "new", icon: FilePlusCorner, label: t("scanBanner.metrics.newFiles"), value: job.new_files_live ?? 0 },
    { key: "deleted", icon: FileXCorner, label: t("scanBanner.metrics.deletedFiles"), value: job.deleted_files_live ?? 0 },
    { key: "unchanged", icon: File, label: t("scanBanner.metrics.unchangedFiles"), value: job.unchanged_files ?? 0 },
    { key: "modified", icon: FileDiff, label: t("scanBanner.metrics.modifiedFiles"), value: job.modified_files_live ?? 0 },
    { key: "errors", icon: FileExclamationPoint, label: t("scanBanner.metrics.errors"), value: job.errors },
    { key: "queued", icon: FileSearchCorner, label: t("scanBanner.metrics.queued"), value: job.files_total },
    { key: "analyzed", icon: FileCheckCorner, label: t("scanBanner.metrics.analyzed"), value: job.files_scanned },
  ].filter((m) => m.value > 0);

  const isDeterminate = isDeterminateScanProgress(job);
  const libraryLabel = job.library_name ?? t("scanBanner.libraryFallback", { id: job.library_id });

  return (
    <div
      className={`scan-job-card${isDeterminate ? " is-determinate" : " is-indeterminate"}`}
      style={isDeterminate ? { "--scan-progress": `${job.progress_percent}%` } as React.CSSProperties : undefined}
    >
      <div className="scan-job-card-main">
        <AnimatedSearchIcon animateOnMount className="scan-job-card-search-icon" />
        <span className="scan-job-card-name" title={libraryLabel}>
          {libraryLabel}
        </span>
        <AnimatePresence>
          {expanded && metrics.length > 0 && (
            <motion.div
              className="scan-job-metrics"
              initial={isMobile ? { opacity: 0, y: 8 } : { opacity: 0, x: 16 }}
              animate={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, x: 0 }}
              exit={isMobile ? { opacity: 0, y: 8 } : { opacity: 0, x: 16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {metrics.map((metric, i) => (
                <span key={metric.key} className="scan-job-metric-item">
                  {i > 0 && <span className="scan-job-metric-sep" aria-hidden="true" />}
                  <span title={metric.label} className="scan-job-metric-icon-wrap">
                    <metric.icon size={14} aria-label={metric.label} />
                    <span className="scan-job-metric-value">{metric.value.toLocaleString()}</span>
                  </span>
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="scan-job-card-actions">
          <button
            type="button"
            className="secondary icon-only-button scan-job-toggle-button"
            aria-label={t("scanBanner.metrics.toggleMetrics")}
            title={t("scanBanner.metrics.toggleMetrics")}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? <FolderInputIcon size={16} aria-hidden="true" />
              : <FolderOutputIcon size={16} aria-hidden="true" />
            }
          </button>
          <span className="scan-job-action-sep" aria-hidden="true" />
          <button
            type="button"
            className="secondary icon-only-button scan-banner-stop"
            aria-label={t("scanBanner.metrics.stopJob")}
            title={t("scanBanner.metrics.stopJob")}
            disabled={stopping}
            onClick={onStop}
          >
            <BanIcon size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}


export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeJobs, hasActiveJobs, stopLibrary } = useScanJobs();
  const { appSettings, appSettingsLoaded, libraries, librariesLoaded, loadDashboard, loadLibraries, setAppSettings } = useAppData();
  const [localReleaseNotes] = useState<ReleaseNotes[]>(() => getAllReleaseNotes());
  const [releaseNotes] = useState<ReleaseNotes | null>(() => getCurrentReleaseNotes());
  const currentReleaseVersion = releaseNotes?.version ?? normalizeReleaseVersion(APP_VERSION);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [showReleaseNotes, setShowReleaseNotes] = useState(() => shouldShowReleaseNotes(APP_VERSION, releaseNotes));
  const [showUpdateTelemetryAttention, setShowUpdateTelemetryAttention] = useState(
    () => shouldShowReleaseNotes(APP_VERSION, releaseNotes) && isFirstOpenAfterUpdate(APP_VERSION, releaseNotes),
  );
  const [expandedReleaseVersion, setExpandedReleaseVersion] = useState(currentReleaseVersion);
  const [stoppingScans, setStoppingScans] = useState(false);
  const [scanCancelError, setScanCancelError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingTelemetryMode, setPendingTelemetryMode] = useState<TelemetryMode | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [releaseActionsMenuOpen, setReleaseActionsMenuOpen] = useState(false);
  const hadActiveJobsRef = useRef(hasActiveJobs);
  const settingsIconClickRef = useRef({ count: 0, lastClickedAt: 0 });
  const versionLabel = APP_VERSION === "dev" ? "dev" : `v${APP_VERSION}`;
  const latestAvailableVersion = updateStatus?.latest_version ?? null;
  const updateAvailable = APP_VERSION !== "dev" && Boolean(updateStatus?.update_available && latestAvailableVersion);
  const allReleaseNotes = useMemo(() => {
    const mergedReleaseNotes = mergeReleaseNotes(localReleaseNotes, updateStatus?.release_notes ?? []);
    return updateAvailable &&
      latestAvailableVersion &&
      !mergedReleaseNotes.some((notes) => notes.version === latestAvailableVersion)
      ? mergeReleaseNotes(mergedReleaseNotes, [{ version: latestAvailableVersion, date: null, sections: [] }])
      : mergedReleaseNotes;
  }, [latestAvailableVersion, localReleaseNotes, updateAvailable, updateStatus?.release_notes]);
  const showFullWidthAppShell = appSettings.feature_flags.show_full_width_app_shell;
  const telemetry = appSettings.telemetry ?? {
    mode: "none" as TelemetryMode,
    environment_disabled: false,
    last_user_visible_payload: null,
  };
  const telemetryUndecided = telemetry.mode === "none" || telemetry.mode === "initialized";
  const showTelemetryAttention =
    showReleaseNotes &&
    (showUpdateTelemetryAttention || (appSettingsLoaded && telemetryUndecided && !telemetry.environment_disabled));
  const showFirstLibraryAttention = librariesLoaded && libraries.length === 0;

  function dismissReleaseNotes() {
    if (appSettingsLoaded && telemetryUndecided && !telemetry.environment_disabled) {
      setTelemetryError(t("telemetry.releaseNotesChooseFirst"));
      return;
    }
    markReleaseNotesSeen(APP_VERSION, releaseNotes);
    setShowReleaseNotes(false);
    setReleaseActionsMenuOpen(false);
    setShowUpdateTelemetryAttention(false);
  }

  async function saveTelemetryMode(mode: "off" | "minimal" | "enabled") {
    setPendingTelemetryMode(mode);
    setTelemetryError(null);
    try {
      const updated = await api.updateAppSettings({ telemetry: { mode } });
      setAppSettings(updated);
    } catch {
      setTelemetryError(t("telemetry.saveFailed"));
    } finally {
      setPendingTelemetryMode(null);
    }
  }

  async function downloadLatestInstaller() {
    if (!latestAvailableVersion) {
      return;
    }
    const bridge = getDesktopBridge();
    if (!bridge?.downloadLatestInstaller) {
      return;
    }
    setDownloadState("loading");
    try {
      const result = await bridge.downloadLatestInstaller(latestAvailableVersion);
      setDownloadState(result.ok ? "success" : "error");
    } catch {
      setDownloadState("error");
    }
  }

  function openReleaseNotes() {
    if (allReleaseNotes.length === 0) {
      return;
    }
    setExpandedReleaseVersion(updateAvailable && latestAvailableVersion ? latestAvailableVersion : releaseNotes?.version ?? allReleaseNotes[0].version);
    setShowUpdateTelemetryAttention(false);
    setReleaseActionsMenuOpen(false);
    setShowReleaseNotes(true);
  }

  function handleSettingsIconClick(event: MouseEvent<HTMLElement>) {
    if (!isDevelopmentVersion(APP_VERSION)) {
      return;
    }

    const now = Date.now();
    const clickState = settingsIconClickRef.current;
    clickState.count = now - clickState.lastClickedAt <= UI_ELEMENTS_CLICK_WINDOW_MS ? clickState.count + 1 : 1;
    clickState.lastClickedAt = now;

    if (clickState.count < UI_ELEMENTS_CLICK_COUNT) {
      return;
    }

    clickState.count = 0;
    clickState.lastClickedAt = 0;
    event.preventDefault();
    event.stopPropagation();
    navigate("/ui-elements");
  }

  useEffect(() => {
    if (librariesLoaded) {
      return;
    }
    void loadLibraries().catch(() => undefined);
  }, [librariesLoaded, loadLibraries]);

  useEffect(() => {
    void api.updateStatus().then(setUpdateStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!appSettingsLoaded || allReleaseNotes.length === 0) {
      return;
    }
    if (telemetryUndecided && !telemetry.environment_disabled) {
      setExpandedReleaseVersion(releaseNotes?.version ?? allReleaseNotes[0].version);
      setShowReleaseNotes(true);
    }
  }, [allReleaseNotes, appSettingsLoaded, releaseNotes?.version, telemetry.environment_disabled, telemetryUndecided]);

  useEffect(() => {
    if (hadActiveJobsRef.current && !hasActiveJobs) {
      setScanCancelError(null);
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
            {updateAvailable && latestAvailableVersion ? (
              <span className="app-version-update">{t("releaseNotes.updateAvailable", { version: latestAvailableVersion })}</span>
            ) : null}
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
                    {isActive ? (
                      <motion.span
                        layoutId="primary-nav-pill"
                        className="nav-active-pill"
                        transition={{ type: "spring", stiffness: 500, damping: 38, mass: 0.7 }}
                      />
                    ) : null}
                    <span className="nav-link-content">
                      <House aria-hidden="true" className="nav-icon" />
                    </span>
                  </>
                )}
              </NavLink>
              <NavLink
                to="/files/compare"
                end
                aria-label={t("nav.compareAria")}
                className={({ isActive }) => `icon-nav-button ${isActive ? "active" : ""}`.trim()}
              >
                {({ isActive }) => (
                  <>
                    {isActive ? (
                      <motion.span
                        layoutId="primary-nav-pill"
                        className="nav-active-pill"
                        transition={{ type: "spring", stiffness: 500, damping: 38, mass: 0.7 }}
                      />
                    ) : null}
                    <span className="nav-link-content">
                      <GitCompare aria-hidden="true" className="nav-icon" />
                    </span>
                  </>
                )}
              </NavLink>
              <NavLink
                to="/settings"
                end
                aria-label={t("nav.settingsAria")}
                className={({ isActive }) =>
                  `icon-nav-button ${isActive ? "active" : ""}${showFirstLibraryAttention ? " is-first-library-attention" : ""}`.trim()
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive ? (
                      <motion.span
                        layoutId="primary-nav-pill"
                        className="nav-active-pill"
                        transition={{ type: "spring", stiffness: 500, damping: 38, mass: 0.7 }}
                      />
                    ) : null}
                    <span className="nav-link-content" onClick={handleSettingsIconClick}>
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
                      {isActive ? (
                        <motion.span
                          layoutId="library-nav-pill"
                          className="nav-active-pill"
                          transition={{ type: "spring", stiffness: 500, damping: 38, mass: 0.7 }}
                        />
                      ) : null}
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
            {scanCancelError ? (
              <div className="scan-banner-error" role="alert">
                {scanCancelError}
              </div>
            ) : null}
            <div className="scan-banner-list">
              {activeJobs.map((job) => (
                <ScanJobCard
                  key={job.id}
                  job={job}
                  stopping={stoppingScans}
                  onStop={async () => {
                    setStoppingScans(true);
                    setScanCancelError(null);
                    try {
                      await stopLibrary(job.library_id);
                    } catch {
                      setScanCancelError(t("scanBanner.cancelFailed"));
                    } finally {
                      setStoppingScans(false);
                    }
                  }}
                />
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
            <div className={`release-notes-header${releaseActionsMenuOpen ? " release-notes-header-menu-open" : ""}`}>
              <div className="release-notes-title-block">
                <h2 id="release-notes-title">{t("releaseNotes.title")}</h2>
              </div>
              <div className="release-notes-actions">
                <button
                  type="button"
                  className="release-notes-menu-toggle"
                  aria-label={releaseActionsMenuOpen ? t("releaseNotes.closeMenuAria") : t("releaseNotes.openMenuAria")}
                  aria-expanded={releaseActionsMenuOpen}
                  aria-controls="release-notes-secondary-actions"
                  onClick={() => setReleaseActionsMenuOpen((open) => !open)}
                >
                  <ReleaseNotesMenuIcon open={releaseActionsMenuOpen} />
                </button>
                <div id="release-notes-secondary-actions" className="release-notes-secondary-actions">
                  {isDesktopApp() && updateAvailable && latestAvailableVersion ? (
                    <button
                      type="button"
                      className={`release-notes-download release-notes-download-${downloadState}`}
                      disabled={downloadState === "loading"}
                      onClick={() => void downloadLatestInstaller()}
                    >
                      <Download aria-hidden="true" className="nav-icon" />
                      <span>
                        {downloadState === "loading"
                          ? t("releaseNotes.downloadLoading")
                          : downloadState === "success"
                            ? t("releaseNotes.downloadSuccess")
                            : downloadState === "error"
                              ? t("releaseNotes.downloadRetry", { version: latestAvailableVersion })
                              : t("releaseNotes.download", { version: latestAvailableVersion })}
                      </span>
                    </button>
                  ) : null}
                  <TelemetryModeToggle
                    compact
                    highlightEnabledOption={showTelemetryAttention}
                    mode={telemetry.mode}
                    pendingMode={pendingTelemetryMode}
                    disabled={!appSettingsLoaded || Boolean(pendingTelemetryMode) || telemetry.environment_disabled}
                    undecided={telemetryUndecided}
                    onChange={(mode) => void saveTelemetryMode(mode)}
                  />
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
                    href={GITHUB_SPONSORS_URL}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("releaseNotes.donateAria")}
                    data-tooltip={t("releaseNotes.donateAria")}
                  >
                    <HandCoinsIcon aria-hidden="true" className="release-notes-hand-coins-icon" size={18} />
                  </a>
                  <a
                    className="release-notes-icon-link"
                    href={GITHUB_REPOSITORY_URL}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("releaseNotes.githubAria")}
                    data-tooltip={t("releaseNotes.githubAria")}
                  >
                    <GithubIcon className="release-notes-github-icon" size={18} aria-hidden="true" />
                  </a>
                </div>
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
            {telemetryError ? <div className="alert release-notes-alert">{telemetryError}</div> : null}
            <div className="release-notes-content">
              {allReleaseNotes.map((versionNotes) => {
                const isExpanded = expandedReleaseVersion === versionNotes.version;
                const isLatestAvailable = updateAvailable && versionNotes.version === latestAvailableVersion;
                const isCurrentInstalled = versionNotes.version === currentReleaseVersion;
                const ToggleIcon = isExpanded ? ChevronDown : ChevronRight;
                return (
                  <section
                    key={versionNotes.version}
                    className={`release-notes-version${isLatestAvailable ? " release-notes-version-latest" : ""}${isCurrentInstalled ? " release-notes-version-current" : ""}`}
                  >
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
                        {isLatestAvailable ? (
                          <span className="release-notes-latest-badge">{t("releaseNotes.latestAvailable")}</span>
                        ) : null}
                        {isCurrentInstalled ? (
                          <span className="release-notes-current-badge">{t("releaseNotes.currentInstalled")}</span>
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
                                <li key={`${itemIndex}-${item}`}>{renderReleaseNoteItem(item)}</li>
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
