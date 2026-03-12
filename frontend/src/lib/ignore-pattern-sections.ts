export type IgnorePatternSectionState = {
  customExpanded: boolean;
  defaultsExpanded: boolean;
};

const STORAGE_KEY = "medialyze-ignore-pattern-sections";

const DEFAULT_STATE: IgnorePatternSectionState = {
  customExpanded: true,
  defaultsExpanded: false,
};

function normalizeSectionState(value: unknown): IgnorePatternSectionState {
  if (!value || typeof value !== "object") {
    return DEFAULT_STATE;
  }

  const customExpanded =
    "customExpanded" in value && typeof value.customExpanded === "boolean"
      ? value.customExpanded
      : DEFAULT_STATE.customExpanded;
  const defaultsExpanded =
    "defaultsExpanded" in value && typeof value.defaultsExpanded === "boolean"
      ? value.defaultsExpanded
      : DEFAULT_STATE.defaultsExpanded;

  return {
    customExpanded,
    defaultsExpanded,
  };
}

export function getIgnorePatternSectionState(): IgnorePatternSectionState {
  if (typeof window === "undefined") {
    return DEFAULT_STATE;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_STATE;
  }

  try {
    return normalizeSectionState(JSON.parse(raw));
  } catch {
    return DEFAULT_STATE;
  }
}

export function saveIgnorePatternSectionState(
  state: IgnorePatternSectionState,
): IgnorePatternSectionState {
  const normalized = normalizeSectionState(state);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }

  return normalized;
}
