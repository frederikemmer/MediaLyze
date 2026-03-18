import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppDataProvider } from "../lib/app-data";
import { api, type MediaFileDetail, type MediaFileQualityScoreDetail } from "../lib/api";
import { FileDetailPage } from "./FileDetailPage";

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
    video_streams: [{ codec: "hevc", width: 3840, height: 1606 }],
    audio_streams: [{ codec: "eac3", channels: 6, language: "en" }],
    subtitle_streams: [{ codec: "srt", language: "en", default_flag: true }],
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
    vi.spyOn(api, "appSettings").mockResolvedValue({
      ignore_patterns: [],
      user_ignore_patterns: [],
      default_ignore_patterns: [],
      feature_flags: { show_dolby_vision_profiles: false, show_analyzed_files_csv_export: false },
    });
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockResolvedValue(createQualityDetail());

    const { container } = renderPage(file.id);

    expect(await screen.findByText("3840x1606")).toBeInTheDocument();
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
  });

  it("stays stable when the quality detail request fails", async () => {
    const file = createFileDetail();
    vi.spyOn(api, "appSettings").mockResolvedValue({
      ignore_patterns: [],
      user_ignore_patterns: [],
      default_ignore_patterns: [],
      feature_flags: { show_dolby_vision_profiles: false, show_analyzed_files_csv_export: false },
    });
    vi.spyOn(api, "file").mockResolvedValue(file);
    vi.spyOn(api, "fileQualityScore").mockRejectedValue(new Error("quality unavailable"));

    const { container } = renderPage(file.id);

    expect(await screen.findByText("3840x1606")).toBeInTheDocument();
    expect(screen.getByText("Quality breakdown")).toBeInTheDocument();
    expect(container.querySelectorAll(".path-segment")).toHaveLength(3);
    expect(screen.queryByText("quality unavailable")).not.toBeInTheDocument();
  });
});
