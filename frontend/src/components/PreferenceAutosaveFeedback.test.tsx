import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import "../i18n";
import * as auth from "../lib/auth";
import * as notifications from "../lib/notifications";
import { PreferenceAutosaveFeedback } from "./PreferenceAutosaveFeedback";
import { preferenceStorage, selectPreferenceIdentity } from "../lib/preference-storage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("confirms Desktop's global local preferences once on page departure", async () => {
  const notify = vi.fn();
  vi.spyOn(auth, "useAuth").mockReturnValue({ identity: { id: "desktop", kind: "desktop", owner: true } } as unknown as ReturnType<typeof auth.useAuth>);
  vi.spyOn(notifications, "useOptionalNotifications").mockReturnValue({ notify } as unknown as ReturnType<typeof notifications.useOptionalNotifications>);
  selectPreferenceIdentity(null); localStorage.clear();
  function Navigation() { const navigate = useNavigate(); return <button onClick={() => navigate("/storage-map")}>Leave</button>; }
  render(<MemoryRouter initialEntries={["/libraries/1"]}><PreferenceAutosaveFeedback /><Navigation /></MemoryRouter>);
  // The storage helper captures the actual browser route, independently of MemoryRouter.
  window.history.replaceState(null, "", "/libraries/1");
  act(() => preferenceStorage.setItem("medialyze-library-file-column-widths", '{"filename":280}'));
  await act(async () => {});
  expect(notify).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Leave"));
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", source: expect.objectContaining({ area: "library", href: "/libraries/1" }) })));
  expect(notify).toHaveBeenCalledTimes(1);
  localStorage.clear(); window.history.replaceState(null, "", "/");
});
it("waits for the original page's pending save before confirming on departure", async () => {
  const notify = vi.fn();
  vi.spyOn(auth, "useAuth").mockReturnValue({ identity: { id: "a", kind: "account" } } as ReturnType<typeof auth.useAuth>);
  vi.spyOn(notifications, "useOptionalNotifications").mockReturnValue({ notify } as unknown as ReturnType<typeof notifications.useOptionalNotifications>);
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  function Navigation() { const navigate = useNavigate(); return <button onClick={() => navigate("/storage-map")}>Leave</button>; }
  render(<MemoryRouter initialEntries={["/"]}><PreferenceAutosaveFeedback /><Navigation /></MemoryRouter>);
  act(() => window.dispatchEvent(new CustomEvent("medialyze-preference-save", { detail: { promise, pathname: "/", search: "" } })));
  fireEvent.click(screen.getByText("Leave"));
  await act(async () => { await Promise.resolve(); });
  expect(notify).not.toHaveBeenCalled();
  await act(async () => { resolve(); await promise; });
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", source: expect.objectContaining({ area: "library", href: "/" }) })));
});
it("does not report a visit without a preference change", async () => {
  const notify = vi.fn();
  vi.spyOn(auth, "useAuth").mockReturnValue({ identity: { id: "a", kind: "account" } } as ReturnType<typeof auth.useAuth>);
  vi.spyOn(notifications, "useOptionalNotifications").mockReturnValue({ notify } as unknown as ReturnType<typeof notifications.useOptionalNotifications>);
  function Navigation() { const navigate = useNavigate(); return <button onClick={() => navigate("/storage-map")}>Leave</button>; }
  render(<MemoryRouter initialEntries={["/"]}><PreferenceAutosaveFeedback /><Navigation /></MemoryRouter>);
  fireEvent.click(screen.getByText("Leave"));
  await act(async () => { await Promise.resolve(); });
  expect(notify).not.toHaveBeenCalled();
});
it("shows a safe sign-out error in the originating identity", () => {
  const notify = vi.fn();
  vi.spyOn(auth, "useAuth").mockReturnValue({ identity: { id: "a", kind: "account" } } as ReturnType<typeof auth.useAuth>);
  vi.spyOn(notifications, "useOptionalNotifications").mockReturnValue({ notify } as unknown as ReturnType<typeof notifications.useOptionalNotifications>);
  render(<MemoryRouter><PreferenceAutosaveFeedback /></MemoryRouter>);
  act(() => window.dispatchEvent(new Event("medialyze-logout-failed")));
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error", topicKey: "account:logout", source: expect.objectContaining({ href: "/settings?section=accounts&account=me" }) }));
});
it("reports a failed write immediately and never confirms it on departure", async () => {
  const notify = vi.fn();
  vi.spyOn(auth, "useAuth").mockReturnValue({ identity: { id: "a", kind: "account" } } as ReturnType<typeof auth.useAuth>);
  vi.spyOn(notifications, "useOptionalNotifications").mockReturnValue({ notify } as unknown as ReturnType<typeof notifications.useOptionalNotifications>);
  function Navigation() { const navigate = useNavigate(); return <button onClick={() => navigate("/storage-map")}>Leave</button>; }
  render(<MemoryRouter initialEntries={["/"]}><PreferenceAutosaveFeedback /><Navigation /></MemoryRouter>);
  act(() => window.dispatchEvent(new CustomEvent("medialyze-preference-save", { detail: { promise: Promise.reject(new Error("secret")), pathname: "/", search: "" } })));
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
  fireEvent.click(screen.getByText("Leave"));
  await act(async () => { await Promise.resolve(); });
  expect(notify).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(notify.mock.calls)).not.toContain("secret");
});
