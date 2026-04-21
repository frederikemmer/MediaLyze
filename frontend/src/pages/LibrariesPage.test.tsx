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
  type HistoryReconstructionStatus,
  type DashboardResponse,
  type HistoryReconstructionResult,
  type HistoryStorage,
  type LibrarySummary,
  type PathInspection,
  type RecentScanJobPage,
  type RecentScanJob,
  type ScanJob,
  type ScanJobDetail,
} from "../lib/api";
import { ScanJobsProvider } from "../lib/scan-jobs";
import { LibrariesPage } from "./LibrariesPage";

type AppSettingsOverrides = Omit<Partial<AppSettings>, "scan_performance" | "feature_flags" | "history_retention"> & {
  scan_performance?: Partial<NonNullable<AppSettings["scan_performance"]>>;
  history_retention?: {
    file_history?: Partial<NonNullable<AppSettings["history_retention"]>["file_history"]>;
    library_history?: Partial<NonNullable<AppSettings["history_retention"]>["library_history"]>;
    scan_history?: Partial<NonNullable<AppSettings["history_retention"]>["scan_history"]>;
  };
  feature_flags?: Partial<AppSettings["feature_flags"]>;
};

function createAppSettings(overrides: AppSettingsOverrides = {}): AppSettings {
  const {
    feature_flags: overrideFeatureFlags = {},
    scan_performance: overrideScanPerformance = {},
    history_retention: overrideHistoryRetention = {},
    ...restOverrides
  } = overrides;
  return {
    ignore_patterns: ["movie.tmp", "*/@eaDir/*"],
    user_ignore_patterns: ["movie.tmp"],
    default_ignore_patterns: ["*/@eaDir/*"],
    scan_performance: {
      scan_worker_count: 4,
      parallel_scan_jobs: 2,
      comparison_scatter_point_limit: 5000,
      ...overrideScanPerformance,
    },
    history_retention: {
      file_history: { days: 30, storage_limit_gb: 0, ...overrideHistoryRetention.file_history },
      library_history: { days: 365, storage_limit_gb: 0, ...overrideHistoryRetention.library_history },
      scan_history: { days: 30, storage_limit_gb: 0, ...overrideHistoryRetention.scan_history },
    },
    feature_flags: {
      show_analyzed_files_csv_export: false,
      show_full_width_app_shell: false,
      hide_quality_score_meter: false,
      unlimited_panel_size: false,
      ...overrideFeatureFlags,
    },
    ...restOverrides,
  };
}

function createHistoryStorage(overrides: Partial<HistoryStorage> = {}): HistoryStorage {
  return {
    generated_at: "2026-03-16T10:03:00Z",
    database_file_bytes: 5_000_000,
    reclaimable_file_bytes: 0,
    categories: {
      file_history: {
        entry_count: 10,
        current_estimated_bytes: 1_000_000,
        average_daily_bytes: 100_000,
        projected_bytes_30d: 3_000_000,
        projected_bytes_for_configured_days: 3_000_000,
        days_limit: 30,
        storage_limit_bytes: 0,
        oldest_recorded_at: "2026-01-01T00:00:00Z",
        newest_recorded_at: "2026-03-16T10:03:00Z",
      },
      library_history: {
        entry_count: 5,
        current_estimated_bytes: 200_000,
        average_daily_bytes: 1_000,
        projected_bytes_30d: 30_000,
        projected_bytes_for_configured_days: 365_000,
        days_limit: 365,
        storage_limit_bytes: 0,
        oldest_recorded_at: "2025-03-16T10:03:00Z",
        newest_recorded_at: "2026-03-16T10:03:00Z",
      },
      scan_history: {
        entry_count: 20,
        current_estimated_bytes: 300_000,
        average_daily_bytes: 10_000,
        projected_bytes_30d: 300_000,
        projected_bytes_for_configured_days: 300_000,
        days_limit: 30,
        storage_limit_bytes: 0,
        oldest_recorded_at: "2026-02-15T10:03:00Z",
        newest_recorded_at: "2026-03-16T10:03:00Z",
      },
    },
    ...overrides,
  };
}

function createHistoryReconstructionResult(
  overrides: Partial<HistoryReconstructionResult> = {},
): HistoryReconstructionResult {
  return {
    generated_at: "2026-04-19T12:00:00Z",
    libraries_processed: 2,
    libraries_with_media: 2,
    created_file_history_entries: 8,
    created_library_history_entries: 24,
    updated_library_history_entries: 0,
    oldest_reconstructed_snapshot_day: "2026-03-01",
    newest_reconstructed_snapshot_day: "2026-04-18",
    ...overrides,
  };
}

function createHistoryReconstructionStatus(
  overrides: Partial<HistoryReconstructionStatus> = {},
): HistoryReconstructionStatus {
  return {
    status: "idle",
    phase: "idle",
    started_at: null,
    finished_at: null,
    progress_percent: 0,
    libraries_total: 0,
    libraries_processed: 0,
    libraries_with_media: 0,
    current_library_name: null,
    phase_total: 0,
    phase_completed: 0,
    created_file_history_entries: 0,
    created_library_history_entries: 0,
    updated_library_history_entries: 0,
    result: null,
    error: null,
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
    duplicate_detection_mode: "off",
    scan_config: {},
    created_at: "2026-03-15T12:00:00Z",
    updated_at: "2026-03-15T12:00:00Z",
    quality_profile: DEFAULT_QUALITY_PROFILE,
    show_on_dashboard: true,
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

function createScanJob(overrides: Partial<ScanJob> = {}): ScanJob {
  return {
    id: 21,
    library_id: 1,
    library_name: "Movies",
    status: "queued",
    job_type: "incremental",
    files_total: 0,
    files_scanned: 0,
    errors: 0,
    started_at: null,
    finished_at: null,
    progress_percent: 0,
    phase_label: "Queued",
    phase_detail: null,
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
        duplicate_groups: 2,
        duplicate_files: 4,
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

function createDashboard(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    totals: {
      libraries: 1,
      files: 0,
      storage_bytes: 0,
      duration_seconds: 0,
    },
    container_distribution: [],
    video_codec_distribution: [],
    resolution_distribution: [],
    hdr_distribution: [],
    audio_codec_distribution: [],
    audio_spatial_profile_distribution: [],
    audio_language_distribution: [],
    subtitle_distribution: [],
    subtitle_codec_distribution: [],
    subtitle_source_distribution: [],
    numeric_distributions: {
      quality_score: { total: 0, bins: [] },
      duration: { total: 0, bins: [] },
      size: { total: 0, bins: [] },
      bitrate: { total: 0, bins: [] },
      audio_bitrate: { total: 0, bins: [] },
    },
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
  vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard());
  vi.spyOn(api, "historyStorage").mockResolvedValue(createHistoryStorage());
  vi.spyOn(api, "historyReconstructionStatus").mockResolvedValue(createHistoryReconstructionStatus());
  vi.spyOn(api, "reconstructHistory").mockResolvedValue(
    createHistoryReconstructionStatus({
      status: "running",
      phase: "loading_libraries",
      libraries_total: 2,
    }),
  );
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
        scan_performance: {
          scan_worker_count: 4,
          parallel_scan_jobs: 2,
          comparison_scatter_point_limit: 5000,
        },
        history_retention: {
          file_history: { days: 30, storage_limit_gb: 0 },
          library_history: { days: 365, storage_limit_gb: 0 },
          scan_history: { days: 30, storage_limit_gb: 0 },
        },
        feature_flags: {
          show_analyzed_files_csv_export: false,
          show_full_width_app_shell: false,
          hide_quality_score_meter: false,
          unlimited_panel_size: false,
        },
      }),
    );
  });

  it("persists the analyzed files CSV export feature flag", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        feature_flags: {
          show_analyzed_files_csv_export: true,
          show_full_width_app_shell: false,
          hide_quality_score_meter: false,
          unlimited_panel_size: false,
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
        scan_performance: {
          scan_worker_count: 4,
          parallel_scan_jobs: 2,
          comparison_scatter_point_limit: 5000,
        },
        history_retention: {
          file_history: { days: 30, storage_limit_gb: 0 },
          library_history: { days: 365, storage_limit_gb: 0 },
          scan_history: { days: 30, storage_limit_gb: 0 },
        },
        feature_flags: {
          show_analyzed_files_csv_export: true,
          show_full_width_app_shell: false,
          hide_quality_score_meter: false,
          unlimited_panel_size: false,
        },
      }),
    );
  });

  it("persists the full-width app shell feature flag", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        feature_flags: {
          show_analyzed_files_csv_export: false,
          show_full_width_app_shell: true,
          hide_quality_score_meter: false,
          unlimited_panel_size: false,
        },
      }),
    );

    renderPage();

    const checkbox = await screen.findByLabelText("Use full-width app shell");
    await screen.findByDisplayValue("movie.tmp");
    await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        user_ignore_patterns: ["movie.tmp"],
        default_ignore_patterns: ["*/@eaDir/*"],
        scan_performance: {
          scan_worker_count: 4,
          parallel_scan_jobs: 2,
          comparison_scatter_point_limit: 5000,
        },
        history_retention: {
          file_history: { days: 30, storage_limit_gb: 0 },
          library_history: { days: 365, storage_limit_gb: 0 },
          scan_history: { days: 30, storage_limit_gb: 0 },
        },
        feature_flags: {
          show_analyzed_files_csv_export: false,
          show_full_width_app_shell: true,
          hide_quality_score_meter: false,
          unlimited_panel_size: false,
        },
      }),
    );
  });

  it("persists the hide quality score meter feature flag", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        feature_flags: {
          show_analyzed_files_csv_export: false,
          show_full_width_app_shell: false,
          hide_quality_score_meter: true,
          unlimited_panel_size: false,
        },
      }),
    );

    renderPage();

    const checkbox = await screen.findByLabelText("Hide quality score meter");
    await screen.findByDisplayValue("movie.tmp");
    await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        user_ignore_patterns: ["movie.tmp"],
        default_ignore_patterns: ["*/@eaDir/*"],
        scan_performance: {
          scan_worker_count: 4,
          parallel_scan_jobs: 2,
          comparison_scatter_point_limit: 5000,
        },
        history_retention: {
          file_history: { days: 30, storage_limit_gb: 0 },
          library_history: { days: 365, storage_limit_gb: 0 },
          scan_history: { days: 30, storage_limit_gb: 0 },
        },
        feature_flags: {
          show_analyzed_files_csv_export: false,
          show_full_width_app_shell: false,
          hide_quality_score_meter: true,
          unlimited_panel_size: false,
        },
      }),
    );
  });

  it("persists the unlimited panel size feature flag", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        feature_flags: {
          show_analyzed_files_csv_export: false,
          show_full_width_app_shell: false,
          hide_quality_score_meter: false,
          unlimited_panel_size: true,
        },
      }),
    );

    renderPage();

    const checkbox = await screen.findByLabelText("Unlimited panel size");
    await screen.findByDisplayValue("movie.tmp");
    await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        user_ignore_patterns: ["movie.tmp"],
        default_ignore_patterns: ["*/@eaDir/*"],
        scan_performance: {
          scan_worker_count: 4,
          parallel_scan_jobs: 2,
          comparison_scatter_point_limit: 5000,
        },
        history_retention: {
          file_history: { days: 30, storage_limit_gb: 0 },
          library_history: { days: 365, storage_limit_gb: 0 },
          scan_history: { days: 30, storage_limit_gb: 0 },
        },
        feature_flags: {
          show_analyzed_files_csv_export: false,
          show_full_width_app_shell: false,
          hide_quality_score_meter: false,
          unlimited_panel_size: true,
        },
      }),
    );
  });

  it("persists scan performance limits from app settings", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        scan_performance: {
          scan_worker_count: 6,
          parallel_scan_jobs: 3,
          comparison_scatter_point_limit: 5000,
        },
      }),
    );

    renderPage();

    const scanWorkerInput = (await screen.findByLabelText("Per-scan analysis workers")) as HTMLSelectElement;
    const parallelScanInput = screen.getByLabelText("Parallel library scans") as HTMLSelectElement;
    await waitFor(() => {
      expect(scanWorkerInput).toBeEnabled();
      expect(parallelScanInput).toBeEnabled();
    });
    expect(parallelScanInput.value).toBe("2");

    fireEvent.change(scanWorkerInput, { target: { value: "6" } });
    fireEvent.change(parallelScanInput, { target: { value: "3" } });
    fireEvent.blur(parallelScanInput);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        user_ignore_patterns: ["movie.tmp"],
        default_ignore_patterns: ["*/@eaDir/*"],
        scan_performance: {
          scan_worker_count: 6,
          parallel_scan_jobs: 3,
          comparison_scatter_point_limit: 5000,
        },
        history_retention: {
          file_history: { days: 30, storage_limit_gb: 0 },
          library_history: { days: 365, storage_limit_gb: 0 },
          scan_history: { days: 30, storage_limit_gb: 0 },
        },
        feature_flags: {
          show_analyzed_files_csv_export: false,
          show_full_width_app_shell: false,
          hide_quality_score_meter: false,
          unlimited_panel_size: false,
        },
      }),
    );
  });

  it("persists the comparison scatter point limit from app settings", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        scan_performance: {
          scan_worker_count: 4,
          parallel_scan_jobs: 2,
          comparison_scatter_point_limit: 10000,
        },
      }),
    );

    renderPage();

    const scatterPointLimitInput = (await screen.findByLabelText("Scatter plot points")) as HTMLSelectElement;
    await screen.findByDisplayValue("movie.tmp");
    await waitFor(() => expect(scatterPointLimitInput).toBeEnabled());

    fireEvent.change(scatterPointLimitInput, { target: { value: "10000" } });

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        user_ignore_patterns: ["movie.tmp"],
        default_ignore_patterns: ["*/@eaDir/*"],
        scan_performance: {
          scan_worker_count: 4,
          parallel_scan_jobs: 2,
          comparison_scatter_point_limit: 10000,
        },
        history_retention: {
          file_history: { days: 30, storage_limit_gb: 0 },
          library_history: { days: 365, storage_limit_gb: 0 },
          scan_history: { days: 30, storage_limit_gb: 0 },
        },
        feature_flags: {
          show_analyzed_files_csv_export: false,
          show_full_width_app_shell: false,
          hide_quality_score_meter: false,
          unlimited_panel_size: false,
        },
      }),
    );
  });

  it("shows the scatter plot point limit under the plots and charts section", async () => {
    renderPage();

    const sectionTitle = await screen.findByText("Plots & Charts");
    const settingsSection = sectionTitle.closest(".app-settings-section") as HTMLElement | null;
    expect(settingsSection).not.toBeNull();
    if (!settingsSection) {
      return;
    }

    expect(within(settingsSection).getByLabelText("Scatter plot points")).toBeInTheDocument();
    expect(within(settingsSection).queryByLabelText("Per-scan analysis workers")).not.toBeInTheDocument();
    expect(within(settingsSection).queryByLabelText("Parallel library scans")).not.toBeInTheDocument();
  });

  it("renders history retention rows with storage forecast values", async () => {
    renderPage();

    expect(await screen.findByText("History retention")).toBeInTheDocument();
    expect(screen.getAllByText("File history")).toHaveLength(2);
    expect(screen.getAllByText("Media library history")).toHaveLength(2);
    expect(screen.getAllByText("Scan history")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Reconstruct history" })).toBeInTheDocument();
    expect(screen.getAllByText("0 = unlimited").length).toBeGreaterThan(0);
    expect(screen.getByText(/File history retention only affects per-file snapshots/)).toBeInTheDocument();
    expect(await screen.findByText("977 KB")).toBeInTheDocument();
    expect((await screen.findAllByText("2.9 MB")).length).toBeGreaterThan(0);
  });

  it("shows live reconstruction progress inside the history retention panel", async () => {
    vi.spyOn(api, "historyReconstructionStatus").mockResolvedValue(
      createHistoryReconstructionStatus({
        status: "running",
        phase: "reconstructing_file_history",
        progress_percent: 25,
        libraries_total: 4,
        libraries_processed: 1,
        current_library_name: "Movies",
        phase_total: 200,
        phase_completed: 50,
        created_file_history_entries: 12,
        created_library_history_entries: 3,
      }),
    );

    renderPage();

    expect(await screen.findByText("Reconstructing file history")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("50 of 200 media files")).toBeInTheDocument();
    expect(screen.getByText("1 of 4 libraries")).toBeInTheDocument();
    expect(screen.getByText("Current library: Movies")).toBeInTheDocument();
  });

  it("reconstructs approximate history and refreshes the storage forecast", async () => {
    const reconstructSpy = vi.spyOn(api, "reconstructHistory").mockResolvedValue(
      createHistoryReconstructionStatus({
        status: "running",
        phase: "reconstructing_file_history",
        progress_percent: 40,
        libraries_total: 2,
        libraries_processed: 0,
        current_library_name: "Movies",
        phase_total: 10,
        phase_completed: 4,
      }),
    );
    const historyStatusSpy = vi
      .spyOn(api, "historyReconstructionStatus")
      .mockResolvedValueOnce(createHistoryReconstructionStatus())
      .mockResolvedValueOnce(
        createHistoryReconstructionStatus({
          status: "completed",
          phase: "completed",
          progress_percent: 100,
          libraries_total: 2,
          libraries_processed: 2,
          libraries_with_media: 2,
          created_library_history_entries: 12,
          created_file_history_entries: 4,
          result: createHistoryReconstructionResult({
            created_library_history_entries: 12,
            created_file_history_entries: 4,
          }),
        }),
      );
    const historyStorageSpy = vi
      .spyOn(api, "historyStorage")
      .mockResolvedValueOnce(createHistoryStorage())
      .mockResolvedValueOnce(createHistoryStorage());

    renderPage();

    const button = await screen.findByRole("button", { name: "Reconstruct history" });
    fireEvent.click(button);

    await waitFor(() => expect(reconstructSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(historyStatusSpy).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await waitFor(() => expect(historyStorageSpy).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(
      await screen.findByText("Reconstructed 12 library snapshots and 4 initial file-history entries."),
    ).toBeInTheDocument();
  });

  it("persists history retention values and refreshes the storage forecast", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        history_retention: {
          file_history: { days: 120, storage_limit_gb: 1.5 },
          library_history: { days: 365, storage_limit_gb: 0 },
          scan_history: { days: 30, storage_limit_gb: 0 },
        },
      }),
    );
    const historyStorageSpy = vi
      .spyOn(api, "historyStorage")
      .mockResolvedValueOnce(createHistoryStorage())
      .mockResolvedValueOnce(
        createHistoryStorage({
          categories: {
            ...createHistoryStorage().categories,
            file_history: {
              ...createHistoryStorage().categories.file_history,
              days_limit: 120,
              storage_limit_bytes: 1610612736,
            },
          },
        }),
      );

    renderPage();

    await screen.findByDisplayValue("movie.tmp");
    const daysInput = (await screen.findByLabelText("Retention days", {
      selector: "#file_history-history-days",
    })) as HTMLInputElement;
    const storageInput = screen.getByLabelText("Storage limit (GB)", {
      selector: "#file_history-history-gb",
    }) as HTMLInputElement;
    expect(daysInput.value).toBe("30");
    expect(storageInput.value).toBe("0");
    fireEvent.change(daysInput, { target: { value: "120" } });
    fireEvent.change(storageInput, { target: { value: "1.5" } });
    fireEvent.blur(storageInput);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        user_ignore_patterns: ["movie.tmp"],
        default_ignore_patterns: ["*/@eaDir/*"],
        scan_performance: {
          scan_worker_count: 4,
          parallel_scan_jobs: 2,
          comparison_scatter_point_limit: 5000,
        },
        history_retention: {
          file_history: { days: 120, storage_limit_gb: 1.5 },
          library_history: { days: 365, storage_limit_gb: 0 },
          scan_history: { days: 30, storage_limit_gb: 0 },
        },
        feature_flags: {
          show_analyzed_files_csv_export: false,
          show_full_width_app_shell: false,
          hide_quality_score_meter: false,
          unlimited_panel_size: false,
        },
      }),
    );
    await waitFor(() => expect(historyStorageSpy).toHaveBeenCalledTimes(2));
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

  it("shows recognized codec options in quality score settings", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrarySummary()]);

    renderPage();

    await screen.findByText("Movies");
    fireEvent.click(screen.getByRole("button", { name: "Quality score" }));

    const videoCodecTitle = await screen.findByText("Video codec");
    const videoCodecGroup = videoCodecTitle.closest(".quality-settings-group");
    if (!(videoCodecGroup instanceof HTMLElement)) {
      throw new Error("Expected video codec settings group");
    }
    fireEvent.click(within(videoCodecGroup).getAllByRole("button")[0]);
    expect(await within(videoCodecGroup).findByRole("menuitemcheckbox", { name: "VP9" })).toBeInTheDocument();
    expect(within(videoCodecGroup).getByRole("menuitemcheckbox", { name: "Apple ProRes" })).toBeInTheDocument();

    const audioCodecTitle = await screen.findByText("Audio codec");
    const audioCodecGroup = audioCodecTitle.closest(".quality-settings-group");
    if (!(audioCodecGroup instanceof HTMLElement)) {
      throw new Error("Expected audio codec settings group");
    }
    fireEvent.click(within(audioCodecGroup).getAllByRole("button")[0]);
    expect(await within(audioCodecGroup).findByRole("menuitemcheckbox", { name: "Opus" })).toBeInTheDocument();
    expect(within(audioCodecGroup).getByRole("menuitemcheckbox", { name: "Vorbis" })).toBeInTheDocument();
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

  it("shows duplicate detection settings and auto-saves the selected mode", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrarySummary()]);
    const updateSpy = vi.spyOn(api, "updateLibrarySettings").mockResolvedValue(
      createLibrarySummary({ duplicate_detection_mode: "both" }),
    );

    renderPage();

    await screen.findByText("Movies");
    fireEvent.change(screen.getByLabelText("Duplicate detection"), { target: { value: "both" } });

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          duplicate_detection_mode: "both",
        }),
      ),
    );
  });

  it("shows the duplicate detection hint in a tooltip instead of inline text", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrarySummary()]);

    renderPage();

    await screen.findByText("Movies");
    expect(
      screen.queryByText("Off disables duplicate detection. Filename is fast and approximate. File hash is exact but significantly more expensive during scans. Both stores and shows both duplicate views."),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Explain duplicate detection modes" }));

    expect(
      await screen.findByText("Off disables duplicate detection. Filename is fast and approximate. File hash is exact but significantly more expensive during scans. Both stores and shows both duplicate views."),
    ).toBeInTheDocument();
  });
});

describe("LibrariesPage settings panels", () => {
  it("does not show the old centralized table-view settings panel", async () => {
    renderPage();

    await screen.findByRole("button", { name: /^configured libraries$/i });
    expect(screen.queryByRole("button", { name: /^table view$/i })).not.toBeInTheDocument();
  });

  it("shows the main settings panels expanded by default", async () => {
    renderPage();

    const appSettingsToggle = await screen.findByRole("button", { name: /^app settings$/i });
    const resolutionCategoriesToggle = screen.getByRole("button", { name: /^resolution categories$/i });
    const historyRetentionToggle = screen.getByRole("button", { name: /^history retention$/i });

    expect(appSettingsToggle).toHaveAttribute("aria-expanded", "true");
    expect(resolutionCategoriesToggle).toHaveAttribute("aria-expanded", "true");
    expect(historyRetentionToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Interface language")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add resolution category" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore defaults" })).toBeInTheDocument();
  });

  it("places the history retention panel between resolution categories and recent scan logs", async () => {
    renderPage();

    const resolutionPanel = (await screen.findByRole("button", { name: /^resolution categories$/i })).closest(
      ".async-panel",
    ) as HTMLElement | null;
    const historyRetentionPanel = screen.getByRole("button", { name: /^history retention$/i }).closest(
      ".async-panel",
    ) as HTMLElement | null;
    const recentScanLogsPanel = screen.getByRole("button", { name: /^recent scan logs$/i }).closest(
      ".async-panel",
    ) as HTMLElement | null;

    expect(resolutionPanel).not.toBeNull();
    expect(historyRetentionPanel).not.toBeNull();
    expect(recentScanLogsPanel).not.toBeNull();

    if (!resolutionPanel || !historyRetentionPanel || !recentScanLogsPanel) {
      return;
    }

    expect(resolutionPanel.compareDocumentPosition(historyRetentionPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(historyRetentionPanel.compareDocumentPosition(recentScanLogsPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("restores persisted settings panel state from localStorage", async () => {
    window.localStorage.setItem(
      "medialyze-settings-panel-state",
      JSON.stringify({
        configuredLibraries: false,
        historyRetention: false,
        recentScanLogs: true,
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
    const historyRetentionToggle = screen.getByRole("button", { name: /^history retention$/i });
    const appSettingsToggle = screen.getByRole("button", { name: /^app settings$/i });

    expect(configuredToggle).toHaveAttribute("aria-expanded", "false");
    expect(ignorePatternsToggle).toHaveAttribute("aria-expanded", "false");
    expect(resolutionCategoriesToggle).toHaveAttribute("aria-expanded", "false");
    expect(historyRetentionToggle).toHaveAttribute("aria-expanded", "false");
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
        historyRetention: true,
        recentScanLogs: true,
        resolutionCategories: true,
        createLibrary: true,
        ignorePatterns: true,
        appSettings: false,
      }),
    );
  });

  it("queues a full scan for all configured libraries from the panel header", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([
      createLibrarySummary(),
      createLibrarySummary({ id: 2, name: "Series", path: "/media/series", type: "series" }),
    ]);
    const scanSpy = vi
      .spyOn(api, "scanLibrary")
      .mockResolvedValueOnce(createScanJob({ id: 31, library_id: 1, library_name: "Movies", job_type: "full" }))
      .mockResolvedValueOnce(createScanJob({ id: 32, library_id: 2, library_name: "Series", job_type: "full" }));

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /^full scan$/i }));

    await waitFor(() => {
      expect(scanSpy).toHaveBeenNthCalledWith(1, 1, "full");
      expect(scanSpy).toHaveBeenNthCalledWith(2, 2, "full");
    });
  });

  it("moves library details into a title tooltip and keeps badges in the title area", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrarySummary()]);

    renderPage();

    expect(screen.queryByText("/media/movies")).not.toBeInTheDocument();

    const detailsButton = await screen.findByRole("button", { name: "Show library details for Movies" });
    const titleMain = screen.getByRole("link", { name: "Movies" }).closest(".library-title-main") as HTMLElement | null;
    expect(titleMain).not.toBeNull();
    if (!titleMain) {
      return;
    }

    const titleArea = within(titleMain);
    expect(titleArea.getByRole("link", { name: "Movies" })).toBeInTheDocument();
    expect(titleArea.getByText("Manual")).toBeInTheDocument();

    fireEvent.mouseEnter(detailsButton);

    expect(await screen.findByText("/media/movies")).toBeInTheDocument();
    expect(screen.getByText("0 files")).toBeInTheDocument();
  });

  it("toggles dashboard visibility from the library action button and refreshes dashboard data", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrarySummary()]);
    const updateSpy = vi
      .spyOn(api, "updateLibrarySettings")
      .mockResolvedValue(createLibrarySummary({ show_on_dashboard: false }));
    const dashboardSpy = vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard({ totals: { libraries: 0, files: 0, storage_bytes: 0, duration_seconds: 0 } }));

    renderPage();

    const toggleButton = await screen.findByRole("button", { name: "Hide library Movies from dashboard" });
    expect(toggleButton).toHaveAttribute("title", "Exclude this library from dashboard statistics");

    fireEvent.click(toggleButton);

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(1, { show_on_dashboard: false }));
    await waitFor(() => expect(dashboardSpy).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Show library Movies on dashboard" })).toBeInTheDocument();
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
            failed_files: [{ path: "broken.mkv", reason: "ffprobe exploded", detail: "Traceback line 1\nTraceback line 2" }],
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
    expect(await screen.findByText("Duplicate processing")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Ignore patterns")[1]);
    expect((await screen.findAllByText("sample.*")).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByText("Files that could not be analyzed"));
    expect(await screen.findByText("ffprobe exploded")).toBeInTheDocument();
    expect(await screen.findByRole("button", {
      name: "Copy troubleshooting details for broken.mkv",
    })).toBeInTheDocument();
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
