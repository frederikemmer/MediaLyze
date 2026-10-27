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
import * as passkeys from "./passkeys";
import { AuthProvider, emptyPolicy, useAuth } from "./auth";
import { clearIdentityRequests, setExpectedIdentity } from "./access-session";
import { selectPreferenceIdentity } from "./preference-storage";
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
