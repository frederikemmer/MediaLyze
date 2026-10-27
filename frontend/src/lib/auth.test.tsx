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
import { AuthProvider, emptyPolicy } from "./auth";
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
describe("Authentication gate", () => {
  it("explains setup password requirements and rejects short passwords before sending", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(json({ ...status(null), setup_required: true }));
    render(
      <AuthProvider>
        <div>Private view</div>
      </AuthProvider>,
    );
    const input = await screen.findByLabelText("Password");
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
    render(
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
    render(
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
  it("returns to login after expiry and requires explicit guest entry", async () => {
    let current: unknown = identity;
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (path) =>
        String(path).endsWith("/auth/status")
          ? json(status(current))
          : json({}),
      );
    render(
      <AuthProvider>
        <div>Private view</div>
      </AuthProvider>,
    );
    expect(await screen.findByText("Private view")).toBeInTheDocument();
    current = null;
    act(() => window.dispatchEvent(new Event("medialyze-session-expired")));
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue as guest" }),
    ).toBeInTheDocument();
    expect(
      fetch.mock.calls.some(([path]) => String(path).endsWith("/auth/guest")),
    ).toBe(false);
    expect(screen.queryByText("Private view")).not.toBeInTheDocument();
  });
  it("only exposes the forced password form for a temporary-password session", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        json(status({ ...identity, must_change_password: true })),
      );
    render(
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
