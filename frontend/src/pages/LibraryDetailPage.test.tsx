import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppDataProvider } from "../lib/app-data";
import {
  api,
  type LibraryStatistics,
  type LibrarySummary,
  type MediaFileTablePage,
} from "../lib/api";
import { ScanJobsProvider } from "../lib/scan-jobs";
import { LibraryDetailPage } from "./LibraryDetailPage";

function createLibrarySummary(id: number): LibrarySummary {
  return {
    id,
    name: `Series ${id}`,
    path: `/media/series-${id}`,
    type: "series",
    last_scan_at: "2026-03-12T09:00:00Z",
    scan_mode: "manual",
    scan_config: {},
    created_at: "2026-03-12T08:00:00Z",
    updated_at: "2026-03-12T08:30:00Z",
    file_count: 2,
    total_size_bytes: 2048,
    total_duration_seconds: 7200,
    ready_files: 2,
    pending_files: 0,
  };
}

function createLibraryStatistics(): LibraryStatistics {
  return {
    video_codec_distribution: [{ label: "h264", value: 2 }],
    resolution_distribution: [{ label: "1920x1080", value: 2 }],
    hdr_distribution: [{ label: "SDR", value: 2 }],
    audio_codec_distribution: [{ label: "aac", value: 2 }],
    audio_language_distribution: [{ label: "en", value: 2 }],
    subtitle_language_distribution: [{ label: "en", value: 2 }],
    subtitle_codec_distribution: [{ label: "srt", value: 2 }],
    subtitle_source_distribution: [{ label: "external", value: 2 }],
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
        duration: 3600,
        video_codec: "h264",
        resolution: "1920x1080",
        hdr_type: null,
        audio_codecs: ["aac"],
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
        duration: 3600,
        video_codec: "h264",
        resolution: "1920x1080",
        hdr_type: null,
        audio_codecs: ["aac"],
        audio_languages: ["en"],
        subtitle_languages: ["en"],
        subtitle_codecs: ["srt"],
        subtitle_sources: ["external"],
      },
    ],
  };
}

function renderPage(libraryId: number) {
  return render(
    <MemoryRouter initialEntries={[`/libraries/${libraryId}`]}>
      <AppDataProvider>
        <ScanJobsProvider>
          <Routes>
            <Route path="/libraries/:libraryId" element={<LibraryDetailPage />} />
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

describe("LibraryDetailPage", () => {
  it("loads summary, statistics, and files separately", async () => {
    const libraryId = 101;
    const librarySummarySpy = vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    const libraryStatisticsSpy = vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    expect(librarySummarySpy).toHaveBeenCalled();
    expect(libraryStatisticsSpy).toHaveBeenCalled();
    expect(libraryFilesSpy).toHaveBeenCalled();
  });

  it("keeps files usable when statistics loading fails", async () => {
    const libraryId = 202;
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockRejectedValue(new Error("statistics unavailable"));
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    expect(await screen.findAllByText("statistics unavailable")).not.toHaveLength(0);
  });

  it("refetches only files when sorting changes", async () => {
    const libraryId = 303;
    const librarySummarySpy = vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    const libraryStatisticsSpy = vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    const initialFileCalls = libraryFilesSpy.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /codec/i }));

    await waitFor(() => expect(libraryFilesSpy.mock.calls.length).toBeGreaterThan(initialFileCalls));
    expect(librarySummarySpy).toHaveBeenCalled();
    expect(libraryStatisticsSpy).toHaveBeenCalled();
  });
});
