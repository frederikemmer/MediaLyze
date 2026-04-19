export type SettingsPanelId =
  | "configuredLibraries"
  | "historyRetention"
  | "recentScanLogs"
  | "libraryStatistics"
  | "resolutionCategories"
  | "createLibrary"
  | "ignorePatterns"
  | "appSettings";

export type SettingsPanelState = Record<SettingsPanelId, boolean>;

const STORAGE_KEY = "medialyze-settings-panel-state";

const DEFAULT_STATE: SettingsPanelState = {
  configuredLibraries: true,
  historyRetention: true,
  recentScanLogs: true,
  libraryStatistics: true,
  resolutionCategories: true,
  createLibrary: true,
  ignorePatterns: true,
  appSettings: true,
};

function normalizeSettingsPanelState(value: unknown): SettingsPanelState {
  if (!value || typeof value !== "object") {
    return DEFAULT_STATE;
  }

  return {
    configuredLibraries:
      "configuredLibraries" in value && typeof value.configuredLibraries === "boolean"
        ? value.configuredLibraries
        : DEFAULT_STATE.configuredLibraries,
    historyRetention:
      "historyRetention" in value && typeof value.historyRetention === "boolean"
        ? value.historyRetention
        : DEFAULT_STATE.historyRetention,
    recentScanLogs:
      "recentScanLogs" in value && typeof value.recentScanLogs === "boolean"
        ? value.recentScanLogs
        : DEFAULT_STATE.recentScanLogs,
    libraryStatistics:
      "libraryStatistics" in value && typeof value.libraryStatistics === "boolean"
        ? value.libraryStatistics
        : DEFAULT_STATE.libraryStatistics,
    resolutionCategories:
      "resolutionCategories" in value && typeof value.resolutionCategories === "boolean"
        ? value.resolutionCategories
        : DEFAULT_STATE.resolutionCategories,
    createLibrary:
      "createLibrary" in value && typeof value.createLibrary === "boolean"
        ? value.createLibrary
        : DEFAULT_STATE.createLibrary,
    ignorePatterns:
      "ignorePatterns" in value && typeof value.ignorePatterns === "boolean"
        ? value.ignorePatterns
        : DEFAULT_STATE.ignorePatterns,
    appSettings:
      "appSettings" in value && typeof value.appSettings === "boolean"
        ? value.appSettings
        : DEFAULT_STATE.appSettings,
  };
}

export function getSettingsPanelState(): SettingsPanelState {
  if (typeof window === "undefined") {
    return DEFAULT_STATE;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_STATE;
    }
    return normalizeSettingsPanelState(JSON.parse(raw));
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveSettingsPanelState(state: SettingsPanelState): SettingsPanelState {
  const normalized = normalizeSettingsPanelState(state);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // ignore storage errors
    }
  }

  return normalized;
}
