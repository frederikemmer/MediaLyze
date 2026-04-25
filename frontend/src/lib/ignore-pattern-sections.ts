export type IgnorePatternSectionState = {
  combinedExpanded: boolean;
};

const STORAGE_KEY = "medialyze-ignore-pattern-sections";

const DEFAULT_STATE: IgnorePatternSectionState = {
  combinedExpanded: true,
};

function normalizeSectionState(value: unknown): IgnorePatternSectionState {
  if (!value || typeof value !== "object") {
    return DEFAULT_STATE;
  }

  const combinedExpanded =
    "combinedExpanded" in value && typeof value.combinedExpanded === "boolean"
      ? value.combinedExpanded
      : ("customExpanded" in value && typeof value.customExpanded === "boolean"
          ? value.customExpanded
          : ("defaultsExpanded" in value && typeof value.defaultsExpanded === "boolean"
              ? value.defaultsExpanded
              : DEFAULT_STATE.combinedExpanded));

  return {
    combinedExpanded,
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
