import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppDataProvider } from "../lib/app-data";
import {
  api,
  type AppSettings,
  type MediaFileDetail,
  type MediaFileHistory,
  type MediaFileQualityScoreDetail,
} from "../lib/api";
import { FILE_DETAIL_PANEL_SETTINGS_STORAGE_KEY, getFileDetailPanelSettings } from "../lib/file-detail-panels";
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
      comparison_scatter_point_limit: 5000,
      ...overrideScanPerformance,
    },
    feature_flags: {
      show_analyzed_files_csv_export: false,
      show_full_width_app_shell: false,
      hide_quality_score_meter: false,
      unlimited_panel_size: false,
      in_depth_dolby_vision_profiles: false,
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
    container: "mkv",
    duration: 3360,
    bitrate: 25_000_000,
    audio_bitrate: 768_000,
    video_codec: "hevc",
    resolution: "3840x1606",
    resolution_category_id: "4k",
    resolution_category_label: "UHD",
    hdr_type: "Dolby Vision",
    audio_codecs: ["eac3"],
    audio_spatial_profiles: ["Dolby Atmos"],
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
        profile: "Dolby Digital Plus + Dolby Atmos",
        spatial_audio_profile: "dolby_atmos",
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

function createFileHistory(): MediaFileHistory {
  const current = createFileDetail();
  return {
    file_id: current.id,
    library_id: current.library_id,
    relative_path: current.relative_path,
    total: 3,
    items: [
      {
        id: 3,
        media_file_id: current.id,
        library_id: current.library_id,
        relative_path: current.relative_path,
        filename: current.filename,
        captured_at: "2026-03-15T10:00:00Z",
        capture_reason: "scan_analysis",
        snapshot_hash: "newer-scan-only",
        snapshot: {
          ...current,
          last_seen_at: "2026-03-15T10:00:00Z",
          last_analyzed_at: "2026-03-15T10:05:00Z",
          quality_score: 9,
          size_bytes: 10_737_418_240,
        },
      },
      {
        id: 2,
        media_file_id: current.id,
        library_id: current.library_id,
        relative_path: current.relative_path,
        filename: current.filename,
        captured_at: "2026-03-14T10:00:00Z",
        capture_reason: "quality_recompute",
        snapshot_hash: "newer",
        snapshot: {
          ...current,
          quality_score: 9,
          size_bytes: 10_737_418_240,
        },
      },
      {
        id: 1,
        media_file_id: current.id,
        library_id: current.library_id,
        relative_path: current.relative_path,
        filename: current.filename,
        captured_at: "2026-03-13T10:00:00Z",
        capture_reason: "scan_analysis",
        snapshot_hash: "older",
        snapshot: {
          ...current,
          relative_path: "Shows/Season01/Old_File_Name.mkv",
          filename: "Old_File_Name.mkv",
          quality_score: 8,
          size_bytes: 8_589_934_592,
        },
      },
    ],
  };
}

function renderPage(fileId: number) {
  if (!vi.isMockFunction(api.fileHistory)) {
    vi.spyOn(api, "fileHistory").mockResolvedValue({
      file_id: fileId,
      library_id: 9,
      relative_path: "",
      total: 0,
      items: [],
    });
  }

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

function getPanelShell(title: string): HTMLElement {
  const titleButton = screen.getByRole("button", { name: title });
  const shell = titleButton.closest(".file-detail-panel-shell");
  if (!(shell instanceof HTMLElement)) {
    throw new Error(`Panel shell for "${title}" not found`);
  }
  return shell;
}

function getPanelOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".file-detail-panel-shell .panel-header h2")).map((heading) =>
    heading.textContent?.trim() ?? "",
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("FileDetailPage", () => {
  it("renders header badges and exposes the relative path in the title tooltip", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    expect(await screen.findByText("UHD")).toBeInTheDocument();
    expect(screen.getByText("10.0 GB")).toBeInTheDocument();
    expect(screen.getAllByText("56m").length).toBeGreaterThan(0);
    expect(screen.getAllByText("9/10").length).toBeGreaterThan(0);
    expect(container.querySelector(".path-segment")).not.toBeInTheDocument();
    expect(container.querySelector(".card-grid")).not.toBeInTheDocument();

    const pathTooltipTrigger = screen.getByRole("button", { name: "Show full relative path" });
    fireEvent.mouseEnter(pathTooltipTrigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(file.relative_path);

    fireEvent.click(screen.getByRole("button", { name: "Show exact resolution" }));
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent(file.resolution ?? ""));

    expect(screen.getByText("Container")).toBeInTheDocument();
    expect(screen.getByText("Matroska")).toBeInTheDocument();
    expect(screen.getByText("25 Mbps")).toBeInTheDocument();
    expect(screen.getByText("100/100")).toBeInTheDocument();
    expect(screen.getByText("Main 10")).toBeInTheDocument();
    expect(screen.getByText("Dolby Digital Plus")).toBeInTheDocument();
    expect(screen.getByText("Dolby Atmos")).toBeInTheDocument();
    expect(screen.getByText("5.1")).toBeInTheDocument();
    expect(screen.getAllByText("SubRip (SRT)")).toHaveLength(2);
    expect(screen.getByText("External")).toBeInTheDocument();
  });

  it("renders file history snapshots in the detail panel", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());
    vi.spyOn(api, "fileHistory").mockResolvedValue(createFileHistory());

    const { container } = renderPage(file.id);

    expect(await screen.findByRole("button", { name: "File history" })).toBeInTheDocument();
    expect(screen.getAllByText("Quality").length).toBeGreaterThan(0);
    expect(screen.getAllByText("8.0 GB").length).toBeGreaterThan(0);
    expect(screen.getAllByText("9/10").length).toBeGreaterThan(0);
    const oldValues = Array.from(container.querySelectorAll(".file-history-old-value")).map((element) =>
      element.textContent?.trim(),
    );
    expect(oldValues).toContain("8.0 GB");
    expect(oldValues).toContain("Shows/Season01/Old_File_Name.mkv");
    expect(screen.getAllByText("Shows/Season01/Old_File_Name.mkv").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".file-history-entry")).toHaveLength(2);
    expect(container.querySelectorAll(".file-history-entry[open]")).toHaveLength(1);
  });

  it("stays stable when the quality detail request fails", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockRejectedValue(new Error("quality unavailable"));

    const { container } = renderPage(file.id);

    expect(await screen.findByText("UHD")).toBeInTheDocument();
    expect(screen.getByText("Quality breakdown")).toBeInTheDocument();
    expect(container.querySelector(".card-grid")).not.toBeInTheDocument();
    expect(screen.queryByText("quality unavailable")).not.toBeInTheDocument();
  });

  it("persists collapsed panel state across file detail pages", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    renderPage(file.id);

    expect(await screen.findByText("Matroska")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    await waitFor(() => expect(screen.queryByText("Matroska")).not.toBeInTheDocument());

    cleanup();
    renderPage(file.id + 1);

    expect(await screen.findByRole("button", { name: "Format" })).toBeInTheDocument();
    expect(screen.queryByText("Matroska")).not.toBeInTheDocument();
    expect(getFileDetailPanelSettings().collapsed.format).toBe(true);
  });

  it("persists reordered panels across file detail pages", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    await screen.findByText("Matroska");

    const rawJsonShell = getPanelShell("Raw ffprobe JSON");
    const qualityShell = getPanelShell("Quality breakdown");
    const rawJsonHandle = rawJsonShell.querySelector(".file-detail-panel-drag-handle");
    expect(rawJsonHandle).toBeTruthy();

    fireEvent.dragStart(rawJsonHandle as Element);
    fireEvent.dragOver(qualityShell);
    fireEvent.drop(qualityShell);
    fireEvent.dragEnd(rawJsonHandle as Element);

    await waitFor(() =>
      expect(getPanelOrder(container).slice(0, 2)).toEqual(["Raw ffprobe JSON", "Quality breakdown"]),
    );

    cleanup();
    const rerendered = renderPage(file.id + 1);
    await screen.findByText("Matroska");

    expect(getPanelOrder(rerendered.container).slice(0, 2)).toEqual(["Raw ffprobe JSON", "Quality breakdown"]);
    expect(window.localStorage.getItem(FILE_DETAIL_PANEL_SETTINGS_STORAGE_KEY)).toContain("\"rawJson\",\"qualityBreakdown\"");
  });

  it("reorders panels while following pointer drag", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getMockRect(this: HTMLElement) {
      if (this instanceof HTMLElement && this.classList.contains("file-detail-panels-grid")) {
        return { x: 0, y: 0, left: 0, top: 0, width: 700, height: 600, right: 700, bottom: 600, toJSON: () => ({}) };
      }
      if (this instanceof HTMLElement && this.classList.contains("file-detail-panel-shell")) {
        const width = Number.parseFloat(this.style.width || "345");
        const height = this.textContent?.includes("Raw ffprobe JSON") ? 180 : 100;
        return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON: () => ({}) };
      }
      return { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, toJSON: () => ({}) };
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function getMockClientWidth(this: HTMLElement) {
      return this instanceof HTMLElement && this.classList.contains("file-detail-panels-grid") ? 700 : 345;
    });

    const { container } = renderPage(file.id);

    await waitFor(() => expect(container.querySelector(".file-detail-panels-grid")).toHaveClass("is-masonry-ready"));
    const rawJsonShell = getPanelShell("Raw ffprobe JSON");
    const rawJsonHandle = rawJsonShell.querySelector(".file-detail-panel-drag-handle");
    expect(rawJsonHandle).toBeTruthy();

    fireEvent.pointerDown(rawJsonHandle as Element, { pointerId: 1, button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 40 });
    expect(rawJsonShell).toHaveClass("is-dragging");
    expect(rawJsonShell.style.transform).toContain("translate3d");

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 40, clientY: 40 });

    await waitFor(() =>
      expect(window.localStorage.getItem(FILE_DETAIL_PANEL_SETTINGS_STORAGE_KEY)).toContain(
        "\"rawJson\",\"qualityBreakdown\"",
      ),
    );
  });
});
