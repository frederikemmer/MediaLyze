import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Activity, Bug, ChevronDown, ChevronRight, Download, Files, GitCompare, History, House, LibraryBig, Map, RefreshCw, Settings, UserRoundCheck, X } from "lucide-react";
import { FilePlusCorner, FileXCorner, File, FileDiff, FileExclamationPoint, FileSearchCorner, FileCheckCorner } from "lucide-react";
import { AnimatePresence, motion, useAnimation, type Transition } from "motion/react";

import { AnimatedSearchIcon } from "./AnimatedSearchIcon";
import { BanIcon } from "./BanIcon";
import { ConnectorProviderIcon } from "./ConnectorProviderIcon";
import { FolderInputIcon } from "./FolderInputIcon";
import { FolderOutputIcon } from "./FolderOutputIcon";
import { GithubIcon } from "./GithubIcon";
import { HandCoinsIcon } from "./HandCoinsIcon";
import { TelemetryModeToggle } from "./TelemetryModeToggle";
import { api, type ConnectorConnection, type ConnectorSyncJob, type ScanJob, type TelemetryMode, type UpdateStatus } from "../lib/api";
import { APP_VERSION } from "../lib/app-version";
import { useAppData } from "../lib/app-data";
import {
  getAllReleaseNotes,
  getCurrentReleaseNotes,
  isDevelopmentVersion,
  isFirstOpenAfterUpdate,
  isUpdateReminderDue,
  markBrowserUpdateReminder,
  markReleaseNotesSeen,
  mergeReleaseNotes,
  normalizeReleaseVersion,
  readBrowserUpdateReminder,
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
const GITHUB_RELEASES_URL = `${GITHUB_REPOSITORY_URL}releases`;

type InstallerDownloadState =
  | "idle"
  | "loading"
  | "success"
  | "canceled"
  | "asset_unavailable"
  | "unsupported_platform"
  | "integrity_error"
  | "network_error"
  | "save_error";

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

type ActiveConnectorJob = {
  connection: ConnectorConnection;
  job: ConnectorSyncJob;
};

type ConnectorProgressMetric = {
  current: number;
  total: number | null;
  detail: string | null;
};

function connectorProgressMetrics(job: ConnectorSyncJob): Record<string, ConnectorProgressMetric> {
  const rawMetrics = job.sync_summary?.progress_metrics;
  if (!rawMetrics || typeof rawMetrics !== "object" || Array.isArray(rawMetrics)) return {};
  return Object.fromEntries(
    Object.entries(rawMetrics).flatMap(([key, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const metric = value as Record<string, unknown>;
      if (typeof metric.current !== "number") return [];
      return [[key, {
        current: metric.current,
        total: typeof metric.total === "number" ? metric.total : null,
        detail: typeof metric.detail === "string" ? metric.detail : null,
      }]];
    }),
  );
}

function ConnectorSyncJobCard({
  activeJob,
  onStop,
  stopping,
}: {
  activeJob: ActiveConnectorJob;
  onStop: () => void;
  stopping: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
    return !window.matchMedia("(max-width: 500px)").matches;
  });

  const { connection, job } = activeJob;
  const progressTotal = job.progress_total ?? 0;
  const isDeterminate = job.status === "running" && progressTotal > 0;
  const progressPercent = isDeterminate
    ? Math.min(100, Math.max(0, (job.progress_current / progressTotal) * 100))
    : 0;
  const phaseKey = job.status === "queued" ? "queued" : job.progress_phase ?? "starting";
  const phaseTranslationGroup = phaseKey.startsWith("mirroring_") ? "syncMirrorStep" : "syncStep";
  const phaseLabel = t(`connectors.${phaseTranslationGroup}.${phaseKey}`, {
    defaultValue: phaseKey.replaceAll("_", " "),
  });
  const savedMetrics = connectorProgressMetrics(job);
  const activeMetric = { current: job.progress_current, total: job.progress_total, detail: job.progress_detail };
  const metricDefinitions = [
    { key: "items", icon: Files, tooltip: "assetsProgress" },
    { key: "user_states", icon: UserRoundCheck, tooltip: "usersProgress" },
    { key: "playback_events", icon: History, tooltip: "playbackProgress" },
    { key: "libraries", icon: LibraryBig, tooltip: "librariesProgress" },
  ] as const;
  const metrics = metricDefinitions.flatMap((definition) => {
    const metric = savedMetrics[definition.key] ?? (phaseKey === definition.key ? activeMetric : null);
    if (!metric || (metric.current <= 0 && (metric.total ?? 0) <= 0)) return [];
    const value = metric.total === null
      ? metric.current.toLocaleString()
      : `${metric.current.toLocaleString()} / ${metric.total.toLocaleString()}`;
    return [{ ...definition, metric, value }];
  });

  return (
    <div
      className={`scan-job-card connector-sync-job-card${isDeterminate ? " is-determinate" : " is-indeterminate"}`}
      style={isDeterminate ? { "--scan-progress": `${progressPercent}%` } as React.CSSProperties : undefined}
    >
      <div className="scan-job-card-main">
        <span className="scan-job-card-search-icon connector-sync-provider-icon" aria-hidden="true">
          <ConnectorProviderIcon provider={connection.provider} />
        </span>
        <span className="scan-job-card-name" title={connection.name}>{connection.name}</span>
        {expanded ? (
            <div className="scan-job-metrics">
              <span className="scan-job-metric-item">
                <span
                  className="scan-job-metric-icon-wrap"
                  title={t("connectors.syncBanner.currentPhase", { phase: phaseLabel })}
                >
                  <Activity size={14} aria-hidden="true" />
                  <span className="scan-job-metric-value">{phaseLabel}</span>
                </span>
              </span>
              {metrics.map(({ key, icon: MetricIcon, tooltip, metric, value }) => (
                <span key={key} className="scan-job-metric-item">
                  <span className="scan-job-metric-sep" aria-hidden="true" />
                  <span
                    className="scan-job-metric-icon-wrap"
                    title={t(`connectors.syncBanner.${tooltip}`, {
                      current: metric.current.toLocaleString(),
                      total: metric.total?.toLocaleString() ?? "–",
                      detail: metric.detail ?? "",
                    })}
                  >
                    <MetricIcon size={14} aria-hidden="true" />
                    <span className="scan-job-metric-value">{value}</span>
                  </span>
                </span>
              ))}
            </div>
        ) : null}
        <div className="scan-job-card-actions">
          <button
            type="button"
            className="secondary icon-only-button scan-job-toggle-button"
            aria-label={t("connectors.syncBanner.toggleMetrics")}
            title={t("connectors.syncBanner.toggleMetrics")}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <FolderInputIcon size={16} aria-hidden="true" /> : <FolderOutputIcon size={16} aria-hidden="true" />}
          </button>
          <span className="scan-job-action-sep" aria-hidden="true" />
          <button
            type="button"
            className="secondary icon-only-button scan-banner-stop"
            aria-label={t("connectors.syncBanner.stopJob")}
            title={t("connectors.syncBanner.stopJob")}
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
  const initialCurrentReleaseNotesOpenRef = useRef(shouldShowReleaseNotes(APP_VERSION, releaseNotes));
  const currentReleaseVersion = releaseNotes?.version ?? normalizeReleaseVersion(APP_VERSION);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [showReleaseNotes, setShowReleaseNotes] = useState(initialCurrentReleaseNotesOpenRef.current);
  const [showUpdateTelemetryAttention, setShowUpdateTelemetryAttention] = useState(
    () => initialCurrentReleaseNotesOpenRef.current && isFirstOpenAfterUpdate(APP_VERSION, releaseNotes),
  );
  const [expandedReleaseVersion, setExpandedReleaseVersion] = useState(currentReleaseVersion);
  const [stoppingScans, setStoppingScans] = useState(false);
  const [scanCancelError, setScanCancelError] = useState<string | null>(null);
  const [activeConnectorJobs, setActiveConnectorJobs] = useState<ActiveConnectorJob[]>([]);
  const [stoppingConnectorJobs, setStoppingConnectorJobs] = useState<Set<number>>(() => new Set());
  const [connectorCancelError, setConnectorCancelError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingTelemetryMode, setPendingTelemetryMode] = useState<TelemetryMode | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<InstallerDownloadState>("idle");
  const [releaseActionsMenuOpen, setReleaseActionsMenuOpen] = useState(false);
  const hadActiveJobsRef = useRef(hasActiveJobs);
  const automaticUpdateReminderHandledRef = useRef(false);
  const automaticUpdateReminderOpenRef = useRef(false);
  const settingsIconClickRef = useRef({ count: 0, lastClickedAt: 0 });
  const versionLabel = APP_VERSION === "dev" ? "dev" : `v${APP_VERSION}`;
  const latestAvailableVersion = updateStatus?.latest_version ?? null;
  const updateAvailable = APP_VERSION !== "dev" && Boolean(updateStatus?.update_available && latestAvailableVersion);
  const desktopBridge = getDesktopBridge();
  const desktopRuntime = desktopBridge?.getRuntimeInfo?.() ?? null;
  const matchingDesktopAsset = desktopRuntime
    ? updateStatus?.desktop_assets?.find(
        (asset) => asset.platform === desktopRuntime.platform && asset.arch === desktopRuntime.arch,
      ) ?? null
    : null;
  const knownDesktopTarget = desktopRuntime
    ? (desktopRuntime.platform === "darwin" && desktopRuntime.arch === "arm64")
      || (desktopRuntime.platform === "win32" && desktopRuntime.arch === "x64")
      || (desktopRuntime.platform === "linux" && desktopRuntime.arch === "x64")
    : false;
  const latestReleaseUrl = updateStatus?.latest_release_url ?? GITHUB_RELEASES_URL;
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
    automaticUpdateReminderOpenRef.current = false;
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
    if (!desktopBridge?.downloadLatestInstaller || !matchingDesktopAsset) {
      return;
    }
    setDownloadState("loading");
    try {
      const result = await desktopBridge.downloadLatestInstaller(latestAvailableVersion);
      setDownloadState(result.ok ? "success" : result.status ?? "network_error");
    } catch {
      setDownloadState("network_error");
    }
  }

  async function cancelInstallerDownload() {
    if (!desktopBridge?.cancelInstallerDownload) {
      return;
    }
    await desktopBridge.cancelInstallerDownload().catch(() => false);
  }

  function openReleaseNotes() {
    if (allReleaseNotes.length === 0) {
      return;
    }
    setExpandedReleaseVersion(updateAvailable && latestAvailableVersion ? latestAvailableVersion : releaseNotes?.version ?? allReleaseNotes[0].version);
    automaticUpdateReminderOpenRef.current = false;
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
    if (
      automaticUpdateReminderHandledRef.current
      || !appSettingsLoaded
      || updateStatus === null
    ) {
      return;
    }
    automaticUpdateReminderHandledRef.current = true;
    if (
      initialCurrentReleaseNotesOpenRef.current
      || (telemetryUndecided && !telemetry.environment_disabled)
      || appSettings.feature_flags.hide_automatic_update_reminders === true
      || !updateAvailable
      || !latestAvailableVersion
      || updateStatus.automatic_reminder_eligible !== true
    ) {
      return;
    }

    const openReminder = (markShown: () => Promise<boolean> | boolean) => {
      automaticUpdateReminderOpenRef.current = true;
      setExpandedReleaseVersion(latestAvailableVersion);
      setShowUpdateTelemetryAttention(false);
      setShowReleaseNotes(true);
      window.requestAnimationFrame(() => {
        void Promise.resolve(markShown()).then((marked) => {
          if (!marked && automaticUpdateReminderOpenRef.current) {
            automaticUpdateReminderOpenRef.current = false;
            setShowReleaseNotes(false);
          }
        });
      });
    };

    if (isDesktopApp()) {
      void api.desktopUpdateReminder()
        .then((reminder) => {
          if (isUpdateReminderDue(reminder.reminded_at)) {
            openReminder(() =>
              api.markDesktopUpdateReminder(latestAvailableVersion)
                .then(() => true)
                .catch(() => false)
            );
          }
        })
        .catch(() => undefined);
    } else {
      const storage = readBrowserUpdateReminder();
      if (storage.available && isUpdateReminderDue(storage.reminder?.remindedAt ?? null)) {
        openReminder(() => markBrowserUpdateReminder(latestAvailableVersion));
      }
    }
  }, [
    appSettings.feature_flags.hide_automatic_update_reminders,
    appSettingsLoaded,
    latestAvailableVersion,
    telemetry.environment_disabled,
    telemetryUndecided,
    updateAvailable,
    updateStatus,
  ]);

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
    let disposed = false;
    let refreshRunning = false;

    async function refreshConnectorJobs() {
      if (refreshRunning) return;
      refreshRunning = true;
      try {
        const connections = await api.connectors();
        const jobs = await Promise.all(connections.map(async (connection) => ({
          connection,
          job: await api.connectorSyncStatus(connection.id),
        })));
        if (!disposed) {
          setActiveConnectorJobs(jobs.filter((entry): entry is ActiveConnectorJob => (
            entry.job?.status === "queued" || entry.job?.status === "running"
          )));
        }
      } catch {
        // Preserve the last known active jobs while connector polling recovers.
      } finally {
        refreshRunning = false;
      }
    }

    void refreshConnectorJobs();
    const timer = window.setInterval(() => void refreshConnectorJobs(), 5000);
    const handleFocus = () => void refreshConnectorJobs();
    window.addEventListener("focus", handleFocus);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

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
            <NavLink to="/" end className="app-title-link" aria-label={`${t("app.title")} ${t("nav.homeAria")}`}>
              <h1>{t("app.title")}</h1>
            </NavLink>
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
              <NavLink
                to="/storage-map"
                end
                aria-label={t("nav.storageMapAria")}
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
                      <Map aria-hidden="true" className="nav-icon" />
                    </span>
                  </>
                )}
              </NavLink>
              <NavLink
                to="/transcoding"
                end
                aria-label={t("nav.transcodingAria")}
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
                      <Activity aria-hidden="true" className="nav-icon" />
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
        {activeJobs.length > 0 || activeConnectorJobs.length > 0 ? (
          <div className="scan-banner">
            {scanCancelError ? (
              <div className="scan-banner-error" role="alert">
                {scanCancelError}
              </div>
            ) : null}
            {connectorCancelError ? (
              <div className="scan-banner-error" role="alert">
                {connectorCancelError}
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
              {activeConnectorJobs.map((activeJob) => (
                <ConnectorSyncJobCard
                  key={`connector-${activeJob.connection.id}-${activeJob.job.id}`}
                  activeJob={activeJob}
                  stopping={stoppingConnectorJobs.has(activeJob.job.id)}
                  onStop={async () => {
                    setStoppingConnectorJobs((current) => new Set(current).add(activeJob.job.id));
                    setConnectorCancelError(null);
                    try {
                      await api.cancelConnectorSync(activeJob.connection.id, activeJob.job.id);
                      setActiveConnectorJobs((current) => current.filter((entry) => entry.job.id !== activeJob.job.id));
                    } catch {
                      setConnectorCancelError(t("connectors.syncBanner.cancelFailed"));
                    } finally {
                      setStoppingConnectorJobs((current) => {
                        const next = new Set(current);
                        next.delete(activeJob.job.id);
                        return next;
                      });
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
                  {isDesktopApp() && updateAvailable && latestAvailableVersion && matchingDesktopAsset ? (
                    <button
                      type="button"
                      className={`release-notes-download release-notes-download-${downloadState}`}
                      onClick={() => downloadState === "loading"
                        ? void cancelInstallerDownload()
                        : void downloadLatestInstaller()}
                    >
                      <Download aria-hidden="true" className="nav-icon" />
                      <span>
                        {downloadState === "loading"
                          ? t("releaseNotes.downloadCancel")
                          : downloadState === "success"
                            ? t("releaseNotes.downloadSuccess")
                            : downloadState !== "idle"
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
            {isDesktopApp() && updateAvailable && latestAvailableVersion && !matchingDesktopAsset ? (
              <div className="alert release-notes-alert">
                {knownDesktopTarget
                  ? t("releaseNotes.downloadUnavailable")
                  : t("releaseNotes.downloadUnsupported")}
                {" "}
                <a href={latestReleaseUrl} target="_blank" rel="noreferrer">
                  {t("releaseNotes.openReleasePage")}
                </a>
              </div>
            ) : null}
            {downloadState !== "idle" && downloadState !== "loading" && downloadState !== "success" ? (
              <div className="alert release-notes-alert">
                {t(`releaseNotes.downloadStates.${downloadState}`)}
              </div>
            ) : null}
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
                        {versionNotes.sections.length === 0 ? (
                          <p>{t("releaseNotes.noDetails")}</p>
                        ) : null}
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
