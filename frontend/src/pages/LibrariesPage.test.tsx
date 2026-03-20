import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { AppDataProvider } from "../lib/app-data";
import {
  api,
  DEFAULT_QUALITY_PROFILE,
  type AppSettings,
  type BrowseResponse,
  type LibrarySummary,
  type PathInspection,
  type RecentScanJobPage,
  type RecentScanJob,
  type ScanJobDetail,
} from "../lib/api";
import { ScanJobsProvider } from "../lib/scan-jobs";
import { LibrariesPage } from "./LibrariesPage";

function createAppSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ignore_patterns: ["movie.tmp", "*/@eaDir/*"],
    user_ignore_patterns: ["movie.tmp"],
    default_ignore_patterns: ["*/@eaDir/*"],
    feature_flags: {
      show_dolby_vision_profiles: false,
      show_analyzed_files_csv_export: false,
    },
    ...overrides,
  };
}

function createBrowseResponse(): BrowseResponse {
  return {
    current_path: ".",
    parent_path: null,
    entries: [
      {
        name: "media",
        path: "media",
        is_dir: true,
      },
    ],
  };
}

function createLibrarySummary(overrides: Partial<LibrarySummary> = {}): LibrarySummary {
  return {
    id: 1,
    name: "Movies",
    path: "/media/movies",
    type: "movies",
    last_scan_at: null,
    scan_mode: "manual",
    scan_config: {},
    created_at: "2026-03-15T12:00:00Z",
    updated_at: "2026-03-15T12:00:00Z",
    quality_profile: DEFAULT_QUALITY_PROFILE,
    file_count: 0,
    total_size_bytes: 0,
    total_duration_seconds: 0,
    ready_files: 0,
    pending_files: 0,
    ...overrides,
  };
}

function createPathInspection(overrides: Partial<PathInspection> = {}): PathInspection {
  return {
    normalized_path: "/media/movies",
    exists: true,
    is_directory: true,
    path_kind: "local",
    watch_supported: true,
    ...overrides,
  };
}

function createRecentScanJob(overrides: Partial<RecentScanJob> = {}): RecentScanJob {
  return {
    id: 14,
    library_id: 1,
    library_name: "Movies",
    status: "completed",
    outcome: "successful",
    job_type: "incremental",
    trigger_source: "manual",
    started_at: "2026-03-16T10:00:00Z",
    finished_at: "2026-03-16T10:03:00Z",
    duration_seconds: 180,
    discovered_files: 12,
    ignored_total: 2,
    new_files: 3,
    modified_files: 1,
    deleted_files: 0,
    analysis_failed: 0,
    ...overrides,
  };
}

function createScanJobDetail(overrides: Partial<ScanJobDetail> = {}): ScanJobDetail {
  return {
    ...createRecentScanJob(),
    trigger_details: { reason: "user_requested" },
    scan_summary: {
      ignore_patterns: ["sample.*"],
      discovery: {
        discovered_files: 12,
        ignored_total: 2,
        ignored_dir_total: 0,
        ignored_file_total: 2,
        ignored_pattern_hits: [{ pattern: "sample.*", count: 2, paths: ["sample.mkv"], truncated_count: 1 }],
      },
      changes: {
        queued_for_analysis: 4,
        unchanged_files: 8,
        reanalyzed_incomplete_files: 0,
        new_files: { count: 3, paths: ["new-a.mkv"], truncated_count: 1 },
        modified_files: { count: 1, paths: ["changed.mkv"], truncated_count: 0 },
        deleted_files: { count: 0, paths: [], truncated_count: 0 },
      },
      analysis: {
        queued_for_analysis: 4,
        analyzed_successfully: 4,
        analysis_failed: 0,
        failed_files: [],
        failed_files_truncated_count: 0,
      },
    },
    ...overrides,
  };
}

function createRecentScanJobPage(overrides: Partial<RecentScanJobPage> = {}): RecentScanJobPage {
  return {
    items: [],
    has_more: false,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AppDataProvider>
        <ScanJobsProvider>
          <LibrariesPage />
        </ScanJobsProvider>
      </AppDataProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.spyOn(api, "libraries").mockResolvedValue([]);
  vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
  vi.spyOn(api, "browse").mockResolvedValue(createBrowseResponse());
  vi.spyOn(api, "inspectPath").mockResolvedValue(createPathInspection());
  vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);
  vi.spyOn(api, "recentScanJobs").mockResolvedValue(createRecentScanJobPage());
  vi.spyOn(api, "scanJobDetail").mockResolvedValue(createScanJobDetail());
  vi.spyOn(api, "updateAppSettings").mockResolvedValue(createAppSettings());
  delete window.medialyzeDesktop;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("LibrariesPage ignore patterns", () => {
  it("shows custom patterns expanded and default patterns collapsed by default", async () => {
    renderPage();

    const customToggle = await screen.findByRole("button", { name: /custom ignore patterns/i });
    const defaultToggle = screen.getByRole("button", { name: /default ignore patterns/i });

    expect(customToggle).toHaveAttribute("aria-expanded", "true");
    expect(defaultToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Add a new ignore pattern")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("*/@eaDir/*")).not.toBeInTheDocument();
  });

  it("restores the persisted collapse state from localStorage", async () => {
    window.localStorage.setItem(
      "medialyze-ignore-pattern-sections",
      JSON.stringify({ customExpanded: false, defaultsExpanded: true }),
    );

    renderPage();

    const customToggle = await screen.findByRole("button", { name: /custom ignore patterns/i });
    const defaultToggle = screen.getByRole("button", { name: /default ignore patterns/i });

    expect(customToggle).toHaveAttribute("aria-expanded", "false");
    expect(defaultToggle).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByDisplayValue("*/@eaDir/*")).toBeInTheDocument();
  });

  it("sends custom and default ignore patterns separately when editing defaults", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        ignore_patterns: ["movie.tmp", "*/#recycle/*"],
        user_ignore_patterns: ["movie.tmp"],
        default_ignore_patterns: ["*/#recycle/*"],
      }),
    );

    renderPage();

    const defaultToggle = await screen.findByRole("button", { name: /default ignore patterns/i });
    fireEvent.click(defaultToggle);

    const defaultInput = await screen.findByDisplayValue("*/@eaDir/*");
    fireEvent.change(defaultInput, { target: { value: "*/#recycle/*" } });
    fireEvent.blur(defaultInput);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        user_ignore_patterns: ["movie.tmp"],
        default_ignore_patterns: ["*/#recycle/*"],
        feature_flags: {
          show_dolby_vision_profiles: false,
          show_analyzed_files_csv_export: false,
        },
      }),
    );
  });

  it("persists the dolby vision profile feature flag", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        feature_flags: {
          show_dolby_vision_profiles: true,
          show_analyzed_files_csv_export: false,
        },
      }),
    );

    renderPage();

    const checkbox = await screen.findByLabelText("Show Dolby Vision Profiles");
    await screen.findByDisplayValue("movie.tmp");
    await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        user_ignore_patterns: ["movie.tmp"],
        default_ignore_patterns: ["*/@eaDir/*"],
        feature_flags: {
          show_dolby_vision_profiles: true,
          show_analyzed_files_csv_export: false,
        },
      }),
    );
  });

  it("persists the analyzed files CSV export feature flag", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        feature_flags: {
          show_dolby_vision_profiles: false,
          show_analyzed_files_csv_export: true,
        },
      }),
    );

    renderPage();

    const checkbox = await screen.findByLabelText("Show analyzed-files CSV export");
    await screen.findByDisplayValue("movie.tmp");
    await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        user_ignore_patterns: ["movie.tmp"],
        default_ignore_patterns: ["*/@eaDir/*"],
        feature_flags: {
          show_dolby_vision_profiles: false,
          show_analyzed_files_csv_export: true,
        },
      }),
    );
  });

  it("clamps visual density maximum when the ideal is raised above it", async () => {
    const library = createLibrarySummary();
    vi.spyOn(api, "libraries").mockResolvedValue([library]);

    renderPage();

    await screen.findByText("Movies");
    fireEvent.click(screen.getByRole("button", { name: "Quality score" }));
    const visualDensityTitle = await screen.findByText("Visual density");
    const visualDensityGroup = visualDensityTitle.closest(".quality-settings-group");
    if (!(visualDensityGroup instanceof HTMLElement)) {
      throw new Error("Expected visual density settings group");
    }
    const idealInput = within(visualDensityGroup).getByDisplayValue("0.04") as HTMLInputElement;
    const maximumInput = within(visualDensityGroup).getByDisplayValue("0.08") as HTMLInputElement;
    fireEvent.change(idealInput, { target: { value: "0.09" } });

    await waitFor(() => expect(maximumInput).toHaveValue(0.09));
  });
});

describe("LibrariesPage desktop mode", () => {
  it("shows the desktop folder picker instead of the MEDIA_ROOT browser", async () => {
    window.medialyzeDesktop = {
      isDesktop: () => true,
      selectLibraryPath: vi.fn().mockResolvedValue("/mnt/media"),
    };

    renderPage();

    expect(await screen.findByRole("button", { name: "Choose folder" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Up" })).not.toBeInTheDocument();
    expect(screen.getByText("Select a local folder, mounted network share, or UNC path to analyze.")).toBeInTheDocument();
  });

  it("falls back to scheduled scans when watch is selected for a network path", async () => {
    window.medialyzeDesktop = {
      isDesktop: () => true,
      selectLibraryPath: vi.fn().mockResolvedValue("/mnt/network-media"),
    };
    vi.spyOn(api, "libraries").mockResolvedValue([
      createLibrarySummary({ path: "/mnt/network-media", scan_mode: "manual" }),
    ]);
    vi.spyOn(api, "inspectPath").mockResolvedValue(
      createPathInspection({
        normalized_path: "/mnt/network-media",
        path_kind: "network",
        watch_supported: false,
      }),
    );

    renderPage();

    await screen.findByText("Movies");
    fireEvent.change(screen.getByLabelText("Scan mode"), { target: { value: "watch" } });

    await waitFor(() => expect(screen.getByLabelText("Scan mode")).toHaveValue("scheduled"));
    expect(screen.getByText("Watch mode is only available for local paths. MediaLyze falls back to scheduled scans for network locations.")).toBeInTheDocument();
  });
});

describe("LibrariesPage settings panels", () => {
  it("shows the main settings panels expanded by default", async () => {
    renderPage();

    const appSettingsToggle = await screen.findByRole("button", { name: /^app settings$/i });

    expect(appSettingsToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Interface language")).toBeInTheDocument();
  });

  it("restores persisted settings panel state from localStorage", async () => {
    window.localStorage.setItem(
      "medialyze-settings-panel-state",
      JSON.stringify({
        configuredLibraries: false,
        recentScanLogs: true,
        libraryStatistics: true,
        createLibrary: true,
        ignorePatterns: false,
        appSettings: false,
      }),
    );

    renderPage();

    const configuredToggle = await screen.findByRole("button", { name: /^configured libraries$/i });
    const ignorePatternsToggle = screen.getByRole("button", { name: /^ignore patterns$/i });
    const appSettingsToggle = screen.getByRole("button", { name: /^app settings$/i });

    expect(configuredToggle).toHaveAttribute("aria-expanded", "false");
    expect(ignorePatternsToggle).toHaveAttribute("aria-expanded", "false");
    expect(appSettingsToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Add first library")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Interface language")).not.toBeInTheDocument();
  });

  it("persists panel collapse changes when toggled", async () => {
    renderPage();

    const appSettingsToggle = await screen.findByRole("button", { name: /^app settings$/i });
    fireEvent.click(appSettingsToggle);

    expect(appSettingsToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Interface language")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("medialyze-settings-panel-state")).toBe(
      JSON.stringify({
        configuredLibraries: true,
        recentScanLogs: true,
        libraryStatistics: true,
        createLibrary: true,
        ignorePatterns: true,
        appSettings: false,
      }),
    );
  });

  it("shows the recent scan logs panel expanded by default", async () => {
    renderPage();

    const scanLogsToggle = await screen.findByRole("button", { name: /^recent scan logs$/i });

    expect(scanLogsToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("No completed scans yet.")).toBeInTheDocument();
  });

  it("renders recent scan log cards and lazy-loads details", async () => {
    const recentSpy = vi.spyOn(api, "recentScanJobs").mockResolvedValue(
      createRecentScanJobPage({
        items: [createRecentScanJob({ outcome: "failed", trigger_source: "watchdog", analysis_failed: 1 })],
      }),
    );
    const detailSpy = vi.spyOn(api, "scanJobDetail").mockResolvedValue(
      createScanJobDetail({
        outcome: "failed",
        trigger_source: "watchdog",
        trigger_details: { event_count: 2, paths: ["movie.mkv"] },
        scan_summary: {
          ...createScanJobDetail().scan_summary,
          analysis: {
            queued_for_analysis: 4,
            analyzed_successfully: 3,
            analysis_failed: 1,
            failed_files: [{ path: "broken.mkv", reason: "ffprobe exploded" }],
            failed_files_truncated_count: 0,
          },
        },
      }),
    );

    renderPage();

    await waitFor(() => expect(recentSpy).toHaveBeenCalledWith({ sinceHours: 24, limit: 200 }));

    const jobButton = await screen.findByRole("button", { name: /movies/i });
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Watchdog")).toBeInTheDocument();

    fireEvent.click(jobButton);

    await waitFor(() => expect(detailSpy).toHaveBeenCalledWith(14));
    expect(await screen.findAllByText("Ignore patterns")).toHaveLength(2);
    fireEvent.click(screen.getAllByText("Ignore patterns")[1]);
    expect((await screen.findAllByText("sample.*")).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByText("Files that could not be analyzed"));
    expect(screen.queryByText("ffprobe exploded")).not.toBeInTheDocument();

    const failedFileTrigger = await screen.findByRole("button", {
      name: "Show analysis failure details for broken.mkv",
    });
    expect(screen.queryByText("broken.mkv, ...")).not.toBeInTheDocument();
    expect(failedFileTrigger).toHaveTextContent("broken.mkv");

    fireEvent.click(failedFileTrigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("ffprobe exploded");
  });

  it("loads older scans when clicking load more", async () => {
    const recentSpy = vi
      .spyOn(api, "recentScanJobs")
      .mockResolvedValueOnce(
        createRecentScanJobPage({
          items: [createRecentScanJob({ id: 10, finished_at: "2026-03-16T10:03:00Z" })],
          has_more: false,
        }),
      )
      .mockResolvedValueOnce(
        createRecentScanJobPage({
          items: [createRecentScanJob({ id: 9, finished_at: "2026-03-15T10:03:00Z" })],
          has_more: false,
        }),
      );

    renderPage();

    expect(await screen.findByRole("button", { name: "Load more" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() =>
      expect(recentSpy).toHaveBeenNthCalledWith(2, {
        limit: 20,
        beforeFinishedAt: "2026-03-16T10:03:00Z",
        beforeId: 10,
      }),
    );
    expect(await screen.findByText("Mar 15, 2026, 11:03 AM")).toBeInTheDocument();
  });
});
