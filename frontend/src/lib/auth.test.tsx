import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { HeaderAccountMenu } from "../components/HeaderAccountMenu";
import { PersonalAccountPanel } from "../components/AccountsPanel";
import * as notifications from "./notifications";
import { ThemeProvider } from "./theme";
import * as passkeys from "./passkeys";
import { AuthProvider, emptyPolicy, useAuth } from "./auth";
import { clearIdentityRequests, setExpectedIdentity } from "./access-session";
import { preferenceStorage, selectPreferenceIdentity } from "./preference-storage";
const identity = {
  id: "user-id",
  kind: "account",
  username: "Alex",
  owner: false,
  revision: 1,
  policy: emptyPolicy(),
  must_change_password: false,
};
const status = (value: unknown = identity) => ({
  identity: value,
  csrf: "csrf",
  guest_enabled: true,
  setup_required: false,
  permissions: [],
  library_permissions: [],
});
const json = (value: unknown, code = 200) =>
  new Response(JSON.stringify(value), {
    status: code,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(async () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  setExpectedIdentity("");
  selectPreferenceIdentity(null);
  clearIdentityRequests();
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  selectPreferenceIdentity(null);
  localStorage.clear();
});
function renderAuth(children: ReactNode, path = "/") {
  return render(<MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>);
}
const guest = { ...identity, id: "guest-id", username: "", kind: "guest" };
function SessionView() {
  const { identity: current, logout, has } = useAuth();
  const location = useLocation();
  return <>
    <p>Session: {current?.kind}</p>
    <p>Page: {location.pathname}{location.search}{location.hash}</p>
    <p>Dashboard allowed: {String(has("overview.dashboard"))}</p>
    <HeaderAccountMenu username={current?.username ?? ""} owner={current?.owner ?? false} kind={current?.kind === "guest" ? "guest" : "account"} onSignOut={logout} />
  </>;
}
describe("Authentication gate", () => {
  it.each(["account", "desktop"])("hydrates and partially saves %s preferences without overwriting another editor", async (kind) => {
    const current = { ...identity, kind, id: kind === "desktop" ? "desktop" : identity.id };
    const original = { palette: "contrast", style: "tint", duration_seconds: 9, grouping: "type" };
    const latest = { ...original, duration_seconds: 6 };
    let saved = { storage: {} as Record<string, string>, ui_preferences: {
      interface_language: "en", color_theme: "dark", notifications: original,
    } };
    const patches: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/auth/status")) return json(status(current));
      if (init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body));
        patches.push(patch);
        saved = { ...saved, ...patch, ui_preferences: { ...saved.ui_preferences, ...patch.ui_preferences } };
      }
      return json(saved);
    });
    const mounted = renderAuth(<AuthProvider><div>Preferences ready</div></AuthProvider>);
    await screen.findByText("Preferences ready");
    expect(preferenceStorage.getItem("medialyze-theme")).toBe("dark");
    // The Notification editor saved newer values after hydration.
    saved.ui_preferences.notifications = latest;
    act(() => preferenceStorage.setItem("medialyze-settings-active-panel", "logs"));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({ storage: { "medialyze-settings-active-panel": "logs" }, ui_preferences: { color_theme: "dark" } });
    expect(patches[0].ui_preferences).not.toHaveProperty("notifications");
    expect(saved.ui_preferences.notifications).toEqual(latest);
    mounted.unmount();
    // A fresh browser/Electron session has no local mirror to fall back to.
    localStorage.clear();
    selectPreferenceIdentity(null);
    renderAuth(<AuthProvider><div>Restored preferences</div></AuthProvider>);
    await screen.findByText("Restored preferences");
    expect(preferenceStorage.getItem("medialyze-settings-active-panel")).toBe("logs");
    expect(preferenceStorage.getItem("medialyze-theme")).toBe("dark");
  });

  it("lands on sign-in with a safe warning when status fails after a confirmed credential change", async () => {
    let current: typeof identity | null = { ...identity, owner: true };
    let failStatus = false;
    const notify = vi.fn();
    vi.spyOn(notifications, "useNotifications").mockReturnValue({ notify, dismiss: vi.fn(), clearAll: vi.fn(), retryHistory: vi.fn(), historyRevision: 0, historyWriteFailed: false });
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
      if (String(path).endsWith("/auth/status")) return failStatus ? json({ detail: "private status error" }, 500) : json(status(current));
      if (String(path).endsWith("/me/passkeys")) return json({ enabled: false, items: [] });
      if (String(path).endsWith("/auth/password") && init?.method === "POST") { current = null; failStatus = true; return json({}); }
      if (String(path).endsWith("/auth/login")) { current = identity; return json({}); }
      return json({ storage: {}, ui_preferences: {} });
    });
    renderAuth(<AuthProvider><ThemeProvider><div>Protected account content</div><PersonalAccountPanel /></ThemeProvider></AuthProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Change password" }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "private password" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "NewPassword1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const warning = "Change saved, but the session could not be refreshed. Please sign in again.";
    expect(await screen.findByRole("status")).toHaveTextContent(warning);
    expect(screen.queryByText("Protected account content")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveValue("");
    expect(document.body).not.toHaveTextContent("private status error");
    expect(notify).not.toHaveBeenCalled();
    failStatus = false;
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(warning));
    expect(fetch.mock.calls.some(([path]) => String(path).endsWith("/auth/guest"))).toBe(false);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new password" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    expect(await screen.findByText("Protected account content")).toBeInTheDocument();
    expect(screen.queryByText(warning)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("private status error");
  });
  it("shows the confirmed credential acknowledgement once after the authenticated subtree unmounts", async () => {
    let current: typeof identity | null = identity;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
      if (String(path).endsWith("/auth/status")) return json(status(current));
      if (String(path).endsWith("/auth/login")) { current = identity; return json({}); }
      return json({ storage: {}, ui_preferences: {} });
    });
    function Private() {
      const { refreshAfterCredentialChange } = useAuth();
      return <button onClick={() => { current = null; void refreshAfterCredentialChange!(); }}>Confirm credential mutation</button>;
    }
    renderAuth(<AuthProvider><Private /></AuthProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm credential mutation" }));
    expect(await screen.findByText("Change saved – please sign in again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm credential mutation" })).not.toBeInTheDocument();
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByText("Change saved – please sign in again.")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    await screen.findByRole("button", { name: "Confirm credential mutation" });
    expect(screen.queryByText("Change saved – please sign in again.")).not.toBeInTheDocument();
  });
  it("shows a safe inline error when forced-password sign out fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
      if (String(path).endsWith("/auth/status")) return json(status({ ...identity, must_change_password: true }));
      if (String(path).endsWith("/auth/logout")) return json({ detail: "private error" }, 500);
      return json({});
    });
    renderAuth(<AuthProvider><div>Private</div></AuthProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign out.");
    expect(screen.queryByText(/private error/)).not.toBeInTheDocument();
  });
  it.each(["account", "desktop"] as const)("keeps %s hydration silent and serializes partial preference writes without resending notification settings", async (kind) => {
    let release!: (value: Response) => void;
    let server: Record<string, unknown> = { storage: {}, ui_preferences: { notifications: { duration: 10 } }, extra: "kept" };
    const patches: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (path, init) => {
      if (String(path).endsWith("/auth/status")) return json(status({ ...identity, kind, id: kind === "desktop" ? "desktop" : identity.id }));
      if (init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body)); patches.push(payload);
        if (patches.length === 1) return new Promise<Response>((resolve) => { release = (response) => { server = payload; resolve(response); }; });
        server = payload; return json(payload);
      }
      return json(server);
    });
    const changed = vi.fn(); window.addEventListener("medialyze-preferences-changed", changed);
    renderAuth(<AuthProvider><div>Private view</div></AuthProvider>);
    await screen.findByText("Private view");
    expect(changed).not.toHaveBeenCalled();
    act(() => preferenceStorage.setItem("medialyze-theme", "dark"));
    await waitFor(() => expect(patches).toHaveLength(1), { timeout: 2000 });
    act(() => preferenceStorage.setItem("medialyze-theme", "light"));
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(patches).toHaveLength(1);
    await act(async () => release(json(patches[0])));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toMatchObject({ storage: { "medialyze-theme": "light" }, ui_preferences: { color_theme: "light" } });
    expect(patches[1].ui_preferences).not.toHaveProperty("notifications");
    expect(patches[1]).not.toHaveProperty("extra");
    window.removeEventListener("medialyze-preferences-changed", changed);
  });
  it("explains setup password requirements and rejects short passwords before sending", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json({ ...status(null), setup_required: true }));
    renderAuth(
      <AuthProvider>
        <div>Private view</div>
      </AuthProvider>,
    );
    const input = await screen.findByLabelText("Password");
    expect(screen.getByRole("banner")).toHaveTextContent("MediaLyze");
    expect(screen.getByText(/Since version 0.20/)).toBeInTheDocument();
    expect(screen.getByText("Existing installations are carried over automatically.")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "At least 5 characters and at least one number or special character.",
      ),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "fixture-owner" },
    });
    fireEvent.change(input, { target: { value: "abcd" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "At least 5 characters",
    );
    expect(fetch.mock.calls).toHaveLength(1);
    expect(screen.queryByText("Private view")).not.toBeInTheDocument();
  });
  it("does not mount data views before account preferences have loaded", async () => {
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (path) =>
      String(path).endsWith("/auth/status")
        ? json(status())
        : new Promise((r) => {
            resolve = r;
          }),
    );
    renderAuth(
      <AuthProvider>
        <div>Private view</div>
      </AuthProvider>,
    );
    await waitFor(() => expect(resolve).toBeDefined());
    expect(screen.queryByText("Private view")).not.toBeInTheDocument();
    await act(async () => resolve(json({ storage: {} })));
    expect(await screen.findByText("Private view")).toBeInTheDocument();
  });
  it("does not skip failed preference hydration when retrying", async () => {
    let attempts = 0;
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
      if (String(path).endsWith("/auth/status")) return json(status());
      attempts += 1;
      if (attempts === 1) return json({ detail: "failed" }, 503);
      return new Promise((r) => {
        resolve = r;
      });
    });
    renderAuth(
      <AuthProvider>
        <div>Private view</div>
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(attempts).toBe(2));
    expect(screen.queryByText("Private view")).not.toBeInTheDocument();
    await act(async () => resolve(json({ storage: {} })));
    expect(await screen.findByText("Private view")).toBeInTheDocument();
  });
  it.each(["first visit", "expiry", "sign out"])("enters enabled guest access on %s with only Guest permissions", async (entry) => {
    let current: unknown = entry === "first visit" ? null : identity;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
      if (String(path).endsWith("/auth/status")) return json(status(current));
      if (String(path).endsWith("/auth/logout")) current = null;
      if (String(path).endsWith("/auth/guest")) current = guest;
      return json({});
    });
    renderAuth(<AuthProvider><SessionView /></AuthProvider>);
    if (entry !== "first visit") {
      expect(await screen.findByText("Session: account")).toBeInTheDocument();
      if (entry === "expiry") {
        current = null;
        act(() => window.dispatchEvent(new Event("medialyze-session-expired")));
      } else {
        fireEvent.click(screen.getByRole("button", { name: "Account menu for Alex" }));
        fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
      }
    }
    expect(await screen.findByText("Session: guest")).toBeInTheDocument();
    expect(screen.getByText("Dashboard allowed: false")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Login" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.filter(([path]) => String(path).endsWith("/auth/guest"))).toHaveLength(1);
  });
  it("keeps login available from the guest menu, including after a failed login, and returns to the originating page", async () => {
    let current: unknown = guest;
    let failLogin = true;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (path) => {
      if (String(path).endsWith("/auth/status")) return json(status(current));
      if (String(path).endsWith("/auth/login")) {
        if (failLogin) return json({ detail: "Invalid credentials" }, 401);
        current = identity;
      }
      return json({});
    });
    renderAuth(<AuthProvider><SessionView /></AuthProvider>, "/libraries/42?view=files#results");
    fireEvent.click(await screen.findByRole("button", { name: "Account menu for Guest" }));
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Login" }));
    expect(await screen.findByRole("main", { name: "Login" })).toBeInTheDocument();
    expect(screen.queryByText(/Since version 0.20/)).not.toBeInTheDocument();
    expect(screen.queryByText("Existing installations are carried over automatically.")).not.toBeInTheDocument();
    expect(screen.getByRole("main").querySelector("p, h1, h2")).toBeNull();
    const statusRequests = fetch.mock.calls.length;
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(statusRequests));
    expect(screen.getByRole("main", { name: "Login" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    failLogin = false;
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    expect(await screen.findByText("Session: account")).toBeInTheDocument();
    expect(screen.getByText("Page: /libraries/42?view=files#results")).toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => String(path).endsWith("/auth/guest"))).toBe(false);
  });
  it.each([
    { path: "/", initial: null, guestEnabled: false },
    { path: "/login", initial: null, guestEnabled: false },
    { path: "/login", initial: guest, guestEnabled: true },
  ])("shows the account immediately after login with a pending poll ($path, guest=$guestEnabled)", async ({ path, initial, guestEnabled }) => {
    let current: unknown = initial;
    let holdPoll = false;
    let releasePoll!: () => void;
    let loginFinished = false;
    let csrfVersion = 0;
    let issuedCsrf = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).endsWith("/auth/status")) {
        // Anonymous status responses also rotate the server's CSRF cookie.
        issuedCsrf = `csrf-${++csrfVersion}`;
        const snapshot = { ...status(current), guest_enabled: guestEnabled, csrf: issuedCsrf };
        if (holdPoll) {
          holdPoll = false;
          return new Promise<Response>((resolve) => { releasePoll = () => resolve(json(snapshot)); });
        }
        return json(snapshot);
      }
      if (String(url).endsWith("/auth/login")) {
        if (new Headers(init?.headers).get("X-CSRF-Token") !== issuedCsrf) {
          return json({ detail: "Invalid CSRF token" }, 403);
        }
        current = { ...identity, owner: true };
        loginFinished = true;
      }
      return json({ storage: {} });
    });
    renderAuth(<AuthProvider><SessionView /></AuthProvider>, path);
    await screen.findByRole("main", { name: "Login" });
    holdPoll = true;
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(releasePoll).toBeDefined());
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Login" }));
    await waitFor(() => expect(loginFinished).toBe(true));
    expect(await screen.findByText("Session: account")).toBeInTheDocument();
    await act(async () => releasePoll());
    expect(screen.getByText("Session: account")).toBeInTheDocument();
    expect(screen.getByText("Dashboard allowed: true")).toBeInTheDocument();
    expect(screen.getByText("Page: /")).toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "Login" })).not.toBeInTheDocument();
  });
  it("allows a Guest to leave login without creating another guest session", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(status(guest)));
    renderAuth(<AuthProvider><SessionView /></AuthProvider>, "/login");
    fireEvent.click(await screen.findByRole("button", { name: "Continue as guest" }));
    expect(await screen.findByText("Session: guest")).toBeInTheDocument();
    expect(screen.getByText("Page: /")).toBeInTheDocument();
    expect(fetch.mock.calls).toHaveLength(1);
  });
  it.each(["/", "/login"])("shows login when Guest is disabled at %s", async (path) => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ...status(null), guest_enabled: false }));
    renderAuth(<AuthProvider><SessionView /></AuthProvider>, path);
    expect(await screen.findByRole("main", { name: "Login" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue as guest" })).not.toBeInTheDocument();
    expect(fetch.mock.calls).toHaveLength(1);
  });
  it("does not enter Guest automatically on a direct login visit", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(status(null)));
    renderAuth(<AuthProvider><SessionView /></AuthProvider>, "/login");
    expect(await screen.findByRole("main", { name: "Login" })).toBeInTheDocument();
    expect(fetch.mock.calls).toHaveLength(1);
  });
  it("opens the application after passkey login without submitting a password", async () => {
    let current: unknown = null;
    vi.spyOn(passkeys, "supportsPasskeys").mockReturnValue(true);
    let complete!: () => void;
    const authenticate = vi.spyOn(passkeys, "authenticatePasskey").mockImplementation(() => new Promise((resolve) => {
      complete = () => { current = identity; resolve(); };
    }));
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => json(String(url).endsWith("/auth/status")
      ? { ...status(current), passkeys: { enabled: true, reason: "ready" } } : { storage: {} }));
    renderAuth(<AuthProvider><SessionView /></AuthProvider>, "/login");
    fireEvent.click(await screen.findByRole("button", { name: "Login with passkey" }));
    await waitFor(() => expect(complete).toBeDefined());
    const beforeFocus = fetch.mock.calls.length;
    fireEvent(window, new Event("focus"));
    expect(fetch.mock.calls).toHaveLength(beforeFocus);
    await act(async () => complete());
    expect(await screen.findByText("Session: account")).toBeInTheDocument();
    expect(authenticate).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.some(([path]) => String(path).endsWith("/auth/login"))).toBe(false);
  });
  it("only exposes the forced password form for a temporary-password session", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        json(status({ ...identity, must_change_password: true })),
      );
    renderAuth(
      <AuthProvider>
        <div>Private view</div>
      </AuthProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Change password" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Private view")).not.toBeInTheDocument();
    expect(fetch.mock.calls).toHaveLength(1);
  });
});
