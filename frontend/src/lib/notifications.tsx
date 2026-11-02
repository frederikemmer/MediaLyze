import { api } from "./api";
import { identityGeneration } from "./access-session";
import type { NotificationHistoryWrite } from "./notification-history";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppData } from "./app-data";
import {
  GUEST_NOTIFICATION_SETTINGS_CHANGED_EVENT,
  normalizeNotificationSettings,
  readGuestNotificationSettings,
} from "./notification-settings";
import { NotificationHost } from "../components/NotificationHost";
import { useAuth } from "./auth";
import { EXPLICIT_JOB_START_EVENT, type ExplicitJobStart } from "./notification-job-tracking";
import { usePageVisibility } from "./page-visibility";

export type NotificationType = "success" | "info" | "warning" | "error";
export type NotificationMessagePart = string | { reference: string };
export type NotificationInput = {
  type: NotificationType;
  /** Localized at the call site. References are text, never HTML or links. */
  message: string | readonly NotificationMessagePart[];
  topicKey?: string;
  /** Settings previews are transient and never enter personal history. */
  preview?: boolean;
  source: {
    area: "connectors" | "transcoding" | "library" | "settings";
    /** Internal app route, including a concrete query/fragment if needed. */
    href: string;
    label: string;
  };
};
export type NotificationEntry = NotificationInput & { id: number };
type Timer = { remaining: number; startedAt: number; handle?: ReturnType<typeof setTimeout> };
type NotificationApi = { historyRevision: number; historyWriteFailed: boolean; retryHistory: () => void; notify: (input: NotificationInput) => number; dismiss: (id: number) => void; clearAll: () => void };
function notificationEventId() {
  // randomUUID is unavailable on some self-hosted HTTP origins; getRandomValues still works.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const NotificationContext = createContext<NotificationApi | null>(null);

export function notificationText(message: NotificationInput["message"]) {
  return typeof message === "string" ? message : message.map((part) => typeof part === "string" ? part : part.reference).join("");
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications requires NotificationProvider");
  return context;
}

export function useOptionalNotifications() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { appSettings } = useAppData();
  const { identity } = useAuth();
  const { t } = useTranslation();
  const [guestSettings, setGuestSettings] = useState(readGuestNotificationSettings);
  useEffect(() => {
    if (identity?.kind !== "guest") return;
    const refresh = () => setGuestSettings(readGuestNotificationSettings());
    const onStorage = (event: StorageEvent) => {
      if (event.key === "medialyze-identity:guest:medialyze-notifications") refresh();
    };
    refresh();
    window.addEventListener(GUEST_NOTIFICATION_SETTINGS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(GUEST_NOTIFICATION_SETTINGS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [identity?.kind]);
  const settings = identity?.kind === "guest"
    ? guestSettings
    : normalizeNotificationSettings(appSettings.ui_preferences?.notifications);
  const duration = useRef(settings.duration_seconds);
  duration.current = settings.duration_seconds;
  const [entries, setEntries] = useState<NotificationEntry[]>([]);
  const [announcements, setAnnouncements] = useState<{ id: number; text: string }[]>([]);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [historyWriteFailed, setHistoryWriteFailed] = useState(false);
  const pendingHistory = useRef(new Map<string, NotificationHistoryWrite>());
  const writingHistory = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(identityGeneration());
  const saveHistory = useCallback(async () => {
    if (writingHistory.current || !mounted.current || generation.current !== identityGeneration()) return;
    writingHistory.current = true;
    try {
      for (const [eventId, payload] of pendingHistory.current) {
        if (!mounted.current || generation.current !== identityGeneration()) return;
        try { await api.recordNotification(payload); }
        catch { if (mounted.current && generation.current === identityGeneration()) setHistoryWriteFailed(true); return; }
        if (!mounted.current || generation.current !== identityGeneration()) return;
        pendingHistory.current.delete(eventId);
        setHistoryRevision((value) => value + 1);
      }
      setHistoryWriteFailed(false);
    } finally { writingHistory.current = false; }
  }, []);
  const retryHistory = useCallback(() => { void saveHistory(); }, [saveHistory]);
  useEffect(() => {
    mounted.current = true;
    window.addEventListener("online", retryHistory);
    window.addEventListener("focus", retryHistory);
    return () => { mounted.current = false; window.removeEventListener("online", retryHistory); window.removeEventListener("focus", retryHistory); };
  }, [retryHistory]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, Timer>());
  const pauseSources = useRef(new Set<string>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id)?.handle);
    timers.current.delete(id);
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setAnnouncements((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer.handle);
    timers.current.clear();
    setEntries([]);
    setAnnouncements([]);
  }, []);

  const schedule = useCallback((id: number, timer: Timer) => {
    timer.startedAt = performance.now();
    timer.handle = setTimeout(() => dismiss(id), timer.remaining);
  }, [dismiss]);

  const setPaused = useCallback((source: string, active: boolean) => {
    const wasPaused = pauseSources.current.size > 0;
    if (active) pauseSources.current.add(source);
    else pauseSources.current.delete(source);
    const paused = pauseSources.current.size > 0;
    if (paused === wasPaused) return;
    for (const [id, timer] of timers.current) {
      if (paused) {
        clearTimeout(timer.handle);
        timer.handle = undefined;
        timer.remaining = Math.max(0, timer.remaining - (performance.now() - timer.startedAt));
      } else schedule(id, timer);
    }
  }, [schedule]);

  useEffect(() => {
    const nextDuration = settings.duration_seconds * 1000;
    const paused = pauseSources.current.size > 0;
    for (const [id, timer] of timers.current) {
      clearTimeout(timer.handle);
      timer.handle = undefined;
      timer.remaining = nextDuration;
      if (!paused) schedule(id, timer);
    }
  }, [schedule, settings.duration_seconds]);

  const notify = useCallback((input: NotificationInput) => {
    // Navigation stays inside MediaLyze; reject protocol-relative/external targets.
    if (!input.source.href.startsWith("/") || input.source.href.startsWith("//") || /[\\\u0000-\u0020]/.test(input.source.href)) {
      throw new Error("Notification target must be an internal app route");
    }
    if (!mounted.current || generation.current !== identityGeneration()) return -1;
    if (!input.preview) {
      const eventId = notificationEventId();
      pendingHistory.current.set(eventId, { event_id: eventId, type: input.type, message: input.message, source: input.source });
      void saveHistory();
    }
    const id = ++nextId.current;
    const timer: Timer = { remaining: duration.current * 1000, startedAt: performance.now() };
    timers.current.set(id, timer);
    if (!pauseSources.current.size) schedule(id, timer);
    setEntries((current) => [...current, { ...input, id }]);
    const text = `${t(`notifications.types.${input.type}`)}: ${notificationText(input.message)}`;
    setAnnouncements((current) => [...current, { id, text }]);
    return id;
  }, [saveHistory, schedule, t]);

  useEffect(() => {
    // Existing dialogs are page-local; observe their semantic modal state without coupling to each page.
    const update = () => {
      const dialogs = document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]');
      setPaused("dialog", [...dialogs].some((dialog) => !dialog.closest('[hidden], [aria-hidden="true"], .ui-elements-static-backdrop')));
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "hidden", "aria-hidden", "aria-modal", "role"] });
    update();
    return () => { observer.disconnect(); setPaused("dialog", false); };
  }, [setPaused]);

  useEffect(() => {
    const currentTimers = timers.current;
    return () => { for (const timer of currentTimers.values()) clearTimeout(timer.handle); currentTimers.clear(); };
  }, []);

  return (
    <NotificationContext.Provider value={{ notify, dismiss, clearAll, historyRevision, historyWriteFailed, retryHistory }}>
      {children}
      <ExplicitJobCompletionWatcher />
      <NotificationHost entries={entries} settings={settings} setPaused={setPaused} />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="false" aria-relevant="additions text">
        {announcements.map((announcement) => <p key={announcement.id}>{announcement.text}</p>)}
      </div>
    </NotificationContext.Provider>
  );
}

type TrackedJob = { input: ExplicitJobStart; startedAt: number };

function explicitJobKey(input: ExplicitJobStart): string {
  if (input.kind === "scan" || input.kind === "transcode") return `${input.kind}:${input.job.id}`;
  if (input.kind === "connector_sync") return `connector:${input.connectionId}:${input.jobId}`;
  if (input.kind === "jellyfin_sync") return `jellyfin:${input.jobId}`;
  return `history:${input.status.job_id ?? input.libraryId ?? "all"}:${input.status.started_at ?? "queued"}`;
}

function ExplicitJobCompletionWatcher() {
  const { identity, has } = useAuth();
  const { notify } = useNotifications();
  const { t } = useTranslation();
  const visible = usePageVisibility();
  const tracked = useRef(new Map<string, TrackedJob>());
  const polling = useRef(false);
  const identityKey = identity ? `${identity.kind}:${identity.id}:${identity.revision}` : "anonymous";

  useEffect(() => {
    tracked.current.clear();
  }, [identityKey]);

  useEffect(() => {
    function belongsToCurrentActor(origin: { kind: string; id: string } | null | undefined) {
      return !identity || !origin || (origin.kind === identity.kind && origin.id === identity.id);
    }
    function canRead(input: ExplicitJobStart) {
      if (!identity) return true;
      if (input.kind === "scan") return identity.kind !== "guest" && belongsToCurrentActor(input.job.origin) && has("library.read", input.job.library_id);
      if (input.kind === "transcode") return belongsToCurrentActor(input.job.origin) && has("library.read", input.job.library_id) && has("transcode.view", input.job.library_id);
      if (input.kind === "connector_sync" || input.kind === "jellyfin_sync") return has("connector.view");
      if (input.libraryId !== undefined) return identity.kind !== "guest" && belongsToCurrentActor(input.status.origin) && has("library.read", input.libraryId);
      if (identity.kind === "guest" || !belongsToCurrentActor(input.status.origin)) return false;
      return has("settings.app.view");
    }
    const handleStart = (event: Event) => {
      const input = (event as CustomEvent<ExplicitJobStart>).detail;
      if (!input || !canRead(input)) return;
      tracked.current.set(explicitJobKey(input), { input, startedAt: Date.now() });
    };
    window.addEventListener(EXPLICIT_JOB_START_EVENT, handleStart);
    return () => window.removeEventListener(EXPLICIT_JOB_START_EVENT, handleStart);
  }, [has, identityKey]);

  const poll = useCallback(async () => {
    if (polling.current || !visible || tracked.current.size === 0) return;
    polling.current = true;
    try {
      let activeScanIds: Set<number> | null = null;
      let activeTranscodeIds: Set<number> | null = null;
      if ([...tracked.current.values()].some(({ input }) => input.kind === "scan")) {
        try { activeScanIds = new Set((await api.activeScanJobs()).map((job) => job.id)); } catch { /* retry next poll */ }
      }
      if ([...tracked.current.values()].some(({ input }) => input.kind === "transcode")) {
        try { activeTranscodeIds = new Set((await api.activeTranscodeJobs()).items.map((job) => job.id)); } catch { /* retry next poll */ }
      }
      for (const [key, item] of [...tracked.current]) {
        if (Date.now() - item.startedAt > 7 * 86400000) {
          tracked.current.delete(key);
          continue;
        }
        try {
          let type: NotificationType | null = null;
          let message: NotificationInput["message"] = "";
          let source: NotificationInput["source"] | null = null;
          let jobId: number | null = null;

          if (item.input.kind === "scan") {
            if (activeScanIds === null || activeScanIds.has(item.input.job.id)) continue;
            const job = await api.scanJobDetail(item.input.job.id);
            if (!["successful", "completed_with_issues", "failed", "canceled"].includes(job.outcome)) continue;
            jobId = job.id;
            type = job.outcome === "successful" ? "success" : job.outcome === "completed_with_issues" ? "warning" : job.outcome === "failed" ? "error" : "info";
            const library = item.input.job.library_name ?? String(job.library_id);
            message = [t(`notifications.jobs.scan.${job.outcome}`, { library }), { reference: t("notifications.jobReference", { id: job.id }) }];
            source = { area: "library", href: `/settings?section=logs&library_id=${job.library_id}&scan-job=${job.id}#settings-panel-recentScanLogs`, label: t("notifications.jobs.openScanJob", { id: job.id }) };
          } else if (item.input.kind === "transcode") {
            if (activeTranscodeIds === null || activeTranscodeIds.has(item.input.job.id)) continue;
            const job = await api.transcodeJob(item.input.job.id);
            if (["queued", "running"].includes(job.status)) continue;
            jobId = job.id;
            type = job.status === "completed" ? "success" : job.status === "failed" ? "error" : "info";
            message = [t(`notifications.jobs.transcode.${job.status}`), { reference: t("notifications.jobReference", { id: job.id }) }];
            source = { area: "transcoding", href: `/transcoding?job=${job.id}`, label: t("notifications.jobs.openTranscodingJob", { id: job.id }) };
          } else if (item.input.kind === "connector_sync") {
            const job = await api.connectorSyncStatus(item.input.connectionId, item.input.jobId);
            if (!job) {
              tracked.current.delete(key);
              continue;
            }
            if (["queued", "running"].includes(job.status)) continue;
            jobId = job.id;
            type = job.status === "completed" ? "success" : job.status === "failed" ? "error" : "info";
            message = [t(`notifications.jobs.connector.${job.status}`, { name: item.input.connectionName }), { reference: t("notifications.jobReference", { id: job.id }) }];
            source = { area: "connectors", href: `/settings?section=jellyfin#connector-${item.input.connectionId}`, label: item.input.connectionName };
          } else if (item.input.kind === "jellyfin_sync") {
            const status = await api.jellyfinSyncStatus(item.input.jobId);
            if (!status.sync_job_id) {
              tracked.current.delete(key);
              continue;
            }
            if (status.sync_job_id !== item.input.jobId || !status.sync_job_status || ["queued", "running"].includes(status.sync_job_status)) continue;
            jobId = status.sync_job_id;
            type = status.sync_job_status === "completed" ? "success" : status.sync_job_status === "failed" ? "error" : "info";
            message = [t(`notifications.jobs.connector.${status.sync_job_status}`, { name: status.server_name ?? "Jellyfin" }), { reference: t("notifications.jobReference", { id: status.sync_job_id }) }];
            source = { area: "connectors", href: "/settings?section=jellyfin", label: t("connectors.title") };
          } else {
            const status = await api.historyReconstructionStatus(item.input.libraryId);
            if (["queued", "running", "idle"].includes(status.status)) continue;
            const requestedJobId = item.input.status.job_id;
            if (!requestedJobId || status.job_id !== requestedJobId) {
              tracked.current.delete(key);
              continue;
            }
            jobId = status.started_at ? Date.parse(status.started_at) : null;
            type = status.status === "completed" ? "success" : status.status === "failed" ? "error" : "info";
            message = t(`notifications.jobs.history.${status.status}`);
            source = item.input.libraryId !== undefined
              ? { area: "library", href: `/libraries/${item.input.libraryId}`, label: t("notifications.jobs.openLibrary", { library: String(item.input.libraryId) }) }
              : { area: "settings", href: "/settings?section=logs&settingsFocus=settings-panel-historyRetention", label: t("libraries.historyRetention.title") };
          }

          if (type && source) {
            tracked.current.delete(key);
            notify({
              type,
              message,
              topicKey: `job:${item.input.kind}:${jobId ?? key}`,
              source,
            });
          }
        } catch {
          // Transient errors keep the registered job for the next poll.
        }
      }
    } finally {
      polling.current = false;
    }
  }, [notify, t, visible]);

  useEffect(() => {
    const interval = window.setInterval(() => void poll(), 5000);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [poll]);

  return null;
}
