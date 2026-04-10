import "../i18n";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppDataProvider } from "../lib/app-data";
import { api, type AppSettings, type DashboardResponse } from "../lib/api";
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
    },
    feature_flags: {
      show_analyzed_files_csv_export: false,
      show_full_width_app_shell: false,
      hide_quality_score_meter: false,
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
  };
}

function renderPage() {
  return render(
    <AppDataProvider>
      <ScanJobsProvider>
        <DashboardPage />
      </ScanJobsProvider>
    </AppDataProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("DashboardPage", () => {
  it("renders newly supported dashboard statistic panels when enabled in settings", async () => {
    const settings = getLibraryStatisticsSettings();
    settings.visibility.container.dashboardEnabled = true;
    settings.visibility.audio_spatial_profiles.dashboardEnabled = true;
    settings.visibility.subtitle_codecs.dashboardEnabled = true;
    settings.visibility.subtitle_sources.dashboardEnabled = true;
    saveLibraryStatisticsSettings(settings);

    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "dashboard").mockResolvedValue(createDashboard());
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
});
