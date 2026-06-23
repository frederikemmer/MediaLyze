import i18n from "../i18n";

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
  type QualityProfileDefinition,
  type RecentScanJobPage,
  type RecentScanJob,
  type ScanJob,
  type ScanJobDetail,
} from "../lib/api";
import { ScanJobsProvider } from "../lib/scan-jobs";
import type { SettingsPanelId } from "../lib/settings-panel-state";
import { LibrariesPage } from "./LibrariesPage";

type AppSettingsOverrides = Omit<
  Partial<AppSettings>,
  "scan_performance" | "feature_flags" | "history_retention" | "ui_preferences"
> & {
  scan_performance?: Partial<NonNullable<AppSettings["scan_performance"]>>;
  history_retention?: {
    file_history?: Partial<NonNullable<AppSettings["history_retention"]>["file_history"]>;
    library_history?: Partial<NonNullable<AppSettings["history_retention"]>["library_history"]>;
    scan_history?: Partial<NonNullable<AppSettings["history_retention"]>["scan_history"]>;
  };
  feature_flags?: Partial<AppSettings["feature_flags"]>;
  ui_preferences?: Partial<NonNullable<AppSettings["ui_preferences"]>>;
};

function createAppSettings(overrides: AppSettingsOverrides = {}): AppSettings {
  const {
    feature_flags: overrideFeatureFlags = {},
    scan_performance: overrideScanPerformance = {},
    history_retention: overrideHistoryRetention = {},
    ui_preferences: overrideUiPreferences = {},
    ...restOverrides
  } = overrides;
  return {
    ignore_patterns: ["movie.tmp", "*/@eaDir/*"],
    user_ignore_patterns: ["movie.tmp"],
    default_ignore_patterns: ["*/@eaDir/*"],
    pattern_recognition: {
      analyze_bonus_content: true,
      show_season_patterns: {
        recognition_mode: "folder_depth",
        series_folder_depth: 1,
        season_folder_depth: 2,
        series_folder_regexes: ["^(?P<title>.+?)(?:\\s+\\((?P<year>\\d{4})\\))?(?:\\s+\\[[^\\]]+\\])?$"],
        season_folder_regexes: [
          "^(?:Season|Staffel)\\s*(?P<season>\\d{1,3})(?:\\s+\\([^)]*\\))?(?:\\s+\\[[^\\]]+\\])*$",
        ],
      },
      bonus_content: {
        user_folder_patterns: [],
        default_folder_patterns: ["extras/*"],
        effective_folder_patterns: ["extras/*"],
        user_file_patterns: [],
        default_file_patterns: [],
        effective_file_patterns: [],
      },
    },
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
    ui_preferences: {
      interface_language: "en",
      color_theme: "system",
      ...overrideUiPreferences,
    },
    telemetry: {
      mode: "none",
      environment_disabled: false,
      installation_id: null,
      installation_id_suffix: null,
      last_sent_at: null,
      last_user_visible_payload: null,
    },
    feature_flags: {
      show_analyzed_files_csv_export: false,
      show_full_width_app_shell: false,
      hide_quality_score_meter: false,
      show_music_quality_score: false,
      unlimited_panel_size: false,
      in_depth_dolby_vision_profiles: false,
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
    quality_profile_id: null,
    show_on_dashboard: true,
    file_count: 0,
    total_size_bytes: 0,
    total_duration_seconds: 0,
    ready_files: 0,
    pending_files: 0,
    ...overrides,
  };
}

function createQualityProfileDefinition(overrides: Partial<QualityProfileDefinition> = {}): QualityProfileDefinition {
  return {
    id: 1,
    name: "Default video",
    media_type: "video",
    profile: DEFAULT_QUALITY_PROFILE,
    is_default: true,
    is_builtin: false,
    created_at: "2026-03-15T12:00:00Z",
    updated_at: "2026-03-15T12:00:00Z",
    library_count: 0,
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
    video_bit_depth_distribution: [],
    bit_depth_distribution: [],
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

function renderPage({
  seedExpandedPanels = true,
  activePanel,
}: {
  seedExpandedPanels?: boolean;
  activePanel?: SettingsPanelId;
} = {}) {
  if (activePanel) {
    window.localStorage.setItem("medialyze-settings-active-panel", activePanel);
  }
  if (seedExpandedPanels) {
    if (!window.localStorage.getItem("medialyze-pattern-recognition-sections")) {
      window.localStorage.setItem(
        "medialyze-pattern-recognition-sections",
        JSON.stringify({
          series_folder_regexes: true,
          season_folder_regexes: true,
          bonus_folder_patterns: true,
        }),
      );
    }
    if (!window.localStorage.getItem("medialyze-ignore-pattern-sections")) {
      window.localStorage.setItem(
        "medialyze-ignore-pattern-sections",
        JSON.stringify({ combinedExpanded: true }),
      );
    }
  }
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
  vi.spyOn(api, "telemetryPreview").mockResolvedValue({
    mode: "minimal",
    redacted: true,
    payload: {
      telemetry_mode: "minimal",
      app: { name: "MediaLyze" },
      system: { os_family: "darwin" },
    },
  });
  vi.spyOn(api, "telemetrySendNow").mockResolvedValue(createAppSettings());
  vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);
  vi.spyOn(api, "recentScanJobs").mockResolvedValue(createRecentScanJobPage());
  vi.spyOn(api, "scanJobDetail").mockResolvedValue(createScanJobDetail());
  vi.spyOn(api, "updateAppSettings").mockResolvedValue(createAppSettings());
  vi.spyOn(api, "qualityProfiles").mockResolvedValue([createQualityProfileDefinition()]);
  vi.spyOn(api, "createQualityProfile").mockResolvedValue(createQualityProfileDefinition({ id: 2, name: "New video profile", is_default: false }));
  vi.spyOn(api, "updateQualityProfile").mockResolvedValue(createQualityProfileDefinition());
  vi.spyOn(api, "deleteQualityProfile").mockResolvedValue(undefined);
  delete window.medialyzeDesktop;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
  void i18n.changeLanguage("en");
});

describe("LibrariesPage ignore patterns", () => {
  it("keeps the combined ignore-pattern section collapsed by default", async () => {
    renderPage({ seedExpandedPanels: false, activePanel: "patternRecognition" });

    fireEvent.click(await screen.findByRole("button", { name: /^pattern recognition$/i }));
    const combinedToggle = await screen.findByRole("button", { name: /^ignore patterns\d+$/i });
    const bonusFolderToggle = screen.getByRole("button", { name: /^bonus folder patterns\d+$/i });

    expect(combinedToggle).toHaveAttribute("aria-expanded", "false");
    expect(bonusFolderToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Add a new ignore pattern")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("*/@eaDir/*")).not.toBeInTheDocument();
  });

  it("restores the persisted collapse state from localStorage", async () => {
    window.localStorage.setItem(
      "medialyze-ignore-pattern-sections",
      JSON.stringify({ combinedExpanded: false }),
    );

    renderPage({ seedExpandedPanels: false, activePanel: "patternRecognition" });

    const combinedToggle = await screen.findByRole("button", { name: /^ignore patterns\d+$/i });

    expect(combinedToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByDisplayValue("*/@eaDir/*")).not.toBeInTheDocument();
  });

  it("saves combined ignore patterns through the shared section", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        ignore_patterns: ["movie.tmp", "*/#recycle/*"],
        user_ignore_patterns: ["movie.tmp", "*/#recycle/*"],
        default_ignore_patterns: [],
      }),
    );

    renderPage({ activePanel: "patternRecognition" });

    const defaultInput = await screen.findByDisplayValue("*/@eaDir/*");
    fireEvent.change(defaultInput, { target: { value: "*/#recycle/*" } });
    fireEvent.blur(defaultInput);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        user_ignore_patterns: ["movie.tmp", "*/#recycle/*"],
        default_ignore_patterns: [],
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
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: false,
        },
      }),
    );
  });

  it("restores built-in ignore defaults from the shared section", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        ignore_patterns: ["*/@eaDir/*"],
        user_ignore_patterns: [],
        default_ignore_patterns: ["*/@eaDir/*"],
      }),
    );

    renderPage({ activePanel: "patternRecognition" });

    const restoreButton = await screen.findByRole("button", { name: "Restore ignore defaults" });
    fireEvent.click(restoreButton);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        user_ignore_patterns: [],
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
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: false,
        },
      }),
    );
  });

  it("persists bonus-content folder recognition settings through app settings", async () => {
    const patternRecognition = {
      analyze_bonus_content: true,
      show_season_patterns: {
        recognition_mode: "folder_depth" as const,
        series_folder_depth: 1,
        season_folder_depth: 2,
        series_folder_regexes: ["^(?<title>.+)$"],
        season_folder_regexes: ["^Season (?<season>\\d+)$"],
      },
      bonus_content: {
        user_folder_patterns: ["Custom Extras/*"],
        default_folder_patterns: ["extras/*"],
        effective_folder_patterns: ["Custom Extras/*", "extras/*"],
        user_file_patterns: [],
        default_file_patterns: [],
        effective_file_patterns: [],
      },
    };
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        pattern_recognition: patternRecognition,
      }),
    );
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings({ pattern_recognition: patternRecognition }));

    renderPage({ activePanel: "patternRecognition" });

    await screen.findByDisplayValue("Custom Extras/*");
    const bonusInput = screen.getByDisplayValue("Custom Extras/*");
    fireEvent.change(bonusInput, { target: { value: "Featurettes/*" } });
    fireEvent.blur(bonusInput);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        pattern_recognition: {
          analyze_bonus_content: true,
          show_season_patterns: patternRecognition.show_season_patterns,
          bonus_content: {
            user_folder_patterns: ["Featurettes/*", "extras/*"],
            default_folder_patterns: [],
            user_file_patterns: [],
            default_file_patterns: [],
          },
        },
      }),
    );
  });

  it("defaults show and season recognition to folder depth and hides regex inputs", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());

    renderPage({ activePanel: "patternRecognition" });

    expect(await screen.findByDisplayValue("Folder depth")).toBeInTheDocument();
    expect(screen.getByLabelText("Series folder depth")).toHaveValue("1");
    expect(screen.getByLabelText("Season folder depth")).toHaveValue("2");
    expect(screen.queryByText("Series folder regexes")).not.toBeInTheDocument();
    expect(screen.queryByText("Season folder regexes")).not.toBeInTheDocument();
  });

  it("switches show and season recognition to regex mode and persists the selection", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        pattern_recognition: {
          analyze_bonus_content: true,
          show_season_patterns: {
            recognition_mode: "regex",
            series_folder_depth: 1,
            season_folder_depth: 2,
            series_folder_regexes: ["^(?<title>.+)$"],
            season_folder_regexes: ["^Season (?<season>\\d+)$"],
          },
          bonus_content: {
            user_folder_patterns: [],
            default_folder_patterns: ["extras/*"],
            effective_folder_patterns: ["extras/*"],
            user_file_patterns: [],
            default_file_patterns: [],
            effective_file_patterns: [],
          },
        },
      }),
    );
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());

    renderPage({ activePanel: "patternRecognition" });

    fireEvent.change(await screen.findByDisplayValue("Folder depth"), { target: { value: "regex" } });

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        pattern_recognition: {
          analyze_bonus_content: true,
          show_season_patterns: {
            recognition_mode: "regex",
            series_folder_depth: 1,
            season_folder_depth: 2,
            series_folder_regexes: [
              "^(?P<title>.+?)(?:\\s+\\((?P<year>\\d{4})\\))?(?:\\s+\\[[^\\]]+\\])?$",
            ],
            season_folder_regexes: [
              "^(?:Season|Staffel)\\s*(?P<season>\\d{1,3})(?:\\s+\\([^)]*\\))?(?:\\s+\\[[^\\]]+\\])*$",
            ],
          },
          bonus_content: {
            user_folder_patterns: [],
            default_folder_patterns: expect.any(Array),
            user_file_patterns: [],
            default_file_patterns: [],
          },
        },
      }),
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it("persists the analyzed files CSV export feature flag", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        feature_flags: {
          show_analyzed_files_csv_export: true,
          show_full_width_app_shell: false,
          hide_quality_score_meter: false,
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: false,
        },
      }),
    );

    renderPage({ activePanel: "appSettings" });

    const checkbox = await screen.findByLabelText("Show analyzed-files CSV export");
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
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: false,
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
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: false,
        },
      }),
    );

    renderPage({ activePanel: "appSettings" });

    const checkbox = await screen.findByLabelText("Use full-width app shell");
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
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: false,
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
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: false,
        },
      }),
    );

    renderPage({ activePanel: "appSettings" });

    const checkbox = await screen.findByLabelText("Hide quality score meter");
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
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: false,
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
          show_music_quality_score: false,
          unlimited_panel_size: true,
          in_depth_dolby_vision_profiles: false,
        },
      }),
    );

    renderPage({ activePanel: "appSettings" });

    const checkbox = await screen.findByLabelText("Unlimited panel size");
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
          show_music_quality_score: false,
          unlimited_panel_size: true,
          in_depth_dolby_vision_profiles: false,
        },
      }),
    );
  });

  it("persists the in-depth Dolby Vision profiles feature flag", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        feature_flags: {
          show_analyzed_files_csv_export: false,
          show_full_width_app_shell: false,
          hide_quality_score_meter: false,
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: true,
        },
      }),
    );

    renderPage({ activePanel: "appSettings" });

    const checkbox = await screen.findByLabelText("In-depth Dolby Vision profiles");
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
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: true,
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

    renderPage({ activePanel: "appSettings" });

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
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: false,
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

    renderPage({ activePanel: "appSettings" });

    const scatterPointLimitInput = (await screen.findByLabelText("Scatter plot points")) as HTMLSelectElement;
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
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: false,
        },
      }),
    );
  });

  it("shows the scatter plot point limit under the plots and charts section", async () => {
    renderPage({ activePanel: "appSettings" });

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
    renderPage({ activePanel: "historyRetention" });

    expect(await screen.findByRole("heading", { name: "History retention" })).toBeInTheDocument();
    expect(screen.getAllByText("File history")).toHaveLength(2);
    expect(screen.getAllByText("Media library history")).toHaveLength(2);
    expect(screen.getAllByText("Scan history")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Reconstruct history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explain retention days" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explain storage limit" })).toBeInTheDocument();
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

    renderPage({ activePanel: "historyRetention" });

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

    renderPage({ activePanel: "historyRetention" });

    const button = await screen.findByRole("button", { name: "Reconstruct history" });
    fireEvent.click(button);

    await waitFor(() => expect(reconstructSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(historyStatusSpy).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await waitFor(() => expect(historyStorageSpy).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const reconstructionMessage = await screen.findByText(
      "Reconstructed 12 library snapshots and 4 initial file-history entries.",
    );
    expect(reconstructionMessage).toBeInTheDocument();
    expect(reconstructionMessage).toHaveClass("alert", "success");
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

    renderPage({ activePanel: "historyRetention" });

    const daysInput = (await screen.findByLabelText("Retention days", {
      selector: "#file_history-history-days",
    })) as HTMLInputElement;
    const storageInput = screen.getByLabelText("Storage limit (GB)", {
      selector: "#file_history-history-gb",
    }) as HTMLInputElement;
    expect(daysInput.value).toBe("30");
    expect(storageInput.value).toBe("0");
    await waitFor(() => expect(daysInput).toBeEnabled());
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
          show_music_quality_score: false,
          unlimited_panel_size: false,
          in_depth_dolby_vision_profiles: false,
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

    renderPage({ activePanel: "resolutionCategories" });

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

    renderPage({ activePanel: "resolutionCategories" });

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
    renderPage({ activePanel: "resolutionCategories" });

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

    renderPage({ activePanel: "resolutionCategories" });

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

  it("shows active metrics in the quality profiles settings panel", async () => {
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

    renderPage({ activePanel: "configuredLibraries" });

    fireEvent.click(await screen.findByRole("button", { name: "Quality profiles" }));
    expect(await screen.findByText("Visual density")).toBeInTheDocument();
    expect(screen.getByText("Video codec")).toBeInTheDocument();
  });

  it("shows built-in quality profiles as protected and read-only", async () => {
    vi.spyOn(api, "qualityProfiles").mockResolvedValue([
      createQualityProfileDefinition({
        is_builtin: true,
        profile: {
          ...DEFAULT_QUALITY_PROFILE,
          active_metrics: ["resolution", "visual_density"],
        },
      }),
    ]);
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrarySummary()]);

    renderPage({ activePanel: "qualityProfiles" });

    expect(await screen.findByRole("button", { name: "Built-in default profile protection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename profile" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete profile" })).toBeDisabled();
    expect(screen.getByLabelText("Add metric")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Configure Visual density metric" }));
    expect(await screen.findByLabelText("Minimum (GB/hour)")).toBeDisabled();
    expect(screen.getAllByLabelText("Explain metric weight").every((input) => input.hasAttribute("disabled"))).toBe(true);
  });

  it("edits visual density profile values as 1080p-equivalent GB per hour", async () => {
    const updateSpy = vi.spyOn(api, "updateQualityProfile").mockResolvedValue(createQualityProfileDefinition());

    renderPage({ activePanel: "qualityProfiles" });

    fireEvent.click(await screen.findByRole("button", { name: "Configure Visual density metric" }));
    const minimumInput = await screen.findByLabelText("Minimum (GB/hour)");
    const idealInput = screen.getByLabelText("Ideal (GB/hour)");
    const maximumInput = screen.getByLabelText("Maximum (GB/hour)");
    expect(minimumInput).toHaveValue(1.2);
    expect(idealInput).toHaveValue(2.4);
    expect(maximumInput).toHaveValue(4.8);

    fireEvent.change(idealInput, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          profile: expect.objectContaining({
            visual_density: expect.objectContaining({
              minimum: 0.02,
              ideal: 0.05,
              maximum: 0.08,
            }),
          }),
        }),
      ),
    );
  });

  it("adds and removes metrics in quality score profiles", async () => {
    const updateSpy = vi.spyOn(api, "updateQualityProfile").mockResolvedValue(
      createQualityProfileDefinition({
        profile: {
          ...DEFAULT_QUALITY_PROFILE,
          active_metrics: ["audio_channels", "audio_codec", "music_tags"],
        },
      }),
    );
    vi.spyOn(api, "qualityProfiles").mockResolvedValue([
      createQualityProfileDefinition({
        id: 2,
        name: "Default music",
        media_type: "music",
        is_default: true,
        profile: {
          ...DEFAULT_QUALITY_PROFILE,
          active_metrics: ["audio_channels", "audio_codec"],
          resolution: { ...DEFAULT_QUALITY_PROFILE.resolution, weight: 0 },
          visual_density: { ...DEFAULT_QUALITY_PROFILE.visual_density, weight: 0 },
          video_codec: { ...DEFAULT_QUALITY_PROFILE.video_codec, weight: 0 },
          dynamic_range: { ...DEFAULT_QUALITY_PROFILE.dynamic_range, weight: 0 },
          music_tags: { weight: 0, minimum: "partial", ideal: "complete" },
        },
      }),
    ]);
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrarySummary()]);

    renderPage({ activePanel: "qualityProfiles" });

    fireEvent.click(await screen.findByRole("button", { name: "Music" }));
    fireEvent.change(await screen.findByLabelText("Add metric"), { target: { value: "music_tags" } });
    expect(await screen.findByText("Music tags")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        2,
        expect.objectContaining({
          profile: expect.objectContaining({
            active_metrics: expect.arrayContaining(["music_tags"]),
          }),
        }),
      ),
    );
  });
});

describe("LibrariesPage media type selection", () => {
  it("requires an explicit media type and can create audiobook libraries", async () => {
    const createSpy = vi
      .spyOn(api, "createLibrary")
      .mockResolvedValue(createLibrarySummary({ name: "Audiobooks", type: "audiobooks" }));

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Add library" }));
    const mediaTypeSelect = await screen.findByRole("combobox", { name: "Media type" });
    expect(mediaTypeSelect).toHaveValue("");
    expect(within(mediaTypeSelect).getByRole("option", { name: "Select media type" })).toBeInTheDocument();
    expect(within(mediaTypeSelect).getByRole("option", { name: "Audiobooks" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Audiobooks" } });
    fireEvent.change(mediaTypeSelect, { target: { value: "audiobooks" } });
    const createForm = mediaTypeSelect.closest("form");
    expect(createForm).not.toBeNull();
    fireEvent.click(within(createForm as HTMLFormElement).getByRole("button", { name: "Create library" }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Audiobooks",
          type: "audiobooks",
        }),
      ),
    );
  });
});

describe("LibrariesPage desktop mode", () => {
  it("shows the desktop folder picker instead of the MEDIA_ROOT browser", async () => {
    window.medialyzeDesktop = {
      isDesktop: () => true,
      selectLibraryPaths: vi.fn().mockResolvedValue(["/mnt/media"]),
    };

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Add library" }));
    expect(await screen.findByRole("button", { name: "Choose folder" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Up" })).not.toBeInTheDocument();
    expect(screen.getByText("Select a local folder, mounted network share, or UNC path to analyze.")).toBeInTheDocument();
  });

  it("falls back to scheduled scans when watch is selected for a network path", async () => {
    window.medialyzeDesktop = {
      isDesktop: () => true,
      selectLibraryPaths: vi.fn().mockResolvedValue(["/mnt/network-media"]),
    };
    vi.spyOn(api, "libraries").mockResolvedValue([
      createLibrarySummary({ path: "/mnt/network-media", scan_mode: "watch" }),
    ]);
    vi.spyOn(api, "inspectPath").mockResolvedValue(
      createPathInspection({
        normalized_path: "/mnt/network-media",
        path_kind: "network",
        watch_supported: false,
      }),
    );

    renderPage({ activePanel: "configuredLibraries" });

    await screen.findByRole("link", { name: "Movies" });

    await waitFor(() => expect(screen.getByLabelText("Scan mode")).toHaveTextContent("Time Interval"));
    expect(
      screen.getAllByText(
        "Watch mode is only available for local paths. MediaLyze falls back to scheduled scans for network locations.",
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows duplicate detection settings and auto-saves the selected mode", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrarySummary()]);
    const updateSpy = vi.spyOn(api, "updateLibrarySettings").mockResolvedValue(
      createLibrarySummary({ duplicate_detection_mode: "both" }),
    );

    renderPage({ activePanel: "configuredLibraries" });

    await screen.findByRole("link", { name: "Movies" });
    fireEvent.click(screen.getByLabelText("Duplicate detection"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Both" }));

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

    renderPage({ activePanel: "configuredLibraries" });

    await screen.findByRole("link", { name: "Movies" });
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
  it("keeps libraries selected while no library exists and exposes add library from the panel", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([]);

    renderPage();

    expect(await screen.findByRole("heading", { name: "Libraries" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^libraries$/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Add library" })).toBeInTheDocument();
    expect(document.querySelector('[data-settings-panel-id="createLibrary"]')).not.toBeInTheDocument();
  });

  it("does not show the old centralized table-view settings panel", async () => {
    renderPage();

    await screen.findByRole("button", { name: /^libraries$/i });
    expect(screen.queryByRole("button", { name: /^table view$/i })).not.toBeInTheDocument();
  });

  it("switches between settings panels from the vertical navigation", async () => {
    renderPage({ activePanel: "appSettings" });

    expect(await screen.findByLabelText("Interface language")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ukrainian" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add resolution category" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^resolution categories$/i }));

    expect(await screen.findByRole("button", { name: "Add resolution category" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Interface language")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("medialyze-settings-active-panel")).toBe("resolutionCategories");
  });

  it("collapses and restores the settings navigation", async () => {
    renderPage({ activePanel: "appSettings" });

    const collapseButton = await screen.findByRole("button", { name: "Collapse settings menu" });
    fireEvent.click(collapseButton);

    expect(window.localStorage.getItem("medialyze-settings-sidebar-collapsed")).toBe("true");
    expect(await screen.findByRole("button", { name: "Expand settings menu" })).toBeInTheDocument();
  });

  it("opens the mobile settings menu and closes it after selecting a panel", async () => {
    renderPage({ activePanel: "appSettings" });

    const trigger = await screen.findByRole("button", { name: "Open settings menu" });
    expect(trigger).toHaveTextContent("App settings");

    const menu = document.getElementById("settings-mobile-navigation-menu");
    expect(menu).not.toBeNull();
    expect(menu).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(trigger);

    expect(await screen.findByRole("button", { name: "Close settings menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(menu).toHaveAttribute("aria-hidden", "false");
    expect(within(menu as HTMLElement).getByRole("button", { name: "full scan" })).toBeInTheDocument();

    fireEvent.click(within(menu as HTMLElement).getByRole("button", { name: "Resolution categories" }));

    expect(await screen.findByRole("button", { name: "Add resolution category" })).toBeInTheDocument();
    expect(window.localStorage.getItem("medialyze-settings-active-panel")).toBe("resolutionCategories");
    expect(menu).toHaveAttribute("aria-hidden", "true");
    expect(await screen.findByRole("button", { name: "Open settings menu" })).toHaveTextContent(
      "Resolution categories",
    );
  });

  it("persists interface language changes to app settings", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({ ui_preferences: { interface_language: "uk" } }),
    );

    renderPage({ activePanel: "appSettings" });

    fireEvent.change(await screen.findByLabelText("Interface language"), { target: { value: "uk" } });

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        ui_preferences: { interface_language: "uk" },
      }),
    );
  });

  it("persists color theme changes to app settings", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({ ui_preferences: { color_theme: "dark" } }),
    );

    renderPage({ activePanel: "appSettings" });

    fireEvent.change(await screen.findByLabelText("Color theme"), { target: { value: "dark" } });

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        ui_preferences: { color_theme: "dark" },
      }),
    );
  });

  it("shows enabled telemetry preview JSON with app settings and extensible media kind counts", async () => {
    vi.mocked(api.telemetryPreview).mockResolvedValue({
      mode: "enabled",
      redacted: true,
      payload: {
        telemetry_mode: "enabled",
        usage: {
          media_kind_counts: {
            audio: 120,
            video: 2300,
            audiobook: 10,
          },
        },
        app_settings: {
          interface_language: "de",
          color_theme: "dark",
        },
      },
    });

    renderPage({ activePanel: "telemetry" });

    expect(await screen.findByRole("heading", { name: "Telemetry" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Example full" }));

    const preview = await screen.findByLabelText("Telemetry payload JSON preview");
    await waitFor(() => {
      expect(preview).toHaveTextContent('"media_kind_counts"');
      expect(preview).toHaveTextContent('"audiobook"');
      expect(preview).toHaveTextContent('"app_settings"');
    });
  });

  it("shows minimal telemetry preview JSON without usage or app settings", async () => {
    vi.mocked(api.telemetryPreview).mockResolvedValue({
      mode: "minimal",
      redacted: true,
      payload: {
        telemetry_mode: "minimal",
        app: { name: "MediaLyze" },
        system: { os_family: "darwin" },
      },
    });

    renderPage({ activePanel: "telemetry" });

    fireEvent.click(await screen.findByRole("button", { name: "Example minimal" }));

    const preview = await screen.findByLabelText("Telemetry payload JSON preview");
    await waitFor(() => {
      expect(preview).toHaveTextContent('"telemetry_mode": "minimal"');
      expect(preview).not.toHaveTextContent('"media_kind_counts"');
      expect(preview).not.toHaveTextContent('"app_settings"');
    });
  });

  it("keeps the telemetry payload viewer stable while loading the first preview", async () => {
    let resolvePreview: (value: Awaited<ReturnType<typeof api.telemetryPreview>>) => void = () => {};
    vi.mocked(api.telemetryPreview).mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );

    renderPage({ activePanel: "telemetry" });

    const preview = await screen.findByLabelText("Telemetry payload JSON preview");
    expect(preview).toHaveTextContent("No user-visible telemetry payload has been sent yet.");

    fireEvent.click(await screen.findByRole("button", { name: "Example minimal" }));

    expect(preview).toHaveTextContent("No user-visible telemetry payload has been sent yet.");
    expect(preview).not.toHaveTextContent("Loading telemetry payload preview");

    resolvePreview({
      mode: "minimal",
      redacted: true,
      payload: {
        telemetry_mode: "minimal",
        app: { name: "MediaLyze" },
      },
    });

    await waitFor(() => expect(preview).toHaveTextContent('"telemetry_mode": "minimal"'));
  });

  it("shows telemetry stats link and copyable installation id", async () => {
    const installationId = "84435651-2be0-4b47-9d7c-6eacb1f25395";
    const writeText = vi.fn().mockResolvedValue(undefined);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.mocked(api.appSettings).mockResolvedValue(
      createAppSettings({
        telemetry: {
          mode: "enabled",
          environment_disabled: false,
          installation_id: installationId,
          installation_id_suffix: "b1f25395",
          last_sent_at: null,
          last_user_visible_payload: null,
        },
      }),
    );

    renderPage({ activePanel: "telemetry" });

    expect(await screen.findByText("Public statistics")).toBeInTheDocument();
    expect(screen.queryByText("Payload preview")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Own installation ID")).toHaveValue(installationId);

    const copyButton = screen.getByRole("button", { name: "Copy" });
    expect(copyButton).toHaveTextContent("");
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(installationId));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open MediaLyze statistics page" }));
    expect(open).toHaveBeenCalledWith("https://www.medialyze.app/stats", "_blank", "noopener,noreferrer");
  });

  it("opens telemetry stats externally in desktop builds", async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(true);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    window.medialyzeDesktop = {
      isDesktop: () => true,
      selectLibraryPaths: vi.fn().mockResolvedValue([]),
      openExternalUrl,
    };

    renderPage({ activePanel: "telemetry" });

    fireEvent.click(await screen.findByRole("button", { name: "Open MediaLyze statistics page" }));

    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledWith("https://www.medialyze.app/stats"));
    expect(open).not.toHaveBeenCalled();
  });

  it("updates telemetry mode from the panel header toggle", async () => {
    const updateSpy = vi.spyOn(api, "updateAppSettings").mockResolvedValue(
      createAppSettings({
        telemetry: {
          mode: "minimal",
          environment_disabled: false,
          installation_id_suffix: null,
          last_sent_at: null,
          last_user_visible_payload: null,
        },
      }),
    );

    renderPage({ activePanel: "telemetry" });

    const offButtons = await screen.findAllByRole("button", { name: "Telemetry off" });
    expect(offButtons[0]).toHaveAttribute("data-tooltip-title", "Telemetry off");
    expect(offButtons[0]).toHaveAttribute("data-tooltip-body", "No telemetry payloads are sent.");

    const minimalButtons = await screen.findAllByRole("button", { name: "Minimal telemetry" });
    expect(minimalButtons[0]).toHaveAttribute("data-tooltip-title", "Minimal telemetry");
    expect(minimalButtons[0]).toHaveAttribute(
      "data-tooltip-body",
      "Tell the Dev which runtime/system you are using, nothing else.",
    );

    const enabledButtons = await screen.findAllByRole("button", { name: "Help the dev" });
    expect(enabledButtons[0]).toHaveAttribute("data-tooltip-title", "Help the dev");
    expect(enabledButtons[0]).toHaveAttribute(
      "data-tooltip-body",
      "Adds rounded usage counts and app settings to inform development. NO private data.",
    );

    fireEvent.click(minimalButtons[0]);

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith({
        telemetry: { mode: "minimal" },
      }),
    );
    await waitFor(() => expect(minimalButtons[0]).toHaveAttribute("aria-pressed", "true"));
  });

  it("silently sends telemetry after triple-clicking the selected enabled toggle", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(
      createAppSettings({
        telemetry: {
          mode: "enabled",
          environment_disabled: false,
          installation_id: "84435651-2be0-4b47-9d7c-6eacb1f25395",
          installation_id_suffix: "b1f25395",
          last_sent_at: null,
          last_user_visible_payload: null,
        },
      }),
    );
    const sendNowSpy = vi.spyOn(api, "telemetrySendNow").mockResolvedValue(
      createAppSettings({
        telemetry: {
          mode: "enabled",
          environment_disabled: false,
          installation_id: "84435651-2be0-4b47-9d7c-6eacb1f25395",
          installation_id_suffix: "b1f25395",
          last_sent_at: "2026-05-12T00:03:00Z",
          last_user_visible_payload: { telemetry_mode: "enabled" },
        },
      }),
    );

    renderPage({ activePanel: "telemetry" });

    const enabledButtons = await screen.findAllByRole("button", { name: "Help the dev" });
    fireEvent.click(enabledButtons[0]);
    fireEvent.click(enabledButtons[0]);
    fireEvent.click(enabledButtons[0]);

    await waitFor(() => expect(sendNowSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Failed to save telemetry settings.")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Telemetry payload JSON preview")).toHaveTextContent('"telemetry_mode": "enabled"'),
    );
  });

  it("orders settings navigation entries consistently", async () => {
    renderPage();

    const resolutionItem = await screen.findByRole("button", { name: /^resolution categories$/i });
    const patternRecognitionItem = screen.getByRole("button", { name: /^pattern recognition$/i });
    const historyRetentionItem = screen.getByRole("button", { name: /^history retention$/i });
    const recentScanLogsItem = screen.getByRole("button", { name: /^recent scan logs$/i });

    expect(resolutionItem.compareDocumentPosition(patternRecognitionItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(patternRecognitionItem.compareDocumentPosition(historyRetentionItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(historyRetentionItem.compareDocumentPosition(recentScanLogsItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("restores the persisted active settings panel from localStorage", async () => {
    window.localStorage.setItem("medialyze-settings-active-panel", "appSettings");

    renderPage();

    expect(await screen.findByLabelText("Interface language")).toBeInTheDocument();
    expect(screen.queryByText("Add first library")).not.toBeInTheDocument();
  });

  it("falls back to configured libraries when the persisted active panel is invalid", async () => {
    window.localStorage.setItem("medialyze-settings-active-panel", "invalid-panel");

    renderPage();

    expect(await screen.findByRole("heading", { name: "Libraries" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^libraries$/i })).toHaveAttribute("aria-current", "page");
  });

  it("does not render old top-level collapse toggles", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: /^app settings$/i })).not.toHaveAttribute("aria-expanded");
    expect(screen.getByRole("button", { name: /^libraries$/i })).not.toHaveAttribute("aria-expanded");
  });

  it("queues a full scan for all configured libraries from the quick action", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([
      createLibrarySummary(),
      createLibrarySummary({ id: 2, name: "Series", path: "/media/series", type: "series" }),
    ]);
    const scanSpy = vi
      .spyOn(api, "scanLibrary")
      .mockResolvedValueOnce(createScanJob({ id: 31, library_id: 1, library_name: "Movies", job_type: "full" }))
      .mockResolvedValueOnce(createScanJob({ id: 32, library_id: 2, library_name: "Series", job_type: "full" }));

    renderPage();

    const settingsMenu = await screen.findByLabelText("Settings menu");
    const desktopQuickActions = settingsMenu.querySelector(".settings-navigation-quick-actions") as HTMLElement | null;
    expect(desktopQuickActions).not.toBeNull();
    expect(within(desktopQuickActions as HTMLElement).getByText("Quickactions")).toBeInTheDocument();
    fireEvent.click(within(desktopQuickActions as HTMLElement).getByRole("button", { name: /^full scan$/i }));

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

    fireEvent.focus(detailsButton);

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

  it("edits library name and type inline from the library header", async () => {
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrarySummary()]);
    const promptSpy = vi.spyOn(window, "prompt").mockImplementation(() => null);
    const updateSpy = vi.spyOn(api, "updateLibrarySettings").mockResolvedValue(
      createLibrarySummary({
        name: "Shows",
        type: "series",
      }),
    );

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit library Movies" }));

    expect(promptSpy).not.toHaveBeenCalled();

    const nameInput = screen.getByRole("textbox", { name: "Edit name for library Movies" });
    const typeSelect = screen.getByRole("combobox", { name: "Edit media type for library Movies" });
    fireEvent.change(nameInput, { target: { value: "Shows" } });
    fireEvent.change(typeSelect, { target: { value: "series" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes for library Movies" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(1, { name: "Shows", type: "series" }));
    expect(await screen.findByRole("link", { name: "Shows" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit library Shows" })).toBeInTheDocument();
  });

  it("keeps recent scan logs out of the active panel by default", async () => {
    renderPage({ seedExpandedPanels: false });

    expect(await screen.findByRole("button", { name: /^recent scan logs$/i })).toBeInTheDocument();
    expect(screen.queryByText("No completed scans yet.")).not.toBeInTheDocument();
  });

  it("shows recent scan logs after selecting the navigation item", async () => {
    renderPage({ seedExpandedPanels: false, activePanel: "recentScanLogs" });

    expect(await screen.findByText("No completed scans yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^recent scan logs$/i })).toHaveAttribute("aria-current", "page");
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

    renderPage({ activePanel: "recentScanLogs" });

    await waitFor(() => expect(recentSpy).toHaveBeenCalledWith({ sinceHours: 24, limit: 200 }));

    const jobButton = await screen.findByRole("button", { name: /movies/i });
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Watchdog")).toBeInTheDocument();

    fireEvent.click(jobButton);

    await waitFor(() => expect(detailSpy).toHaveBeenCalledWith(14));
    const ignoreSections = await screen.findAllByText("Ignore patterns");
    expect(ignoreSections.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("Duplicate processing")).toBeInTheDocument();
    fireEvent.click(ignoreSections.at(-1) as HTMLElement);
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

    renderPage({ activePanel: "recentScanLogs" });

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
