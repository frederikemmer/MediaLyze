import "../i18n";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { LibraryHistoryPoint } from "../lib/api";
import { HistoryTrendChart } from "./HistoryTrendChart";

const historyPoints: LibraryHistoryPoint[] = [
  {
    snapshot_day: "2026-04-15",
    trend_metrics: {
      total_files: 10,
      resolution_counts: { "4k": 2, "1080p": 8 },
      average_bitrate: null,
      average_audio_bitrate: null,
      average_duration_seconds: null,
      average_quality_score: null,
      numeric_distributions: {
        quality_score: {
          total: 10,
          bins: [
            { lower: 0, upper: 5, count: 2, percentage: 20 },
            { lower: 5, upper: 10, count: 8, percentage: 80 },
          ],
        },
      },
    },
  },
  {
    snapshot_day: "2026-04-16",
    trend_metrics: {
      total_files: 12,
      resolution_counts: { "4k": 3, "1080p": 9 },
      average_bitrate: null,
      average_audio_bitrate: null,
      average_duration_seconds: null,
      average_quality_score: null,
      numeric_distributions: {
        quality_score: {
          total: 12,
          bins: [
            { lower: 0, upper: 5, count: 3, percentage: 25 },
            { lower: 5, upper: 10, count: 9, percentage: 75 },
          ],
        },
      },
    },
  },
];

function renderedYAxis() {
  return JSON.parse(screen.getByTestId("echarts-react").getAttribute("data-y-axis") ?? "null");
}

afterEach(() => {
  cleanup();
});

describe("HistoryTrendChart", () => {
  it("caps the vertical axis at 100 in percentage mode", () => {
    render(
      <HistoryTrendChart
        points={historyPoints}
        resolutionCategories={[
          { id: "4k", label: "4k" },
          { id: "1080p", label: "1080p" },
        ]}
        metricId="resolution_mix"
        displayMode="percentage"
      />,
    );

    expect(renderedYAxis()).toMatchObject({ min: 0, max: 100 });
  });

  it("keeps automatic vertical scaling in count mode", () => {
    render(
      <HistoryTrendChart
        points={historyPoints}
        resolutionCategories={[
          { id: "4k", label: "4k" },
          { id: "1080p", label: "1080p" },
        ]}
        metricId="resolution_mix"
        displayMode="count"
      />,
    );

    expect(renderedYAxis()).not.toHaveProperty("max");
  });
});
