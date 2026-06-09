import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { api, DEFAULT_QUALITY_PROFILE, type AppSettings, type LibrarySummary, type MediaFileDetail } from "../lib/api";
import { AppDataProvider } from "../lib/app-data";
import { FileComparePage } from "./FileComparePage";

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current path">{`${location.pathname}${location.search}`}</output>;
}

function createAppSettings(): AppSettings {
  return {
    ignore_patterns: [],
    user_ignore_patterns: [],
    default_ignore_patterns: [],
    resolution_categories: [{ id: "uhd", label: "UHD", min_width: 3840, min_height: 2160 }],
    scan_performance: { scan_worker_count: 4, parallel_scan_jobs: 2, comparison_scatter_point_limit: 5000 },
    history_retention: {
      file_history: { days: 90, storage_limit_gb: 0 },
      library_history: { days: 365, storage_limit_gb: 0 },
      scan_history: { days: 30, storage_limit_gb: 0 },
    },
    ui_preferences: { interface_language: "en", color_theme: "system" },
    feature_flags: {
      show_analyzed_files_csv_export: true,
      show_full_width_app_shell: false,
      hide_quality_score_meter: false,
      show_music_quality_score: false,
      unlimited_panel_size: false,
      in_depth_dolby_vision_profiles: false,
    },
  };
}

function createLibrary(id: number, name: string): LibrarySummary {
  return {
    id,
    name,
    path: `/media/${name}`,
    type: "movies",
    last_scan_at: null,
    scan_mode: "manual",
    duplicate_detection_mode: "filename",
    scan_config: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    quality_profile: DEFAULT_QUALITY_PROFILE,
    show_on_dashboard: true,
    file_count: 1,
    total_size_bytes: 1024,
    total_duration_seconds: 60,
    ready_files: 1,
    pending_files: 0,
  };
}

function createFile(id: number, overrides: Partial<MediaFileDetail> = {}): MediaFileDetail {
  return {
    id,
    library_id: 1,
    relative_path: `Movies/File-${id}.mkv`,
    filename: `File-${id}.mkv`,
    extension: "mkv",
    size_bytes: 10_000_000_000,
    mtime: 1_700_000_000,
    last_seen_at: "2026-01-01T00:00:00Z",
    last_analyzed_at: "2026-01-01T00:00:00Z",
    scan_status: "ready",
    quality_score: 8,
    quality_score_raw: 82,
    container: "mkv",
    duration: 3600,
    bitrate: 20_000_000,
    audio_bitrate: 640_000,
    bit_depth: 24,
    audio_title: null,
    audio_artist: null,
    audio_album: null,
    audio_album_artist: null,
    audio_genre: null,
    audio_date: null,
    audio_disc: null,
    audio_composer: null,
    audio_channels: 6,
    sample_rate: 48000,
    track_number: null,
    bit_rate_mode: null,
    has_embedded_cover: false,
    chapter_count: 0,
    audiobook_narrator: null,
    audiobook_author: null,
    audiobook_publisher: null,
    audiobook_series: null,
    audiobook_series_part: null,
    audiobook_description: null,
    audiobook_copyright: null,
    audiobook_asin: null,
    audiobook_isbn: null,
    audiobook_language: null,
    audiobook_abridged: null,
    embedded_cover_stream_index: null,
    embedded_cover_codec: null,
    embedded_cover_width: null,
    embedded_cover_height: null,
    analysis_failure_kind: null,
    analysis_failure_reason: null,
    analysis_failure_detail: null,
    video_codec: "hevc",
    resolution: "3840x2160",
    resolution_category_id: "uhd",
    resolution_category_label: "UHD",
    hdr_type: "hdr10",
    audio_codecs: ["eac3"],
    audio_spatial_profiles: [],
    audio_languages: ["en"],
    subtitle_languages: [],
    subtitle_codecs: [],
    subtitle_sources: [],
    content_category: "main",
    series_id: null,
    series_title: null,
    season_id: null,
    season_number: null,
    episode_number: null,
    episode_number_end: null,
    episode_title: null,
    media_format: { container_format: "matroska", duration: 3600, bit_rate: 20_000_000, probe_score: 100 },
    video_streams: [
      {
        stream_index: 0,
        codec: "hevc",
        profile: "Main 10",
        width: 3840,
        height: 2160,
        pix_fmt: "yuv420p10le",
        color_space: "bt2020nc",
        color_transfer: "smpte2084",
        color_primaries: "bt2020",
        frame_rate: 23.976,
        bit_rate: 18_000_000,
        bit_depth: 10,
        hdr_type: "hdr10",
      },
    ],
    audio_streams: [],
    subtitle_streams: [],
    external_subtitles: [],
    chapters: [],
    raw_ffprobe_json: { format: {} },
    ...overrides,
  };
}

function createChapters(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    chapter_index: index,
    start_time: index * 60,
    end_time: (index + 1) * 60,
    duration: 60,
    title: `Chapter title ${index + 1}`,
    tags: null,
  }));
}

function renderPage(initialEntry = "/files/compare?left=1&right=2") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppDataProvider>
        <Routes>
          <Route path="/files/compare" element={<><FileComparePage /><LocationProbe /></>} />
        </Routes>
      </AppDataProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("FileComparePage", () => {
  it("loads file ids from the URL and highlights changed values", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrary(1, "Movies")]);
    vi.spyOn(api, "file").mockImplementation(async (id) =>
      Number(id) === 1 ? createFile(1) : createFile(2, { filename: "File-2.mkv", size_bytes: 12_000_000_000 }),
    );
    vi.spyOn(api, "fileQualityScore").mockResolvedValue({
      id: 1,
      score: 8,
      score_raw: 82,
      breakdown: { score: 8, score_raw: 82, categories: [] },
    });

    const { container } = renderPage();

    expect(await screen.findByRole("heading", { name: "Compare files" })).toBeInTheDocument();
    expect(screen.getAllByText("File-1.mkv").length).toBeGreaterThan(0);
    expect(screen.getAllByText("File-2.mkv").length).toBeGreaterThan(0);
    const sizeRows = Array.from(container.querySelectorAll(".file-compare-row")).filter((row) =>
      row.textContent?.includes("Size"),
    );
    expect(sizeRows[0]).toHaveClass("has-difference");
    const resolutionRows = Array.from(container.querySelectorAll(".file-compare-row")).filter((row) =>
      row.textContent?.includes("Resolution"),
    );
    expect(resolutionRows[0]).toHaveClass("is-identical");
    expect(screen.getByRole("button", { name: "Video streams" })).toHaveAttribute("aria-expanded", "false");
  });

  it("can show only differing comparison rows without the old comparison header", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrary(1, "Movies")]);
    vi.spyOn(api, "file").mockImplementation(async (id) =>
      Number(id) === 1 ? createFile(1) : createFile(2, { filename: "File-2.mkv", size_bytes: 12_000_000_000 }),
    );
    vi.spyOn(api, "fileQualityScore").mockResolvedValue({
      id: 1,
      score: 8,
      score_raw: 82,
      breakdown: { score: 8, score_raw: 82, categories: [] },
    });

    const { container } = renderPage();

    expect(await screen.findByRole("heading", { name: "Compare files" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "File comparison" })).not.toBeInTheDocument();
    expect(screen.getByText("Resolution")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show differences only" }));

    await waitFor(() => {
      expect(container.querySelector(".file-compare-display-button.active")?.getAttribute("aria-label")).toBe(
        "Show differences only",
      );
    });
    expect(screen.queryByText("Resolution")).not.toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
  });

  it("opens the comparison column count menu", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrary(1, "Movies")]);
    vi.spyOn(api, "file").mockImplementation(async (id) =>
      Number(id) === 1 ? createFile(1) : createFile(2, { filename: "File-2.mkv" }),
    );
    vi.spyOn(api, "fileQualityScore").mockResolvedValue({
      id: 1,
      score: 8,
      score_raw: 82,
      breakdown: { score: 8, score_raw: 82, categories: [] },
    });

    const { container } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Select comparison columns" }));
    expect(screen.getByRole("menuitemradio", { name: "2 columns" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "3 columns" }));

    expect(container.querySelector(".file-compare-toolbar-3-columns")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Swap compared files" })).not.toBeInTheDocument();
  });

  it("keeps empty comparison columns visually neutral", async () => {
    window.localStorage.setItem("medialyze-file-compare-column-count", "3");
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrary(1, "Movies")]);
    vi.spyOn(api, "file").mockImplementation(async (id) =>
      Number(id) === 1 ? createFile(1) : createFile(2, { filename: "File-2.mkv", size_bytes: 12_000_000_000 }),
    );
    vi.spyOn(api, "fileQualityScore").mockResolvedValue({
      id: 1,
      score: 8,
      score_raw: 82,
      breakdown: { score: 8, score_raw: 82, categories: [] },
    });

    const { container } = renderPage();

    expect(await screen.findByRole("heading", { name: "Compare files" })).toBeInTheDocument();
    const sizeRow = Array.from(container.querySelectorAll(".file-compare-row")).find((row) =>
      row.textContent?.includes("Size"),
    );
    expect(sizeRow).toHaveClass("has-difference");
    const cells = Array.from(sizeRow?.querySelectorAll(".file-compare-cell") ?? []);
    expect(cells).toHaveLength(3);
    expect(cells[2]).toHaveClass("is-empty-slot");
  });

  it("swaps the compared file sides", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrary(1, "Movies")]);
    vi.spyOn(api, "file").mockImplementation(async (id) =>
      Number(id) === 1 ? createFile(1) : createFile(2, { filename: "File-2.mkv" }),
    );
    vi.spyOn(api, "fileQualityScore").mockResolvedValue({
      id: 1,
      score: 8,
      score_raw: 82,
      breakdown: { score: 8, score_raw: 82, categories: [] },
    });

    renderPage();

    expect(await screen.findByLabelText("current path")).toHaveTextContent("/files/compare?left=1&right=2");
    fireEvent.click(screen.getByRole("button", { name: "Swap compared files" }));
    await waitFor(() =>
      expect(screen.getByLabelText("current path")).toHaveTextContent("/files/compare?left=2&right=1"),
    );
  });

  it("removes selected files from either comparison side", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrary(1, "Movies")]);
    vi.spyOn(api, "file").mockImplementation(async (id) =>
      Number(id) === 1 ? createFile(1) : createFile(2, { filename: "File-2.mkv" }),
    );
    vi.spyOn(api, "fileQualityScore").mockResolvedValue({
      id: 1,
      score: 8,
      score_raw: 82,
      breakdown: { score: 8, score_raw: 82, categories: [] },
    });

    renderPage();

    expect(await screen.findByLabelText("current path")).toHaveTextContent("/files/compare?left=1&right=2");
    fireEvent.click(screen.getByRole("button", { name: "Remove File-1.mkv from comparison" }));
    await waitFor(() =>
      expect(screen.getByLabelText("current path")).toHaveTextContent("/files/compare?right=2"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove File-2.mkv from comparison" }));
    await waitFor(() =>
      expect(screen.getByLabelText("current path")).toHaveTextContent("/files/compare"),
    );
  });

  it("searches globally and applies the selected library filter", async () => {
    const searchSpy = vi.spyOn(api, "fileSearch").mockResolvedValue({
      query: "copy",
      library_id: 2,
      limit: 20,
      items: [
        {
          id: 1,
          library_id: 1,
          library_name: "Movies",
          library_type: "movies",
          filename: "File-1.mkv",
          relative_path: "Movies/File-1.mkv",
          size_bytes: 1024,
          container: "mkv",
          duration: 60,
          quality_score: 8,
          video_codec: "h264",
          resolution: "1920x1080",
          hdr_type: null,
        },
        {
          id: 9,
          library_id: 2,
          library_name: "Archive",
          library_type: "movies",
          filename: "Copy.mkv",
          relative_path: "Archive/Copy.mkv",
          size_bytes: 2048,
          container: "mkv",
          duration: 60,
          quality_score: 7,
          video_codec: "h264",
          resolution: "1920x1080",
          hdr_type: null,
        },
      ],
    });
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrary(1, "Movies"), createLibrary(2, "Archive")]);
    const fileSpy = vi.spyOn(api, "file").mockResolvedValue(createFile(1));
    vi.spyOn(api, "fileQualityScore").mockResolvedValue({
      id: 1,
      score: 8,
      score_raw: 82,
      breakdown: { score: 8, score_raw: 82, categories: [] },
    });

    renderPage("/files/compare?left=1");

    const filterButtons = await screen.findAllByRole("button", { name: "Filter search by library" });
    fireEvent.click(filterButtons[1]);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Archive" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Right file" }), {
      target: { value: "copy" },
    });

    await waitFor(() => expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({ query: "copy", libraryId: 2 })));
    const alreadySelectedResult = await screen.findByTitle("Already selected on the other side.");
    expect(alreadySelectedResult).toBeDisabled();
    expect(alreadySelectedResult).toHaveAttribute("title", "Already selected on the other side.");
    expect(await screen.findByText("2.0 KB - Video - Archive")).toBeInTheDocument();
    expect(screen.queryByText("Archive / Archive/Copy.mkv")).not.toBeInTheDocument();
    expect(screen.getByText("Copy.mkv")).toHaveAttribute("title", "Archive / Archive/Copy.mkv");
    fireEvent.click(await screen.findByRole("button", { name: /Copy.mkv/ }));
    await waitFor(() => expect(fileSpy).toHaveBeenCalledWith(9));
  });

  it("limits chapter comparison rows and can expand them", async () => {
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrary(1, "Movies")]);
    vi.spyOn(api, "file").mockImplementation(async (id) =>
      createFile(Number(id), { chapters: createChapters(12), chapter_count: 12 }),
    );
    vi.spyOn(api, "fileQualityScore").mockResolvedValue({
      id: 1,
      score: 8,
      score_raw: 82,
      breakdown: { score: 8, score_raw: 82, categories: [] },
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Chapters" }));
    expect(await screen.findByText("Chapter 10")).toBeInTheDocument();
    expect(screen.queryByText("Chapter 11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all 12 chapters" }));
    expect(await screen.findByText("Chapter 12")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    await waitFor(() => expect(screen.queryByText("Chapter 11")).not.toBeInTheDocument());
  });

  it("can show and copy full raw ffprobe JSON", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "libraries").mockResolvedValue([createLibrary(1, "Movies")]);
    vi.spyOn(api, "file").mockImplementation(async (id) =>
      Number(id) === 1
        ? createFile(1, { raw_ffprobe_json: { format: { filename: "left.mkv" } } })
        : createFile(2, { raw_ffprobe_json: { format: { filename: "right.mkv" } } }),
    );
    vi.spyOn(api, "fileQualityScore").mockResolvedValue({
      id: 1,
      score: 8,
      score_raw: 82,
      breakdown: { score: 8, score_raw: 82, categories: [] },
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Raw ffprobe JSON" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show full JSON" }));
    expect(await screen.findByText(/left.mkv/)).toBeInTheDocument();
    expect(screen.getByText(/right.mkv/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Copy raw ffprobe JSON" })[0]);
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(JSON.stringify({ format: { filename: "left.mkv" } }, null, 2)),
    );
    expect(screen.getByRole("button", { name: "Copied raw ffprobe JSON" })).toBeInTheDocument();
  });
});
