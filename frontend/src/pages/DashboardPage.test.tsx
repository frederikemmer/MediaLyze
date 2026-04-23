import "../i18n";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";

import { AppDataProvider } from "../lib/app-data";
import {
  api,
  type AppSettings,
  type ComparisonResponse,
  type DashboardHistoryResponse,
  type DashboardResponse,
} from "../lib/api";
import { getLibraryStatisticsSettings, saveLibraryStatisticsSettings } from "../lib/library-statistics-settings";
import { ScanJobsProvider } from "../lib/scan-jobs";
import { DashboardPage } from "./DashboardPage";

function createAppSettings(): AppSettings {
  return {
    ignore_patterns: [],
    user_ignore_patterns: [],
    default_ignore_patterns: [],
    resolution_categories: [],
    scan_performance: {
      scan_worker_count: 4,
      parallel_scan_jobs: 2,
      comparison_scatter_point_limit: 5000,
    },
    feature_flags: {
      show_analyzed_files_csv_export: false,
      show_full_width_app_shell: false,
      hide_quality_score_meter: false,
      unlimited_panel_size: false,
      in_depth_dolby_vision_profiles: false,
    },
  };
}

function createDashboard(): DashboardResponse {
  return {
    totals: {
      libraries: 2,
      files: 10,
      storage_bytes: 1024,
      duration_seconds: 3600,
    },
    container_distribution: [
      { label: "MKV", value: 7 },
      { label: "MP4", value: 3 },
    ],
    video_codec_distribution: [{ label: "hevc", value: 10 }],
    resolution_distribution: [{ label: "4k", value: 5 }],
    hdr_distribution: [{ label: "HDR10", value: 3 }],
    audio_codec_distribution: [{ label: "eac3", value: 8 }],
    audio_spatial_profile_distribution: [{ label: "Dolby Atmos", value: 4 }],
    audio_language_distribution: [{ label: "en", value: 9 }],
    subtitle_distribution: [{ label: "en", value: 6 }],
    subtitle_codec_distribution: [{ label: "subrip", value: 5 }],
    subtitle_source_distribution: [{ label: "internal", value: 4 }],
    numeric_distributions: {
      quality_score: {
        total: 10,
        bins: Array.from({ length: 10 }, (_, index) => ({
          lower: index + 1,
          upper: index + 2,
          count: index === 7 ? 4 : 0,
          percentage: index === 7 ? 40 : 0,
        })),
      },
      duration: {
        total: 10,
        bins: [
          { lower: 0, upper: 1800, count: 2, percentage: 20 },
          { lower: 1800, upper: 3600, count: 3, percentage: 30 },
          { lower: 3600, upper: 5400, count: 2, percentage: 20 },
          { lower: 5400, upper: 7200, count: 2, percentage: 20 },
          { lower: 7200, upper: 9000, count: 1, percentage: 10 },
          { lower: 9000, upper: 10800, count: 0, percentage: 0 },
          { lower: 10800, upper: null, count: 0, percentage: 0 },
        ],
      },
      size: {
        total: 10,
        bins: [
          { lower: 0, upper: 500000000, count: 1, percentage: 10 },
          { lower: 500000000, upper: 1000000000, count: 2, percentage: 20 },
          { lower: 1000000000, upper: 2000000000, count: 3, percentage: 30 },
          { lower: 2000000000, upper: 4000000000, count: 2, percentage: 20 },
          { lower: 4000000000, upper: 8000000000, count: 1, percentage: 10 },
          { lower: 8000000000, upper: 16000000000, count: 1, percentage: 10 },
          { lower: 16000000000, upper: null, count: 0, percentage: 0 },
        ],
      },
      bitrate: {
        total: 10,
        bins: [
          { lower: 0, upper: 2000000, count: 1, percentage: 10 },
          { lower: 2000000, upper: 4000000, count: 2, percentage: 20 },
          { lower: 4000000, upper: 8000000, count: 3, percentage: 30 },
          { lower: 8000000, upper: 12000000, count: 2, percentage: 20 },
          { lower: 12000000, upper: 20000000, count: 1, percentage: 10 },
          { lower: 20000000, upper: 40000000, count: 1, percentage: 10 },
          { lower: 40000000, upper: null, count: 0, percentage: 0 },
        ],
      },
      audio_bitrate: {
        total: 10,
        bins: [
          { lower: 0, upper: 128000, count: 1, percentage: 10 },
          { lower: 128000, upper: 256000, count: 2, percentage: 20 },
          { lower: 256000, upper: 512000, count: 3, percentage: 30 },
          { lower: 512000, upper: 1024000, count: 2, percentage: 20 },
          { lower: 1024000, upper: 2048000, count: 1, percentage: 10 },
          { lower: 2048000, upper: null, count: 1, percentage: 10 },
        ],
      },
    },
  };
}

function createComparisonResponse(): ComparisonResponse {
  return {
    x_field: "duration",
    y_field: "size",
    x_field_kind: "numeric",
    y_field_kind: "numeric",
    available_renderers: ["heatmap", "scatter", "bar"],
    total_files: 10,
    included_files: 10,
    excluded_files: 0,
    sampled_points: false,
    sample_limit: 5000,
    x_buckets: [
      { key: "0:1800", label: "0:1800", lower: 0, upper: 1800 },
      { key: "1800:3600", label: "1800:3600", lower: 1800, upper: 3600 },
      { key: "3600:5400", label: "3600:5400", lower: 3600, upper: 5400 },
    ],
    y_buckets: [
      { key: "0:500000000", label: "0:500000000", lower: 0, upper: 500000000 },
      { key: "500000000:1000000000", label: "500000000:1000000000", lower: 500000000, upper: 1000000000 },
    ],
    heatmap_cells: [
      { x_key: "1800:3600", y_key: "0:500000000", count: 4 },
      { x_key: "3600:5400", y_key: "500000000:1000000000", count: 6 },
    ],
    scatter_points: [
      { media_file_id: 1, asset_name: "movie-one.mkv", x_value: 2400, y_value: 400000000 },
      { media_file_id: 2, asset_name: "movie-two.mkv", x_value: 4200, y_value: 900000000 },
    ],
    bar_entries: [
      { x_key: "1800:3600", x_label: "1800:3600", value: 400000000, count: 4 },
      { x_key: "3600:5400", x_label: "3600:5400", value: 900000000, count: 6 },
    ],
  };
}

function createDashboardHistory(): DashboardHistoryResponse {
  return {
    generated_at: "2026-04-19T08:00:00Z",
    oldest_snapshot_day: "2026-04-17",
    newest_snapshot_day: "2026-04-18",
    visible_library_ids: [1, 2],
    resolution_categories: [
      { id: "4k", label: "4k" },
      { id: "1080p", label: "1080p" },
    ],
    points: [
      {
        snapshot_day: "2026-04-17",
        trend_metrics: {
          total_files: 8,
          resolution_counts: { "4k": 3, "1080p": 5 },
          average_bitrate: 8_000_000,
          average_audio_bitrate: 512_000,
          average_duration_seconds: 4_200,
          average_quality_score: 7.2,
        },
      },
      {
        snapshot_day: "2026-04-18",
        trend_metrics: {
          total_files: 10,
          resolution_counts: { "4k": 4, "1080p": 6 },
          average_bitrate: 8_500_000,
          average_audio_bitrate: 576_000,
          average_duration_seconds: 4_500,
          average_quality_score: 7.6,
        },
      },
    ],
  };
}

function renderPage() {
  const FileRoute = () => {
    const { fileId = "" } = useParams();
    return <div>{`File detail ${fileId}`}</div>;
  };

  return render(
    <MemoryRouter initialEntries={["/"]}>
      <AppDataProvider>
        <ScanJobsProvider>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/files/:fileId" element={<FileRoute />} />
          </Routes>
        </ScanJobsProvider>
      </AppDataProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("DashboardPage", () => {
  it("shows the dashboard title and persists inline layout changes", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard());
    vi.spyOn(api, "dashboardHistory").mockResolvedValue(createDashboardHistory());
    vi.spyOn(api, "dashboardComparison").mockResolvedValue(createComparisonResponse());
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);

    renderPage();

    expect(await screen.findByRole("heading", { level: 2, name: "Dashboard" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit panel layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Add panel" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Subtitle codecs" }));
    fireEvent.click(screen.getByRole("button", { name: "Save panel layout" }));

    expect(window.localStorage.getItem("medialyze-statistic-panel-layout-dashboard-main")).toContain("\"subtitle_codecs\"");
  });

  it("renders dashboard statistic panels from the persisted inline layout", async () => {
    window.localStorage.setItem(
      "medialyze-statistic-panel-layout-dashboard-main",
      JSON.stringify({
        items: [
          { instanceId: "container", statisticId: "container", width: 1, height: 1 },
          { instanceId: "audio_spatial_profiles", statisticId: "audio_spatial_profiles", width: 1, height: 1 },
          { instanceId: "subtitle_codecs", statisticId: "subtitle_codecs", width: 1, height: 1 },
          { instanceId: "subtitle_sources", statisticId: "subtitle_sources", width: 1, height: 1 },
        ],
      }),
    );

    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard());
    vi.spyOn(api, "dashboardHistory").mockResolvedValue(createDashboardHistory());
    vi.spyOn(api, "dashboardComparison").mockResolvedValue(createComparisonResponse());
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("Containers")).toBeInTheDocument();
    expect(screen.getByText("Spatial audio")).toBeInTheDocument();
    expect(screen.getByText("Subtitle codecs")).toBeInTheDocument();
    expect(screen.getAllByText("Subtitle sources")).toHaveLength(1);
    expect(screen.getByText("MKV")).toBeInTheDocument();
    expect(screen.getByText("Dolby Atmos")).toBeInTheDocument();
    expect(screen.getByText("SubRip (SRT)")).toBeInTheDocument();
    expect(screen.getByText("Internal")).toBeInTheDocument();
  });

  it("shows which persisted dashboard layout entries could not be reused", async () => {
    window.localStorage.setItem(
      "medialyze-statistic-panel-layout-dashboard-main",
      JSON.stringify({
        items: [
          { instanceId: "legacy", statisticId: "legacy_metric", width: 1, height: 1 },
          { instanceId: "size", statisticId: "size", width: 2, height: 8 },
        ],
      }),
    );

    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard());
    vi.spyOn(api, "dashboardHistory").mockResolvedValue(createDashboardHistory());
    vi.spyOn(api, "dashboardComparison").mockResolvedValue(createComparisonResponse());
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("Layout updated")).toBeInTheDocument();
    expect(screen.getByText(/Panel "legacy_metric" at position 1 is no longer available/)).toBeInTheDocument();
    expect(screen.getByText('Panel "File size" height was changed from 8 to 4.')).toBeInTheDocument();
  });

  it("renders numeric dashboard charts when enabled in settings", async () => {
    const settings = getLibraryStatisticsSettings();
    settings.visibility.size.dashboardEnabled = true;
    settings.visibility.quality_score.dashboardEnabled = true;
    settings.visibility.duration.dashboardEnabled = true;
    saveLibraryStatisticsSettings(settings);

    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard());
    vi.spyOn(api, "dashboardHistory").mockResolvedValue(createDashboardHistory());
    vi.spyOn(api, "dashboardComparison").mockResolvedValue(createComparisonResponse());
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);

    renderPage();

    expect(await screen.findByRole("heading", { level: 2, name: "File size" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Quality score" })).toBeInTheDocument();
    expect((await screen.findAllByTestId("echarts-react")).length).toBeGreaterThan(0);
  });

  it("renders the comparison panel and reloads it when the axis selection changes", async () => {
    window.localStorage.setItem(
      "medialyze-statistic-panel-layout-dashboard-main",
      JSON.stringify({
        items: [{ instanceId: "comparison-1", statisticId: "comparison", width: 2, height: 2 }],
      }),
    );

    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard());
    vi.spyOn(api, "dashboardHistory").mockResolvedValue(createDashboardHistory());
    const comparisonSpy = vi.spyOn(api, "dashboardComparison").mockResolvedValue(createComparisonResponse());
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);

    renderPage();

    expect(screen.queryByRole("heading", { level: 2, name: "Metric comparison" })).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Select Y-axis metric")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Select Y-axis metric"), { target: { value: "quality_score" } });

    expect(comparisonSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ xField: "duration", yField: "quality_score" }),
    );
  });

  it("renders dashboard numeric bar charts with a non-interactive cursor", async () => {
    window.localStorage.setItem(
      "medialyze-statistic-panel-layout-dashboard-main",
      JSON.stringify({
        items: [{ instanceId: "duration", statisticId: "duration", width: 2, height: 2 }],
      }),
    );

    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard());
    vi.spyOn(api, "dashboardHistory").mockResolvedValue(createDashboardHistory());
    vi.spyOn(api, "dashboardComparison").mockResolvedValue(createComparisonResponse());
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);

    renderPage();

    const chart = (await screen.findAllByTestId("echarts-react")).find(
      (candidate) => candidate.getAttribute("data-points") === "[2,3,2,2,1,0,0]",
    );
    expect(chart).toBeDefined();
    expect(chart).toHaveAttribute("data-cursor", "default");
    expect(chart).toHaveAttribute("data-clickable", "false");
  });

  it("opens the file detail route when a comparison point is clicked in scatter view", async () => {
    window.localStorage.setItem(
      "medialyze-statistic-panel-layout-dashboard-main",
      JSON.stringify({
        items: [
          {
            instanceId: "comparison-1",
            statisticId: "comparison",
            width: 2,
            height: 2,
            comparisonSelection: {
              xField: "duration",
              yField: "size",
              renderer: "scatter",
            },
          },
        ],
      }),
    );

    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard());
    vi.spyOn(api, "dashboardHistory").mockResolvedValue(createDashboardHistory());
    vi.spyOn(api, "dashboardComparison").mockResolvedValue(createComparisonResponse());
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);

    renderPage();

    const chart = (await screen.findAllByTestId("echarts-react")).find(
      (candidate) => candidate.getAttribute("data-points") === "[[2400,400000000],[4200,900000000]]",
    );
    expect(chart).toBeDefined();
    expect(chart).toHaveAttribute("data-cursor", "pointer");
    fireEvent.click(chart!);

    expect(await screen.findByText("File detail 1")).toBeInTheDocument();
  });

  it("does not navigate when a dashboard comparison heatmap cell is clicked", async () => {
    window.localStorage.setItem(
      "medialyze-statistic-panel-layout-dashboard-main",
      JSON.stringify({
        items: [
          {
            instanceId: "comparison-1",
            statisticId: "comparison",
            width: 2,
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

    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard());
    vi.spyOn(api, "dashboardHistory").mockResolvedValue(createDashboardHistory());
    vi.spyOn(api, "dashboardComparison").mockResolvedValue(createComparisonResponse());
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);

    renderPage();

    const chart = (await screen.findAllByTestId("echarts-react")).find(
      (candidate) => candidate.getAttribute("data-points") === "[[1,0,4],[2,1,6]]",
    );
    expect(chart).toBeDefined();
    expect(chart).toHaveAttribute("data-cursor", "default");
    expect(chart).toHaveAttribute("data-clickable", "false");
    fireEvent.click(chart!);

    expect(screen.queryByText("File detail 1")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Dashboard" })).toBeInTheDocument();
  });

  it("does not navigate when a dashboard comparison bar is clicked", async () => {
    window.localStorage.setItem(
      "medialyze-statistic-panel-layout-dashboard-main",
      JSON.stringify({
        items: [
          {
            instanceId: "comparison-1",
            statisticId: "comparison",
            width: 2,
            height: 2,
            comparisonSelection: {
              xField: "duration",
              yField: "size",
              renderer: "bar",
            },
          },
        ],
      }),
    );

    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard());
    vi.spyOn(api, "dashboardHistory").mockResolvedValue(createDashboardHistory());
    vi.spyOn(api, "dashboardComparison").mockResolvedValue(createComparisonResponse());
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);

    renderPage();

    const chart = (await screen.findAllByTestId("echarts-react")).find(
      (candidate) => candidate.getAttribute("data-points") === "[400000000,900000000]",
    );
    expect(chart).toBeDefined();
    expect(chart).toHaveAttribute("data-cursor", "default");
    expect(chart).toHaveAttribute("data-clickable", "false");
    fireEvent.click(chart!);

    expect(screen.queryByText("File detail 1")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Dashboard" })).toBeInTheDocument();
  });

  it("renders the dashboard history panel", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard());
    vi.spyOn(api, "dashboardHistory").mockResolvedValue(createDashboardHistory());
    vi.spyOn(api, "dashboardComparison").mockResolvedValue(createComparisonResponse());
    vi.spyOn(api, "activeScanJobs").mockResolvedValue([]);

    renderPage();

    const historyToggle = await screen.findByRole("button", { name: "Historic data" });
    expect(historyToggle).toBeInTheDocument();
    expect(historyToggle.closest(".statistic-layout-panel-shell")).not.toBeNull();
    expect(screen.getByLabelText("Select history metric")).toBeInTheDocument();
    expect(screen.queryByText("Daily trend snapshots from finished scans")).not.toBeInTheDocument();
  });
});
