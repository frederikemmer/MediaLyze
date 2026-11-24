/** Existing layout helpers share this account-scoped storage boundary. */
let namespace: string | null = null;
// Favorites already report their synchronous local write through their owning hook.
const FAVORITES_KEY = "medialyze.compatibility-profile-favorites";
let restoring = 0;
export async function restorePreferenceState(work: () => Promise<unknown>) {
  restoring += 1;
  try { await work(); } finally { restoring -= 1; }
}
const keyFor = (key: string) =>
  namespace === null ? key : `medialyze-identity:${namespace}:${key}`;
export const preferenceStorage = {
  getItem: (key: string) => localStorage.getItem(keyFor(key)),
  setItem(key: string, value: string) {
    try {
      const previous = localStorage.getItem(keyFor(key));
      if (previous === value) return;
      localStorage.setItem(keyFor(key), value);
    } catch (error) {
      if (!restoring && key !== FAVORITES_KEY) announcePreferenceSave(key, Promise.reject(error));
      throw error;
    }
    if (restoring) return;
    if (namespace?.startsWith("account:") || namespace?.startsWith("desktop:"))
      window.dispatchEvent(new CustomEvent("medialyze-preferences-changed", { detail: { key } }));
    else if (key !== FAVORITES_KEY) announcePreferenceSave(key, Promise.resolve());
  },
  removeItem(key: string) {
    try {
      if (localStorage.getItem(keyFor(key)) === null) return;
      localStorage.removeItem(keyFor(key));
    } catch (error) {
      if (!restoring && key !== FAVORITES_KEY) announcePreferenceSave(key, Promise.reject(error));
      throw error;
    }
    if (restoring) return;
    if (namespace?.startsWith("account:") || namespace?.startsWith("desktop:"))
      window.dispatchEvent(new CustomEvent("medialyze-preferences-changed", { detail: { key } }));
    else if (key !== FAVORITES_KEY) announcePreferenceSave(key, Promise.resolve());
  },
};
export function selectPreferenceIdentity(
  id: string | null,
  values?: Record<string, string>,
) {
  namespace = id;
  if (values && id) {
    const prefix = `medialyze-identity:${id}:`;
    for (const key of Object.keys(localStorage))
      if (key.startsWith(prefix)) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(values))
      if ((key.startsWith("medialyze-") || key === "medialyze.compatibility-profile-favorites") && typeof value === "string")
        localStorage.setItem(prefix + key, value);
  }
}
export function preferenceSnapshot(): Record<string, string> {
  const prefix = `medialyze-identity:${namespace}:`;
  return Object.fromEntries(
    Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .map((key) => [key.slice(prefix.length), localStorage.getItem(key)!]),
  );
}

/** Announce only user-facing preference categories; navigation and mount bookkeeping stay silent. */
export function announcePreferenceSave(key: string, promise: Promise<unknown>) {
  void promise.catch(() => {});
  const userChangeKeys = [
    "medialyze-language", "medialyze-theme", "medialyze.compatibility-profile-favorites",
    "medialyze-library-file-column-widths", "medialyze-transcoding-column-widths",
    "medialyze-file-detail-audio-stream-primary",
    "medialyze-file-compare-column-count",
    "medialyze-comparison-selection-dashboard", "medialyze-comparison-selection-library",
  ];
  if (!(userChangeKeys.includes(key) || key === "medialyze-library-statistics-settings" || key.startsWith("medialyze-library-statistics-settings-") || key.startsWith("medialyze-statistic-panel-layout-"))) return;
  window.dispatchEvent(new CustomEvent("medialyze-preference-save", { detail: { key, promise, pathname: window.location.pathname, search: window.location.search } }));
}
