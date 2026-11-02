import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationSettingsPanel } from "./NotificationSettingsPanel";
import * as appData from "../lib/app-data";
import * as auth from "../lib/auth";
import * as notifications from "../lib/notifications";
import { api, type AppSettings } from "../lib/api";
import { DEFAULT_NOTIFICATION_SETTINGS } from "../lib/notification-settings";
import { selectPreferenceIdentity } from "../lib/preference-storage";
import i18n from "../i18n";

const initial = { ...DEFAULT_NOTIFICATION_SETTINGS };
const updated = { ...initial, palette: "contrast" as const, duration_seconds: 9 };

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.spyOn(appData, "useAppData").mockReturnValue({
    appSettings: { ui_preferences: { notifications: initial } } as AppSettings,
    appSettingsLoaded: true,
    setAppSettings: vi.fn(),
  } as unknown as ReturnType<typeof appData.useAppData>);
  vi.spyOn(notifications, "useNotifications").mockReturnValue({ notify: vi.fn(), clearAll: vi.fn() } as unknown as ReturnType<typeof notifications.useNotifications>);
});

afterEach(() => {
  cleanup();
  selectPreferenceIdentity(null);
  localStorage.clear();
  vi.restoreAllMocks();
});

function renderPanel(kind: "account" | "guest") {
  vi.spyOn(auth, "useAuth").mockReturnValue({
    identity: { id: kind, username: kind, kind, owner: false, revision: 1,
      must_change_password: false, policy: auth.emptyPolicy() },
    status: null, refresh: async () => {}, logout: async () => {}, has: () => false,
  });
  selectPreferenceIdentity(kind === "guest" ? "guest" : "account:test");
  render(<MemoryRouter><NotificationSettingsPanel /></MemoryRouter>);
}

it("saves only changed fields and adopts the server's merged settings", async () => {
  const response = { ui_preferences: { notifications: updated } } as AppSettings;
  const save = vi.spyOn(api, "updateAppSettings").mockResolvedValue(response);
  const setAppSettings = vi.mocked(appData.useAppData()).setAppSettings;
  renderPanel("account");
  fireEvent.change(screen.getByLabelText("Display duration"), { target: { value: "9" } });
  await waitFor(() => expect(save).toHaveBeenCalledWith({ ui_preferences: { notifications: { duration_seconds: 9 } } }));
  expect(setAppSettings).toHaveBeenCalledWith(response);
});

it("merges Guest changes with settings another tab saved after mounting", async () => {
  renderPanel("guest");
  localStorage.setItem("medialyze-identity:guest:medialyze-notifications", JSON.stringify({ ...initial, palette: "contrast" }));
  fireEvent.change(screen.getByLabelText("Display duration"), { target: { value: "9" } });
  await waitFor(() => expect(JSON.parse(localStorage.getItem("medialyze-identity:guest:medialyze-notifications")!)).toEqual(updated));
});
