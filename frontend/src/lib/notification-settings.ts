import { preferenceStorage } from "./preference-storage";

export type NotificationSettings = {
  palette: "medialyze" | "soft" | "contrast";
  style: "outline" | "rail" | "tint";
  duration_seconds: number;
  grouping: "off" | "topic" | "type" | "both";
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  palette: "medialyze",
  style: "outline",
  duration_seconds: 2.5,
  grouping: "topic",
};

const GUEST_NOTIFICATION_SETTINGS_STORAGE_KEY = "medialyze-notifications";
const GUEST_NOTIFICATION_SETTINGS_CHANGED_EVENT = "medialyze-guest-notification-settings-changed";

export function readGuestNotificationSettings(): NotificationSettings {
  try {
    const stored = preferenceStorage.getItem(GUEST_NOTIFICATION_SETTINGS_STORAGE_KEY);
    return stored
      ? normalizeNotificationSettings(JSON.parse(stored) as Partial<NotificationSettings>)
      : DEFAULT_NOTIFICATION_SETTINGS;
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

export function saveGuestNotificationSettings(value: NotificationSettings): NotificationSettings {
  const normalized = normalizeNotificationSettings(value);
  preferenceStorage.setItem(GUEST_NOTIFICATION_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event(GUEST_NOTIFICATION_SETTINGS_CHANGED_EVENT));
  return normalized;
}

export { GUEST_NOTIFICATION_SETTINGS_CHANGED_EVENT };

export function normalizeNotificationSettings(value?: Partial<NotificationSettings>): NotificationSettings {
  return {
    palette: value?.palette && ["medialyze", "soft", "contrast"].includes(value.palette) ? value.palette : "medialyze",
    style: value?.style && ["outline", "rail", "tint"].includes(value.style) ? value.style : "outline",
    grouping: value?.grouping && ["off", "topic", "type", "both"].includes(value.grouping) ? value.grouping : "topic",
    duration_seconds: typeof value?.duration_seconds === "number" && Number.isFinite(value.duration_seconds)
      ? Math.round(Math.min(10, Math.max(1, value.duration_seconds)) * 2) / 2 : 2.5,
  };
}
