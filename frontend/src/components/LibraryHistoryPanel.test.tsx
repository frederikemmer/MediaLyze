import "../i18n";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryHistoryResponse } from "../lib/api";
import { LibraryHistoryPanel } from "./LibraryHistoryPanel";

const storageKey = "medialyze-history-panel-test-range";

function createHistory(): LibraryHistoryResponse {
  return {
    generated_at: "2026-04-16T12:00:00Z",
    library_id: 1,
    oldest_snapshot_day: "2026-03-01",
    newest_snapshot_day: "2026-04-16",
    resolution_categories: [
      { id: "4k", label: "4k" },
      { id: "1080p", label: "1080p" },
    ],
    points: [
      {
        snapshot_day: "2026-03-01",
        trend_metrics: {
          total_files: 4,
          resolution_counts: { "4k": 1, "1080p": 3 },
          average_bitrate: null,
          average_audio_bitrate: null,
          average_duration_seconds: null,
          average_quality_score: null,
        },
      },
      {
        snapshot_day: "2026-04-05",
        trend_metrics: {
          total_files: 5,
          resolution_counts: { "4k": 2, "1080p": 3 },
          average_bitrate: null,
          average_audio_bitrate: null,
          average_duration_seconds: null,
          average_quality_score: null,
        },
      },
      {
        snapshot_day: "2026-04-16",
        trend_metrics: {
          total_files: 6,
          resolution_counts: { "4k": 3, "1080p": 3 },
          average_bitrate: null,
          average_audio_bitrate: null,
          average_duration_seconds: null,
          average_quality_score: null,
        },
      },
    ],
  };
}

function renderPanel() {
  render(
    <LibraryHistoryPanel
      history={createHistory()}
      selectedMetric="resolution_mix"
      onChangeMetric={vi.fn()}
      collapsed={false}
      onToggleCollapsed={vi.fn()}
      currentResolutionCategoryIds={["4k", "1080p"]}
      rangeStorageKey={storageKey}
    />,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(storageKey);
});

describe("LibraryHistoryPanel", () => {
  it("defaults to the last 30 days and persists range presets", () => {
    renderPanel();

    expect(screen.getByTestId("echarts-react").getAttribute("data-points")).toBe("[2,3]");

    fireEvent.click(screen.getByRole("button", { name: "7d" }));

    expect(screen.getByTestId("echarts-react").getAttribute("data-points")).toBe("[3]");
    expect(window.localStorage.getItem(storageKey)).toBe(JSON.stringify({ mode: "7d" }));
  });

  it("opens the custom date range picker", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));

    expect(screen.getByRole("dialog", { name: "Custom" })).toBeInTheDocument();
    expect(window.localStorage.getItem(storageKey)).toContain("\"mode\":\"custom\"");
  });
});
