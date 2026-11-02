import { preferenceStorage } from "./preference-storage";
export type SettingsPanelId =
  | "accounts"
  | "configuredLibraries"
  | "jellyfin"
  | "qualityProfiles"
  | "compatibilityProfiles"
  | "appSettings"
  | "transcoding"
  | "transcodingPresets"
  | "patternRecognition"
  | "logs"
  | "historyRetention"
  | "recentScanLogs"
  | "telemetry";

const ACTIVE_PANEL_STORAGE_KEY = "medialyze-settings-active-panel";
const NAV_COLLAPSED_STORAGE_KEY = "medialyze-settings-sidebar-collapsed";

export const SETTINGS_PANEL_IDS: SettingsPanelId[] = [
  "accounts",
  "configuredLibraries",
  "jellyfin",
  "qualityProfiles",
  "compatibilityProfiles",
  "appSettings",
  "transcoding",
  "transcodingPresets",
  "patternRecognition",
  "logs",
  "historyRetention",
  "recentScanLogs",
  "telemetry",
];

export const SETTINGS_PANEL_SLUGS: Record<SettingsPanelId, string> = {
  accounts: "accounts",
  configuredLibraries: "libraries",
  jellyfin: "jellyfin",
  qualityProfiles: "quality-profiles",
  compatibilityProfiles: "compatibility-profiles",
  appSettings: "application",
  transcoding: "transcoding",
  transcodingPresets: "transcoding-presets",
  patternRecognition: "pattern-recognition",
  logs: "logs",
  historyRetention: "history-retention",
  recentScanLogs: "scan-logs",
  telemetry: "telemetry",
};

const SETTINGS_PANEL_BY_SLUG = new Map(
  Object.entries(SETTINGS_PANEL_SLUGS).map(([panelId, slug]) => [
    slug,
    panelId as SettingsPanelId,
  ]),
);

export function isSettingsPanelId(value: unknown): value is SettingsPanelId {
  return (
    typeof value === "string" &&
    SETTINGS_PANEL_IDS.includes(value as SettingsPanelId)
  );
}

export function settingsPanelFromSection(
  value: string | null | undefined,
): SettingsPanelId | null {
  if (!value) return null;
  if (["logs", "historyRetention", "recentScanLogs", "history-retention", "scan-logs", "transcode-history", "notification-history"].includes(value)) return "logs";
  if (value === "personal-account" || value === "personalAccount")
    return "accounts";
  if (value === "resolution-categories" || value === "resolutionCategories")
    return "qualityProfiles";
  if (isSettingsPanelId(value)) return value;
  return SETTINGS_PANEL_BY_SLUG.get(value) ?? null;
}

export function settingsSectionForPanel(panelId: SettingsPanelId): string {
  return SETTINGS_PANEL_SLUGS[panelId];
}

export function getActiveSettingsPanel(
  fallback: SettingsPanelId,
): SettingsPanelId {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = preferenceStorage.getItem(ACTIVE_PANEL_STORAGE_KEY);
    if (raw === "historyRetention" || raw === "recentScanLogs") return "logs";
    if (raw === "resolutionCategories") return "qualityProfiles";
    return raw === "personalAccount"
      ? "accounts"
      : isSettingsPanelId(raw)
        ? raw
        : fallback;
  } catch {
    return fallback;
  }
}

export function hasStoredActiveSettingsPanelPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return preferenceStorage.getItem(ACTIVE_PANEL_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveActiveSettingsPanel(
  panelId: SettingsPanelId,
): SettingsPanelId {
  if (typeof window !== "undefined") {
    try {
      preferenceStorage.setItem(ACTIVE_PANEL_STORAGE_KEY, panelId);
    } catch {
      // ignore storage errors
    }
  }
  return panelId;
}

export function getSettingsNavCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return preferenceStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveSettingsNavCollapsed(collapsed: boolean): boolean {
  if (typeof window !== "undefined") {
    try {
      preferenceStorage.setItem(
        NAV_COLLAPSED_STORAGE_KEY,
        collapsed ? "true" : "false",
      );
    } catch {
      // ignore storage errors
    }
  }
  return collapsed;
}
