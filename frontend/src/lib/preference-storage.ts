/** Existing layout helpers share this account-scoped storage boundary. */
let namespace: string | null = null;
const keyFor = (key: string) =>
  namespace === null ? key : `medialyze-identity:${namespace}:${key}`;
export const preferenceStorage = {
  getItem: (key: string) => localStorage.getItem(keyFor(key)),
  setItem(key: string, value: string) {
    localStorage.setItem(keyFor(key), value);
    if (namespace?.startsWith("account:"))
      window.dispatchEvent(new Event("medialyze-preferences-changed"));
  },
  removeItem(key: string) {
    localStorage.removeItem(keyFor(key));
    if (namespace?.startsWith("account:"))
      window.dispatchEvent(new Event("medialyze-preferences-changed"));
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
      if (key.startsWith("medialyze-") && typeof value === "string")
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
