/** Shared identity generation for API calls, media downloads and cache teardown. */
let csrf = "";
let expectedIdentity = "";
export function setExpectedIdentity(value: string) {
  expectedIdentity = value;
}
let generation = 0;
export const identityGeneration = () => generation;
let requests = new AbortController();
export function setCsrf(value: string) {
  csrf = value;
}
export function clearIdentityRequests() {
  generation += 1;
  requests.abort();
  requests = new AbortController();
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith("medialyze")) sessionStorage.removeItem(key);
}
export async function sessionFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const current = generation;
  const headers = new Headers(init.headers);
  headers.set("X-MediaLyze-Origin", window.location.origin);
  if (init.method && !["GET", "HEAD"].includes(init.method.toUpperCase()))
    headers.set("X-CSRF-Token", csrf);
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    signal: init.signal
      ? AbortSignal.any([init.signal, requests.signal])
      : requests.signal,
  });
  if (current !== generation)
    throw new DOMException("Identity changed", "AbortError");
  const actualIdentity = response.headers.get("X-MediaLyze-Identity");
  if (
    !path.includes("/auth/") &&
    expectedIdentity &&
    actualIdentity &&
    actualIdentity !== expectedIdentity
  ) {
    window.dispatchEvent(new Event("medialyze-session-expired"));
    throw new DOMException("Identity changed", "AbortError");
  }
  if (response.status === 401 && !path.includes("/auth/"))
    window.dispatchEvent(new Event("medialyze-session-expired"));
  const guard =
    <T>(reader: () => Promise<T>) =>
    async () => {
      const value = await reader();
      if (current !== generation)
        throw new DOMException("Identity changed", "AbortError");
      return value;
    };
  response.json = guard(response.json.bind(response));
  response.text = guard(response.text.bind(response));
  response.blob = guard(response.blob.bind(response));
  response.arrayBuffer = guard(response.arrayBuffer.bind(response));
  return response;
}
export async function accessRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await sessionFetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const result = response.status === 204 ? undefined : await response.json();
  if (!response.ok)
    throw new Error(
      typeof result?.detail === "string" ? result.detail : "Request failed",
    );
  return result as T;
}
