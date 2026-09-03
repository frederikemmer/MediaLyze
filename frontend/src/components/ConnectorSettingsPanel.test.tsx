import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, type ConnectorConnection } from "../lib/api";
import { ConnectorSettingsPanel } from "./ConnectorSettingsPanel";

const CONNECTION: ConnectorConnection = {
  id: 7,
  provider: "jellyfin",
  name: "Living Room",
  base_url: "http://jellyfin.local",
  config: {},
  capabilities: { users: true, user_states: true, playback_events: true },
  enabled: true,
  sync_interval_minutes: 60,
  path_mapping_mode: "automatic",
  library_mapping_mode: "automatic",
  server_name: "Jellyfin",
  server_version: "10.11",
  last_status: "success",
  last_error: null,
  last_sync_started_at: null,
  last_sync_finished_at: null,
  last_successful_sync_at: null,
  has_secret: true,
  created_at: "2026-08-04T00:00:00Z",
  updated_at: "2026-08-04T00:00:00Z",
};

function mockApi(connections: ConnectorConnection[] = [CONNECTION]) {
  vi.spyOn(api, "connectors").mockResolvedValue(connections);
  vi.spyOn(api, "connectorSyncStatus").mockResolvedValue(null);
  vi.spyOn(api, "connectorUsers").mockResolvedValue([
    { remote_id: "user-1", name: "Alice", enabled_for_sync: true, last_synced_at: null },
    { remote_id: "user-2", name: "Bob", enabled_for_sync: false, last_synced_at: null },
  ]);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ConnectorSettingsPanel", () => {
  it("renders provider connections as accordions with a subtle URL", async () => {
    mockApi();

    render(<ConnectorSettingsPanel />);

    expect(document.querySelector(".connector-settings-stack")).not.toBeInTheDocument();
    expect(await screen.findByText("Living Room")).toBeInTheDocument();
    expect(screen.getByTitle("Jellyfin")).toHaveClass("connector-provider-icon");
    expect(screen.getByTitle("Jellyfin").querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("http://jellyfin.local").parentElement).toHaveClass("connector-connection-title");
    const connectionToggle = screen.getByRole("button", { name: /Living Room/ });
    expect(connectionToggle).toHaveAttribute("aria-expanded", "true");
    expect(connectionToggle.closest(".connector-connection-card")).toHaveClass("library-settings-card", "is-expanded");
    expect(document.querySelector(".connector-connection-body")).toHaveClass("library-settings-body");
    expect(connectionToggle.querySelector(".connector-connection-chevron .nav-icon")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Connection" })).not.toBeInTheDocument();
    expect(screen.queryByText("user_states")).not.toBeInTheDocument();
    const usersToggle = screen.getByRole("button", { name: /Analyzed users/ });
    expect(usersToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    fireEvent.click(usersToggle);
    expect(usersToggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows a simple provider dropdown with Plex disabled", async () => {
    mockApi([]);
    render(<ConnectorSettingsPanel />);

    const addConnection = await screen.findByRole("button", { name: "Add connection" });
    expect(addConnection).toHaveClass("settings-panel-header-action", "connector-action-button");
    expect(addConnection.closest(".panel-title-row")).toBeInTheDocument();
    expect(screen.getByText("Connect MediaLyze to one or more media servers and map each external library location to a stable MediaLyze root.")).toHaveClass("subtitle");
    fireEvent.click(addConnection);

    expect(screen.getByRole("heading", { name: "Add connector" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Provider" })).toHaveValue("jellyfin");
    expect(screen.getByRole("option", { name: "Jellyfin" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Plex — Soon™" })).toBeDisabled();
    expect(screen.queryByRole("spinbutton", { name: "Sync interval (minutes)" })).not.toBeInTheDocument();
  });

  it("creates an additional Jellyfin connection disabled by default", async () => {
    mockApi([]);
    const create = vi.spyOn(api, "createConnector").mockResolvedValue(CONNECTION);
    render(<ConnectorSettingsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Add connection" }));

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Living Room" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Server URL" }), { target: { value: "http://jellyfin.local" } });
    fireEvent.change(screen.getByLabelText("API key / secret"), { target: { value: "secret-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Create connection" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      provider: "jellyfin",
      name: "Living Room",
      sync_interval_minutes: 60,
      enabled: false,
    })));
  });

  it("stores playback-user selection per connection", async () => {
    mockApi();
    const updateUsers = vi.spyOn(api, "updateConnectorUsers").mockResolvedValue([
      { remote_id: "user-1", name: "Alice", enabled_for_sync: true, last_synced_at: null },
      { remote_id: "user-2", name: "Bob", enabled_for_sync: true, last_synced_at: null },
    ]);
    render(<ConnectorSettingsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /Analyzed users/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Bob" }));

    await waitFor(() => expect(updateUsers).toHaveBeenCalledWith(CONNECTION.id, ["user-1", "user-2"]));
  });

  it("groups and filters analyzed users", async () => {
    mockApi();
    render(<ConnectorSettingsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /Analyzed users/ }));
    expect(await screen.findByRole("heading", { name: "Selected" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Not selected" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search analyzed users" }), { target: { value: "Bob" } });
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("loads automatic mapping state lazily and switches path mode", async () => {
    mockApi();
    const overview = vi.spyOn(api, "connectorMappingOverview").mockResolvedValue({
      connection_id: CONNECTION.id,
      path_mapping_mode: "automatic",
      library_mapping_mode: "automatic",
      coverage: { total_items: 12, matched_items: 9, attention_items: 3, matched_percent: 75 },
      libraries: [{
        id: 21,
        remote_id: "movies",
        name: "Movies",
        media_type: "movies",
        linked_library_ids: [1],
        required_library_ids: [1],
        recommendation: null,
        locations: [{
          id: 31,
          remote_path: "/remote/movies",
          bindings: [{ id: 41, location_id: 31, library_root_id: 51, source_prefix: "/remote/movies", normalized_source_prefix: "/remote/movies", target_subpath: "", case_mode: "sensitive", priority: 0, active: true, origin: "automatic", confidence: 1, evidence_count: 6, verification_status: "verified", last_verified_at: null }],
        }],
      }],
    });
    vi.spyOn(api, "libraries").mockResolvedValue([{
      id: 1, name: "Movies", path: "/media/movies", roots: [{ id: 51, path: "/media/movies", display_name: "Main", path_key: "/media/movies" }], type: "movies", last_scan_at: null, scan_mode: "manual", duplicate_detection_mode: "off", scan_config: {}, created_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:00:00Z", quality_profile: {} as never, show_on_dashboard: true, file_count: 0, total_size_bytes: 0, total_duration_seconds: 0, ready_files: 0, pending_files: 0,
    }]);
    const update = vi.spyOn(api, "updateConnector").mockResolvedValue({ ...CONNECTION, path_mapping_mode: "manual" });
    render(<ConnectorSettingsPanel />);

    const pathToggle = await screen.findByRole("button", { name: /^Path mappings Map connector locations/ });
    expect(pathToggle).toHaveAttribute("aria-expanded", "false");
    const pathMode = screen.getByRole("group", { name: "Path mapping mode" });
    expect(pathMode.closest(".connector-mapping-section-header")).toContainElement(pathToggle);
    const pathExpandToggle = screen.getByRole("button", { name: "Expand Path mappings" });
    expect(pathExpandToggle).toHaveClass("connector-mapping-expand-toggle");
    expect(pathExpandToggle).not.toHaveClass("secondary", "icon-only-button");
    expect(pathExpandToggle.querySelector(".nav-icon")).toHaveAttribute("aria-hidden", "true");
    expect(pathMode).toHaveClass("library-history-range-toggle");
    expect(pathMode.querySelector(".library-history-range-pill")).toBeInTheDocument();
    expect(pathMode.querySelectorAll(".library-history-range-button")).toHaveLength(2);
    expect(pathMode.querySelector('[aria-pressed="true"]')).toHaveTextContent("Automatic");
    expect(overview).not.toHaveBeenCalled();
    fireEvent.click(pathToggle);
    expect(await screen.findByText("Verified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Library assignments Assign connector libraries/ }));
    expect(await screen.findByText("75% path coverage")).toBeInTheDocument();
    expect(document.querySelector(".connector-mapping-summary-card .connector-mapping-coverage-track span")).toHaveStyle({ width: "75%" });
    const assignmentRow = document.querySelector(".connector-library-assignment-row");
    expect(assignmentRow).toHaveTextContent("Movies→Moviesrequired by path mapping");
    expect(assignmentRow?.querySelector(".connector-library-choice")).toHaveClass("is-selected", "is-required");
    fireEvent.click(screen.getAllByRole("button", { name: "Manual" })[1]);
    await waitFor(() => expect(update).toHaveBeenCalledWith(CONNECTION.id, { path_mapping_mode: "manual" }));
  });

  it("runs generic lifecycle actions for the expanded connection", async () => {
    mockApi();
    const testConnection = vi.spyOn(api, "testConnector").mockResolvedValue({ success: true, server_name: "Living Room", server_version: "10.11", error: null });
    const update = vi.spyOn(api, "updateConnector").mockResolvedValue({ ...CONNECTION, enabled: false });
    const sync = vi.spyOn(api, "syncConnector").mockResolvedValue({ job_id: 12, status: "queued", trigger_source: "manual", accepted: true });
    const remove = vi.spyOn(api, "deleteConnector").mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ConnectorSettingsPanel />);

    const testButton = await screen.findByRole("button", { name: "Test" });
    expect(testButton).toHaveClass("connector-action-button");
    fireEvent.click(testButton);
    await waitFor(() => expect(testConnection).toHaveBeenCalledWith(CONNECTION.id, { base_url: CONNECTION.base_url }));
    const enabledSwitch = screen.getByRole("switch", { name: "Disable" });
    expect(enabledSwitch).toBeChecked();
    expect(enabledSwitch.closest(".connector-enabled-switch")).toBeInTheDocument();
    fireEvent.click(enabledSwitch);
    await waitFor(() => expect(update).toHaveBeenCalledWith(CONNECTION.id, { enabled: false }));
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(sync).toHaveBeenCalledWith(CONNECTION.id));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(CONNECTION.id));
  });

  it("sets and replaces a connector API key from a dialog", async () => {
    mockApi();
    const update = vi.spyOn(api, "updateConnector").mockResolvedValue({ ...CONNECTION, has_secret: true });
    render(<ConnectorSettingsPanel />);

    const replaceButton = await screen.findByRole("button", { name: "Replace key" });
    expect(screen.queryByLabelText("API key / secret")).not.toBeInTheDocument();
    fireEvent.click(replaceButton);

    expect(await screen.findByRole("dialog", { name: "Set API key" })).toBeInTheDocument();
    expect(screen.getByText("An API key is already configured and can be replaced.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("API key / secret"), { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(CONNECTION.id, { secret: "new-secret" }));
  });

  it("shows and invokes cancellation for an active generic job", async () => {
    mockApi();
    vi.mocked(api.connectorSyncStatus).mockResolvedValue({
      id: 12,
      connection_id: CONNECTION.id,
      job_type: "sync",
      sync_run_id: "run-12",
      status: "running",
      trigger_source: "manual",
      cancellation_requested: false,
      progress_phase: "items",
      progress_detail: null,
      progress_current: 20,
      progress_total: 100,
      error: null,
      sync_summary: {},
    });
    const cancel = vi.spyOn(api, "cancelConnectorSync").mockResolvedValue({ job_id: 12, status: "running", cancellation_requested: true });
    render(<ConnectorSettingsPanel />);

    expect(document.querySelector(".connector-job-status")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel sync" }));

    await waitFor(() => expect(cancel).toHaveBeenCalledWith(CONNECTION.id, 12));
  });
});
