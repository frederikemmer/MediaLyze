import { useLocation } from "react-router";
import { BellPlus, ChevronDown, ChevronRight, FlaskConical, Save, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { useAppData } from "../lib/app-data";
import { useAuth } from "../lib/auth";
import {
  normalizeNotificationSettings,
  readGuestNotificationSettings,
  saveGuestNotificationSettings,
  type NotificationSettings,
} from "../lib/notification-settings";
import { useNotifications, type NotificationInput, type NotificationType } from "../lib/notifications";

export function NotificationSettingsFields({ value, onChange, disabled = false }: {
  value: NotificationSettings; onChange: (value: NotificationSettings) => void; disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  return (
    <div className="app-settings-performance-grid">
      <div className="field">
        <label htmlFor={`${id}-palette`}>{t("notifications.palette")}</label>
        <select id={`${id}-palette`} className="settings-choice-input" value={value.palette} disabled={disabled}
          onChange={(event) => onChange({ ...value, palette: event.target.value as NotificationSettings["palette"] })}>
          {["medialyze", "soft", "contrast"].map((key) => <option value={key} key={key}>{t(`notifications.palettes.${key}`)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-style`}>{t("notifications.style")}</label>
        <select id={`${id}-style`} className="settings-choice-input" value={value.style} disabled={disabled}
          onChange={(event) => onChange({ ...value, style: event.target.value as NotificationSettings["style"] })}>
          {["outline", "rail", "tint"].map((key) => <option value={key} key={key}>{t(`notifications.styles.${key}`)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-duration`}>{t("notifications.duration")}</label>
        <div className="notification-duration-control">
          <input id={`${id}-duration`} type="range" min={1} max={10} step={0.5} value={value.duration_seconds} disabled={disabled}
            aria-valuetext={t("notifications.seconds", { value: new Intl.NumberFormat(i18n.resolvedLanguage).format(value.duration_seconds) })}
            onChange={(event) => onChange({ ...value, duration_seconds: Number(event.target.value) })} />
          <output htmlFor={`${id}-duration`}>{t("notifications.seconds", { value: new Intl.NumberFormat(i18n.resolvedLanguage).format(value.duration_seconds) })}</output>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-grouping`}>{t("notifications.grouping")}</label>
        <select id={`${id}-grouping`} className="settings-choice-input" value={value.grouping} disabled={disabled}
          onChange={(event) => onChange({ ...value, grouping: event.target.value as NotificationSettings["grouping"] })}>
          {["off", "topic", "type", "both"].map((key) => <option value={key} key={key}>{t(`notifications.groups.${key}`)}</option>)}
        </select>
      </div>
    </div>
  );
}

export function NotificationPreviewControls({ disabled = false, settingsHref = "/settings?section=application#notification-settings" }: {
  disabled?: boolean; settingsHref?: string;
}) {
  const { t } = useTranslation();
  const { notify, clearAll } = useNotifications();
  const targets: Record<NotificationInput["source"]["area"], string> = {
    settings: settingsHref,
    library: "/settings?section=libraries",
    connectors: "/settings?section=jellyfin",
    transcoding: "/transcoding",
  };
  const types: NotificationType[] = ["success", "info", "warning", "error"];
  const areas: NotificationInput["source"]["area"][] = ["settings", "library", "connectors", "transcoding"];
  function sendRandom(count: number) {
    for (let index = 0; index < count; index += 1) {
      const type = types[Math.floor(Math.random() * types.length)];
      const area = areas[Math.floor(Math.random() * areas.length)];
      notify({
        type, preview: true, topicKey: `notification-preview:${area}`,
        message: area === "transcoding"
          ? [t("notifications.previewPrefix"), { reference: t("notifications.jobReference", { id: Math.floor(Math.random() * 900) + 100 }) }, t(`notifications.previewJob.${type}`)]
          : t(`notifications.previewMessages.${type}`, { area: t(`notifications.areas.${area}`) }),
        source: { area, href: targets[area], label: t("notifications.openArea", { area: t(`notifications.areas.${area}`) }) },
      });
    }
  }
  return (
    <div className="notification-preview-controls">
      <button className="secondary small settings-panel-header-action" type="button" disabled={disabled} onClick={() => sendRandom(1)}>
        <FlaskConical aria-hidden="true" className="nav-icon" />{t("notifications.sendRandomOne")}
      </button>
      <button className="secondary small settings-panel-header-action" type="button" disabled={disabled} onClick={() => sendRandom(10)}>
        <BellPlus aria-hidden="true" className="nav-icon" />{t("notifications.sendRandomTen")}
      </button>
      <button className="secondary small settings-panel-header-action" type="button" onClick={clearAll}>
        <Trash2 aria-hidden="true" className="nav-icon" />{t("notifications.clearVisible")}
      </button>
    </div>
  );
}

export function NotificationSettingsPanel({ sectionId = "notification-settings" }: { sectionId?: string } = {}) {
  const { t } = useTranslation();
  const { identity, has } = useAuth();
  const { notify } = useNotifications();
  const location = useLocation();
  const bodyId = useId();
  const settingsHref = "/settings?section=application#notification-settings";
  const { appSettings, appSettingsLoaded, setAppSettings } = useAppData();
  const stored = identity?.kind === "guest"
    ? readGuestNotificationSettings()
    : normalizeNotificationSettings(appSettings.ui_preferences?.notifications);
  const storedKey = JSON.stringify(stored);
  const [draft, setDraft] = useState(stored);
  const [expanded, setExpanded] = useState(true);
  const [saving, setSaving] = useState(false);
  // Personal Notification preferences never grant or require instance-settings rights.
  const editable = identity?.kind === "guest" || identity?.kind === "account" || !identity || has("settings.app.edit");
  const dirty = JSON.stringify(draft) !== storedKey;
  useEffect(() => { setDraft(JSON.parse(storedKey) as NotificationSettings); }, [storedKey]);
  useEffect(() => {
    if (location.hash !== `#${sectionId}`) return;
    setExpanded(true);
    const frame = window.requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView({ block: "nearest" }));
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash, location.key, sectionId]);

  async function save() {
    if (!editable || saving || !appSettingsLoaded) return;
    setSaving(true);
    try {
      if (identity?.kind === "guest") {
        const updated = saveGuestNotificationSettings(draft);
        setDraft(updated);
        notify({
          type: "success", message: t("notifications.saved"), topicKey: "notification-settings",
          source: { area: "settings", href: settingsHref, label: t("notifications.title") },
        });
        return;
      }
      const updated = await api.updateAppSettings({ ui_preferences: { notifications: draft } });
      setAppSettings(updated);
      notify({
        type: "success", message: t("notifications.saved"), topicKey: "notification-settings",
        source: { area: "settings", href: settingsHref, label: t("notifications.title") },
      });
    } catch {
      notify({
        type: "error", message: t("notifications.saveFailed"), topicKey: "notification-settings",
        source: { area: "settings", href: settingsHref, label: t("notifications.title") },
      });
    }
    finally { setSaving(false); }
  }

  return (
    <section id={sectionId} tabIndex={-1} className="app-settings-section transcode-automation-section transcode-federation-panel notification-settings-panel">
      <div className="compatibility-profile-panel transcode-automation-content">
        <div className="transcode-federation-heading">
          <div className="transcode-federation-heading-main">
            <button type="button" className="transcode-federation-section-chevron" aria-expanded={expanded} aria-controls={bodyId}
              aria-label={t(expanded ? "notifications.collapse" : "notifications.expand")} onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronDown aria-hidden="true" className="nav-icon" /> : <ChevronRight aria-hidden="true" className="nav-icon" />}
            </button>
            <h3>{t("notifications.title")}</h3>
          </div>
          <div className="transcode-federation-heading-actions">
            <button type="button" className="secondary small settings-panel-header-action" disabled={!editable || !dirty || saving || !appSettingsLoaded} onClick={() => void save()}>
              <Save aria-hidden="true" className="nav-icon" />{t(saving ? "notifications.saving" : "notifications.save")}
            </button>
          </div>
        </div>
        <div id={bodyId} className="transcode-automation-panel-body" hidden={!expanded}>
          {!editable ? <p className="field-hint">{t("access.readOnly")}</p> : null}
          {identity?.kind === "guest" ? <p className="field-hint">{t("notifications.guestLocalHint")}</p> : null}
          <NotificationSettingsFields value={draft} disabled={!editable || saving || !appSettingsLoaded} onChange={setDraft} />
          <NotificationPreviewControls disabled={dirty || saving || !appSettingsLoaded} settingsHref={settingsHref} />
        </div>
      </div>
    </section>
  );
}
