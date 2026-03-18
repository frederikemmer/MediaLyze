import "../i18n";

import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppDataProvider } from "../lib/app-data";
import {
  api,
  DEFAULT_QUALITY_PROFILE,
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
    quality_profile: DEFAULT_QUALITY_PROFILE,
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
        quality_score_raw: 82.4,
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
        quality_score_raw: 74.1,
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

function renderPage(libraryId: number, { strictMode = false }: { strictMode?: boolean } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[`/libraries/${libraryId}`]}>
      <AppDataProvider>
        <ScanJobsProvider>
          <Routes>
            <Route path="/libraries/:libraryId" element={<LibraryDetailPage />} />
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
  window.localStorage.clear();
});

describe("LibraryDetailPage", () => {
  it("loads summary, statistics, and files separately", async () => {
    const libraryId = 101;
    vi.spyOn(api, "appSettings").mockResolvedValue({
      ignore_patterns: [],
      user_ignore_patterns: [],
      default_ignore_patterns: [],
      feature_flags: { show_dolby_vision_profiles: false },
    });
    const librarySummarySpy = vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    const libraryStatisticsSpy = vi.spyOn(api, "libraryStatistics").mockResolvedValue(createLibraryStatistics());
    const libraryFilesSpy = vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    expect(librarySummarySpy).toHaveBeenCalled();
    expect(libraryStatisticsSpy).toHaveBeenCalled();
    expect(libraryFilesSpy).toHaveBeenCalled();
  });

  it("still loads statistics and files under strict mode remounts", async () => {
    const libraryId = 111;
    vi.spyOn(api, "appSettings").mockResolvedValue({
      ignore_patterns: [],
      user_ignore_patterns: [],
      default_ignore_patterns: [],
      feature_flags: { show_dolby_vision_profiles: false },
    });
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
    vi.spyOn(api, "appSettings").mockResolvedValue({
      ignore_patterns: [],
      user_ignore_patterns: [],
      default_ignore_patterns: [],
      feature_flags: { show_dolby_vision_profiles: false },
    });
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
    vi.spyOn(api, "appSettings").mockResolvedValue({
      ignore_patterns: [],
      user_ignore_patterns: [],
      default_ignore_patterns: [],
      feature_flags: { show_dolby_vision_profiles: false },
    });
    vi.spyOn(api, "librarySummary").mockResolvedValue(createLibrarySummary(libraryId));
    vi.spyOn(api, "libraryStatistics").mockRejectedValue(new Error("statistics unavailable"));
    vi.spyOn(api, "libraryFiles").mockResolvedValue(createFilesPage(libraryId));

    renderPage(libraryId);

    expect(await screen.findByText("2 of 2 entries rendered")).toBeInTheDocument();
    expect(await screen.findAllByText("statistics unavailable")).not.toHaveLength(0);
  });

  it("refetches only files when sorting changes", async () => {
    const libraryId = 303;
    vi.spyOn(api, "appSettings").mockResolvedValue({
      ignore_patterns: [],
      user_ignore_patterns: [],
      default_ignore_patterns: [],
      feature_flags: { show_dolby_vision_profiles: false },
    });
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

  it("adds and removes metadata search fields and sends field-specific filters", async () => {
    const libraryId = 404;
    vi.spyOn(api, "appSettings").mockResolvedValue({
      ignore_patterns: [],
      user_ignore_patterns: [],
      default_ignore_patterns: [],
      feature_flags: { show_dolby_vision_profiles: false },
    });
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

  it("combines file/path and metadata filters in the same request", async () => {
    const libraryId = 505;
    vi.spyOn(api, "appSettings").mockResolvedValue({
      ignore_patterns: [],
      user_ignore_patterns: [],
      default_ignore_patterns: [],
      feature_flags: { show_dolby_vision_profiles: false },
    });
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

  it("blocks invalid structured search values and shows an inline validation error", async () => {
    const libraryId = 606;
    vi.spyOn(api, "appSettings").mockResolvedValue({
      ignore_patterns: [],
      user_ignore_patterns: [],
      default_ignore_patterns: [],
      feature_flags: { show_dolby_vision_profiles: false },
    });
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
    await waitFor(() => expect(libraryFilesSpy.mock.calls.length).toBe(initialCalls));
  });
});
