import "../i18n";

import { StrictMode } from "react";
import i18next from "i18next";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useParams } from "react-router-dom";

import { AppDataProvider } from "../lib/app-data";
import { LIBRARY_FILE_COLUMN_WIDTHS_STORAGE_KEY } from "../lib/library-file-column-widths";
import { buildNumericDistributionFilterExpression } from "../lib/numeric-distributions";
import { buildComparisonFieldFilterValue } from "../lib/statistic-comparisons";
import { getLibraryStatisticsSettings, saveLibraryStatisticsSettings } from "../lib/library-statistics-settings";
import {
  api,
  DEFAULT_QUALITY_PROFILE,
  type AppSettings,
  type ComparisonResponse,
  type DuplicateGroupPage,
  type LibraryHistoryResponse,
  type LibraryStatistics,
  type LibrarySummary,
  type MediaFileStreamDetails,
  type MediaFileTablePage,
} from "../lib/api";
import { ScanJobsProvider } from "../lib/scan-jobs";
import { buildFileColumns, LibraryDetailPage } from "./LibraryDetailPage";

const scrollIntoViewMock = vi.fn();

type AppSettingsOverrides = Omit<Partial<AppSettings>, "scan_performance" | "feature_flags"> & {
  scan_performance?: Partial<NonNullable<AppSettings["scan_performance"]>>;
  feature_flags?: Partial<AppSettings["feature_flags"]>;
};

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  writable: true,
  value: scrollIntoViewMock,
});

function createLibrarySummary(id: number): LibrarySummary {
  return {
    id,
    name: `Series ${id}`,
    path: `/media/series-${id}`,
    type: "series",
    last_scan_at: "2026-03-12T09:00:00Z",
    scan_mode: "manual",
    duplicate_detection_mode: "off",
    scan_config: {},
    created_at: "2026-03-12T08:00:00Z",
    updated_at: "2026-03-12T08:30:00Z",
    quality_profile: DEFAULT_QUALITY_PROFILE,
    show_on_dashboard: true,
    file_count: 2,
    total_size_bytes: 2048,
    total_duration_seconds: 7200,
    ready_files: 2,
    pending_files: 0,
  };
}

function createDuplicateGroupPage(overrides: Partial<DuplicateGroupPage> = {}): DuplicateGroupPage {
  return {
    mode: "filename",
    total_groups: 1,
    duplicate_file_count: 2,
    offset: 0,
    limit: 25,
    items: [
      {
        mode: "filename",
        signature: "episode 01",
        label: "episode 01",
        file_count: 2,
        total_size_bytes: 2048,
        items: [
          { id: 1, relative_path: "episode-01.mkv", filename: "episode-01.mkv", size_bytes: 1024 },
          { id: 2, relative_path: "episode-01-copy.mkv", filename: "episode-01-copy.mkv", size_bytes: 1024 },
        ],
      },
    ],
    ...overrides,
  };
}

function createLibraryStatistics(overrides: Partial<LibraryStatistics> = {}): LibraryStatistics {
  return {
    container_distribution: [{ label: "MKV", value: 2, filter_value: "mkv" }],
    video_codec_distribution: [{ label: "h264", value: 2 }],
    resolution_distribution: [{ label: "1920x1080", value: 2 }],
    hdr_distribution: [{ label: "SDR", value: 2 }],
    audio_codec_distribution: [{ label: "aac", value: 2 }],
    audio_spatial_profile_distribution: [{ label: "Dolby Atmos", value: 1 }],
    audio_language_distribution: [{ label: "en", value: 2 }],
    subtitle_language_distribution: [{ label: "en", value: 2 }],
    subtitle_codec_distribution: [{ label: "srt", value: 2 }],
    subtitle_source_distribution: [{ label: "external", value: 2 }],
    numeric_distributions: {
      quality_score: {
        total: 2,
        bins: Array.from({ length: 10 }, (_, index) => ({
          lower: index + 1,
          upper: index + 2,
          count: index === 6 || index === 7 ? 1 : 0,
          percentage: index === 6 || index === 7 ? 50 : 0,
        })),
      },
      duration: {
        total: 2,
        bins: [
          { lower: 0, upper: 1800, count: 0, percentage: 0 },
          { lower: 1800, upper: 3600, count: 0, percentage: 0 },
          { lower: 3600, upper: 5400, count: 2, percentage: 100 },
          { lower: 5400, upper: 7200, count: 0, percentage: 0 },
          { lower: 7200, upper: 9000, count: 0, percentage: 0 },
          { lower: 9000, upper: 10800, count: 0, percentage: 0 },
          { lower: 10800, upper: null, count: 0, percentage: 0 },
        ],
      },
      size: {
        total: 2,
        bins: [
          { lower: 0, upper: 500000000, count: 2, percentage: 100 },
          { lower: 500000000, upper: 1000000000, count: 0, percentage: 0 },
          { lower: 1000000000, upper: 2000000000, count: 0, percentage: 0 },
          { lower: 2000000000, upper: 4000000000, count: 0, percentage: 0 },
          { lower: 4000000000, upper: 8000000000, count: 0, percentage: 0 },
          { lower: 8000000000, upper: 16000000000, count: 0, percentage: 0 },
          { lower: 16000000000, upper: null, count: 0, percentage: 0 },
        ],
      },
      bitrate: {
        total: 2,
        bins: [
          { lower: 0, upper: 2000000, count: 0, percentage: 0 },
          { lower: 2000000, upper: 4000000, count: 1, percentage: 50 },
          { lower: 4000000, upper: 8000000, count: 1, percentage: 50 },
          { lower: 8000000, upper: 12000000, count: 0, percentage: 0 },
          { lower: 12000000, upper: 20000000, count: 0, percentage: 0 },
          { lower: 20000000, upper: 40000000, count: 0, percentage: 0 },
          { lower: 40000000, upper: null, count: 0, percentage: 0 },
        ],
      },
      audio_bitrate: {
        total: 2,
        bins: [
          { lower: 0, upper: 128000, count: 0, percentage: 0 },
          { lower: 128000, upper: 256000, count: 1, percentage: 50 },
          { lower: 256000, upper: 512000, count: 1, percentage: 50 },
          { lower: 512000, upper: 1024000, count: 0, percentage: 0 },
          { lower: 1024000, upper: 2048000, count: 0, percentage: 0 },
          { lower: 2048000, upper: null, count: 0, percentage: 0 },
        ],
      },
    },
    ...overrides,
  };
}

function createLibraryHistoryResponse(overrides: Partial<LibraryHistoryResponse> = {}): LibraryHistoryResponse {
  return {
    generated_at: "2026-04-19T12:00:00Z",
    library_id: 1,
    oldest_snapshot_day: "2026-04-15",
    newest_snapshot_day: "2026-04-16",
    resolution_categories: [
      { id: "4k", label: "4k" },
      { id: "1080p", label: "1080p" },
      { id: "720p", label: "720p" },
    ],
    points: [
      {
        snapshot_day: "2026-04-15",
        trend_metrics: {
          total_files: 10,
          resolution_counts: { "4k": 2, "1080p": 6, "720p": 2 },
          average_bitrate: 8_000_000,
          average_audio_bitrate: 512_000,
          average_duration_seconds: 5400,
          average_quality_score: 7.3,
        },
      },
      {
        snapshot_day: "2026-04-16",
        trend_metrics: {
          total_files: 12,
          resolution_counts: { "4k": 3, "1080p": 7, "720p": 2 },
          average_bitrate: 9_000_000,
          average_audio_bitrate: 640_000,
          average_duration_seconds: 5600,
          average_quality_score: 7.8,
        },
      },
    ],
    ...overrides,
  };
}

function createComparisonResponse(overrides: Partial<ComparisonResponse> = {}): ComparisonResponse {
  return {
    x_field: "duration",
    y_field: "size",
    x_field_kind: "numeric",
    y_field_kind: "numeric",
    available_renderers: ["heatmap", "scatter", "bar"],
    total_files: 2,
    included_files: 2,
    excluded_files: 0,
    sampled_points: false,
    sample_limit: 5000,
    x_buckets: [
      { key: "1800:3600", label: "1800:3600", lower: 1800, upper: 3600 },
      { key: "3600:5400", label: "3600:5400", lower: 3600, upper: 5400 },
    ],
    y_buckets: [
      { key: "0:500000000", label: "0:500000000", lower: 0, upper: 500000000 },
      { key: "500000000:1000000000", label: "500000000:1000000000", lower: 500000000, upper: 1000000000 },
    ],
    heatmap_cells: [
      { x_key: "1800:3600", y_key: "0:500000000", count: 1 },
      { x_key: "3600:5400", y_key: "500000000:1000000000", count: 1 },
    ],
    scatter_points: [
      { media_file_id: 1, x_value: 3600, y_value: 1024 },
      { media_file_id: 2, x_value: 4200, y_value: 1024 },
    ],
    bar_entries: [
      { x_key: "1800:3600", x_label: "1800:3600", value: 1024, count: 1 },
      { x_key: "3600:5400", x_label: "3600:5400", value: 1024, count: 1 },
    ],
    ...overrides,
  };
}

function createFilesPage(libraryId: number): MediaFileTablePage {
  return {
    total: 2,
    offset: 0,
    limit: 200,
    items: [
      {
        id: 1,
        library_id: libraryId,
        relative_path: "episode-01.mkv",
        filename: "episode-01.mkv",
        extension: "mkv",
        size_bytes: 1024,
        mtime: 1,
        last_seen_at: "2026-03-12T09:00:00Z",
        last_analyzed_at: "2026-03-12T09:00:00Z",
        scan_status: "ready",
        quality_score: 8,
        quality_score_raw: 82.4,
        container: "mkv",
        duration: 3600,
        bitrate: 4_000_000,
        audio_bitrate: 256_000,
        video_codec: "h264",
        resolution: "1920x1080",
        hdr_type: null,
        audio_codecs: ["aac"],
        audio_spatial_profiles: ["Dolby Atmos"],
        audio_languages: ["en"],
        subtitle_languages: ["en"],
        subtitle_codecs: ["srt"],
        subtitle_sources: ["external"],
      },
      {
        id: 2,
        library_id: libraryId,
        relative_path: "episode-02.mkv",
        filename: "episode-02.mkv",
        extension: "mkv",
        size_bytes: 1024,
        mtime: 2,
        last_seen_at: "2026-03-12T09:00:00Z",
        last_analyzed_at: "2026-03-12T09:00:00Z",
        scan_status: "ready",
        quality_score: 7,
        quality_score_raw: 74.1,
        container: "mkv",
        duration: 3600,
        bitrate: 8_000_000,
        audio_bitrate: 512_000,
        video_codec: "h264",
        resolution: "1920x1080",
        hdr_type: null,
        audio_codecs: ["aac"],
        audio_spatial_profiles: [],
        audio_languages: ["en"],
        subtitle_languages: ["en"],
        subtitle_codecs: ["srt"],
        subtitle_sources: ["external"],
      },
    ],
  };
}

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
    resolution_categories: [
      { id: "4k", label: "4k", min_width: 3648, min_height: 1520 },
      { id: "1080p", label: "1080p", min_width: 1824, min_height: 760 },
      { id: "720p", label: "720p", min_width: 1216, min_height: 506 },
      { id: "sd", label: "sd", min_width: 0, min_height: 0 },
    ],
    scan_performance: {
      scan_worker_count: 4,
      parallel_scan_jobs: 2,
      comparison_scatter_point_limit: 5000,
      ...overrideScanPerformance,
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

function createStreamDetails(fileId: number): MediaFileStreamDetails {
  return {
    id: fileId,
    video_streams: [
      {
        stream_index: 0,
        codec: "h264",
        profile: "High",
        width: 1920,
        height: 1080,
        pix_fmt: "yuv420p",
        color_space: "bt709",
        color_transfer: "bt709",
        color_primaries: "bt709",
        frame_rate: 23.976,
        bit_rate: 10_000_000,
        hdr_type: null,
      },
    ],
    audio_streams: [
      {
        stream_index: 1,
        codec: "aac",
        profile: "Dolby Digital Plus + Dolby Atmos",
        spatial_audio_profile: "dolby_atmos",
        channels: 2,
        channel_layout: "stereo",
        sample_rate: 48_000,
        bit_rate: 192_000,
        language: "en",
        default_flag: true,
        forced_flag: false,
      },
      {
        stream_index: 2,
        codec: "truehd",
        profile: "TrueHD",
        spatial_audio_profile: null,
        channels: 8,
        channel_layout: "7.1",
        sample_rate: 48_000,
        bit_rate: 4_000_000,
        language: "ja",
        default_flag: false,
        forced_flag: false,
      },
    ],
    subtitle_streams: [
      {
        stream_index: 3,
        codec: "subrip",
        language: "en",
        default_flag: true,
        forced_flag: false,
        subtitle_type: "text",
      },
    ],
    external_subtitles: [
      {
        path: "episode-01.de.srt",
        language: "de",
        format: "srt",
      },
    ],
  };
}

function mockAppSettings(overrides: AppSettingsOverrides = {}) {
  return vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings(overrides));
}

function renderPage(libraryId: number, { strictMode = false }: { strictMode?: boolean } = {}) {
  const FileRoute = () => {
    const { fileId = "" } = useParams();
    return <div>{`File detail ${fileId}`}</div>;
  };

  const tree = (
    <MemoryRouter initialEntries={[`/libraries/${libraryId}`]}>
      <AppDataProvider>
        <ScanJobsProvider>
          <Routes>
            <Route path="/libraries/:libraryId" element={<LibraryDetailPage />} />
            <Route path="/files/:fileId" element={<FileRoute />} />
          </Routes>
        </ScanJobsProvider>
      </AppDataProvider>
    </MemoryRouter>
  );

  return render(
    strictMode ? <StrictMode>{tree}</StrictMode> : tree,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  scrollIntoViewMock.mockClear();
  window.localStorage.clear();
});

beforeEach(() => {
  vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);
  vi.spyOn(api, "libraryComparison").mockResolvedValue(createComparisonResponse());
  vi.spyOn(api, "libraryHistory").mockResolvedValue(createLibraryHistoryResponse());
  vi.spyOn(api, "libraryDuplicates").mockResolvedValue(createDuplicateGroupPage());
});

describe("LibraryDetailPage", () => {
  it("loads summary, statistics, and files separately", async () => {
    const libraryId = 101;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    const librarySummarySpy = vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    const libraryStatisticsSpy = vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryHistorySpy = vi.spyOn(api, "libraryHistory").mockResolvedValue(createLibraryHistoryResponse());
    const libraryComparisonSpy = vi.spyOn(api, "libraryComparison").mockResolvedValue(createComparisonResponse());
    const libraryDuplicatesSpy = vi.spyOn(api, "libraryDuplicates").mockResolvedValue(createDuplicateGroupPage());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    expect(librarySummarySpy).toHaveBeenCalled();
    expect(libraryStatisticsSpy).toHaveBeenCalled();
    expect(libraryHistorySpy).toHaveBeenCalled();
    expect(libraryComparisonSpy).toHaveBeenCalled();
    expect(libraryDuplicatesSpy).toHaveBeenCalled();
    expect(libraryFilesSpy).toHaveBeenCalled();
  });

  it("renders the library history panel between statistics and duplicates", async () => {
    const libraryId = 126;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    const { container } = renderPage(libraryId);

    const historyToggle = await screen.findByRole("button", { name: "Media library history" });
    const duplicatesToggle = screen.getByRole("button", { name: "Duplications" });
    const statisticGrid = container.querySelector(".statistic-layout-grid");
    const historySection = historyToggle.closest("section");
    const duplicatesSection = duplicatesToggle.closest("section");

    expect(statisticGrid).not.toBeNull();
    expect(historySection).not.toBeNull();
    expect(duplicatesSection).not.toBeNull();
    expect(statisticGrid!.compareDocumentPosition(historySection!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(historySection!.compareDocumentPosition(duplicatesSection!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("loads library history independently from duplicates and files", async () => {
    const libraryId = 127;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryHistory").mockRejectedValue(new Error("history unavailable"));
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    expect(await screen.findByText("history unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duplications" })).toBeInTheDocument();
  });

  it("renders an empty history state when no enriched points exist", async () => {
    const libraryId = 128;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryHistory").mockResolvedValue(createLibraryHistoryResponse({ points: [] }));
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("History trends will appear after the next finished scan.")).toBeInTheDocument();
  });

  it("renders the resolution history metric as a stacked area chart", async () => {
    const libraryId = 129;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryHistory").mockResolvedValue(createLibraryHistoryResponse());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    const chart = (await screen.findAllByTestId("echarts-react")).find(
      (candidate) => candidate.getAttribute("data-series-count") === "3",
    );
    expect(chart).toBeDefined();
    expect(chart?.getAttribute("data-series-has-area")).toBe("[true,true,true]");
    expect(chart?.getAttribute("data-points")).toBe("[2,3]");
  });

  it("renders numeric history metrics as line charts and updates when the selector changes", async () => {
    const libraryId = 130;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryHistory").mockResolvedValue(createLibraryHistoryResponse());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    fireEvent.click(await screen.findByLabelText("Select history metric"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Average bitrate" }));

    const chart = (await screen.findAllByTestId("echarts-react")).find(
      (candidate) => candidate.getAttribute("data-points") === "[8000000,9000000]",
    );
    expect(chart).toBeDefined();
    expect(chart?.getAttribute("data-series-count")).toBe("1");
    expect(chart?.getAttribute("data-series-has-area")).toBe("[false]");
  });

  it("persists the selected history metric", async () => {
    const libraryId = 131;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    fireEvent.click(await screen.findByLabelText("Select history metric"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Average duration" }));

    expect(window.localStorage.getItem("medialyze-library-detail-history-selected-metric")).toBe(
      "average_duration_seconds",
    );
  });

  it("persists the history panel collapsed state", async () => {
    const libraryId = 132;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    const historyToggle = await screen.findByRole("button", { name: "Media library history" });
    fireEvent.click(historyToggle);

    expect(window.localStorage.getItem("medialyze-library-detail-history-collapsed")).toBe("true");
    expect(screen.queryByLabelText("Select history metric")).not.toBeInTheDocument();
    expect(screen.queryByText("Daily trend snapshots from finished scans")).not.toBeInTheDocument();
  });

  it("persists inline statistic panel layout changes for the current library", async () => {
    const libraryId = 118;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByRole("heading", { level: 2, name: `Series ${libraryId}` })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Add panel" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Spatial audio" }));
    fireEvent.click(screen.getByRole("button", { name: "Save panel layout" }));

    expect(window.localStorage.getItem(`medialyze-statistic-panel-layout-library-${libraryId}`)).toContain(
      "\"audio_spatial_profiles\"",
    );
  });

  it("renders the comparison panel and reloads it when the axis selection changes", async () => {
    const libraryId = 121;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const comparisonSpy = vi.spyOn(api, "libraryComparison").mockResolvedValue(createComparisonResponse());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(screen.queryByRole("heading", { level: 2, name: "Metric comparison" })).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Select Y-axis metric")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Select Y-axis metric"), { target: { value: "quality_score" } });

    expect(comparisonSpy).toHaveBeenLastCalledWith(
      String(libraryId),
      expect.objectContaining({ xField: "size", yField: "quality_score" }),
    );
  });

  it("reloads comparison data when navigating to a different library with the same panel selection", async () => {
    window.localStorage.setItem(
      "medialyze-statistic-panel-layout-library-131",
      JSON.stringify({
        items: [{ instanceId: "comparison-1", statisticId: "comparison", width: 2, height: 2 }],
      }),
    );
    window.localStorage.setItem(
      "medialyze-statistic-panel-layout-library-132",
      JSON.stringify({
        items: [{ instanceId: "comparison-1", statisticId: "comparison", width: 2, height: 2 }],
      }),
    );
    window.localStorage.setItem(
      "medialyze-comparison-selection-library",
      JSON.stringify({ xField: "duration", yField: "size", renderer: "scatter" }),
    );

    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockImplementation(async (libraryId) => createLibrarySummary(Number(libraryId)));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryHistory").mockResolvedValue(createLibraryHistoryResponse());
    vi.spyOn(api, "libraryDuplicates").mockResolvedValue(createDuplicateGroupPage());
    vi.spyOn(api, "libraryFiles").mockImplementation(async (libraryId) => createFilesPage(Number(libraryId)));
    vi.spyOn(api, "libraryComparison").mockImplementation(async (libraryId) =>
      createComparisonResponse({
        scatter_points:
          String(libraryId) === "131"
            ? [
                { media_file_id: 1, x_value: 3600, y_value: 1024 },
                { media_file_id: 2, x_value: 4200, y_value: 1024 },
              ]
            : [
                { media_file_id: 3, x_value: 7200, y_value: 2048 },
                { media_file_id: 4, x_value: 8400, y_value: 4096 },
              ],
      }),
    );

    const router = createMemoryRouter(
      [
        {
          path: "/libraries/:libraryId",
          element: <LibraryDetailPage />,
        },
      ],
      {
        initialEntries: ["/libraries/131"],
      },
    );

    render(
      <AppDataProvider>
        <ScanJobsProvider>
          <RouterProvider router={router} />
        </ScanJobsProvider>
      </AppDataProvider>,
    );

    expect(await screen.findByRole("heading", { level: 2, name: "Series 131" })).toBeInTheDocument();
    expect((await screen.findAllByTestId("echarts-react")).some(
      (candidate) => candidate.getAttribute("data-points") === "[[3600,1024],[4200,1024]]",
    )).toBe(true);

    await router.navigate("/libraries/132");

    expect(await screen.findByRole("heading", { level: 2, name: "Series 132" })).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getAllByTestId("echarts-react").some(
          (candidate) => candidate.getAttribute("data-points") === "[[7200,2048],[8400,4096]]",
        ),
      ).toBe(true);
    });
  });

  it("opens the file detail route when a comparison point is clicked in scatter view", async () => {
    const libraryId = 123;
    window.localStorage.setItem(
      "medialyze-comparison-selection-library",
      JSON.stringify({ xField: "duration", yField: "size", renderer: "scatter" }),
    );
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryComparison").mockResolvedValue(createComparisonResponse());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    const chart = (await screen.findAllByTestId("echarts-react")).find(
      (candidate) => candidate.getAttribute("data-points") === "[[3600,1024],[4200,1024]]",
    );
    expect(chart).toBeDefined();
    fireEvent.click(chart!);

    expect(await screen.findByText("File detail 1")).toBeInTheDocument();
  });

  it("filters the analyzed files table when a comparison heatmap cell is clicked", async () => {
    const libraryId = 124;
    window.localStorage.setItem(
      `medialyze-statistic-panel-layout-library-${libraryId}`,
      JSON.stringify({
        items: [
          {
            instanceId: "comparison-1",
            statisticId: "comparison",
            width: 1,
            height: 2,
            comparisonSelection: {
              xField: "duration",
              yField: "size",
              renderer: "heatmap",
            },
          },
        ],
      }),
    );
    const comparison = createComparisonResponse();
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryComparison").mockResolvedValue(comparison);
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));
    renderPage(libraryId);

    const chart = (await screen.findAllByTestId("echarts-react")).find(
      (candidate) => candidate.getAttribute("data-points") === "[[0,0,1],[1,1,1]]",
    );
    expect(chart).toBeDefined();
    fireEvent.click(chart!);

    expect(await screen.findByDisplayValue(buildComparisonFieldFilterValue("duration", comparison.x_buckets[0]))).toBeInTheDocument();
    expect(screen.getByDisplayValue(buildComparisonFieldFilterValue("size", comparison.y_buckets[0]))).toBeInTheDocument();
    await waitFor(() => {
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: expect.objectContaining({
            duration: buildComparisonFieldFilterValue("duration", comparison.x_buckets[0]),
            size: buildComparisonFieldFilterValue("size", comparison.y_buckets[0]),
          }),
        }),
      );
    });
  });

  it("loads duplicate groups separately and renders matching files", async () => {
    const libraryId = 120;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryDuplicatesSpy = vi.spyOn(api, "libraryDuplicates").mockResolvedValue(createDuplicateGroupPage());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByRole("button", { name: "Duplications" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Duplications" }));
    expect((await screen.findAllByText("episode-01-copy.mkv")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 3, name: "episode 01" })).not.toBeInTheDocument();
    expect(libraryDuplicatesSpy).toHaveBeenCalledWith(String(libraryId), expect.objectContaining({ offset: 0, limit: 25 }));
  });

  it("renders duplicate variants inside a scroll-limited list", async () => {
    const libraryId = 122;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryDuplicates").mockResolvedValue(
      createDuplicateGroupPage({
        items: [
          {
            mode: "filename",
            signature: "episode 01",
            label: "episode 01",
            file_count: 4,
            total_size_bytes: 4096,
            items: [
              { id: 1, relative_path: "episode-01.mkv", filename: "episode-01.mkv", size_bytes: 1024 },
              { id: 2, relative_path: "episode-01-copy.mkv", filename: "episode-01-copy.mkv", size_bytes: 1024 },
              { id: 3, relative_path: "episode-01-alt.mkv", filename: "episode-01-alt.mkv", size_bytes: 1024 },
              { id: 4, relative_path: "episode-01-remux.mkv", filename: "episode-01-remux.mkv", size_bytes: 1024 },
            ],
          },
        ],
      }),
    );
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    const { container } = renderPage(libraryId);

    const duplicatesToggle = await screen.findByRole("button", { name: "Duplications" });
    fireEvent.click(duplicatesToggle);
    const variantsList = container.querySelector(".duplicate-group-items-scroll");
    expect(variantsList).not.toBeNull();
    expect(variantsList).toHaveClass("scan-log-path-list");
  });

  it("hides the score meter when the feature flag is enabled", async () => {
    const libraryId = 123;
    mockAppSettings({
      feature_flags: {
        show_analyzed_files_csv_export: true,
        hide_quality_score_meter: true,
      },
    });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    const { container } = renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    expect(container.querySelector(".score-meter")).toBeNull();
  });

  it("loads and shows detailed audio stream info from the codec tooltip", async () => {
    const loadStreamDetail = vi.fn();
    const columns = buildFileColumns(
      i18next.t.bind(i18next),
      {},
      {},
      { 1: createStreamDetails(1) },
      {},
      vi.fn(),
      loadStreamDetail,
      new Set(["audio_languages"]),
      false,
    );
    const file = createFilesPage(126).items[0];
    const audioLanguagesColumn = columns.find((column) => column.key === "audio_languages");

    expect(audioLanguagesColumn).toBeDefined();
    render(<MemoryRouter>{audioLanguagesColumn!.render(file)}</MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "Show audio stream details for episode-01.mkv" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Audio streams");
    expect(screen.getByRole("tooltip")).toHaveTextContent("en");
    expect(screen.getByRole("tooltip")).toHaveTextContent("AAC");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Stereo");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Dolby Atmos");
    expect(screen.getByRole("tooltip")).toHaveTextContent("ja");
    expect(screen.getByRole("tooltip")).toHaveTextContent("TrueHD");
    expect(screen.getByRole("tooltip")).toHaveTextContent("7.1");
    expect(loadStreamDetail).toHaveBeenCalledWith(1);
  });

  it("renders an audio spatial profiles column that reuses the audio tooltip", async () => {
    const columns = buildFileColumns(
      i18next.t.bind(i18next),
      {},
      {},
      { 1: createStreamDetails(1) },
      {},
      vi.fn(),
      vi.fn(),
      new Set(["audio_spatial_profiles"]),
      false,
    );
    const file = createFilesPage(126).items[0];
    const spatialColumn = columns.find((column) => column.key === "audio_spatial_profiles");

    expect(spatialColumn).toBeDefined();
    render(<MemoryRouter>{spatialColumn!.render(file)}</MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "Show audio stream details for episode-01.mkv" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Dolby Atmos");
    expect(screen.getByRole("tooltip")).toHaveTextContent("AAC");
  });

  it("restores persisted analyzed-file column widths", async () => {
    const libraryId = 124;
    window.localStorage.setItem(
      LIBRARY_FILE_COLUMN_WIDTHS_STORAGE_KEY,
      JSON.stringify({ video_codec: 333 }),
    );
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    const { container } = renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    expect((container.querySelector(".media-data-head-row") as HTMLElement).style.gridTemplateColumns).toContain("333px");
  });

  it("persists resized analyzed-file column widths", async () => {
    const libraryId = 125;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    const resizeHandle = screen.getByRole("button", { name: "Resize column Codec" });
    const headerCell = resizeHandle.closest(".media-data-header-cell") as HTMLDivElement | null;
    expect(headerCell).not.toBeNull();
    headerCell!.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 220,
        height: 42,
        top: 0,
        right: 220,
        bottom: 42,
        left: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    fireEvent.pointerDown(resizeHandle, { clientX: 220 });
    fireEvent.pointerMove(window, { clientX: 300 });
    fireEvent.pointerUp(window);

    await waitFor(() =>
      expect(window.localStorage.getItem(LIBRARY_FILE_COLUMN_WIDTHS_STORAGE_KEY)).toContain("\"video_codec\":300"),
    );
  });

  it("filters duplicate groups and collapses the duplicate panel", async () => {
    const libraryId = 121;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryDuplicates").mockResolvedValue(
      createDuplicateGroupPage({
        total_groups: 2,
        duplicate_file_count: 4,
        items: [
          {
            mode: "filename",
            signature: "episode 01",
            label: "episode 01",
            file_count: 2,
            total_size_bytes: 2048,
            items: [
              { id: 1, relative_path: "episode-01.mkv", filename: "episode-01.mkv", size_bytes: 1024 },
              { id: 2, relative_path: "episode-01-copy.mkv", filename: "episode-01-copy.mkv", size_bytes: 1024 },
            ],
          },
          {
            mode: "filehash",
            signature: "deadbeef",
            label: "bonus-scene.mkv",
            file_count: 2,
            total_size_bytes: 2048,
            items: [
              { id: 3, relative_path: "bonus-scene.mkv", filename: "bonus-scene.mkv", size_bytes: 1024 },
              { id: 4, relative_path: "bonus-scene-copy.mkv", filename: "bonus-scene-copy.mkv", size_bytes: 1024 },
            ],
          },
        ],
      }),
    );
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByRole("button", { name: "Duplications" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Duplications" }));

    fireEvent.change(screen.getByRole("searchbox", { name: "Search duplicates" }), {
      target: { value: "bonus" },
    });

    expect((await screen.findAllByText("bonus-scene-copy.mkv")).length).toBeGreaterThan(0);
    expect(screen.queryByText("episode-01-copy.mkv")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Duplications" }));

    const collapsedToggle = await screen.findByRole("button", { name: "Duplications" });
    expect(collapsedToggle).toBeInTheDocument();
    expect(within(collapsedToggle.closest("section") ?? document.body).getAllByText(/^2$/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("searchbox", { name: "Search duplicates" })).not.toBeInTheDocument();
    expect(screen.queryByText("bonus-scene-copy.mkv")).not.toBeInTheDocument();
  });

  it("still loads statistics and files under strict mode remounts", async () => {
    const libraryId = 111;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    const librarySummarySpy = vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    const libraryStatisticsSpy = vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId, { strictMode: true });

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    expect(await screen.findByText("H.264 / AVC")).toBeInTheDocument();
    expect(screen.queryByText("No analyzed data yet.")).not.toBeInTheDocument();
    expect(librarySummarySpy.mock.calls.length).toBeLessThanOrEqual(2);
    expect(libraryStatisticsSpy.mock.calls.length).toBeLessThanOrEqual(2);
    expect(libraryFilesSpy.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("retries file loading after a strict mode abort cycle", async () => {
    const libraryId = 112;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());

    let requestCount = 0;
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockImplementation(async (_id, params) => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Promise<MediaFileTablePage>((resolve, reject) => {
          params?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true,
          });
        });
      }
      return createFilesPage(libraryId);
    });

    renderPage(libraryId, { strictMode: true });

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    expect(libraryFilesSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps files usable when statistics loading fails", async () => {
    const libraryId = 202;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockRejectedValue(new Error("statistics unavailable"));
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    expect(await screen.findAllByText("statistics unavailable")).not.toHaveLength(0);
  });

  it("reloads duplicate groups after an active scan finishes", async () => {
    const libraryId = 203;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryDuplicatesSpy = vi
      .spyOn(api, "libraryDuplicates")
      .mockResolvedValueOnce(createDuplicateGroupPage({ total_groups: 0, duplicate_file_count: 0, items: [] }))
      .mockResolvedValueOnce(createDuplicateGroupPage());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));
    vi.spyOn(api, "activeScanJobs")
      .mockResolvedValueOnce([
        {
          id: 50,
          library_id: libraryId,
          library_name: "Series 203",
          status: "running",
          job_type: "incremental",
          files_total: 2,
          files_scanned: 1,
          errors: 0,
          started_at: "2026-03-12T09:10:00Z",
          finished_at: null,
          progress_percent: 50,
          phase_label: "Analyzing media",
          phase_detail: "1 of 2 files analyzed",
        },
      ])
      .mockResolvedValueOnce([]);

    renderPage(libraryId);

    expect(await screen.findByRole("button", { name: "Duplications" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Duplications" }));
    expect(await screen.findByText("No duplicate groups found yet.")).toBeInTheDocument();
    await waitFor(() => expect(api.activeScanJobs).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(libraryDuplicatesSpy).toHaveBeenCalledTimes(1));

    fireEvent.focus(window);

    await waitFor(() => expect(libraryDuplicatesSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect((await screen.findAllByText("episode-01-copy.mkv")).length).toBeGreaterThan(0);
  });

  it("reloads library history after an active scan finishes", async () => {
    const libraryId = 204;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryHistorySpy = vi
      .spyOn(api, "libraryHistory")
      .mockResolvedValueOnce(createLibraryHistoryResponse({ points: [] }))
      .mockResolvedValueOnce(createLibraryHistoryResponse());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));
    vi.spyOn(api, "activeScanJobs")
      .mockResolvedValueOnce([
        {
          id: 51,
          library_id: libraryId,
          library_name: "Series 204",
          status: "running",
          job_type: "incremental",
          files_total: 2,
          files_scanned: 1,
          errors: 0,
          started_at: "2026-03-12T09:10:00Z",
          finished_at: null,
          progress_percent: 50,
          phase_label: "Analyzing media",
          phase_detail: "1 of 2 files analyzed",
        },
      ])
      .mockResolvedValueOnce([]);

    renderPage(libraryId);

    expect(await screen.findByText("History trends will appear after the next finished scan.")).toBeInTheDocument();
    await waitFor(() => expect(libraryHistorySpy).toHaveBeenCalledTimes(1));

    fireEvent.focus(window);

    await waitFor(() => expect(libraryHistorySpy.mock.calls.length).toBeGreaterThanOrEqual(2));
    const chart = (await screen.findAllByTestId("echarts-react")).find(
      (candidate) => candidate.getAttribute("data-series-count") === "3",
    );
    expect(chart).toBeDefined();
  });

  it("renders a safe fallback label for unknown legacy resolution categories", async () => {
    const libraryId = 205;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryHistory").mockResolvedValue(
      createLibraryHistoryResponse({
        resolution_categories: [
          { id: "4k", label: "4k" },
          { id: "legacy_hd", label: "legacy_hd" },
        ],
        points: [
          {
            snapshot_day: "2026-04-15",
            trend_metrics: {
              total_files: 10,
              resolution_counts: { "4k": 4, "legacy_hd": 6 },
              average_bitrate: 8_000_000,
              average_audio_bitrate: 512_000,
              average_duration_seconds: 5400,
              average_quality_score: 7.3,
            },
          },
        ],
      }),
    );
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText(/Unknown legacy category: legacy_hd/)).toBeInTheDocument();
  });

  it("refetches only files when sorting changes", async () => {
    const libraryId = 303;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    const librarySummarySpy = vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    const libraryStatisticsSpy = vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    const initialFileCalls = libraryFilesSpy.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /^codec$/i }));

    await waitFor(() => expect(libraryFilesSpy.mock.calls.length).toBeGreaterThan(initialFileCalls));
    expect(librarySummarySpy).toHaveBeenCalled();
    expect(libraryStatisticsSpy).toHaveBeenCalled();
  });

  it("adds and removes metadata search fields and sends field-specific filters", async () => {
    const libraryId = 404;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /add metadata search field/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /video codec/i }));
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    const codecInput = await screen.findByPlaceholderText("e.g. hevc av1");
    fireEvent.change(codecInput, { target: { value: "hevc" } });

    await waitFor(() =>
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: expect.objectContaining({
            video_codec: "hevc",
          }),
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /remove video codec search field/i }));

    await waitFor(() =>
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: {},
        }),
      ),
    );
  });

  it("filters files when clicking a statistic count", async () => {
    const libraryId = 410;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /filter analyzed files by video codec: h\.264 \/ avc/i }));

    expect(await screen.findByPlaceholderText("e.g. hevc av1")).toHaveValue("h264");
    await waitFor(() =>
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: expect.objectContaining({
            video_codec: "h264",
          }),
        }),
      ),
    );
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("renders numeric statistic charts for enabled panels", async () => {
    const libraryId = 414;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByRole("heading", { level: 2, name: "File size" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Duration" })).toBeInTheDocument();
    expect(screen.getAllByTestId("echarts-react").length).toBeGreaterThan(0);
  });

  it("builds range filters from numeric histogram bins", () => {
    expect(
      buildNumericDistributionFilterExpression("duration", {
        lower: 5400,
        upper: 7200,
        count: 2,
        percentage: 100,
      }),
    ).toBe(">=1h 30m,<2h");
  });

  it("applies numeric histogram bin filters in the library view", async () => {
    const libraryId = 415;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId("echarts-react")[0]);

    await waitFor(() =>
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: expect.objectContaining({
            size: ">=0B,<500MB",
          }),
        }),
      ),
    );
  });

  it("replaces existing statistic values in the same field", async () => {
    const libraryId = 411;
    window.localStorage.setItem(
      `medialyze-statistic-panel-layout-library-${libraryId}`,
      JSON.stringify({
        items: [
          {
            instanceId: "audio_codecs",
            statisticId: "audio_codecs",
            width: 1,
            height: 1,
          },
        ],
      }),
    );
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(
      api,
      "libraryStatistics",
    ).mockResolvedValue(
      createLibraryStatistics({
        audio_codec_distribution: [
          { label: "aac", value: 2 },
          { label: "dts", value: 1 },
        ],
      }),
    );
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /filter analyzed files by audio codecs: aac/i }));
    expect(await screen.findByPlaceholderText("e.g. dts aac")).toHaveValue("aac");

    fireEvent.click(screen.getByRole("button", { name: /filter analyzed files by audio codecs: dts/i }));

    await waitFor(() =>
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: expect.objectContaining({
            audio_codecs: "dts",
          }),
        }),
      ),
    );
    expect(screen.getByPlaceholderText("e.g. dts aac")).toHaveValue("dts");
  });

  it("disables already-applied statistic values without duplicating the filter", async () => {
    const libraryId = 412;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /filter analyzed files by video codec: h\.264 \/ avc/i }));

    const appliedButton = await screen.findByRole("button", {
      name: /already added to analyzed files filter for video codec: h\.264 \/ avc/i,
    });
    expect(appliedButton).toBeDisabled();
    expect(await screen.findByPlaceholderText("e.g. hevc av1")).toHaveValue("h264");

    const requestCount = libraryFilesSpy.mock.calls.length;
    fireEvent.click(appliedButton);
    await waitFor(() => expect(libraryFilesSpy.mock.calls.length).toBe(requestCount));
  });

  it("keeps statistic filters from different categories combined", async () => {
    const libraryId = 413;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(
      api,
      "libraryStatistics",
    ).mockResolvedValue(
      createLibraryStatistics({
        resolution_distribution: [{ label: "1920x1080", value: 2 }],
        hdr_distribution: [{ label: "HDR10", value: 1 }],
      }),
    );
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /filter analyzed files by resolution: 1920x1080/i }));
    fireEvent.click(screen.getByRole("button", { name: /filter analyzed files by dynamic range: hdr10/i }));

    await waitFor(() =>
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: expect.objectContaining({
            resolution: "1920x1080",
            hdr_type: "HDR10",
          }),
        }),
      ),
    );
  });

  it("uses stable resolution filter values when statistics provide them", async () => {
    const libraryId = 777;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(
      createLibraryStatistics({
        resolution_distribution: [{ label: "UHD", value: 2, filter_value: "4k" }],
      }),
    );
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /filter analyzed files by resolution: uhd/i }));

    await waitFor(() =>
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: expect.objectContaining({
            resolution: "4k",
          }),
        }),
      ),
    );
  });

  it("passes through und statistic filters unchanged", async () => {
    const libraryId = 778;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(
      createLibraryStatistics({
        audio_language_distribution: [{ label: "und", value: 119 }],
      }),
    );
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /filter analyzed files by audio languages: und/i }));

    await waitFor(() =>
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: expect.objectContaining({
            audio_languages: "und",
          }),
        }),
      ),
    );
  });

  it("uses the container statistic filter value when clicking a container panel entry", async () => {
    const libraryId = 779;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(
      createLibraryStatistics({
        container_distribution: [{ label: "MKV", value: 2, filter_value: "mkv" }],
      }),
    );
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    window.localStorage.setItem(
      `medialyze-statistic-panel-layout-library-${libraryId}`,
      JSON.stringify({
        items: [
          {
            instanceId: "container",
            statisticId: "container",
            width: 1,
            height: 1,
          },
        ],
      }),
    );
    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /filter analyzed files by container: mkv/i }));

    await waitFor(() =>
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: expect.objectContaining({
            container: "mkv",
          }),
        }),
      ),
    );
  });

  it("combines file/path and metadata filters in the same request", async () => {
    const libraryId = 505;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search file and path"), { target: { value: "episode" } });
    fireEvent.click(screen.getByRole("button", { name: /add metadata search field/i }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /subtitle sources/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. internal external"), { target: { value: "external" } });

    await waitFor(() =>
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: expect.objectContaining({
            file: "episode",
            subtitle_sources: "external",
          }),
        }),
      ),
    );
  });

  it("applies subtitle source filters from statistic counts", async () => {
    const libraryId = 506;
    window.localStorage.setItem(
      `medialyze-statistic-panel-layout-library-${libraryId}`,
      JSON.stringify({
        items: [
          { instanceId: "subtitle_sources", statisticId: "subtitle_sources", width: 1, height: 1 },
        ],
      }),
    );
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /filter analyzed files by subtitle sources: external/i }));

    expect(await screen.findByPlaceholderText("e.g. internal external")).toHaveValue("external");
    await waitFor(() =>
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: expect.objectContaining({
            subtitle_sources: "external",
          }),
        }),
      ),
    );
  });

  it("uses the exact hdr profile label as the filter value", async () => {
    const libraryId = 507;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(
      api,
      "libraryStatistics",
    ).mockResolvedValue(
      createLibraryStatistics({
        hdr_distribution: [
          { label: "Dolby Vision 8.1", value: 1 },
          { label: "Dolby Vision 7", value: 1 },
        ],
      }),
    );
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Filter analyzed files by Dynamic Range: Dolby Vision 8.1" }));

    expect(await screen.findByPlaceholderText("e.g. hdr10, dv, sdr")).toHaveValue("Dolby Vision 8.1");
    await waitFor(() =>
      expect(libraryFilesSpy).toHaveBeenLastCalledWith(
        String(libraryId),
        expect.objectContaining({
          filters: expect.objectContaining({
            hdr_type: "Dolby Vision 8.1",
          }),
        }),
      ),
    );
  });

  it("blocks invalid structured search values and shows an inline validation error", async () => {
    const libraryId = 606;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    const initialCalls = libraryFilesSpy.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /add metadata search field/i }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /duration/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. >=1h 30m"), { target: { value: "oops" } });

    expect(await screen.findByText("Use a duration like >90m or >=1h 30m.")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "Export analyzed files as CSV" })) {
      expect(button).toBeDisabled();
    }
    await waitFor(() => expect(libraryFilesSpy.mock.calls.length).toBe(initialCalls));
  });

  it("exports the current filtered and sorted result set as CSV", async () => {
    const libraryId = 707;
    mockAppSettings({ feature_flags: { show_analyzed_files_csv_export: true } });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));
    const downloadCsvSpy = vi.spyOn(api, "downloadLibraryFilesCsv").mockResolvedValue({
      blob: new Blob(["csv"], { type: "text/csv" }),
      filename: "MediaLyze_Series_707_20260318T120000Z.csv",
    });
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrlSpy = vi.fn(() => "blob:test");
    const revokeObjectUrlSpy = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: createObjectUrlSpy });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revokeObjectUrlSpy });
    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    try {
      renderPage(libraryId);

      expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText("Search file and path"), { target: { value: "episode" } });
      fireEvent.click(screen.getByRole("button", { name: /add metadata search field/i }));
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /subtitle sources/i }));
      fireEvent.change(screen.getByPlaceholderText("e.g. internal external"), { target: { value: "external" } });
      fireEvent.click(screen.getByRole("button", { name: /^codec$/i }));

      fireEvent.click(screen.getAllByRole("button", { name: "Export analyzed files as CSV" })[0]);

      await waitFor(() =>
        expect(downloadCsvSpy).toHaveBeenCalledWith(
          String(libraryId),
          expect.objectContaining({
            filters: expect.objectContaining({
              file: "episode",
              subtitle_sources: "external",
            }),
            sortKey: "video_codec",
            sortDirection: "asc",
            signal: expect.any(AbortSignal),
          }),
        ),
      );
      expect(createObjectUrlSpy).toHaveBeenCalled();
      expect(anchorClickSpy).toHaveBeenCalled();
      expect(revokeObjectUrlSpy).toHaveBeenCalledWith("blob:test");
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        writable: true,
        value: originalCreateObjectUrl,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        writable: true,
        value: originalRevokeObjectUrl,
      });
    }
  });

  it("hides the CSV export button when the feature flag is disabled", async () => {
    const libraryId = 708;
    mockAppSettings();
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export analyzed files as CSV" })).not.toBeInTheDocument();
  });
});
