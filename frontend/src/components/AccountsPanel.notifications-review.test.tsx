import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { AccountsPanel, PersonalAccountPanel } from "./AccountsPanel";
import * as authModule from "../lib/auth";
import * as accessApi from "../lib/access-session";
import * as notifications from "../lib/notifications";
import { emptyPolicy, type Identity } from "../lib/auth";
import i18n from "../i18n";
import { NotificationProvider } from "../lib/notifications";
import * as apiModule from "../lib/api";
import * as appDataModule from "../lib/app-data";
import * as themeModule from "../lib/theme";
import { MemoryRouter } from "react-router";
import { clearIdentityRequests } from "../lib/access-session";

const notify = vi.fn();
const owner: Identity = {
  id: "review-owner",
  kind: "account",
  username: "ReviewOwner",
  owner: true,
  revision: 1,
  must_change_password: false,
  policy: emptyPolicy(),
};
const restricted: Identity = {
  ...owner,
  id: "review-account",
  username: "ReviewAccount",
  owner: false,
};
const account = {
  id: "review-account",
  username: "ReviewAccount",
  owner: false,
  active: true,
  editable: true,
  policy: emptyPolicy(),
  must_change_password: false,
};
const libraries = [{ id: 1, name: "Test library", actions: ["library.read"] }];

function mockNotifications() {
  vi.spyOn(notifications, "useNotifications").mockReturnValue({
    notify,
    dismiss: vi.fn(),
    clearAll: vi.fn(),
    retryHistory: vi.fn(),
    historyRevision: 0,
    historyWriteFailed: false,
  });
}

function mockAuth(identity: Identity = owner, refresh = vi.fn()) {
  vi.spyOn(authModule, "useAuth").mockReturnValue({
    identity,
    status: null,
    has: () => true,
    refresh,
    refreshAfterCredentialChange: refresh,
    logout: vi.fn(),
  });
}

function loadResponses(path: string) {
  if (path === "/users") return [account];
  if (path === "/access/libraries") return libraries;
  if (path === "/access/guest") return { enabled: false, policy: emptyPolicy(), editable: true };
  return undefined;
}

describe("AccountsPanel notification review", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    mockNotifications();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    notify.mockClear();
    window.history.replaceState(null, "", "/");
  });

  it("sends a safe create toast only after the account POST succeeds", async () => {
    mockAuth();
    const request = vi.spyOn(accessApi, "accessRequest").mockImplementation(async (path, init) => {
      if (!init?.method) return loadResponses(path);
      if (path === "/users" && init.method === "POST") {
        return { ...account, id: "created-id", username: "NewReview", must_change_password: true };
      }
      throw new Error("private server response containing ReviewOnlySecret!");
    });
    render(<AccountsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Add account" }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "NewReview" } });
    fireEvent.change(screen.getByLabelText("Temporary password"), { target: { value: "ReviewOnlySecret1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "success",
      message: "Account created.",
      topicKey: "accounts:new",
      source: { area: "settings", href: "/settings?section=accounts", label: "Users & access" },
    })));
    expect(request).toHaveBeenCalledWith("/users", expect.objectContaining({ method: "POST" }));
    expect(JSON.stringify(notify.mock.calls)).not.toContain("NewReview");
    expect(JSON.stringify(notify.mock.calls)).not.toContain("ReviewOnlySecret");
  });

  it("reports a failed account save with a safe error and retains the editable draft", async () => {
    mockAuth();
    vi.spyOn(accessApi, "accessRequest").mockImplementation(async (path, init) => {
      if (!init?.method) return loadResponses(path);
      throw new Error("private backend response: ReviewOnlySecret!");
    });
    render(<AccountsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /ReviewAccount/ }));
    fireEvent.click(screen.getByLabelText("Active: ReviewAccount"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "error",
      message: "Could not save account changes.",
      topicKey: "accounts:review-account",
    })));
    expect(screen.getByLabelText("Active: ReviewAccount")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(JSON.stringify(notify.mock.calls)).not.toContain("ReviewOnlySecret");
  });

  it("reports confirmed Guest policy and activation saves to the Guest account topic", async () => {
    mockAuth();
    const request = vi.spyOn(accessApi, "accessRequest").mockImplementation(async (path, init) => {
      if (!init?.method) return loadResponses(path);
      if (path === "/access/guest" && init.method === "PUT") {
        return { enabled: true, policy: JSON.parse(String(init.body)).policy, editable: true };
      }
      throw new Error("private backend response");
    });
    render(<AccountsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Guest" }));
    fireEvent.click(screen.getByLabelText("Active: Guest"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "success",
      message: "Guest access saved.",
      topicKey: "accounts:guest",
      source: expect.objectContaining({ href: "/settings?section=accounts" }),
    })));
    expect(request).toHaveBeenCalledWith("/access/guest", expect.objectContaining({ method: "PUT" }));
  });

  it("reports delete success and error separately, with no raw backend detail", async () => {
    mockAuth();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let failDelete = false;
    const request = vi.spyOn(accessApi, "accessRequest").mockImplementation(async (path, init) => {
      if (!init?.method) return loadResponses(path);
      if (init.method === "DELETE" && failDelete) throw new Error("ReviewOnlySecret backend diagnostic");
      return undefined;
    });
    const { rerender } = render(<AccountsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /ReviewAccount/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "success", message: "Account deleted.", topicKey: "accounts:review-account",
    })));
    expect(request).toHaveBeenCalledWith("/users/review-account", expect.objectContaining({ method: "DELETE" }));

    notify.mockClear();
    failDelete = true;
    rerender(<AccountsPanel key="retry" />);
    fireEvent.click(await screen.findByRole("button", { name: /ReviewAccount/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "error", message: "Could not delete the account.", topicKey: "accounts:review-account",
    })));
    expect(JSON.stringify(notify.mock.calls)).not.toContain("ReviewOnlySecret");
  });

  it("keeps password-change feedback generic across refresh failure", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("ReviewOnlySecret refresh detail"));
    mockAuth(restricted, refresh);
    const request = vi.spyOn(accessApi, "accessRequest").mockImplementation(async (path) =>
      path === "/me/passkeys" ? { enabled: false, items: [] } : undefined,
    );
    const { rerender } = render(<PersonalAccountPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "Current1!" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "NextPassword2!" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "warning", message: "Changes were saved, but the account could not be refreshed." })));
    expect(request).toHaveBeenCalledWith("/auth/password", expect.objectContaining({ method: "POST" }));
    expect(JSON.stringify(notify.mock.calls)).not.toContain("Current1!");
    expect(JSON.stringify(notify.mock.calls)).not.toContain("NextPassword2!");
    expect(JSON.stringify(notify.mock.calls)).not.toContain("ReviewOnlySecret");

    rerender(<PersonalAccountPanel />);
  });

  it("does not write a success toast across an identity revision boundary", async () => {
    vi.mocked(notifications.useNotifications).mockRestore();
    let currentIdentity = owner;
    let refresh = async () => {};
    vi.spyOn(authModule, "useAuth").mockImplementation(() => ({
      identity: currentIdentity,
      status: null,
      has: () => true,
      refresh,
      refreshAfterCredentialChange: refresh,
      logout: vi.fn(),
    }));
    vi.spyOn(themeModule, "useTheme").mockReturnValue({
      preference: "system",
      setPreference: vi.fn(),
      theme: "light",
    } as ReturnType<typeof themeModule.useTheme>);
    vi.spyOn(appDataModule, "useAppData").mockReturnValue({
      appSettings: { ui_preferences: { notifications: { duration_seconds: 5 } } },
    } as ReturnType<typeof appDataModule.useAppData>);
    const historyWrite = vi.spyOn(apiModule.api, "recordNotification").mockImplementation(async () => undefined);
    vi.spyOn(accessApi, "accessRequest").mockImplementation(async (path) =>
      path === "/me/passkeys" ? { enabled: false, items: [] } : undefined,
    );

    function IdentityBoundary() {
      const [revision, setRevision] = useState(1);
      currentIdentity = { ...owner, revision };
      refresh = async () => {
        clearIdentityRequests();
        setRevision((value) => value + 1);
      };
      return (
        <MemoryRouter>
          <output data-testid="identity-revision">{revision}</output>
          <div key={`${currentIdentity.kind}:${currentIdentity.id}:${currentIdentity.revision}`}>
            <NotificationProvider>
              <PersonalAccountPanel />
            </NotificationProvider>
          </div>
        </MemoryRouter>
      );
    }

    render(<IdentityBoundary />);

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "Current1!" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "NewPassword1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByTestId("identity-revision")).toHaveTextContent("2"));
    expect(historyWrite).not.toHaveBeenCalled();
    expect(screen.queryByText("Username saved.")).not.toBeInTheDocument();
  });
});
