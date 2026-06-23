export type CompatibilityProfileType = "hardware" | "software" | "compatibility";

export const FAVORITE_PROFILES_STORAGE_KEY = "medialyze.compatibility-profile-favorites";

export function favoriteProfileKey(type: CompatibilityProfileType, id: string) {
  return `${type}:${id}`;
}

export function readFavoriteProfileKeys() {
  if (typeof window === "undefined") {
    return new Set<string>();
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(FAVORITE_PROFILES_STORAGE_KEY) ?? "[]");
    return Array.isArray(stored)
      ? new Set(stored.filter((value): value is string => typeof value === "string"))
      : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

export function writeFavoriteProfileKeys(keys: Set<string>) {
  try {
    window.localStorage.setItem(FAVORITE_PROFILES_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Keep the in-memory preference usable when browser storage is unavailable.
  }
}
