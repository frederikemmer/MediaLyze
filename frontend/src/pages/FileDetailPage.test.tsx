import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppDataProvider } from "../lib/app-data";
import {
  api,
  type AppSettings,
  type MediaFileDetail,
  type MediaFileQualityScoreDetail,
} from "../lib/api";
import { FileDetailPage } from "./FileDetailPage";

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
      ...overrideScanPerformance,
    },
    feature_flags: {
      show_analyzed_files_csv_export: false,
      show_full_width_app_shell: false,
      hide_quality_score_meter: false,
      ...overrideFeatureFlags,
    },
    ...restOverrides,
  };
}

function createFileDetail(): MediaFileDetail {
  return {
    id: 77,
    library_id: 9,
    relative_path:
      "Shows/Season01/A_Very_Long_Show_Name.2025.S01E01.With.An_Absurdly_Long_File_Name_That_Should_Not_Overflow_The_Layout.2160p.WEB-DL.DV.HEVC-GROUP.mkv",
    filename:
      "A_Very_Long_Show_Name.2025.S01E01.With.An_Absurdly_Long_File_Name_That_Should_Not_Overflow_The_Layout.2160p.WEB-DL.DV.HEVC-GROUP.mkv",
    extension: "mkv",
    size_bytes: 10_737_418_240,
    mtime: 1,
    last_seen_at: "2026-03-13T10:00:00Z",
    last_analyzed_at: "2026-03-13T10:05:00Z",
    scan_status: "ready",
    quality_score: 9,
    quality_score_raw: 91.2,
    duration: 3360,
    video_codec: "hevc",
    resolution: "3840x1606",
    resolution_category_id: "4k",
    resolution_category_label: "UHD",
    hdr_type: "Dolby Vision",
    audio_codecs: ["eac3"],
    audio_languages: ["en"],
    subtitle_languages: ["en", "de"],
    subtitle_codecs: ["srt"],
    subtitle_sources: ["internal", "external"],
    media_format: {
      container_format: "matroska",
      duration: 3360,
      bit_rate: 25_000_000,
      probe_score: 100,
    },
    video_streams: [
      {
        stream_index: 0,
        codec: "hevc",
        profile: "Main 10",
        width: 3840,
        height: 1606,
        pix_fmt: "yuv420p10le",
        color_space: "bt2020nc",
        color_transfer: "smpte2084",
        color_primaries: "bt2020",
        frame_rate: 23.976,
        bit_rate: 20_000_000,
        hdr_type: "Dolby Vision",
      },
    ],
    audio_streams: [
      {
        stream_index: 1,
        codec: "eac3",
        channels: 6,
        channel_layout: "5.1",
        sample_rate: 48_000,
        bit_rate: 768_000,
        language: "en",
        default_flag: true,
        forced_flag: false,
      },
    ],
    subtitle_streams: [
      {
        stream_index: 2,
        codec: "srt",
        language: "en",
        default_flag: true,
        forced_flag: false,
        subtitle_type: "text",
      },
    ],
    external_subtitles: [{ path: "Shows/Season01/file.en.srt", language: "en", format: "srt" }],
    raw_ffprobe_json: { streams: [] },
  };
}

function createQualityDetail(): MediaFileQualityScoreDetail {
  return {
    id: 77,
    score: 9,
    score_raw: 91.2,
    breakdown: {
      score: 9,
      score_raw: 91.2,
      categories: [],
    },
  };
}

function renderPage(fileId: number) {
  return render(
    <MemoryRouter initialEntries={[`/files/${fileId}`]}>
      <AppDataProvider>
        <Routes>
          <Route path="/files/:fileId" element={<FileDetailPage />} />
        </Routes>
      </AppDataProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FileDetailPage", () => {
  it("renders long paths as segmented chips with full-path and filename tooltips", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    expect(await screen.findByText("UHD")).toBeInTheDocument();
    const segments = Array.from(container.querySelectorAll(".path-segment")).map((segment) => segment.textContent);
    expect(segments).toEqual([
      "Shows",
      "Season01",
      "A_Very_Long_Show_Name.2025.S01E01.With.An_Absurdly_Long_File_Name_That_Should_Not_Overflow_The_Layout.2160p.WEB-DL.DV.HEVC-GROUP.mkv",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Show full relative path" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(file.relative_path);

    fireEvent.click(screen.getByRole("button", { name: "Show full file name" }));
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent(file.filename));

    fireEvent.click(screen.getByRole("button", { name: "Show exact resolution" }));
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent(file.resolution ?? ""));
  });

  it("stays stable when the quality detail request fails", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockRejectedValue(new Error("quality unavailable"));

    const { container } = renderPage(file.id);

    expect(await screen.findByText("UHD")).toBeInTheDocument();
    expect(screen.getByText("Quality breakdown")).toBeInTheDocument();
    expect(container.querySelectorAll(".path-segment")).toHaveLength(3);
    expect(screen.queryByText("quality unavailable")).not.toBeInTheDocument();
  });
});
