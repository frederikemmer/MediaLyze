import "../i18n";

import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type JellyfinConnection, type JellyfinSyncStatus } from "../lib/api";
import { JellyfinSettingsPanel } from "./JellyfinSettingsPanel";

const CONNECTION: JellyfinConnection = {
  base_url: "http://jellyfin:8096",
  enabled: true,
  sync_interval_minutes: 60,
  api_key_configured: true,
  server_name: "Jellyfin",
  server_version: "10.11",
  last_status: "running",
  last_error: null,
  last_sync_started_at: "2026-07-15T10:00:00Z",
  last_sync_finished_at: null,
  last_successful_sync_at: null,
  next_scheduled_sync_at: null,
};

const STATUS: JellyfinSyncStatus = {
  ...CONNECTION,
  sync_job_id: 41,
  sync_job_status: "running",
  sync_trigger_source: "manual",
  sync_job_active: true,
  sync_job_error: null,
  sync_summary: {},
  sync_phase: "items",
  sync_phase_detail: null,
  sync_current: 0,
  sync_total: null,
  sync_progress_tracks: [
    { id: "user-1", label: "Alice", current: 250, total: 1000, status: "running" },
    { id: "user-2", label: "Bob", current: 600, total: 1000, status: "running" },
  ],
  item_count: 900,
  matched_item_count: 700,
  unmatched_item_count: 200,
  library_count: 2,
  user_count: 1,
};

function idleSyncStatus(connection: JellyfinConnection): JellyfinSyncStatus {
  return {
    ...STATUS,
    ...connection,
    sync_job_id: 40,
    sync_job_status: "completed",
    sync_trigger_source: "scheduled",
    sync_job_active: false,
    sync_summary: { status: "success" },
    sync_phase: null,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(api, "jellyfinLibraries").mockResolvedValue([]);
});

function renderPanel(props: ComponentProps<typeof JellyfinSettingsPanel> = {}) {
  return render(
    <MemoryRouter>
      <JellyfinSettingsPanel {...props} />
    </MemoryRouter>,
  );
}

describe("JellyfinSettingsPanel", () => {
  it("shows only connection, synchronization, and playback-user settings", async () => {
    vi.spyOn(api, "jellyfinSyncStatus").mockResolvedValue(STATUS);
    vi.spyOn(api, "jellyfinUsers").mockResolvedValue([]);

    renderPanel();

    expect(await screen.findByText("Fetching Jellyfin items")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connection" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Playback users" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Path mappings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Jellyfin libraries" })).not.toBeInTheDocument();
    const progressbars = screen.getAllByRole("progressbar");
    expect(progressbars).toHaveLength(2);
    expect(progressbars[0]).toHaveAttribute("aria-valuenow", "25");
    expect(progressbars[1]).toHaveAttribute("aria-valuenow", "60");
  });

  it("queues synchronization, reports completion, and refreshes the external catalog", async () => {
    const idleConnection = { ...CONNECTION, last_status: "success" };
    const idleStatus = idleSyncStatus(idleConnection);
    const queuedStatus = { ...idleStatus, sync_job_id: 42, sync_job_status: "queued", sync_job_active: true, sync_summary: {} } as JellyfinSyncStatus;
    const completedStatus = { ...idleStatus, sync_job_id: 42, sync_job_status: "completed", sync_job_active: false, sync_summary: { status: "success", items_synced: 120, libraries_synced: 3 } } as JellyfinSyncStatus;
    vi.spyOn(api, "jellyfinSyncStatus")
      .mockResolvedValueOnce(idleStatus)
      .mockResolvedValueOnce(queuedStatus)
      .mockResolvedValue(completedStatus);
    vi.spyOn(api, "jellyfinUsers").mockResolvedValue([]);
    vi.spyOn(api, "syncJellyfin").mockResolvedValue({ job_id: 42, status: "queued", trigger_source: "manual", accepted: true });
    const onCatalogChanged = vi.fn();

    renderPanel({ onCatalogChanged });
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));

    expect(await screen.findByText("Synchronized 120 items from 3 libraries.", {}, { timeout: 2500 })).toBeInTheDocument();
    expect(onCatalogChanged).toHaveBeenCalledTimes(1);
  });

  it("requests cancellation for a running synchronization", async () => {
    vi.spyOn(api, "jellyfinSyncStatus").mockResolvedValue(STATUS);
    vi.spyOn(api, "jellyfinUsers").mockResolvedValue([]);
    const cancelSync = vi.spyOn(api, "cancelJellyfinSync").mockResolvedValue({ job_id: 41, status: "running", cancellation_requested: true });

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel sync" }));

    await waitFor(() => expect(cancelSync).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/cancellation requested/i)).toBeInTheDocument();
  });

  it("leaves the canceling state and unlocks settings after cancellation completes", async () => {
    const canceledStatus = {
      ...STATUS,
      last_status: "canceled",
      last_sync_finished_at: "2026-07-15T10:01:00Z",
      sync_job_status: "canceled",
      sync_job_active: false,
      sync_summary: { status: "canceled" },
      cancellation_requested: true,
    } as JellyfinSyncStatus;
    let cancellationRequested = false;
    vi.spyOn(api, "jellyfinSyncStatus").mockImplementation(
      async () => cancellationRequested ? canceledStatus : STATUS,
    );
    vi.spyOn(api, "jellyfinUsers").mockResolvedValue([]);
    vi.spyOn(api, "cancelJellyfinSync").mockImplementation(async () => {
      cancellationRequested = true;
      return { job_id: 41, status: "running", cancellation_requested: true };
    });

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel sync" }));

    expect(await screen.findByText("Jellyfin synchronization was canceled.", {}, { timeout: 2500 })).toBeInTheDocument();
    expect(screen.queryByText("Canceling synchronization")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeEnabled();
  });

  it("uses zero minutes to disable only scheduled synchronization", async () => {
    const idleConnection = { ...CONNECTION, last_status: "success" };
    vi.spyOn(api, "jellyfinSyncStatus").mockResolvedValue(idleSyncStatus(idleConnection));
    vi.spyOn(api, "jellyfinUsers").mockResolvedValue([]);
    const updateConnection = vi.spyOn(api, "updateJellyfinConnection").mockResolvedValue({ ...idleConnection, sync_interval_minutes: 0 });

    renderPanel();
    const interval = await screen.findByRole("spinbutton", { name: "Sync interval (minutes)" });
    fireEvent.change(interval, { target: { value: "0" } });

    await waitFor(() => expect(updateConnection).toHaveBeenCalledWith(expect.objectContaining({ sync_interval_minutes: 0 })), { timeout: 2000 });
    expect(screen.queryByText("Saved automatically")).not.toBeInTheDocument();
  });

  it("keeps connection and user settings visible when a connection action fails", async () => {
    const idleConnection = { ...CONNECTION, last_status: "success" };
    vi.spyOn(api, "jellyfinSyncStatus").mockResolvedValue(idleSyncStatus(idleConnection));
    vi.spyOn(api, "jellyfinUsers").mockResolvedValue([]);
    vi.spyOn(api, "testJellyfinConnection").mockResolvedValue({ ok: false, server_name: null, server_version: null, error: "Invalid Jellyfin URL" });

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Test connection" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid Jellyfin URL");
    expect(screen.getByRole("heading", { name: "Playback users" })).toBeInTheDocument();
  });

  it("keeps activation explicit and can remove the connection", async () => {
    const idleConnection = { ...CONNECTION, last_status: "success" };
    vi.spyOn(api, "jellyfinSyncStatus").mockResolvedValue(idleSyncStatus(idleConnection));
    vi.spyOn(api, "jellyfinUsers").mockResolvedValue([]);
    const updateConnection = vi.spyOn(api, "updateJellyfinConnection").mockResolvedValue({ ...idleConnection, enabled: false });
    const disconnect = vi.spyOn(api, "disconnectJellyfin").mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Disable integration" }));
    await waitFor(() => expect(updateConnection).toHaveBeenCalledWith({ enabled: false }));

    fireEvent.click(screen.getByRole("button", { name: "Remove connection" }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(await screen.findByText(/connection and its cached data were removed/i)).toBeInTheDocument();
  });

  it("separates catalog freshness from local file matching and links zero matches to mapping settings", async () => {
    const idleConnection = {
      ...CONNECTION,
      last_status: "success",
      last_successful_sync_at: "2026-07-15T10:00:00Z",
    };
    vi.spyOn(api, "jellyfinSyncStatus").mockResolvedValue({
      ...idleSyncStatus(idleConnection),
      item_count: 120,
      matched_item_count: 0,
      unmatched_item_count: 120,
    });
    vi.spyOn(api, "jellyfinUsers").mockResolvedValue([]);
    vi.mocked(api.jellyfinLibraries).mockResolvedValue([{
      id: 7,
      name: "Movies",
      collection_type: "movies",
      locations: ["/remote/movies"],
      mapped_locations: [],
      mapped_status: "linked",
      linked_library_id: 3,
      linked_library_name: "Movies",
      link_method: "manual",
      can_create_medialyze_library: false,
      data_scope: "linked",
      item_count: 120,
      last_synced_at: "2026-07-15T10:00:00Z",
    }]);

    renderPanel();

    expect(await screen.findByText("Catalog current")).toBeInTheDocument();
    expect(screen.getByText("0% locally matched")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open path mapping" })).toHaveAttribute(
      "href",
      "/settings?section=libraries&library=3&focus=path-mapping",
    );
  });

  it("filters and bulk-updates grouped playback users", async () => {
    const idleConnection = { ...CONNECTION, last_status: "success" };
    vi.spyOn(api, "jellyfinSyncStatus").mockResolvedValue(idleSyncStatus(idleConnection));
    vi.spyOn(api, "jellyfinUsers").mockResolvedValue([
      { jellyfin_user_id: "3", name: "Carla", enabled_for_sync: true, last_synced_at: null },
      { jellyfin_user_id: "2", name: "Bob", enabled_for_sync: false, last_synced_at: null },
      { jellyfin_user_id: "1", name: "Alice", enabled_for_sync: true, last_synced_at: null },
    ]);
    const updateUsers = vi.spyOn(api, "updateJellyfinUsers").mockImplementation(async (ids) => [
      { jellyfin_user_id: "1", name: "Alice", enabled_for_sync: ids.includes("1"), last_synced_at: null },
      { jellyfin_user_id: "2", name: "Bob", enabled_for_sync: ids.includes("2"), last_synced_at: null },
      { jellyfin_user_id: "3", name: "Carla", enabled_for_sync: ids.includes("3"), last_synced_at: null },
    ]);

    renderPanel();

    expect(await screen.findByText("2 of 3 selected")).toBeInTheDocument();
    const selectedGroup = screen.getByRole("region", { name: "Selected" });
    const unselectedGroup = screen.getByRole("region", { name: "Not selected" });
    expect(within(selectedGroup).getAllByRole("checkbox").map((checkbox) => checkbox.parentElement?.textContent?.trim()))
      .toEqual(["Alice", "Carla"]);
    expect(within(unselectedGroup).getAllByRole("checkbox").map((checkbox) => checkbox.parentElement?.textContent?.trim()))
      .toEqual(["Bob"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search playback users" }), {
      target: { value: "bob" },
    });
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select none" }));
    await waitFor(() => expect(updateUsers).toHaveBeenCalledWith([]));
    expect(await screen.findByText("0 of 3 selected")).toBeInTheDocument();
  });
});
