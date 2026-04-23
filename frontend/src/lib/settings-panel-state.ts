export type SettingsPanelId =
  | "configuredLibraries"
  | "historyRetention"
  | "patternRecognition"
  | "recentScanLogs"
  | "resolutionCategories"
  | "createLibrary"
  | "appSettings";

export type SettingsPanelState = Record<SettingsPanelId, boolean>;

const STORAGE_KEY = "medialyze-settings-panel-state";

const DEFAULT_STATE: SettingsPanelState = {
  configuredLibraries: true,
  historyRetention: true,
  patternRecognition: true,
  recentScanLogs: true,
  resolutionCategories: true,
  createLibrary: true,
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
    patternRecognition:
      "patternRecognition" in value && typeof value.patternRecognition === "boolean"
        ? value.patternRecognition
        : "ignorePatterns" in value && typeof value.ignorePatterns === "boolean"
          ? value.ignorePatterns
          : DEFAULT_STATE.patternRecognition,
    recentScanLogs:
      "recentScanLogs" in value && typeof value.recentScanLogs === "boolean"
        ? value.recentScanLogs
        : DEFAULT_STATE.recentScanLogs,
    resolutionCategories:
      "resolutionCategories" in value && typeof value.resolutionCategories === "boolean"
        ? value.resolutionCategories
        : DEFAULT_STATE.resolutionCategories,
    createLibrary:
      "createLibrary" in value && typeof value.createLibrary === "boolean"
        ? value.createLibrary
        : DEFAULT_STATE.createLibrary,
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
