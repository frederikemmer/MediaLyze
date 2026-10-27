import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { PasskeysPanel } from "./PasskeysPanel";
import * as auth from "../lib/auth";
import * as access from "../lib/access-session";
import * as passkeys from "../lib/passkeys";

const item: passkeys.Passkey = { id: "one", name: "MacBook", rp_id: "medialyze.test", created_at: 1793095200, last_used_at: null };
const refresh = vi.fn();
beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.spyOn(auth, "useAuth").mockReturnValue({ identity: { id: "user", kind: "account", username: "Alex", owner: false, revision: 1, must_change_password: false, policy: auth.emptyPolicy() }, status: null, has: () => false, refresh, logout: vi.fn() });
  vi.spyOn(passkeys, "supportsPasskeys").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); refresh.mockClear(); });
function open() { fireEvent.click(screen.getByRole("button", { name: "Expand Passkeys" })); }

describe("Own-account passkeys", () => {
  it("always shows a disabled panel with PUBLIC_URL setup guidance when unconfigured", async () => {
    vi.spyOn(access, "accessRequest").mockResolvedValue({ enabled: false, reason: "not_configured", items: [] });
    const { container } = render(<PasskeysPanel />);
    expect(await screen.findByRole("heading", { name: "Passkeys" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Passkey" })).toBeDisabled();
    expect(container.querySelector(".passkeys-panel")).toHaveClass("is-disabled");
    fireEvent.click(screen.getByRole("button", { name: "Passkey setup requirements" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/PUBLIC_URL.*Docker Compose/);
  });
  it("opens named registration from the header and clears the password after registration", async () => {
    vi.spyOn(access, "accessRequest").mockResolvedValue({ enabled: true, reason: "ready", items: [] });
    const register = vi.spyOn(passkeys, "registerPasskey").mockImplementation(async (_name, _password, received) => { received(); return item; });
    render(<PasskeysPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Passkey" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Passkey" }));
    expect(screen.getByRole("button", { name: "Collapse Passkeys" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Passkey name"), { target: { value: "MacBook" } });
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "secret1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create passkey" }));
    expect(await screen.findByText("MacBook")).toBeInTheDocument();
    expect(register).toHaveBeenCalledWith("MacBook", "secret1", expect.any(Function), expect.any(AbortSignal));
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  });
  it("renames only the selected passkey and preserves the draft on failure", async () => {
    const request = vi.spyOn(access, "accessRequest").mockImplementation(async (_path, init) => {
      if (!init) return { enabled: true, reason: "ready", items: [item] };
      return { ...item, name: "Laptop" };
    });
    render(<PasskeysPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Passkey" })).toBeEnabled());
    open();
    fireEvent.click(screen.getByRole("button", { name: "Rename MacBook" }));
    fireEvent.change(screen.getByLabelText("Passkey name"), { target: { value: "Laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(request).toHaveBeenLastCalledWith("/me/passkeys/one", { method: "PATCH", body: JSON.stringify({ name: "Laptop" }) });
    request.mockRejectedValueOnce(new Error("failed"));
    fireEvent.click(screen.getByRole("button", { name: "Rename Laptop" }));
    fireEvent.change(screen.getByLabelText("Passkey name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Passkey name")).toHaveValue("Renamed");
  });
  it("confirms deletion, keeps canceled deletions and refreshes the session after removal", async () => {
    const request = vi.spyOn(access, "accessRequest").mockImplementation(async (_path, init) => init ? undefined : { enabled: true, reason: "ready", items: [item] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<PasskeysPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Passkey" })).toBeEnabled());
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete MacBook" }));
    expect(screen.getByText("MacBook")).toBeInTheDocument();
    expect(request.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Delete MacBook" }));
    await waitFor(() => expect(screen.queryByText("MacBook")).not.toBeInTheDocument());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Sessions signed in with this passkey"));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("does not report canceled browser ceremonies as failures", async () => {
    vi.spyOn(access, "accessRequest").mockResolvedValue({ enabled: true, reason: "ready", items: [] });
    vi.spyOn(passkeys, "registerPasskey").mockRejectedValue(new DOMException("Canceled", "NotAllowedError"));
    render(<PasskeysPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Passkey" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Passkey" }));
    fireEvent.change(screen.getByLabelText("Passkey name"), { target: { value: "key" } });
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Create passkey" }));
    await waitFor(() => expect(screen.getByLabelText("Current password")).toHaveValue(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
