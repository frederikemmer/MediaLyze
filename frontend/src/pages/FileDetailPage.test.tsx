import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
      show_music_quality_score: false,
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
    bit_depth: null,
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
    chapters: [
      {
        chapter_index: 0,
        start_time: 0,
        end_time: 90,
        duration: 90,
        title: "Opening",
        tags: { title: "Opening" },
      },
      {
        chapter_index: 1,
        start_time: 90,
        end_time: 180,
        duration: 90,
        title: null,
        tags: null,
      },
    ],
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

function createEnrichmentOnlyFileHistory(): MediaFileHistory {
  const current = createFileDetail();
  return {
    file_id: current.id,
    library_id: current.library_id,
    relative_path: current.relative_path,
    total: 2,
    items: [
      {
        id: 2,
        media_file_id: current.id,
        library_id: current.library_id,
        relative_path: current.relative_path,
        filename: current.filename,
        captured_at: "2026-03-15T10:00:00Z",
        capture_reason: "scan_analysis",
        snapshot_hash: "enriched",
        snapshot: {
          ...current,
          audio_channels: 6,
          sample_rate: 48_000,
          has_embedded_cover: false,
          content_category: "main",
        },
      },
      {
        id: 1,
        media_file_id: current.id,
        library_id: current.library_id,
        relative_path: current.relative_path,
        filename: current.filename,
        captured_at: "2026-03-14T10:00:00Z",
        capture_reason: "scan_analysis",
        snapshot_hash: "unenriched",
        snapshot: {
          ...current,
          audio_channels: null,
          sample_rate: null,
          has_embedded_cover: undefined,
          content_category: undefined,
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

async function selectFileDetailPanel(name: string) {
  const items = await screen.findAllByRole("button", { name });
  const desktopItem = items.find((item) => item.closest(".settings-navigation-list"));
  fireEvent.click(desktopItem ?? items[0]);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("FileDetailPage", () => {
  it("renders overview badges and swaps active panels from the navigation", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("UHD")).toBeInTheDocument();
    expect(screen.getByText("10.0 GB")).toBeInTheDocument();
    expect(screen.getAllByText("56m").length).toBeGreaterThan(0);
    expect(screen.getAllByText("9/10").length).toBeGreaterThan(0);
    expect(container.querySelector(".path-segment")).not.toBeInTheDocument();
    expect(container.querySelector(".card-grid")).not.toBeInTheDocument();

    const pathTooltipTrigger = screen.getByRole("button", { name: "Show full relative path" });
    fireEvent.mouseEnter(pathTooltipTrigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(file.relative_path);

    await selectFileDetailPanel("Format");
    expect(await screen.findByRole("heading", { name: "Format" })).toBeInTheDocument();
    const activePanel = container.querySelector(".file-detail-active-panel") as HTMLElement;
    expect(within(activePanel).getAllByRole("heading", { name: "Format" })).toHaveLength(1);
    expect(screen.getByText("Container")).toBeInTheDocument();
    expect(screen.getByText("Matroska")).toBeInTheDocument();
    expect(screen.getByText("25 Mbps")).toBeInTheDocument();
    expect(screen.getByText("100/100")).toBeInTheDocument();

    await selectFileDetailPanel("Video streams");
    expect(await screen.findByRole("heading", { name: "Video streams" })).toBeInTheDocument();
    expect(within(activePanel).getAllByRole("heading", { name: "Video streams" })).toHaveLength(1);
    expect(screen.getByText("Main 10")).toBeInTheDocument();

    await selectFileDetailPanel("Audio streams");
    expect(await screen.findByRole("heading", { name: "Audio streams" })).toBeInTheDocument();
    expect(screen.getByText("Dolby Digital Plus")).toBeInTheDocument();
    expect(screen.getByText("Dolby Atmos")).toBeInTheDocument();
    expect(screen.getByText("5.1")).toBeInTheDocument();

    await selectFileDetailPanel("Subtitles");
    expect(await screen.findByRole("heading", { name: "Subtitles" })).toBeInTheDocument();
    expect(screen.getAllByText("SubRip (SRT)")).toHaveLength(2);
    expect(screen.getByText("External")).toBeInTheDocument();
  });

  it("renders audiobook chapters with timings and fallback titles through navigation", async () => {
    const file = createFileDetail();
    const downloadChapters = vi.spyOn(api, "downloadFileChaptersCsv").mockResolvedValue({
      blob: new Blob(["chapter_index,title\n0,Opening\n"], { type: "text/csv" }),
      filename: "book-chapters.csv",
    });
    const createObjectUrl = vi.fn(() => "blob:chapters");
    const revokeObjectUrl = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(window.URL, "createObjectURL", { value: createObjectUrl, configurable: true });
    Object.defineProperty(window.URL, "revokeObjectURL", { value: revokeObjectUrl, configurable: true });
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    renderPage(file.id);

    await selectFileDetailPanel("Chapters");
    expect(await screen.findByText("Opening")).toBeInTheDocument();
    expect(screen.getByText("Chapter 2")).toBeInTheDocument();
    expect(screen.getAllByText("1m").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search chapters" }), { target: { value: "opening" } });
    expect(screen.getByText("Opening")).toBeInTheDocument();
    expect(screen.queryByText("Chapter 2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export chapters" }));
    await waitFor(() => expect(downloadChapters).toHaveBeenCalledWith(file.id));
    expect(createObjectUrl).toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:chapters");
  });

  it("renders cover details and keeps analysis diagnostics in overview", async () => {
    const file = {
      ...createFileDetail(),
      scan_status: "failed",
      has_embedded_cover: true,
      embedded_cover_stream_index: 3,
      embedded_cover_codec: "mjpeg",
      embedded_cover_width: 600,
      embedded_cover_height: 900,
      analysis_failure_kind: "audible_drm_or_unreadable",
      analysis_failure_reason: "Probably DRM-protected or unreadable by ffprobe.",
      analysis_failure_detail: "Invalid data found when processing input",
    };
    const downloadCover = vi.spyOn(api, "downloadFileCover").mockResolvedValue({
      blob: new Blob(["cover"], { type: "image/png" }),
      filename: "movie-cover.png",
    });
    const createObjectUrl = vi.fn(() => "blob:cover");
    const revokeObjectUrl = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(window.URL, "createObjectURL", { value: createObjectUrl, configurable: true });
    Object.defineProperty(window.URL, "revokeObjectURL", { value: revokeObjectUrl, configurable: true });
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    renderPage(file.id);

    expect(await screen.findByText("Analysis issue")).toBeInTheDocument();
    expect(screen.getByText("Probably DRM-protected or unreadable by ffprobe.")).toBeInTheDocument();

    await selectFileDetailPanel("Cover");
    expect(await screen.findByText("600x900")).toBeInTheDocument();
    expect(screen.getByText("mjpeg")).toBeInTheDocument();
    expect(downloadCover).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Load cover" }));
    await waitFor(() => expect(downloadCover).toHaveBeenCalledWith(file.id));
    expect(createObjectUrl).toHaveBeenCalled();
    expect(await screen.findByRole("img", { name: `Embedded cover for ${file.filename}` })).toHaveAttribute("src", "blob:cover");

    fireEvent.click(screen.getByRole("button", { name: "Download cover" }));
    expect(anchorClick).toHaveBeenCalled();
  });

  it("renders file history snapshots in the selected detail panel", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());
    vi.spyOn(api, "fileHistory").mockResolvedValue(createFileHistory());

    const { container } = renderPage(file.id);

    await selectFileDetailPanel("File history");
    expect(await screen.findByRole("heading", { name: "File history" })).toBeInTheDocument();
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

  it("collapses file history snapshots that only add newly detected metadata", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());
    vi.spyOn(api, "fileHistory").mockResolvedValue(createEnrichmentOnlyFileHistory());

    const { container } = renderPage(file.id);

    await selectFileDetailPanel("File history");
    expect(await screen.findByRole("heading", { name: "File history" })).toBeInTheDocument();
    const historyList = container.querySelector(".file-history-list");
    expect(historyList?.querySelectorAll(".file-history-entry")).toHaveLength(1);
    expect(historyList?.textContent).not.toContain("Audio Channels");
    expect(historyList?.textContent).not.toContain("Sample Rate");
    expect(historyList?.textContent).toContain("No tracked fields changed in this period.");
  });

  it("stays stable when the quality detail request fails", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockRejectedValue(new Error("quality unavailable"));

    const { container } = renderPage(file.id);

    expect(await screen.findByText("UHD")).toBeInTheDocument();
    await selectFileDetailPanel("Quality breakdown");
    expect(await screen.findByText("Quality breakdown unavailable.")).toBeInTheDocument();
    expect(container.querySelector(".card-grid")).not.toBeInTheDocument();
    expect(screen.queryByText("quality unavailable")).not.toBeInTheDocument();
  });

  it("persists active navigation selection across file detail pages", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    renderPage(file.id);

    await selectFileDetailPanel("Format");
    expect(await screen.findByText("Matroska")).toBeInTheDocument();
    expect(window.localStorage.getItem("medialyze-file-detail-active-panel")).toBe("format");

    cleanup();
    renderPage(file.id + 1);

    expect(await screen.findByRole("heading", { name: "Format" })).toBeInTheDocument();
    expect(screen.getByText("Matroska")).toBeInTheDocument();
  });

  it("persists collapsed navigation state", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse file detail menu" }));
    expect(window.localStorage.getItem("medialyze-file-detail-sidebar-collapsed")).toBe("true");
    expect(container.querySelector(".file-detail-layout")).toHaveClass("is-settings-nav-collapsed");

    cleanup();
    const rerendered = renderPage(file.id + 1);
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(rerendered.container.querySelector(".file-detail-layout")).toHaveClass("is-settings-nav-collapsed");
  });

  it("does not render legacy drag handles or top-level panel grid", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(container.querySelector(".file-detail-panels-grid")).not.toBeInTheDocument();
    expect(container.querySelector(".file-detail-panel-drag-handle")).not.toBeInTheDocument();
  });

  it("hides video-specific panels for audio files and shows audio metadata", async () => {
    const audioFile: MediaFileDetail = {
      ...createFileDetail(),
      filename: "Song.mp3",
      relative_path: "Music/Album/Song.mp3",
      extension: "mp3",
      container: "mp3",
      video_codec: null,
      resolution: null,
      resolution_category_id: null,
      resolution_category_label: null,
      hdr_type: null,
      video_streams: [],
      subtitle_streams: [],
      external_subtitles: [],
      subtitle_languages: [],
      subtitle_codecs: [],
      subtitle_sources: [],
      chapters: [],
      has_embedded_cover: true,
      embedded_cover_codec: "mjpeg",
      embedded_cover_width: 500,
      embedded_cover_height: 500,
      audio_title: "Song title",
      audio_artist: "Artist A",
      audio_album: "Album A",
      audio_composer: "Composer A",
      raw_ffprobe_json: { format: { tags: { artist: "Artist A" } } },
    };
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(audioFile);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    renderPage(audioFile.id);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Video streams" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Subtitles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chapters" })).not.toBeInTheDocument();

    await selectFileDetailPanel("Audio streams");
    expect(await screen.findByText("Audio metadata")).toBeInTheDocument();
    expect(screen.getByText("Song title")).toBeInTheDocument();
    expect(screen.getByText("Artist A")).toBeInTheDocument();
    expect(screen.getByText("Album A")).toBeInTheDocument();
    expect(screen.getByText("Composer A")).toBeInTheDocument();
  });

  it("keeps music and audiobook metadata out of ordinary video files", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    renderPage(file.id);

    expect(await screen.findByRole("button", { name: "Video streams" })).toBeInTheDocument();
    await selectFileDetailPanel("Audio streams");
    expect(await screen.findByText("Dolby Digital Plus")).toBeInTheDocument();
    expect(screen.queryByText("Audio metadata")).not.toBeInTheDocument();
    expect(screen.queryByText("Album")).not.toBeInTheDocument();
    expect(screen.queryByText("Composer")).not.toBeInTheDocument();
  });

  it("falls back to overview when a stored panel is not available for the current file", async () => {
    const file: MediaFileDetail = {
      ...createFileDetail(),
      chapters: [],
    };
    window.localStorage.setItem("medialyze-file-detail-active-panel", "chapters");
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    renderPage(file.id);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem("medialyze-file-detail-active-panel")).toBe("overview"));
    expect(screen.queryByRole("button", { name: "Chapters" })).not.toBeInTheDocument();
  });

  it("keeps raw JSON reachable through navigation", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    renderPage(file.id);

    await selectFileDetailPanel("Raw ffprobe JSON");
    expect(await screen.findByRole("heading", { name: "Raw ffprobe JSON" })).toBeInTheDocument();
    expect(screen.getAllByText(/streams/).length).toBeGreaterThan(0);
  });
});
