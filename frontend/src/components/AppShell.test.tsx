import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";

import { AppDataProvider } from "../lib/app-data";
import { api, type AppSettings } from "../lib/api";
import { ScanJobsProvider } from "../lib/scan-jobs";
import { AppShell } from "./AppShell";

const appVersionMock = vi.hoisted(() => ({ value: "0.8.3" }));

vi.mock("../lib/app-version", () => ({
  get APP_VERSION() {
    return appVersionMock.value;
  },
}));

type AppSettingsOverrides = Omit<Partial<AppSettings>, "scan_performance" | "feature_flags"> & {
  scan_performance?: Partial<NonNullable<AppSettings["scan_performance"]>>;
  feature_flags?: Partial<AppSettings["feature_flags"]>;
};

function createAppSettings(overrides: AppSettingsOverrides = {}): AppSettings {
  const {
    feature_flags: overrideFeatureFlags = {},
    scan_performance: overrideScanPerformance = {},
    ...restOverrides
  } = overrides;

  return {
    ignore_patterns: [],
    user_ignore_patterns: [],
    default_ignore_patterns: [],
    scan_performance: {
      scan_worker_count: 4,
      parallel_scan_jobs: 2,
      comparison_scatter_point_limit: 5000,
      ...overrideScanPerformance,
    },
    feature_flags: {
      hide_automatic_update_reminders: false,
      show_analyzed_files_csv_export: false,
      show_full_width_app_shell: false,
      hide_quality_score_meter: false,
      show_music_quality_score: false,
      unlimited_panel_size: false,
      in_depth_dolby_vision_profiles: false,
      show_all_playbacks_when_unstacked: false,
      ...overrideFeatureFlags,
    },
    telemetry: {
      mode: "off",
      environment_disabled: false,
      installation_id_suffix: null,
      last_sent_at: null,
      last_user_visible_payload: null,
    },
    ...restOverrides,
  };
}

function renderShell(initialEntries = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AppDataProvider>
        <ScanJobsProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<div>Dashboard</div>} />
              <Route path="/settings" element={<div>Settings page</div>} />
              <Route path="/storage-map" element={<div>Storage map page</div>} />
              <Route path="/ui-elements" element={<div>UI elements page</div>} />
            </Route>
          </Routes>
        </ScanJobsProvider>
      </AppDataProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  appVersionMock.value = "0.8.3";
  window.localStorage.clear();
  vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
  vi.spyOn(api, "libraries").mockResolvedValue([]);
  vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);
  vi.spyOn(api, "connectors").mockResolvedValue([]);
  vi.spyOn(api, "connectorSyncStatus").mockResolvedValue(null);
  vi.spyOn(api, "updateStatus").mockResolvedValue({
    current_version: "0.8.3",
    latest_version: "0.8.3",
    update_available: false,
    checked_at: null,
    release_notes: [],
  });
});

afterEach(() => {
  cleanup();
  delete window.medialyzeDesktop;
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("shows the storage map and transcoding center in the primary navigation", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");

    renderShell();

    const primaryNavigation = await screen.findByRole("navigation", { name: "Primary" });
    const primaryLinks = Array.from(primaryNavigation.querySelectorAll<HTMLAnchorElement>(".media-nav-icons > a"));
    expect(primaryLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/files/compare",
      "/settings",
      "/storage-map",
      "/transcoding",
    ]);

    fireEvent.click(screen.getByRole("link", { name: "Storage map" }));

    expect(await screen.findByText("Storage map page")).toBeInTheDocument();
  });

  it("links the MediaLyze brand back to the dashboard", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");

    renderShell(["/settings"]);

    expect(await screen.findByText("Settings page")).toBeInTheDocument();
    const brandLink = screen.getByRole("link", { name: "MediaLyze Home" });
    expect(brandLink).toHaveAttribute("href", "/");

    fireEvent.click(brandLink);

    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
  });

  it("opens the hidden UI elements page after three quick settings icon clicks in dev builds", async () => {
    appVersionMock.value = "dev";
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "dev");

    renderShell();

    const settingsLink = await screen.findByRole("link", { name: "Settings" });
    fireEvent.click(settingsLink.querySelector(".nav-link-content")!);
    fireEvent.click(settingsLink.querySelector(".nav-link-content")!);
    fireEvent.click(settingsLink.querySelector(".nav-link-content")!);

    expect(await screen.findByText("UI elements page")).toBeInTheDocument();
  });

  it("does not open the hidden UI elements page from stable builds", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");

    renderShell();

    const settingsLink = await screen.findByRole("link", { name: "Settings" });
    fireEvent.click(settingsLink.querySelector(".nav-link-content")!);
    fireEvent.click(settingsLink.querySelector(".nav-link-content")!);
    fireEvent.click(settingsLink.querySelector(".nav-link-content")!);

    expect(await screen.findByText("Settings page")).toBeInTheDocument();
    expect(screen.queryByText("UI elements page")).not.toBeInTheDocument();
  });

  it("resets the hidden UI elements click counter after the activation window", async () => {
    appVersionMock.value = "dev";
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "dev");
    const nowSpy = vi.spyOn(Date, "now");

    renderShell();

    const settingsLink = await screen.findByRole("link", { name: "Settings" });
    nowSpy.mockReturnValue(1000);
    fireEvent.click(settingsLink.querySelector(".nav-link-content")!);
    nowSpy.mockReturnValue(1200);
    fireEvent.click(settingsLink.querySelector(".nav-link-content")!);
    nowSpy.mockReturnValue(3000);
    fireEvent.click(settingsLink.querySelector(".nav-link-content")!);

    expect(screen.queryByText("UI elements page")).not.toBeInTheDocument();
  });

  it("gently highlights settings while no library has been added yet", async () => {
    renderShell();

    await waitFor(() => expect(api.libraries).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Settings" })).toHaveClass("is-first-library-attention");
  });

  it("shows release notes for the current version until dismissed", async () => {
    renderShell();

    expect(await screen.findByRole("dialog", { name: "Release history" })).toBeInTheDocument();
    expect(screen.getAllByText("v0.8.3").length).toBeGreaterThan(0);
    expect(screen.getByText(/default the full-width app shell feature flag/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /v0\.8\.2/i })).toBeInTheDocument();
    expect(screen.queryByText(/backfill legacy library-history snapshots/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /v0\.8\.2/i }));

    expect(screen.getByText(/backfill legacy library-history snapshots/i)).toBeInTheDocument();
    expect(screen.queryByText(/default the full-width app shell feature flag/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close release notes" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Release history" })).not.toBeInTheDocument());
    expect(window.localStorage.getItem("medialyze-release-notes-seen-app-version")).toBe("0.8.3");
    expect(window.localStorage.getItem("medialyze-release-notes-seen-version")).toBe("0.8.3");

    fireEvent.click(screen.getByRole("button", { name: "Show release notes for v0.8.3" }));

    expect(await screen.findByRole("dialog", { name: "Release history" })).toBeInTheDocument();
    expect(screen.getByText(/default the full-width app shell feature flag/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open GitHub repository" })).toHaveAttribute(
      "href",
      "https://github.com/frederikemmer/MediaLyze/",
    );
    expect(screen.getByRole("link", { name: "Open GitHub repository" })).toHaveAttribute(
      "data-tooltip",
      "Open GitHub repository",
    );
    expect(screen.getByRole("link", { name: "Report an issue" })).toHaveAttribute(
      "href",
      "https://github.com/frederikemmer/MediaLyze/issues/new/choose",
    );
    expect(screen.getByRole("link", { name: "Report an issue" })).toHaveAttribute(
      "data-tooltip",
      "Report an issue",
    );
    expect(screen.getByRole("link", { name: "Support MediaLyze" })).toHaveAttribute(
      "href",
      "https://github.com/sponsors/frederikemmer",
    );
    expect(screen.getByRole("link", { name: "Support MediaLyze" })).toHaveAttribute(
      "data-tooltip",
      "Support MediaLyze",
    );

    fireEvent.mouseDown(document.querySelector(".release-notes-backdrop")!);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Release history" })).not.toBeInTheDocument());
  });

  it("renders changelog issue links as clickable release-note links", async () => {
    appVersionMock.value = "dev";

    renderShell();

    expect(await screen.findByRole("dialog", { name: "Release history" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /v0\.16\.1/i }));
    expect(screen.getByRole("link", { name: "#162" })).toHaveAttribute(
      "href",
      "https://github.com/frederikemmer/MediaLyze/issues/162",
    );
  });

  it("gently highlights enabled telemetry only on the first automatic open after an update", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.2");

    renderShell();

    expect(await screen.findByRole("dialog", { name: "Release history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help the dev" })).toHaveClass("is-update-attention");

    fireEvent.click(screen.getByRole("button", { name: "Close release notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Show release notes for v0.8.3" }));

    expect(screen.getByRole("button", { name: "Help the dev" })).not.toHaveClass("is-update-attention");
  });

  it("gently highlights enabled telemetry on the first launch while telemetry is undecided", async () => {
    vi.mocked(api.appSettings).mockResolvedValue(
      createAppSettings({
        telemetry: {
          mode: "none",
          environment_disabled: false,
          installation_id_suffix: null,
          last_sent_at: null,
          last_user_visible_payload: null,
        },
      }),
    );

    renderShell();

    expect(await screen.findByRole("dialog", { name: "Release history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help the dev" })).toHaveClass("is-update-attention");
  });

  it("does not show already dismissed release notes for the current version", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");

    renderShell();

    await waitFor(() => expect(api.libraries).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "Release history" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show release notes for v0.8.3" }));

    expect(await screen.findByRole("dialog", { name: "Release history" })).toBeInTheDocument();
  });

  it("uses a clear tooltip on the active scan cancel button", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");
    vi.mocked(api.activeScanJobs).mockResolvedValue([
      {
        id: 1,
        library_id: 1,
        library_name: "Movies",
        status: "running",
        job_type: "incremental",
        files_total: 100,
        files_scanned: 10,
        errors: 0,
        started_at: "2026-05-26T10:00:00Z",
        finished_at: null,
        progress_percent: 10,
        phase_label: "Analyzing media",
        phase_detail: null,
      },
    ]);

    renderShell();

    const stopButton = await screen.findByRole("button", { name: "Stop this scan" });

    expect(stopButton).toHaveAttribute("title", "Stop this scan");
    expect(stopButton.closest(".scan-banner")).not.toHaveAttribute(
      "title",
      "During scans, scan progress updates live. Statistics and table caches refresh after the scan finishes to keep the app responsive.",
    );
  });

  it("shows indeterminate discovery progress and metrics toggle", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");
    vi.mocked(api.activeScanJobs).mockResolvedValue([
      {
        id: 1,
        library_id: 1,
        library_name: "Movies",
        status: "running",
        job_type: "incremental",
        discovered_files: 4641,
        unchanged_files: 2200,
        discovery_complete: false,
        files_total: 1800,
        files_scanned: 300,
        errors: 0,
        started_at: "2026-05-26T10:00:00Z",
        finished_at: null,
        progress_percent: 16.7,
        progress_mode: "indeterminate",
        phase_label: "Discovering files",
        phase_detail: null,
      },
    ]);

    renderShell();

    // Library name is shown in card
    expect(await screen.findByText("Movies")).toBeInTheDocument();
    // Indeterminate: card itself carries the class
    expect(document.querySelector(".scan-job-card.is-indeterminate")).toBeTruthy();
    // Metrics toggle button is present
    expect(screen.getByRole("button", { name: "Toggle scan metrics" })).toBeInTheDocument();
  });

  it("shows active connector synchronization in the global scan banner", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");
    vi.mocked(api.connectors).mockResolvedValue([{
      id: 7,
      provider: "jellyfin",
      name: "Living Room",
      base_url: "http://jellyfin.local",
      config: {},
      capabilities: { users: true },
      enabled: true,
      sync_interval_minutes: 60,
      path_mapping_mode: "automatic",
      library_mapping_mode: "automatic",
      server_name: "Jellyfin",
      server_version: "10.11",
      last_status: "running",
      last_error: null,
      last_sync_started_at: null,
      last_sync_finished_at: null,
      last_successful_sync_at: null,
      has_secret: true,
      created_at: "2026-08-04T00:00:00Z",
      updated_at: "2026-08-04T00:00:00Z",
    }]);
    vi.mocked(api.connectorSyncStatus).mockResolvedValue({
      id: 12,
      connection_id: 7,
      job_type: "sync",
      sync_run_id: "run-12",
      status: "running",
      trigger_source: "manual",
      cancellation_requested: false,
      progress_phase: "mirroring_user_states",
      progress_detail: null,
      progress_current: 52_200,
      progress_total: 104_265,
      error: null,
      sync_summary: {
        progress_metrics: {
          items: { current: 100, total: 100, detail: null },
          user_states: { current: 2, total: 4, detail: "Alice" },
        },
      },
    });
    const cancel = vi.spyOn(api, "cancelConnectorSync").mockResolvedValue({ job_id: 12, status: "running", cancellation_requested: true });

    renderShell();

    expect(await screen.findByText("Living Room")).toBeInTheDocument();
    expect(document.querySelector(".scan-banner .connector-sync-job-card.is-determinate")).toBeInTheDocument();
    expect(await screen.findByText("Mirroring user states")).toBeInTheDocument();
    expect(screen.getByText("100 / 100")).toBeInTheDocument();
    expect(screen.getByText("2 / 4")).toBeInTheDocument();
    expect(screen.getByTitle("100 of 100 assets synchronized")).toBeInTheDocument();
    expect(screen.getByTitle("User states processed for 2 of 4 users")).toBeInTheDocument();
    expect(screen.queryByText("Sync now")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop this synchronization" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(7, 12));
  });

  it("keeps active scans visible and shows an error when cancel fails", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");
    vi.mocked(api.activeScanJobs).mockResolvedValue([
      {
        id: 1,
        library_id: 1,
        library_name: "Movies",
        status: "running",
        job_type: "incremental",
        files_total: 100,
        files_scanned: 10,
        errors: 0,
        started_at: "2026-05-26T10:00:00Z",
        finished_at: null,
        progress_percent: 10,
        phase_label: "Analyzing media",
        phase_detail: null,
      },
    ]);
    vi.spyOn(api, "cancelActiveScanJobs").mockRejectedValue(new Error("database busy"));

    renderShell();

    fireEvent.click(await screen.findByRole("button", { name: "Stop this scan" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stop was requested, but the database is still busy. Try again shortly.",
    );
    expect(screen.getByText("Movies")).toBeInTheDocument();
  });

  it("shows newer remote releases beside the currently installed version", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");
    vi.mocked(api.updateStatus).mockResolvedValue({
      current_version: "0.8.3",
      latest_version: "0.9.0",
      update_available: true,
      checked_at: "2026-05-15T00:00:00Z",
      release_notes: [
        {
          version: "0.9.0",
          date: "2026-05-15",
          sections: [{ title: "New", items: ["remote update"] }],
        },
      ],
    });

    renderShell();

    expect(await screen.findByText("Update available: v0.9.0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show release notes for v0.8.3" }));

    expect(await screen.findByText("New available")).toBeInTheDocument();
    expect(screen.getByText("Currently installed")).toBeInTheDocument();
    expect(screen.getByText("remote update")).toBeInTheDocument();
  });

  it("shows desktop download only when an update is available", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");
    const downloadLatestInstaller = vi.fn().mockResolvedValue({ ok: true });
    window.medialyzeDesktop = {
      isDesktop: () => true,
      getRuntimeInfo: () => ({ platform: "darwin", arch: "arm64" }),
      selectLibraryPaths: vi.fn(),
      downloadLatestInstaller,
      cancelInstallerDownload: vi.fn(),
    };
    vi.mocked(api.updateStatus).mockResolvedValue({
      current_version: "0.8.3",
      latest_version: "0.9.0",
      latest_release_url: "https://github.com/frederikemmer/MediaLyze/releases/tag/v0.9.0",
      update_available: true,
      automatic_reminder_eligible: true,
      checked_at: "2026-05-15T00:00:00Z",
      release_notes: [],
      desktop_assets: [
        {
          platform: "darwin",
          arch: "arm64",
          filename: "MediaLyze-arm64.dmg",
          download_url: "https://github.com/frederikemmer/MediaLyze/releases/download/v0.9.0/MediaLyze-arm64.dmg",
          size_bytes: 123,
          sha256: null,
        },
      ],
    });

    renderShell();

    expect(await screen.findByText("Update available: v0.9.0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show release notes for v0.8.3" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download v0.9.0" }));

    await waitFor(() => expect(downloadLatestInstaller).toHaveBeenCalledWith("0.9.0"));
    expect(screen.getByRole("button", { name: "Downloaded" })).toBeInTheDocument();
  });

  it("automatically opens a newer stable release and stores the browser reminder", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");
    vi.mocked(api.updateStatus).mockResolvedValue({
      current_version: "0.8.3",
      latest_version: "0.9.0",
      latest_release_url: "https://github.com/frederikemmer/MediaLyze/releases/tag/v0.9.0",
      update_available: true,
      automatic_reminder_eligible: true,
      checked_at: "2026-07-28T00:00:00Z",
      release_notes: [
        {
          version: "0.9.0",
          date: "2026-07-28",
          sections: [{ title: "New", items: ["automatic update"] }],
        },
      ],
      desktop_assets: [],
    });

    renderShell();

    expect(await screen.findByRole("dialog", { name: "Release history" })).toBeInTheDocument();
    expect(await screen.findByText("automatic update")).toBeInTheDocument();
    await waitFor(() =>
      expect(window.localStorage.getItem("medialyze-update-reminder-v1")).toContain('"version":"0.9.0"'),
    );
  });

  it("does not automatically reopen within 72 hours or when the feature flag is disabled", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");
    window.localStorage.setItem(
      "medialyze-update-reminder-v1",
      JSON.stringify({ version: "0.8.4", remindedAt: new Date().toISOString() }),
    );
    vi.mocked(api.updateStatus).mockResolvedValue({
      current_version: "0.8.3",
      latest_version: "0.9.0",
      update_available: true,
      automatic_reminder_eligible: true,
      checked_at: new Date().toISOString(),
      release_notes: [],
      desktop_assets: [],
    });

    const firstRender = renderShell();
    await waitFor(() => expect(api.updateStatus).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "Release history" })).not.toBeInTheDocument();
    firstRender.unmount();

    window.localStorage.removeItem("medialyze-update-reminder-v1");
    vi.mocked(api.appSettings).mockResolvedValue(
      createAppSettings({ feature_flags: { hide_automatic_update_reminders: true } }),
    );
    renderShell();
    await waitFor(() => expect(api.updateStatus).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "Release history" })).not.toBeInTheDocument();
  });

  it("keeps the passive update indicator when browser reminder storage is unavailable", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("storage blocked");
    });
    vi.mocked(api.updateStatus).mockResolvedValue({
      current_version: "0.8.3",
      latest_version: "0.9.0",
      update_available: true,
      automatic_reminder_eligible: true,
      checked_at: new Date().toISOString(),
      release_notes: [],
      desktop_assets: [],
    });

    renderShell();

    expect(await screen.findByText("Update available: v0.9.0")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Release history" })).not.toBeInTheDocument();
  });

  it("uses the installation-wide desktop reminder APIs instead of browser storage", async () => {
    window.localStorage.setItem("medialyze-release-notes-seen-app-version", "0.8.3");
    window.medialyzeDesktop = {
      isDesktop: () => true,
      getRuntimeInfo: () => ({ platform: "linux", arch: "x64" }),
      selectLibraryPaths: vi.fn(),
    };
    vi.spyOn(api, "desktopUpdateReminder").mockResolvedValue({ version: null, reminded_at: null });
    const markReminder = vi.spyOn(api, "markDesktopUpdateReminder").mockResolvedValue({
      version: "0.9.0",
      reminded_at: new Date().toISOString(),
    });
    vi.mocked(api.updateStatus).mockResolvedValue({
      current_version: "0.8.3",
      latest_version: "0.9.0",
      update_available: true,
      automatic_reminder_eligible: true,
      checked_at: new Date().toISOString(),
      release_notes: [],
      desktop_assets: [],
    });

    renderShell();

    expect(await screen.findByRole("dialog", { name: "Release history" })).toBeInTheDocument();
    await waitFor(() => expect(markReminder).toHaveBeenCalledWith("0.9.0"));
    expect(window.localStorage.getItem("medialyze-update-reminder-v1")).toBeNull();
  });

  it("updates telemetry mode from the release notes toggle", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(
      createAppSettings({
        telemetry: {
          mode: "none",
          environment_disabled: false,
          installation_id_suffix: null,
          last_sent_at: null,
          last_user_visible_payload: null,
        },
      }),
    );
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        telemetry: {
          mode: "enabled",
          environment_disabled: false,
          installation_id_suffix: null,
          last_sent_at: null,
          last_user_visible_payload: null,
        },
      }),
    );

    renderShell();

    expect(await screen.findByRole("dialog", { name: "Release history" })).toBeInTheDocument();
    const enabledButton = screen.getByRole("button", { name: "Help the dev" });
    expect(enabledButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Telemetry off" })).toHaveAttribute(
      "data-tooltip-body",
      "No telemetry payloads are sent.",
    );
    expect(screen.getByRole("button", { name: "Minimal telemetry" })).toHaveAttribute(
      "data-tooltip-body",
      "Tell the Dev which runtime/system you are using, nothing else.",
    );
    expect(enabledButton).toHaveAttribute("data-tooltip-title", "Help the dev");
    expect(enabledButton).toHaveAttribute(
      "data-tooltip-body",
      "Adds rounded usage counts and app settings to inform development. NO private data.",
    );

    fireEvent.click(enabledButton);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        telemetry: { mode: "enabled" },
      }),
    );
    await waitFor(() => expect(enabledButton).toHaveAttribute("aria-pressed", "true"));
  });

  it("applies the full-width shell class when the feature flag is enabled", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(
      createAppSettings({
        feature_flags: {
          show_full_width_app_shell: true,
        },
      }),
    );

    const { container } = renderShell();

    await waitFor(() =>
      expect(container.querySelector(".media-app-shell")).toHaveClass("media-app-shell-full-width"),
    );
  });
});
