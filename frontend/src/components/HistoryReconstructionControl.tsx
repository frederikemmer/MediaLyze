import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type HistoryReconstructionStatus } from "../lib/api";
import { trackExplicitJobStart } from "../lib/notification-job-tracking";
import { hasLibraryPermission, useAuth } from "../lib/auth";
import { usePageVisibility } from "../lib/page-visibility";
import { useOptionalNotifications } from "../lib/notifications";
import { TooltipTrigger } from "./TooltipTrigger";

export function emptyHistoryStatus(): HistoryReconstructionStatus {
  return { status: "idle", phase: "idle", started_at: null, finished_at: null,
    progress_percent: 0, libraries_total: 0, libraries_processed: 0, libraries_with_media: 0,
    current_library_name: null, phase_total: 0, phase_completed: 0, created_file_history_entries: 0,
    created_library_history_entries: 0, updated_library_history_entries: 0, result: null, error: null };
}

export function HistoryReconstructionControl({ libraryId, blocked = false, fixture }: {
  libraryId?: number; blocked?: boolean; fixture?: HistoryReconstructionStatus;
}) {
  const { t } = useTranslation();
  const auth = useAuth();
  const notifications = useOptionalNotifications();
  const visible = usePageVisibility();
  const [status, setStatus] = useState<HistoryReconstructionStatus | null>(fixture ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const epoch = useRef(0);
  const allowed = Boolean(fixture || !auth.identity || (libraryId === undefined
    ? hasLibraryPermission(auth.identity, "library.scan") : auth.has("library.scan", libraryId)));
  const active = status?.status === "queued" || status?.status === "running";

  useEffect(() => {
    setStatus(fixture ?? null);
    setPending(false);
    setError(false);
    if (!allowed || fixture || !auth.identity || !visible) return;
    const request = ++epoch.current;
    void api.historyReconstructionStatus(libraryId).then(value => {
      if (request === epoch.current) setStatus(value);
    }).catch(() => {});
    return () => { epoch.current++; };
  }, [libraryId, allowed, fixture, visible, auth.identity?.id, auth.identity?.revision]);

  useEffect(() => {
    if (!active || !visible || fixture) return;
    const timer = window.setInterval(() => {
      const request = ++epoch.current;
      void api.historyReconstructionStatus(libraryId).then(value => {
        if (request === epoch.current) setStatus(value);
      }).catch(() => {});
    }, 2000);
    return () => window.clearInterval(timer);
  }, [active, visible, fixture, libraryId]);

  if (!allowed) return null;
  async function start() {
    if (pending || active || blocked || fixture) return;
    const request = ++epoch.current;
    setPending(true);
    setError(false);
    try {
      const value = await api.reconstructHistory(libraryId);
      if (request === epoch.current) {
        setStatus(value);
        trackExplicitJobStart({ kind: "history_reconstruction", status: value, libraryId });
      }
    } catch {
      if (request === epoch.current) {
        if (notifications) {
          const source = libraryId !== undefined
            ? { area: "library" as const, href: `/libraries/${libraryId}`, label: t("notifications.jobs.openLibrary", { library: String(libraryId) }) }
            : { area: "settings" as const, href: "/settings?section=logs&settingsFocus=settings-panel-historyRetention", label: t("libraries.historyRetention.title") };
          notifications.notify({
            type: "error",
            message: t("libraries.historyRetention.reconstructFailed"),
            topicKey: `history-reconstruction-start:${libraryId ?? "all"}`,
            source,
          });
        } else {
          setError(true);
        }
      }
    } finally {
      if (request === epoch.current) setPending(false);
    }
  }
  let message = "";
  if (active && status) {
    message = `${t("libraries.historyRetention.progressLibraries", {
      completed: status.libraries_processed, total: status.libraries_total,
    })} · ${Math.round(status.progress_percent)}%`;
  } else if (error) {
    message = t("libraries.historyRetention.reconstructFailed");
  }
  return <div className="history-retention-title-actions">
    <button type="button" className="secondary small settings-panel-header-action history-retention-reconstruct-button"
      disabled={pending || active || blocked || Boolean(fixture)} onClick={() => void start()}>
      {pending || active ? t("libraries.historyRetention.reconstructing") : t("libraries.historyRetention.reconstructButton")}
    </button>
    <TooltipTrigger ariaLabel={t("libraries.historyRetention.reconstructTooltipAria")}
      content={`${t("libraries.historyRetention.reconstructScopeHint")}\n\n${t("libraries.historyRetention.reconstructTooltip")}`} preserveLineBreaks />
    {message ? <span className="field-hint" role="status" aria-live="polite">{message}</span> : null}
  </div>;
}
