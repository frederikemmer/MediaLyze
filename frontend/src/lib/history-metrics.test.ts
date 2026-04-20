import { describe, expect, it } from "vitest";

import {
  getHistoryMetricDefinition,
  HISTORY_METRIC_DEFINITIONS,
  HISTORY_METRIC_GROUPS,
  isLibraryHistoryMetricId,
} from "./history-metrics";

describe("history metrics", () => {
  it("groups summary, category, and distribution metrics", () => {
    expect(HISTORY_METRIC_GROUPS.map((group) => group.id)).toEqual(["summary", "category", "distribution"]);
    expect(HISTORY_METRIC_DEFINITIONS.some((definition) => definition.id === "average_quality_score")).toBe(true);
    expect(HISTORY_METRIC_DEFINITIONS.some((definition) => definition.id === "container_mix")).toBe(true);
    expect(HISTORY_METRIC_DEFINITIONS.some((definition) => definition.id === "resolution_mp_distribution")).toBe(true);
  });

  it("validates stored metric ids", () => {
    expect(isLibraryHistoryMetricId("average_quality_score")).toBe(true);
    expect(isLibraryHistoryMetricId("quality_score_distribution")).toBe(true);
    expect(isLibraryHistoryMetricId("ready_files")).toBe(false);
    expect(isLibraryHistoryMetricId("pending_files")).toBe(false);
    expect(isLibraryHistoryMetricId("not_a_metric")).toBe(false);
    expect(isLibraryHistoryMetricId(null)).toBe(false);
  });

  it("reads summary values from v2 metrics with legacy fallbacks", () => {
    const averageBitrate = getHistoryMetricDefinition("average_bitrate");
    const fileCount = getHistoryMetricDefinition("file_count");

    expect(averageBitrate.group).toBe("summary");
    expect(fileCount.group).toBe("summary");
    if (averageBitrate.group !== "summary" || fileCount.group !== "summary") {
      throw new Error("expected summary metric definitions");
    }

    expect(
      averageBitrate.value({
        total_files: 2,
        resolution_counts: {},
        average_bitrate: 8_000_000,
        average_audio_bitrate: null,
        average_duration_seconds: null,
        average_quality_score: null,
      }),
    ).toBe(8_000_000);
    expect(
      fileCount.value({
        total_files: 2,
        resolution_counts: {},
        average_bitrate: null,
        average_audio_bitrate: null,
        average_duration_seconds: null,
        average_quality_score: null,
        totals: { file_count: 3 },
      }),
    ).toBe(3);
  });
});
