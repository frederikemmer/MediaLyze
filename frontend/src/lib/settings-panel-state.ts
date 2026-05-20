export type SettingsPanelId =
  | "configuredLibraries"
  | "createLibrary"
  | "appSettings"
  | "resolutionCategories"
  | "patternRecognition"
  | "historyRetention"
  | "recentScanLogs"
  | "telemetry";

const ACTIVE_PANEL_STORAGE_KEY = "medialyze-settings-active-panel";
const NAV_COLLAPSED_STORAGE_KEY = "medialyze-settings-sidebar-collapsed";

export const SETTINGS_PANEL_IDS: SettingsPanelId[] = [
  "configuredLibraries",
  "createLibrary",
  "appSettings",
  "resolutionCategories",
  "patternRecognition",
  "historyRetention",
  "recentScanLogs",
  "telemetry",
];

export function isSettingsPanelId(value: unknown): value is SettingsPanelId {
  return typeof value === "string" && SETTINGS_PANEL_IDS.includes(value as SettingsPanelId);
}

export function getActiveSettingsPanel(fallback: SettingsPanelId): SettingsPanelId {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(ACTIVE_PANEL_STORAGE_KEY);
    return isSettingsPanelId(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
}

export function hasStoredActiveSettingsPanelPreference(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(ACTIVE_PANEL_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveActiveSettingsPanel(panelId: SettingsPanelId): SettingsPanelId {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(ACTIVE_PANEL_STORAGE_KEY, panelId);
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
    return window.localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveSettingsNavCollapsed(collapsed: boolean): boolean {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
    } catch {
      // ignore storage errors
    }
  }
  return collapsed;
}
