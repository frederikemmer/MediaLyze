import "../i18n";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { api, type MediaSeriesDetail } from "../lib/api";
import { SeriesDetailPage } from "./SeriesDetailPage";

function createSeriesDetail(): MediaSeriesDetail {
  return {
    id: 12,
    library_id: 4,
    title: "Example Show",
    normalized_title: "example show",
    relative_path: "Example Show (2024)",
    year: 2024,
    season_count: 1,
    episode_count: 2,
    total_size_bytes: 4096,
    total_duration_seconds: 7200,
    last_analyzed_at: "2026-04-23T10:30:00Z",
    seasons: [
      {
        id: 30,
        library_id: 4,
        series_id: 12,
        season_number: 1,
        title: "Season 01",
        relative_path: "Example Show (2024)/Season 01",
        episode_count: 2,
        total_size_bytes: 4096,
        total_duration_seconds: 7200,
        episodes: [
          {
            id: 101,
            library_id: 4,
            relative_path: "Example Show (2024)/Season 01/Example Show - S01E01 - Pilot.mkv",
            filename: "Example Show - S01E01 - Pilot.mkv",
            extension: "mkv",
            size_bytes: 2048,
            mtime: 1,
            last_seen_at: "2026-04-23T10:00:00Z",
            last_analyzed_at: "2026-04-23T10:30:00Z",
            scan_status: "ready",
            quality_score: 8,
            quality_score_raw: 82,
            container: "mkv",
            duration: 3600,
            bitrate: 8_000_000,
            audio_bitrate: 640_000,
            video_codec: "h264",
            resolution: "1920x1080",
            resolution_category_id: "1080p",
            resolution_category_label: "1080p",
            hdr_type: "SDR",
            audio_codecs: ["aac"],
            audio_spatial_profiles: [],
            audio_languages: ["en"],
            subtitle_languages: [],
            subtitle_codecs: [],
            subtitle_sources: [],
            content_category: "main",
            series_id: 12,
            series_title: "Example Show",
            season_id: 30,
            season_number: 1,
            episode_number: 1,
            episode_number_end: null,
            episode_title: "Pilot",
          },
          {
            id: 102,
            library_id: 4,
            relative_path: "Example Show (2024)/Season 01/Example Show - S01E02.mkv",
            filename: "Example Show - S01E02.mkv",
            extension: "mkv",
            size_bytes: 2048,
            mtime: 2,
            last_seen_at: "2026-04-23T11:00:00Z",
            last_analyzed_at: "2026-04-23T11:30:00Z",
            scan_status: "ready",
            quality_score: 8,
            quality_score_raw: 82,
            container: "mkv",
            duration: 3600,
            bitrate: 8_000_000,
            audio_bitrate: 640_000,
            video_codec: "h264",
            resolution: "1920x1080",
            resolution_category_id: "1080p",
            resolution_category_label: "1080p",
            hdr_type: "SDR",
            audio_codecs: ["aac"],
            audio_spatial_profiles: [],
            audio_languages: ["en"],
            subtitle_languages: [],
            subtitle_codecs: [],
            subtitle_sources: [],
            content_category: "main",
            series_id: 12,
            series_title: "Example Show",
            season_id: 30,
            season_number: 1,
            episode_number: 2,
            episode_number_end: null,
            episode_title: null,
          },
        ],
      },
    ],
  };
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/libraries/4/series/12"]}>
      <Routes>
        <Route path="/libraries/:libraryId/series/:seriesId" element={<SeriesDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SeriesDetailPage", () => {
  it("renders seasons and links episodes to file detail pages", async () => {
    vi.spyOn(api, "librarySeriesDetail").mockResolvedValue(createSeriesDetail());

    renderPage();

    expect(await screen.findByRole("heading", { name: "Example Show" })).toBeInTheDocument();
    expect(screen.getByText("Season 01")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "E01 Pilot" })).toHaveAttribute("href", "/files/101");
    expect(screen.getByRole("link", { name: "E02 Example Show - S01E02.mkv" })).toHaveAttribute(
      "href",
      "/files/102",
    );

    fireEvent.click(screen.getByRole("button", { name: /season 01/i }));

    await waitFor(() => expect(screen.queryByRole("link", { name: "E01 Pilot" })).not.toBeInTheDocument());
  });
});
