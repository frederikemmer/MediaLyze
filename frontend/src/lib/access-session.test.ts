import { LruCache } from "./lru-cache";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearIdentityRequests, sessionFetch, setCsrf } from "./access-session";
import {
  preferenceSnapshot,
  preferenceStorage,
  selectPreferenceIdentity,
} from "./preference-storage";
afterEach(() => {
  vi.restoreAllMocks();
  selectPreferenceIdentity(null);
  localStorage.clear();
});
describe("Identity boundary", () => {
  it("invalidates persistent module-level LRU entries on identity/revision changes", () => {
    const cache = new LruCache<string, { secret: string }>(4);
    cache.set("library:1", { secret: "old account data" });
    clearIdentityRequests();
    expect(cache.get("library:1")).toBeUndefined();
  });
  it("rejects a response body that finishes parsing after an identity change", async () => {
    let finish!: (value: unknown) => void;
    const result = new Response("{}");
    result.json = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(result);
    const response = await sessionFetch("/api/libraries");
    const body = response.json();
    clearIdentityRequests();
    finish({ private: true });
    await expect(body).rejects.toThrow("Identity changed");
  });
  it("attaches CSRF and rejects late responses after an account change", async () => {
    let resolve!: (r: Response) => void;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    setCsrf("token");
    const response = sessionFetch("/api/users", { method: "POST" });
    expect(new Headers(spy.mock.calls[0][1]?.headers).get("X-CSRF-Token")).toBe(
      "token",
    );
    clearIdentityRequests();
    resolve(new Response("{}"));
    await expect(response).rejects.toThrow("Identity changed");
  });
  it("never imports pre-existing browser layouts into a new account", () => {
    localStorage.setItem("medialyze-theme", "dark");
    selectPreferenceIdentity("account:new", {});
    expect(preferenceStorage.getItem("medialyze-theme")).toBeNull();
    preferenceStorage.setItem("medialyze-theme", "light");
    expect(preferenceSnapshot()).toEqual({ "medialyze-theme": "light" });
    selectPreferenceIdentity("account:other", {});
    expect(preferenceStorage.getItem("medialyze-theme")).toBeNull();
    selectPreferenceIdentity("account:new");
    expect(preferenceStorage.getItem("medialyze-theme")).toBe("light");
    expect(localStorage.getItem("medialyze-theme")).toBe("dark");
  });
});
