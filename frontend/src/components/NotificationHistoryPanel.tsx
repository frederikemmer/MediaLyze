import { TooltipTrigger } from "./TooltipTrigger";
import { ArrowRight, RefreshCw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { api } from "../lib/api";
import { useAppData } from "../lib/app-data";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/format";
import type { NotificationHistoryItem, NotificationHistoryPage } from "../lib/notification-history";
import { useNotifications } from "../lib/notifications";

export function NotificationHistoryList({ items }: { items: NotificationHistoryItem[] }) {
  const { t } = useTranslation();
  return <div className="transcode-history-list">{items.map((item) => (
    <article className="file-history-entry" key={item.id}>
      <div className="file-history-entry-head">
        <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
        <span className={`badge transcode-status-${item.type === "success" ? "completed" : item.type === "error" ? "failed" : "queued"}`}>{t(`notifications.types.${item.type}`)}</span>
        <Link className="secondary icon-only-button" to={item.source.href} aria-label={item.source.label} title={item.source.label}><ArrowRight aria-hidden="true" className="nav-icon" /></Link>
      </div>
      <p className="notification-history-message">{typeof item.message === "string" ? item.message : item.message.map((part, index) => (
        typeof part === "string" ? <span key={index}>{part}</span> : <span key={index} className="notification-reference">{part.reference}</span>
      ))}</p>
    </article>
  ))}</div>;
}

export function NotificationHistoryPanel() {
  const { t } = useTranslation();
  const { historyRevision, historyWriteFailed, retryHistory } = useNotifications();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<NotificationHistoryPage>({ items: [], total: 0, next_before_id: null });
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const ticket = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ticket.current += 1; }; }, []);
  useEffect(() => {
    const current = ++ticket.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api.notificationHistory(query).then((result) => {
        if (mounted.current && current === ticket.current) { setPage(result); setFailed(false); }
      }).catch(() => { if (mounted.current && current === ticket.current) setFailed(true); })
        .finally(() => { if (mounted.current && current === ticket.current) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); ticket.current += 1; };
  }, [query, refresh]);
  const loadedRevision = useRef(historyRevision);
  async function more() {
    if (!page.next_before_id || loading) return;
    const current = ticket.current;
    setLoading(true);
    try {
      const next = await api.notificationHistory(query, page.next_before_id);
      if (mounted.current && current === ticket.current) setPage((previous) => ({ ...next, items: [...previous.items, ...next.items] }));
    } catch { if (mounted.current && current === ticket.current) setFailed(true); }
    finally { if (mounted.current && current === ticket.current) setLoading(false); }
  }
  return <div className="settings-sidebar-stack">
    <div className="notification-history-toolbar">
      <label className="settings-navigation-search">
        <Search aria-hidden="true" className="nav-icon" /><span className="sr-only">{t("logs.searchNotifications")}</span>
        <input type="search" maxLength={200} value={query} placeholder={t("logs.searchNotifications")} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <button type="button" className="secondary small settings-panel-header-action" disabled={loading} onClick={() => { loadedRevision.current = historyRevision; setRefresh((value) => value + 1); retryHistory(); }}>
        <RefreshCw aria-hidden="true" className="nav-icon" />{t(historyRevision !== loadedRevision.current ? "logs.newNotifications" : "logs.refresh")}
      </button>
    </div>
    {historyWriteFailed ? <div className="alert" role="status">{t("logs.writeFailed")} <button type="button" className="secondary small" onClick={retryHistory}>{t("logs.retry")}</button></div> : null}
    {failed ? <p className="alert" role="alert">{t("logs.loadFailed")}</p> : null}
    {loading ? <p className="field-hint" role="status">{t("panel.loading")}</p> : null}
    {!loading && !failed && !page.items.length ? <div className="notice">{t("logs.noNotifications")}</div> : null}
    <NotificationHistoryList items={page.items} />
    {page.next_before_id ? <button type="button" className="secondary small" disabled={loading} onClick={() => void more()}>{t("scanLogs.loadMore")}</button> : null}
  </div>;
}

export function NotificationRetentionRow({ days, disabled = false, onChange, onSave, id = "notification-retention-days" }: {
  days: string; disabled?: boolean; onChange?: (days: string) => void; onSave?: () => void; id?: string;
}) {
  const { t } = useTranslation();
  return <tr>
    <th scope="row"><span className="table-heading-with-tooltip">
      <label htmlFor={id}>{t("logs.notifications")}</label>
      <TooltipTrigger ariaLabel={t("logs.notificationRetention")} content={t("logs.retentionHint")} />
    </span></th>
    <td><input id={id} className="settings-choice-input history-retention-input" type="number" min={0} max={36500} step={1}
      inputMode="numeric" value={days} disabled={disabled} aria-label={t("logs.notificationRetention")}
      onChange={(event) => onChange?.(event.target.value)} onBlur={() => onSave?.()}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></td>
    <td><span className="muted">—</span></td>
  </tr>;
}

export function NotificationRetentionControl() {
  const { t } = useTranslation();
  const { identity, has } = useAuth();
  const { appSettings, appSettingsLoaded, setAppSettings } = useAppData();
  const { notify } = useNotifications();
  const storedDays = appSettings.history_retention?.notification_history_days ?? 30;
  const [days, setDays] = useState(String(storedDays));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDays(String(storedDays)), [storedDays]);
  const editable = !identity || has("settings.app.edit");
  const value = Number(days);
  async function save() {
    if (!editable || saving || !appSettingsLoaded || days.trim() === "" || value === storedDays || !Number.isInteger(value) || value < 0 || value > 36500) return;
    setSaving(true);
    let success = false;
    try { setAppSettings(await api.updateAppSettings({ history_retention: { notification_history_days: value } })); success = true; }
    catch { /* A safe short notification replaces transient inline action feedback. */ }
    finally { setSaving(false); }
    notify({ type: success ? "success" : "error", message: t(success ? "logs.retentionSaved" : "logs.retentionFailed"),
      topicKey: "notification-retention", source: { area: "settings", href: "/settings?section=logs&settingsFocus=settings-panel-historyRetention", label: t("libraries.historyRetention.title") } });
  }
  return <NotificationRetentionRow days={days} disabled={!editable || !appSettingsLoaded || saving}
    onChange={setDays} onSave={() => void save()} />;
}
