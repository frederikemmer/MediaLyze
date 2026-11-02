import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { api, type AppSettings } from "./api";
import { clearIdentityRequests } from "./access-session";
import { DEFAULT_NOTIFICATION_SETTINGS } from "./notification-settings";
import { NotificationProvider, useNotifications } from "./notifications";
import i18n from "../i18n";

const fixture = vi.hoisted(() => ({ settings: {} as AppSettings }));
vi.mock("./app-data", () => ({ useAppData: () => ({ appSettings: fixture.settings }) }));
vi.mock("./auth", () => ({ useAuth: () => ({ identity: null, has: () => false }) }));

function Controls() {
  const { notify, historyWriteFailed, clearAll } = useNotifications();
  const send = (preview = false) => notify({ type: "success", message: preview ? "Preview message" : "Saved message", preview,
    topicKey: "settings", source: { area: "settings", href: "/settings?section=application#notification-settings", label: "Open settings" } });
  return <>
    <button onClick={() => send()}>Send</button>
    <button onClick={() => send(true)}>Preview</button>
    <button onClick={clearAll}>Clear</button>
    <p>History failed: {String(historyWriteFailed)}</p>
  </>;
}
const tree = () => <MemoryRouter><NotificationProvider><Controls /></NotificationProvider></MemoryRouter>;
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

beforeEach(async () => {
  clearIdentityRequests();
  await i18n.changeLanguage("en");
  fixture.settings = { ui_preferences: { interface_language: "en", color_theme: "system", notifications: { ...DEFAULT_NOTIFICATION_SETTINGS } } } as AppSettings;
  vi.useFakeTimers();
  vi.spyOn(api, "recordNotification").mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Notification lifecycle", () => {
  it("saves personal messages once, excludes previews and expires individual cards", async () => {
    render(tree());
    fireEvent.click(screen.getByText("Send"));
    await advance(1000);
    fireEvent.click(screen.getByText("Preview"));
    await advance(1500);
    expect(document.querySelectorAll(".notification-card")).toHaveLength(1);
    expect(api.recordNotification).toHaveBeenCalledOnce();
    expect(api.recordNotification).toHaveBeenCalledWith(expect.objectContaining({ message: "Saved message" }));
    await advance(1000);
    expect(document.querySelectorAll(".notification-card")).toHaveLength(0);
  });

  it("pauses all timers while hovered and preserves their remaining duration", async () => {
    render(tree());
    fireEvent.click(screen.getByText("Send"));
    await advance(1000);
    const host = document.querySelector(".notification-host")!;
    fireEvent.pointerEnter(host, { pointerType: "mouse" });
    await advance(10000);
    expect(document.querySelectorAll(".notification-card")).toHaveLength(1);
    fireEvent.pointerLeave(host, { pointerType: "mouse" });
    await advance(1499);
    expect(document.querySelectorAll(".notification-card")).toHaveLength(1);
    await advance(1);
    expect(document.querySelectorAll(".notification-card")).toHaveLength(0);
  });

  it("restarts visible timers when the saved duration changes", async () => {
    const view = render(tree());
    fireEvent.click(screen.getByText("Send"));
    await advance(2000);
    fixture.settings = { ...fixture.settings, ui_preferences: { ...fixture.settings.ui_preferences!, notifications: { ...DEFAULT_NOTIFICATION_SETTINGS, duration_seconds: 4 } } };
    view.rerender(tree());
    await advance(3999);
    expect(document.querySelectorAll(".notification-card")).toHaveLength(1);
    await advance(1);
    expect(document.querySelectorAll(".notification-card")).toHaveLength(0);
  });

  it("retries failed history writes with the same event ID in the current session", async () => {
    vi.mocked(api.recordNotification).mockRejectedValueOnce(new Error("offline"));
    render(tree());
    fireEvent.click(screen.getByText("Send"));
    await advance(0);
    expect(screen.getByText("History failed: true")).toBeInTheDocument();
    fireEvent(window, new Event("online"));
    await advance(0);
    expect(api.recordNotification).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.recordNotification).mock.calls[0][0].event_id).toBe(vi.mocked(api.recordNotification).mock.calls[1][0].event_id);
    expect(screen.getByText("History failed: false")).toBeInTheDocument();
  });

  it("discards retries from an earlier identity session", async () => {
    vi.mocked(api.recordNotification).mockRejectedValueOnce(new Error("offline"));
    render(tree());
    fireEvent.click(screen.getByText("Send"));
    await advance(0);
    clearIdentityRequests();
    fireEvent(window, new Event("online"));
    await advance(0);
    expect(api.recordNotification).toHaveBeenCalledOnce();
  });

  it("pauses timers for semantic modal dialogs until they close", async () => {
    render(tree());
    fireEvent.click(screen.getByText("Send"));
    await advance(1000);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    await act(async () => { document.body.append(dialog); });
    await advance(5000);
    expect(document.querySelectorAll(".notification-card")).toHaveLength(1);
    await act(async () => { dialog.remove(); });
    await advance(1500);
    expect(document.querySelectorAll(".notification-card")).toHaveLength(0);
  });

  it("groups messages and clears visible cards without another history write", async () => {
    render(tree());
    fireEvent.click(screen.getByText("Send"));
    fireEvent.click(screen.getByText("Send"));
    await advance(0);
    expect(document.querySelectorAll(".notification-deck")).toHaveLength(1);
    expect(document.querySelectorAll(".notification-card")).toHaveLength(2);
    fireEvent.click(screen.getByText("Clear"));
    await advance(0);
    expect(document.querySelectorAll(".notification-card")).toHaveLength(0);
    expect(api.recordNotification).toHaveBeenCalledTimes(2);
  });
});
