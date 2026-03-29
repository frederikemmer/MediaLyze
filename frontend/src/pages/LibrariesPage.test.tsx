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
    duplicate_detection_mode: "filename",
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
      duplicates: {
        mode: "filename",
        queued_for_processing: 4,
        processed_successfully: 4,
        processing_failed: 0,
        failed_files: [],
        failed_files_truncated_count: 0,
        duplicate_groups: 1,
        duplicate_files: 2,
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

  it("auto-saves renamed resolution categories on blur", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        resolution_categories: [
          { id: "8k", label: "8k", min_width: 7680, min_height: 4320 },
          { id: "4k", label: "UHD", min_width: 3840, min_height: 2160 },
          { id: "1440p", label: "1440p", min_width: 2560, min_height: 1440 },
          { id: "1080p", label: "1080p", min_width: 1920, min_height: 1080 },
          { id: "720p", label: "720p", min_width: 1280, min_height: 720 },
          { id: "sd", label: "sd", min_width: 0, min_height: 0 },
        ],
      }),
    );

    renderPage();

    const labelInput = (await screen.findByDisplayValue("4k")) as HTMLInputElement;
    fireEvent.change(labelInput, { target: { value: "UHD" } });
    fireEvent.blur(labelInput);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resolution_categories: expect.arrayContaining([
            expect.objectContaining({ id: "4k", label: "UHD", min_width: 3648, min_height: 1520 }),
          ]),
        }),
      ),
    );
  });

  it("restores default resolution categories through app settings", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(
      createAppSettings({
        resolution_categories: [
          { id: "8k", label: "8k", min_width: 7680, min_height: 4320 },
          { id: "4k", label: "UHD", min_width: 3840, min_height: 2160 },
          { id: "1080p", label: "Full HD", min_width: 1920, min_height: 1080 },
          { id: "720p", label: "HD", min_width: 1280, min_height: 720 },
          { id: "sd", label: "SD", min_width: 0, min_height: 0 },
        ],
      }),
    );
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        resolution_categories: [
          { id: "8k", label: "8k", min_width: 7296, min_height: 3040 },
          { id: "4k", label: "4k", min_width: 3648, min_height: 1520 },
          { id: "1080p", label: "1080p", min_width: 1824, min_height: 760 },
          { id: "720p", label: "720p", min_width: 1216, min_height: 506 },
          { id: "sd", label: "sd", min_width: 0, min_height: 0 },
        ],
      }),
    );

    renderPage();

    await screen.findByDisplayValue("UHD");
    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resolution_categories: [
            expect.objectContaining({ id: "8k", label: "8k", min_width: 7296, min_height: 3040 }),
            expect.objectContaining({ id: "4k", label: "4k", min_width: 3648, min_height: 1520 }),
            expect.objectContaining({ id: "1080p", label: "1080p", min_width: 1824, min_height: 760 }),
            expect.objectContaining({ id: "720p", label: "720p", min_width: 1216, min_height: 506 }),
            expect.objectContaining({ id: "sd", label: "sd", min_width: 0, min_height: 0 }),
          ],
        }),
      ),
    );
  });

  it("shows the resolution category tooltip with relaxed thresholds and reference formats", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Explain reduced default resolution thresholds" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Default buckets intentionally use 5% lower minimum width and height thresholds",
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent("4k / UHD: 3840x2160");
    expect(screen.getByRole("tooltip")).toHaveTextContent("1080p / Full HD: 1920x1080");
  });

  it("adds new resolution categories without persisting a client-generated id", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        resolution_categories: [
          { id: "8k", label: "8k", min_width: 7680, min_height: 4320 },
          { id: "4k", label: "4k", min_width: 3840, min_height: 2160 },
          { id: "1440p", label: "1440p", min_width: 2560, min_height: 1440 },
          { id: "1080p", label: "1080p", min_width: 1920, min_height: 1080 },
          { id: "720p", label: "720p", min_width: 1280, min_height: 720 },
          { id: "480p", label: "480p", min_width: 854, min_height: 480 },
          { id: "sd", label: "sd", min_width: 0, min_height: 0 },
        ],
      }),
    );

    renderPage();

    fireEvent.change(await screen.findByPlaceholderText("New category"), { target: { value: "480p" } });
    fireEvent.change(screen.getByLabelText("Min width", { selector: "#resolution-category-new-width" }), {
      target: { value: "854" },
    });
    fireEvent.change(screen.getByLabelText("Min height", { selector: "#resolution-category-new-height" }), {
      target: { value: "480" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add resolution category" }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resolution_categories: expect.arrayContaining([
            expect.objectContaining({ id: "", label: "480p", min_width: 854, min_height: 480 }),
          ]),
        }),
      ),
    );
  });

  it("clamps visual density maximum when the ideal is raised above it", async () => {
    const library = createLibrarySummary();
    vi.spyOn(api, "libraries").mockResolvedValue([library]);
    vi.spyOn(api, "appSettings").mockResolvedValue(
      createAppSettings({
        resolution_categories: [
          { id: "8k", label: "8k", min_width: 7680, min_height: 4320 },
          { id: "4k", label: "UHD", min_width: 3840, min_height: 2160 },
          { id: "1440p", label: "1440p", min_width: 2560, min_height: 1440 },
          { id: "1080p", label: "Full HD", min_width: 1920, min_height: 1080 },
          { id: "720p", label: "HD", min_width: 1280, min_height: 720 },
          { id: "sd", label: "SD", min_width: 0, min_height: 0 },
        ],
      }),
    );

    renderPage();

    await screen.findByText("Movies");
    fireEvent.click(screen.getByRole("button", { name: "Quality score" }));
    expect(await screen.findByText("UHD")).toBeInTheDocument();
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

  it("saves duplicate detection mode changes per library", async () => {
    const library = createLibrarySummary();
    const updateSpy = vi.spyOn(api, "updateLibrarySettings").mockResolvedValue({
      ...library,
      duplicate_detection_mode: "filehash",
    });
    vi.spyOn(api, "libraries").mockResolvedValue([library]);

    renderPage();

    await screen.findByText("Movies");
    fireEvent.change(screen.getByLabelText("Duplicate detection"), { target: { value: "filehash" } });

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        library.id,
        expect.objectContaining({ duplicate_detection_mode: "filehash" }),
      ),
    );
  });
});

describe("LibrariesPage settings panels", () => {
  it("uses the queued analysis progress for the active scan bar", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrarySummary()]);
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([
      {
        id: 21,
        library_id: 1,
        library_name: "Movies",
        status: "running",
        job_type: "incremental",
        files_total: 8982,
        files_scanned: 0,
        errors: 0,
        started_at: "2026-03-29T10:00:00Z",
        finished_at: null,
        progress_percent: 15,
        phase_key: "analyzing",
        phase_label: "Analyzing media",
        phase_detail: "0 of 822 queued files analyzed, 8160 unchanged",
        phase_progress_percent: 0,
        phase_current: 0,
        phase_total: 822,
        eta_seconds: null,
        scan_mode_label: "incremental",
        duplicate_detection_mode: "filename",
        queued_for_analysis: 822,
        unchanged_files: 8160,
      },
    ]);

    const { container } = renderPage();

    expect(await screen.findByText(/analyzing media · 0% · 0\/822 queued files analyzed/i)).toBeInTheDocument();

    const progressFill = container.querySelector(".library-settings-card .progress span");
    expect(progressFill).not.toBeNull();
    expect(progressFill).toHaveStyle({ width: "0%" });
  });

  it("keeps quality recompute progress separate from media analysis counts", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrarySummary()]);
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([
      {
        id: 22,
        library_id: 1,
        library_name: "Movies",
        status: "running",
        job_type: "quality_recompute",
        files_total: 8989,
        files_scanned: 31,
        errors: 0,
        started_at: "2026-03-29T10:00:00Z",
        finished_at: null,
        progress_percent: 0.3,
        phase_key: "analyzing",
        phase_label: "Recomputing quality scores",
        phase_detail: "31 of 8989 files updated",
        phase_progress_percent: 0.3,
        phase_current: 31,
        phase_total: 8989,
        eta_seconds: null,
        scan_mode_label: "quality_recompute",
        duplicate_detection_mode: "filename",
        queued_for_analysis: 31,
        unchanged_files: 8958,
      },
    ]);

    const { container } = renderPage();

    expect(await screen.findByText(/recomputing quality scores · 0.3% · 31 of 8989 files updated/i)).toBeInTheDocument();

    const progressFill = container.querySelector(".library-settings-card .progress span");
    expect(progressFill).not.toBeNull();
    expect(progressFill).toHaveStyle({ width: "0.3%" });
  });

  it("shows only filename and filehash duplicate detection modes", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrarySummary()]);

    renderPage();

    const duplicateModeSelect = await screen.findByLabelText("Duplicate detection", { selector: "select" });
    expect(within(duplicateModeSelect).getByRole("option", { name: "Filename" })).toBeInTheDocument();
    expect(within(duplicateModeSelect).getByRole("option", { name: "Filehash" })).toBeInTheDocument();
    expect(within(duplicateModeSelect).queryByRole("option", { name: /content hash/i })).not.toBeInTheDocument();
    expect(within(duplicateModeSelect).queryByRole("option", { name: /perceptual/i })).not.toBeInTheDocument();
  });

  it("shows the main settings panels expanded by default", async () => {
    renderPage();

    const appSettingsToggle = await screen.findByRole("button", { name: /^app settings$/i });
    const resolutionCategoriesToggle = screen.getByRole("button", { name: /^resolution categories$/i });

    expect(appSettingsToggle).toHaveAttribute("aria-expanded", "true");
    expect(resolutionCategoriesToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Interface language")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add resolution category" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore defaults" })).toBeInTheDocument();
  });

  it("restores persisted settings panel state from localStorage", async () => {
    window.localStorage.setItem(
      "medialyze-settings-panel-state",
      JSON.stringify({
        configuredLibraries: false,
        recentScanLogs: true,
        libraryStatistics: true,
        resolutionCategories: false,
        createLibrary: true,
        ignorePatterns: false,
        appSettings: false,
      }),
    );

    renderPage();

    const configuredToggle = await screen.findByRole("button", { name: /^configured libraries$/i });
    const ignorePatternsToggle = screen.getByRole("button", { name: /^ignore patterns$/i });
    const resolutionCategoriesToggle = screen.getByRole("button", { name: /^resolution categories$/i });
    const appSettingsToggle = screen.getByRole("button", { name: /^app settings$/i });

    expect(configuredToggle).toHaveAttribute("aria-expanded", "false");
    expect(ignorePatternsToggle).toHaveAttribute("aria-expanded", "false");
    expect(resolutionCategoriesToggle).toHaveAttribute("aria-expanded", "false");
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
        resolutionCategories: true,
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
            failed_files: [{ path: "broken.mkv", reason: "ffprobe exploded", details: "ffprobe exploded\nwith stderr" }],
            failed_files_truncated_count: 0,
          },
          runtime: {
            fatal_error_type: "RuntimeError",
            fatal_error_message: "job failed at finalization",
            fatal_error_traceback: "Traceback: job failed at finalization",
            fatal_error_at: "2026-03-16T10:02:59Z",
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
    expect(await screen.findByRole("tooltip")).toHaveTextContent("with stderr");
    expect(screen.getByText("Execution failure")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Execution failure"));
    expect(screen.getAllByText("RuntimeError")).toHaveLength(2);
    expect(screen.getByText("job failed at finalization")).toBeInTheDocument();
    expect(screen.getByText("Traceback: job failed at finalization")).toBeInTheDocument();
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
