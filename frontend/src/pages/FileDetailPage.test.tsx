import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppDataProvider } from "../lib/app-data";
import {
  api,
  type AppSettings,
  type CompatibilityEvaluation,
  type CompatibilityProfile,
  type HardwareProfile,
  type MediaFileDetail,
  type MediaFileHistory,
  type MediaFileQualityScoreDetail,
  type ProfileEvaluation,
  type SoftwareProfile,
} from "../lib/api";
import { formatDate } from "../lib/format";
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
        bit_depth: 10,
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
        bit_depth: 24,
        bit_rate_mode: "CBR",
        language: "en",
        default_flag: true,
        forced_flag: false,
        title: "English Atmos",
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
      categories: [
        {
          key: "resolution",
          score: 100,
          weight: 8,
          active: true,
          skipped: false,
          minimum: "1080p",
          ideal: "4k",
          actual: "4k",
          unknown_mapping: false,
          notes: [],
        },
        {
          key: "visual_density",
          score: 87.5,
          weight: 10,
          active: true,
          skipped: false,
          minimum: 0.02,
          ideal: 0.04,
          maximum: 0.08,
          actual: 0.0525,
          unknown_mapping: false,
          notes: ["missing_value"],
        },
        {
          key: "video_codec",
          score: 60,
          weight: 5,
          active: true,
          skipped: false,
          minimum: ["h264", "hevc"],
          ideal: ["av1"],
          actual: "vp9",
          unknown_mapping: true,
          notes: [],
        },
        {
          key: "language_preferences",
          score: 0,
          weight: 6,
          active: true,
          skipped: true,
          minimum: null,
          ideal: null,
          actual: [],
          unknown_mapping: false,
          notes: ["no_preferences"],
        },
      ],
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

function createFileHistoryWithUnchangedGap(): MediaFileHistory {
  const current = createFileDetail();
  const { mtime: _ignoredMtime, ...snapshotWithoutMtime } = current;

  return {
    file_id: current.id,
    library_id: current.library_id,
    relative_path: current.relative_path,
    total: 4,
    items: [
      {
        id: 4,
        media_file_id: current.id,
        library_id: current.library_id,
        relative_path: current.relative_path,
        filename: current.filename,
        captured_at: "2026-05-21T12:53:00Z",
        capture_reason: "scan_analysis",
        snapshot_hash: "newest",
        snapshot: {
          ...current,
          quality_score_raw: 78.96,
        },
      },
      {
        id: 3,
        media_file_id: current.id,
        library_id: current.library_id,
        relative_path: current.relative_path,
        filename: current.filename,
        captured_at: "2026-05-21T12:52:00Z",
        capture_reason: "scan_analysis",
        snapshot_hash: "gap-visible",
        snapshot: {
          ...current,
          quality_score_raw: 80.67,
          mtime: undefined,
        },
      },
      {
        id: 2,
        media_file_id: current.id,
        library_id: current.library_id,
        relative_path: current.relative_path,
        filename: current.filename,
        captured_at: "2026-05-19T23:09:00Z",
        capture_reason: "quality_recompute",
        snapshot_hash: "gap-hidden",
        snapshot: {
          ...snapshotWithoutMtime,
          quality_score_raw: 80.67,
        },
      },
      {
        id: 1,
        media_file_id: current.id,
        library_id: current.library_id,
        relative_path: current.relative_path,
        filename: current.filename,
        captured_at: "2026-04-20T17:52:00Z",
        capture_reason: "scan_analysis",
        snapshot_hash: "older",
        snapshot: {
          ...current,
          quality_score_raw: 78.96,
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
  if (!vi.isMockFunction(api.fileCompatibility)) {
    vi.spyOn(api, "fileCompatibility").mockResolvedValue([]);
  }
  if (!vi.isMockFunction(api.fileHardwareCompatibility)) {
    vi.spyOn(api, "fileHardwareCompatibility").mockResolvedValue([]);
  }
  if (!vi.isMockFunction(api.fileSoftwareCompatibility)) {
    vi.spyOn(api, "fileSoftwareCompatibility").mockResolvedValue([]);
  }
  if (!vi.isMockFunction(api.hardwareProfiles)) {
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([]);
  }
  if (!vi.isMockFunction(api.softwareProfiles)) {
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([]);
  }
  if (!vi.isMockFunction(api.compatibilityProfiles)) {
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([]);
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
  it("groups favorite compatibility results into expandable hardware, software, and combination sections", async () => {
    const file: MediaFileDetail = {
      ...createFileDetail(),
      video_codec: null,
      resolution: null,
      resolution_category_id: null,
      resolution_category_label: null,
      hdr_type: null,
      video_streams: [],
      subtitle_languages: [],
      subtitle_codecs: [],
      subtitle_sources: [],
      subtitle_streams: [],
      external_subtitles: [],
    };
    const hardware: HardwareProfile = {
      schema_version: 1,
      profile_version: 1,
      id: "test-device",
      name: "Test Device",
      category: "streaming_device",
      manufacturer: "Test",
      status: "local",
      added: "2026-06-10",
      last_modified: "2026-06-10",
      sources: [],
      video: {},
      audio: {},
      containers: [],
      subtitles: {},
    };
    const otherHardware: HardwareProfile = {
      ...hardware,
      id: "other-device",
      name: "Other Device",
    };
    const software: SoftwareProfile = {
      schema_version: 1,
      profile_version: 1,
      id: "test-player",
      name: "Test Player",
      category: "player",
      developer: "Test",
      platforms: [],
      status: "local",
      added: "2026-06-10",
      last_modified: "2026-06-10",
      sources: [],
      video: {},
      audio: {},
      containers: {},
      subtitles: {},
    };
    const combination: CompatibilityProfile = {
      schema_version: 1,
      profile_version: 1,
      id: "test-combination",
      name: "Living Room",
      hardware_profile_id: hardware.id,
      software_profile_id: software.id,
      status: "local",
      added: "2026-06-10",
      last_modified: "2026-06-10",
      sources: [],
    };
    const evaluation: CompatibilityEvaluation = {
      compatibility_profile_id: combination.id,
      compatibility_profile_name: combination.name,
      hardware_profile_id: hardware.id,
      hardware_profile_version: 1,
      software_profile_id: software.id,
      software_profile_version: 1,
      file_id: file.id,
      status: "direct_play",
      container_status: "direct_play",
      video_status: "direct_play",
      audio_status: "direct_stream",
      subtitle_status: "conditional",
      selected_audio_stream_index: 1,
      findings: [],
    };
    const hardwareEvaluation: ProfileEvaluation = {
      profile_type: "hardware",
      profile_id: hardware.id,
      profile_name: hardware.name,
      profile_version: 1,
      file_id: file.id,
      status: "direct_play",
      container_status: "direct_play",
      video_status: "direct_play",
      audio_status: "direct_play",
      subtitle_status: "direct_play",
      selected_audio_stream_index: 1,
      findings: [],
    };
    const softwareEvaluation: ProfileEvaluation = {
      ...hardwareEvaluation,
      profile_type: "software",
      profile_id: software.id,
      profile_name: software.name,
      status: "direct_stream",
      audio_status: "direct_stream",
    };
    window.localStorage.setItem(
      "medialyze.compatibility-profile-favorites",
      JSON.stringify([
        `hardware:${hardware.id}`,
        `software:${software.id}`,
        `compatibility:${combination.id}`,
      ]),
    );
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());
    vi.spyOn(api, "fileCompatibility").mockResolvedValue([evaluation]);
    vi.spyOn(api, "fileHardwareCompatibility").mockResolvedValue([hardwareEvaluation]);
    vi.spyOn(api, "fileSoftwareCompatibility").mockResolvedValue([softwareEvaluation]);
    vi.spyOn(api, "hardwareProfiles").mockResolvedValue([hardware, otherHardware]);
    vi.spyOn(api, "softwareProfiles").mockResolvedValue([software]);
    vi.spyOn(api, "compatibilityProfiles").mockResolvedValue([combination]);

    const { container } = renderPage(file.id);

    await selectFileDetailPanel("Compatibility");
    expect(await screen.findByRole("heading", { name: "Compatibility" })).toBeInTheDocument();
    const favoritesHelp = screen.getByRole("button", { name: "Show compatibility favorites help" });
    fireEvent.mouseEnter(favoritesHelp);
    const favoritesTooltip = await screen.findByRole("tooltip");
    expect(favoritesTooltip).toHaveTextContent("Click a section's search field to show all profiles");
    expect(within(favoritesTooltip).getByRole("link", { name: "Open Hard/Software Profiles" })).toHaveAttribute(
      "href",
      "/settings",
    );
    const sections = Array.from(container.querySelectorAll(".compatibility-favorite-section"));
    expect(sections).toHaveLength(3);
    sections.forEach((section) => expect(section).toHaveAttribute("open"));
    const profileRows = Array.from(container.querySelectorAll(".compatibility-favorite-profile"));
    expect(profileRows).toHaveLength(3);
    profileRows.forEach((profile) => expect(profile).not.toHaveAttribute("open"));
    expect(within(profileRows[0] as HTMLElement).getByText("Test Device")).toBeInTheDocument();
    expect(within(profileRows[0] as HTMLElement).getByText("Direct play")).toBeInTheDocument();
    expect(within(sections[0] as HTMLElement).queryByText("Other Device")).not.toBeInTheDocument();
    expect(api.fileHardwareCompatibility).toHaveBeenCalledWith(String(file.id), [hardware.id]);

    const hardwareSearch = within(sections[0] as HTMLElement).getByRole("searchbox", {
      name: "Search Hardware profiles",
    });
    fireEvent.focus(hardwareSearch);
    expect(within(sections[0] as HTMLElement).getByText("Other Device")).toBeInTheDocument();
    const visibleHardwareNames = Array.from(
      (sections[0] as HTMLElement).querySelectorAll(
        ".compatibility-favorite-profile-summary > span:first-child, .compatibility-favorite-profile-row > span:first-child",
      ),
    ).map((node) => node.textContent);
    expect(visibleHardwareNames).toEqual(["Test Device", "Other Device"]);
    fireEvent.change(hardwareSearch, { target: { value: "Other Device" } });
    expect(within(sections[0] as HTMLElement).getByText("Other Device")).toBeInTheDocument();
    expect(within(sections[0] as HTMLElement).queryByText("Test Device")).not.toBeInTheDocument();
    fireEvent.click(within(sections[0] as HTMLElement).getByRole("button", {
      name: "Add Other Device to favorites",
    }));
    await waitFor(() => expect(api.fileHardwareCompatibility).toHaveBeenLastCalledWith(
      String(file.id),
      [hardware.id, otherHardware.id],
    ));
    fireEvent.blur(hardwareSearch, { relatedTarget: null });

    const hardwareProfileRow = screen.getByText("Test Device").closest("details");
    expect(hardwareProfileRow).not.toBeNull();
    fireEvent.click(within(hardwareProfileRow as HTMLElement).getByText("Test Device"));
    expect(hardwareProfileRow).toHaveAttribute("open");
    expect(within(hardwareProfileRow as HTMLElement).getByText(/Container: Direct play/)).toBeInTheDocument();
    expect(within(hardwareProfileRow as HTMLElement).getByText(/Audio: Direct play/)).toBeInTheDocument();
    expect(within(hardwareProfileRow as HTMLElement).queryByText(/Video:/)).not.toBeInTheDocument();
    expect(within(hardwareProfileRow as HTMLElement).queryByText(/Subtitles:/)).not.toBeInTheDocument();

    const softwareProfileRow = screen.getByText("Test Player").closest("details");
    expect(softwareProfileRow).not.toBeNull();
    fireEvent.click(within(softwareProfileRow as HTMLElement).getByText("Test Player"));
    expect(softwareProfileRow).toHaveAttribute("open");
    expect(within(softwareProfileRow as HTMLElement).getByText(/Audio: Direct stream/)).toBeInTheDocument();

    const combinationProfileRow = screen.getByText("Living Room").closest("details");
    expect(combinationProfileRow).not.toBeNull();
    fireEvent.click(within(combinationProfileRow as HTMLElement).getByText("Living Room"));
    expect(combinationProfileRow).toHaveAttribute("open");
    expect(within(combinationProfileRow as HTMLElement).queryByText(/Video:/)).not.toBeInTheDocument();
    expect(within(combinationProfileRow as HTMLElement).queryByText(/Subtitles:/)).not.toBeInTheDocument();
  });

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
    expect(screen.queryByRole("button", { name: "Format" })).not.toBeInTheDocument();
    expect(screen.getByText("Container")).toBeInTheDocument();
    expect(screen.getByText("Format name")).toBeInTheDocument();
    expect(screen.getByText("Matroska")).toBeInTheDocument();
    expect(screen.getByText("25 Mbps")).toBeInTheDocument();
    expect(screen.getByText("100/100")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Explain ffprobe format name" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("raw ffprobe format name");

    fireEvent.click(screen.getByRole("button", { name: "Explain ffprobe probe score" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("not the MediaLyze quality score");
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());

    const pathTooltipTrigger = screen.getByRole("button", { name: "Show full relative path" });
    fireEvent.mouseEnter(pathTooltipTrigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(file.relative_path);

    await selectFileDetailPanel("Video streams");
    expect(await screen.findByRole("heading", { name: "Video streams" })).toBeInTheDocument();
    let activePanel = container.querySelector(".file-detail-active-panel") as HTMLElement;
    expect(within(activePanel).getAllByRole("heading", { name: "Video streams" })).toHaveLength(1);
    expect(screen.getAllByText("Main 10").length).toBeGreaterThan(0);
    expect(screen.getByText("Stream index")).toBeInTheDocument();
    expect(screen.getByText("Pixel format")).toBeInTheDocument();
    expect(screen.getByText("yuv420p10le")).toBeInTheDocument();

    await selectFileDetailPanel("Audio streams");
    expect(await screen.findByRole("heading", { name: "Audio streams" })).toBeInTheDocument();
    activePanel = container.querySelector(".file-detail-active-panel") as HTMLElement;
    expect(within(activePanel).getAllByRole("heading", { name: "Audio streams" })).toHaveLength(1);
    expect(screen.getAllByText("Dolby Digital Plus").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dolby Atmos").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5.1").length).toBeGreaterThan(0);
    expect(screen.queryByText("Stream #1")).not.toBeInTheDocument();
    expect(screen.getByText("Stream index")).toBeInTheDocument();
    expect(screen.getAllByText("en").length).toBeGreaterThan(0);
    expect(screen.getByText("Sample rate")).toBeInTheDocument();
    expect(screen.getByText("48000 Hz")).toBeInTheDocument();
    expect(screen.getByText("Bit depth")).toBeInTheDocument();
    expect(screen.getAllByText("24-bit").length).toBeGreaterThan(0);
    expect(screen.getByText("English Atmos")).toBeInTheDocument();

    await selectFileDetailPanel("Subtitles");
    expect(await screen.findByRole("heading", { name: "Subtitles" })).toBeInTheDocument();
    expect(screen.getAllByText("SubRip (SRT)")).toHaveLength(2);
    expect(screen.getByText("External")).toBeInTheDocument();
  });

  it("shows video streams as expandable detail entries", async () => {
    const file: MediaFileDetail = {
      ...createFileDetail(),
      video_streams: [
        ...createFileDetail().video_streams,
        {
          stream_index: 3,
          codec: "h264",
          profile: "High",
          width: 1920,
          height: 1080,
          pix_fmt: "yuv420p",
          color_space: "bt709",
          color_transfer: "bt709",
          color_primaries: "bt709",
          frame_rate: 24,
          bit_rate: 8_000_000,
          bit_depth: 8,
          hdr_type: null,
        },
      ],
    };
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    await selectFileDetailPanel("Video streams");
    expect(await screen.findByRole("heading", { name: "Video streams" })).toBeInTheDocument();
    const entries = Array.from(container.querySelectorAll(".file-detail-active-panel details.stream-detail-entry"));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveAttribute("open");
    expect(entries[1]).not.toHaveAttribute("open");
    expect(entries[0].querySelector(".stream-detail-entry-head")).toHaveTextContent("HEVC");
    expect(entries[0].querySelector(".stream-detail-entry-head")).toHaveTextContent("3840x1606");
    expect(entries[0]).toHaveTextContent("Frame rate");
    expect(entries[0]).toHaveTextContent("23.976 fps");
    expect(entries[0]).toHaveTextContent("Bit depth");
    expect(entries[0]).toHaveTextContent("10-bit");
    expect(entries[0]).toHaveTextContent("Dynamic range");
    expect(entries[0]).toHaveTextContent("Dolby Vision");

    fireEvent.click(entries[1].querySelector("summary") as HTMLElement);
    expect(entries[1]).toHaveAttribute("open");
    expect(entries[1]).toHaveTextContent("Resolution");
    expect(entries[1]).toHaveTextContent("1920x1080");
    expect(entries[1]).toHaveTextContent("Color space");
    expect(entries[1]).toHaveTextContent("bt709");
    expect(entries[1]).toHaveTextContent("8.0 Mbps");
    expect(entries[1]).toHaveTextContent("SDR");
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
    let resolveCover: ((payload: { blob: Blob; filename: string }) => void) | undefined;
    const downloadCover = vi.spyOn(api, "downloadFileCover").mockReturnValue(
      new Promise((resolve) => {
        resolveCover = resolve;
      }),
    );
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
    expect(screen.getByRole("button", { name: "Loading cover" })).toBeDisabled();
    await waitFor(() => expect(downloadCover).toHaveBeenCalledWith(file.id));
    resolveCover?.({
      blob: new Blob(["cover"], { type: "image/png" }),
      filename: "movie-cover.png",
    });
    await waitFor(() => expect(createObjectUrl).toHaveBeenCalled());
    expect(await screen.findByRole("img", { name: `Embedded cover for ${file.filename}` })).toHaveAttribute("src", "blob:cover");

    fireEvent.click(screen.getByRole("button", { name: "Download cover" }));
    expect(anchorClick).toHaveBeenCalled();
  });

  it("renders a preview panel for video files with playback and download warnings", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    await selectFileDetailPanel("Preview (Beta)");
    expect(await screen.findByRole("heading", { name: "Preview (Beta)" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Browser playback currently works best with MP4/WebM video and MP3, M4A, WAV, OGG, or FLAC audio. Codec support may vary by browser.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "If a media file does not play correctly, please report it or upload a sample so the preview feature can be improved.",
      ),
    ).toBeInTheDocument();
    const reportLink = screen.getByRole("link", { name: "Report file" });
    expect(reportLink).toHaveAttribute("href", "https://www.medialyze.app/report?source=file_detail_page");
    expect(reportLink).toHaveAttribute("target", "_blank");
    expect(reportLink).toHaveClass("file-detail-cover-button");
    expect(screen.queryByText("Playback is not optimized yet and may take a while to start or may not run smoothly.")).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole("button", { name: "Show playback warning" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Playback is not optimized yet and may take a while to start or may not run smoothly.",
    );
    expect(screen.queryByRole("link", { name: "Download media" })).not.toBeInTheDocument();
    const player = container.querySelector(".file-detail-preview-player") as HTMLVideoElement | null;
    expect(player?.tagName).toBe("VIDEO");
    expect(player).toHaveAttribute("src", `/api/files/${file.id}/media`);
  });

  it("renders an audio preview panel for audio-only files", async () => {
    const file: MediaFileDetail = {
      ...createFileDetail(),
      filename: "Novel.m4b",
      relative_path: "Audiobooks/Novel.m4b",
      extension: "m4b",
      container: "m4b",
      video_codec: null,
      resolution: null,
      resolution_category_id: null,
      resolution_category_label: null,
      hdr_type: null,
      video_streams: [],
      bitrate: 128_000,
      audio_bitrate: 128_000,
      audio_title: "Novel",
      audio_artist: "Narrator",
      audiobook_author: "Author",
      chapters: [],
      subtitle_streams: [],
      external_subtitles: [],
    };
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    await selectFileDetailPanel("Preview (Beta)");
    expect(await screen.findByRole("heading", { name: "Preview (Beta)" })).toBeInTheDocument();
    const player = container.querySelector(".file-detail-preview-player") as HTMLAudioElement | null;
    expect(player?.tagName).toBe("AUDIO");
    expect(player).toHaveAttribute("src", `/api/files/${file.id}/media`);
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
    expect(container.querySelectorAll(".file-history-entry")).toHaveLength(1);
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
    expect(historyList?.querySelectorAll(".file-history-entry")).toHaveLength(0);
    expect(historyList?.textContent).not.toContain("Audio Channels");
    expect(historyList?.textContent).not.toContain("Sample Rate");
    expect(screen.getByRole("status")).toHaveTextContent("No tracked fields changed in this period.");
    expect(screen.getByRole("status")).toHaveClass("duplicate-panel-empty-state");
  });

  it("merges unchanged gap snapshots into the surrounding history period", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());
    vi.spyOn(api, "fileHistory").mockResolvedValue(createFileHistoryWithUnchangedGap());

    const { container } = renderPage(file.id);

    await selectFileDetailPanel("File history");
    expect(await screen.findByRole("heading", { name: "File history" })).toBeInTheDocument();
    expect(container.querySelectorAll(".file-history-entry")).toHaveLength(2);
    expect(screen.queryByText("No tracked fields changed in this period.")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        `${formatDate("2026-05-19T23:09:00Z")} - ${formatDate("2026-05-21T12:53:00Z")}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        `${formatDate("2026-05-21T12:52:00Z")} - ${formatDate("2026-05-21T12:53:00Z")}`,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        `${formatDate("2026-05-19T23:09:00Z")} - ${formatDate("2026-05-21T12:52:00Z")}`,
      ),
    ).not.toBeInTheDocument();
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

  it("shows quality score categories as expandable stream-style detail entries", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    await selectFileDetailPanel("Quality breakdown");
    expect(await screen.findByRole("heading", { name: "Quality breakdown" })).toBeInTheDocument();
    const entries = Array.from(container.querySelectorAll("details.quality-detail-entry"));
    expect(entries).toHaveLength(4);
    expect(entries[0]).toHaveAttribute("open");
    expect(entries[1]).not.toHaveAttribute("open");
    expect(entries[0].querySelector(".stream-detail-entry-head")).toHaveTextContent("Resolution");
    expect(entries[0].querySelector(".stream-detail-entry-head")).toHaveTextContent("100 / 100");
    expect(entries[0]).toHaveTextContent("Weight: 8");
    expect(entries[0]).toHaveTextContent("Actual");
    expect(entries[0]).toHaveTextContent("4k");

    fireEvent.click(entries[1].querySelector("summary") as HTMLElement);
    expect(entries[1]).toHaveAttribute("open");
    expect(entries[1]).toHaveTextContent("Maximum");
    expect(entries[1]).toHaveTextContent("4.8 GB/hour (1080p equivalent)");
    expect(entries[1]).toHaveTextContent("3.1 GB/hour (1080p equivalent)");
    expect(entries[1]).not.toHaveTextContent("0.08");
    expect(entries[1]).toHaveTextContent("Missing value");

    fireEvent.click(entries[2].querySelector("summary") as HTMLElement);
    expect(entries[2]).toHaveTextContent("h264, hevc");
    expect(entries[2]).toHaveTextContent("Unknown value mapped neutrally.");

    fireEvent.click(entries[3].querySelector("summary") as HTMLElement);
    expect(entries[3]).toHaveTextContent("n/a");
    expect(entries[3]).toHaveTextContent("No preferences configured");
    expect(entries[3]).toHaveTextContent("Skipped");
  });

  it("falls back to overview when the stored active panel is the retired format panel", async () => {
    const file = createFileDetail();
    window.localStorage.setItem("medialyze-file-detail-active-panel", "format");
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    renderPage(file.id);

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Format" })).not.toBeInTheDocument();
    expect(screen.getByText("Matroska")).toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem("medialyze-file-detail-active-panel")).toBe("overview"));
  });

  it("persists active navigation selection across file detail pages", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    renderPage(file.id);

    await selectFileDetailPanel("Video streams");
    expect(await screen.findByRole("heading", { name: "Video streams" })).toBeInTheDocument();
    expect(window.localStorage.getItem("medialyze-file-detail-active-panel")).toBe("videoStreams");

    cleanup();
    renderPage(file.id + 1);

    expect(await screen.findByRole("heading", { name: "Video streams" })).toBeInTheDocument();
    expect(screen.getAllByText("Main 10").length).toBeGreaterThan(0);
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
    const file: MediaFileDetail = {
      ...createFileDetail(),
      audio_album: "Unexpected soundtrack album",
      audio_composer: "Unexpected composer",
      audiobook_language: "de",
    };
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    renderPage(file.id);

    expect(await screen.findByRole("button", { name: "Video streams" })).toBeInTheDocument();
    await selectFileDetailPanel("Audio streams");
    expect((await screen.findAllByText("Dolby Digital Plus")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Audio metadata")).not.toBeInTheDocument();
    expect(screen.queryByText("Book language")).not.toBeInTheDocument();
    expect(screen.queryByText("Unexpected soundtrack album")).not.toBeInTheDocument();
    expect(screen.queryByText("Unexpected composer")).not.toBeInTheDocument();
  });

  it("lets audio stream headers switch between quality-first and language-first display", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    await selectFileDetailPanel("Audio streams");
    expect(await screen.findByRole("heading", { name: "Audio streams" })).toBeInTheDocument();
    const activePanel = container.querySelector(".file-detail-active-panel") as HTMLElement;
    const firstHeader = activePanel.querySelector(".stream-detail-entry-head") as HTMLElement;
    expect(firstHeader.querySelector(".stream-tooltip-inline strong")).toHaveTextContent("Dolby Digital Plus");
    expect(firstHeader.querySelector(":scope > span")).toHaveTextContent("en");
    expect(within(activePanel).getByRole("button", { name: "Show quality first" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(within(activePanel).getByRole("button", { name: "Show language first" }));
    expect(window.localStorage.getItem("medialyze-file-detail-audio-stream-primary")).toBe("language");
    expect(firstHeader.querySelector(".stream-tooltip-inline strong")).toHaveTextContent("en");
    expect(firstHeader.querySelector(".stream-tooltip-inline .stream-tooltip-meta")).toHaveTextContent("5.1");
    expect(firstHeader.querySelector(".stream-tooltip-inline .stream-tooltip-meta")).toHaveTextContent("Dolby Atmos");
    expect(firstHeader.querySelector(".stream-detail-secondary-summary")).toHaveTextContent("Dolby Digital Plus");
    expect(firstHeader.querySelector(".stream-detail-secondary-summary")).not.toHaveTextContent("Dolby Atmos");
    expect(within(activePanel).getByText("Stream index")).toBeInTheDocument();
    expect(within(activePanel).getByText("Language")).toBeInTheDocument();
    expect(within(activePanel).getAllByText("en").length).toBeGreaterThan(0);
  });

  it("persists audio stream primary mode and falls back to quality for invalid values", async () => {
    const file = createFileDetail();
    window.localStorage.setItem("medialyze-file-detail-audio-stream-primary", "language");
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    await selectFileDetailPanel("Audio streams");
    expect(await screen.findByRole("heading", { name: "Audio streams" })).toBeInTheDocument();
    let activePanel = container.querySelector(".file-detail-active-panel") as HTMLElement;
    let firstHeader = activePanel.querySelector(".stream-detail-entry-head") as HTMLElement;
    expect(firstHeader.querySelector(".stream-tooltip-inline strong")).toHaveTextContent("en");

    cleanup();
    window.localStorage.setItem("medialyze-file-detail-audio-stream-primary", "unexpected");
    renderPage(file.id + 1);

    await selectFileDetailPanel("Audio streams");
    activePanel = document.querySelector(".file-detail-active-panel") as HTMLElement;
    firstHeader = activePanel.querySelector(".stream-detail-entry-head") as HTMLElement;
    expect(firstHeader.querySelector(".stream-tooltip-inline strong")).toHaveTextContent("Dolby Digital Plus");
    expect(within(activePanel).getByRole("button", { name: "Show quality first" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
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
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(api, "appSettings").mockResolvedValue(createAppSettings());
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    renderPage(file.id);

    await selectFileDetailPanel("Raw ffprobe JSON");
    expect(await screen.findByRole("heading", { name: "Raw ffprobe JSON" })).toBeInTheDocument();
    expect(screen.getAllByText(/streams/).length).toBeGreaterThan(0);
    const copyButton = screen.getByRole("button", { name: "Copy raw ffprobe JSON" });
    expect(copyButton).toHaveAttribute("data-tooltip", "Copy raw ffprobe JSON");
    expect(copyButton).toHaveClass("async-panel-toggle-icon-button-flat");
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(file.raw_ffprobe_json, null, 2)));
    expect(screen.getByRole("button", { name: "Copied raw ffprobe JSON" })).toBeInTheDocument();
  });
});
