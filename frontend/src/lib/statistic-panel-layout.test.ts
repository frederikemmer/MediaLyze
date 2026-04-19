import { beforeEach, describe, expect, it } from "vitest";

import {
  getLibraryStatisticsSettings,
  saveLibraryStatisticsSettings,
  updateLibraryStatisticVisibility,
} from "./library-statistics-settings";
import {
  addStatisticPanelLayoutItem,
  buildDefaultStatisticPanelLayout,
  normalizeStatisticPanelLayout,
  resizeStatisticPanelLayoutItem,
} from "./statistic-panel-layout";

describe("statistic panel layout", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses built-in page defaults instead of the legacy statistic visibility settings", () => {
    const current = getLibraryStatisticsSettings();
    const updated = updateLibraryStatisticVisibility(
      updateLibraryStatisticVisibility(current, "size", {
        panelEnabled: false,
        dashboardEnabled: false,
      }),
      "comparison",
      {
        panelEnabled: false,
        dashboardEnabled: false,
      },
    );
    saveLibraryStatisticsSettings(updated);

    expect(buildDefaultStatisticPanelLayout("library").items.map((item) => item.statisticId)).toContain("size");
    expect(buildDefaultStatisticPanelLayout("library").items.map((item) => item.statisticId)).toContain("comparison");
    expect(buildDefaultStatisticPanelLayout("dashboard").items.map((item) => item.statisticId)).toContain("size");
    expect(buildDefaultStatisticPanelLayout("dashboard").items.map((item) => item.statisticId)).toContain("comparison");
  });

  it("uses the curated default library layout for first-time statistic layouts", () => {
    const layout = buildDefaultStatisticPanelLayout("library");

    expect(layout.items).toMatchObject([
      { statisticId: "size", width: 2, height: 2 },
      { statisticId: "resolution", width: 1, height: 2 },
      { statisticId: "video_codec", width: 1, height: 2 },
      { statisticId: "hdr_type", width: 1, height: 2 },
      { statisticId: "audio_languages", width: 1, height: 2 },
      { statisticId: "duration", width: 1, height: 2 },
      {
        statisticId: "comparison",
        width: 1,
        height: 2,
        comparisonSelection: {
          xField: "size",
          yField: "duration",
          renderer: "scatter",
        },
      },
      { statisticId: "history", width: 4, height: 3 },
      { statisticId: "duplicates", width: 4, height: 3 },
      { statisticId: "analyzed_files", width: 4, height: 4 },
    ]);
  });

  it("uses the curated default dashboard layout for first-time statistic layouts", () => {
    const layout = buildDefaultStatisticPanelLayout("dashboard");

    expect(layout.items).toMatchObject([
      { statisticId: "size", width: 2, height: 2 },
      { statisticId: "video_codec", width: 1, height: 2 },
      { statisticId: "quality_score", width: 1, height: 2 },
      {
        statisticId: "comparison",
        width: 1,
        height: 2,
        comparisonSelection: {
          xField: "size",
          yField: "duration",
          renderer: "scatter",
        },
      },
      { statisticId: "resolution", width: 1, height: 2 },
      {
        statisticId: "comparison",
        width: 2,
        height: 2,
        comparisonSelection: {
          xField: "video_codec",
          yField: "size",
          renderer: "heatmap",
        },
      },
      { statisticId: "audio_languages", width: 1, height: 2 },
      { statisticId: "bitrate", width: 1, height: 2 },
      { statisticId: "container", width: 1, height: 2 },
      { statisticId: "audio_codecs", width: 1, height: 2 },
      { statisticId: "duration", width: 1, height: 2 },
      { statisticId: "hdr_type", width: 1, height: 2 },
      { statisticId: "audio_bitrate", width: 1, height: 2 },
      { statisticId: "subtitle_languages", width: 1, height: 2 },
    ]);
  });

  it("adds new statistic panels with a default size of one wide by two high", () => {
    const layout = addStatisticPanelLayoutItem("library", { version: 2, items: [] }, "bitrate");

    expect(layout.items).toHaveLength(1);
    expect(layout.items[0]).toMatchObject({
      statisticId: "bitrate",
      width: 1,
      height: 2,
    });
  });

  it("adds analyzed files back as a full-width panel with its default size", () => {
    const layout = addStatisticPanelLayoutItem("library", { items: [] }, "analyzed_files");

    expect(layout.items).toHaveLength(1);
    expect(layout.items[0]).toMatchObject({
      statisticId: "analyzed_files",
      width: 4,
      height: 4,
    });
  });

  it("allows panel heights above four when unlimited height is enabled", () => {
    const layout = resizeStatisticPanelLayoutItem(
      "library",
      { items: [{ instanceId: "bitrate", statisticId: "bitrate", width: 1, height: 4 }] },
      "bitrate",
      { height: 6 },
      { unlimitedHeight: true },
    );

    expect(layout.items[0]).toMatchObject({
      width: 1,
      height: 6,
    });
  });

  it("still clamps width and normal height limits when unlimited height is disabled", () => {
    const layout = normalizeStatisticPanelLayout("library", {
      items: [
        {
          instanceId: "comparison-1",
          statisticId: "comparison",
          width: 7,
          height: 6,
        },
      ],
    });

    expect(layout.items[0]).toMatchObject({
      width: 4,
      height: 4,
    });
  });

  it("keeps history above its minimum size and forces wide library panels to full width", () => {
    const layout = normalizeStatisticPanelLayout("library", {
      items: [
        { instanceId: "history", statisticId: "history", width: 1, height: 1 },
        { instanceId: "duplicates", statisticId: "duplicates", width: 2, height: 3 },
        { instanceId: "analyzed_files", statisticId: "analyzed_files", width: 2, height: 1 },
      ],
    });

    expect(layout.items).toMatchObject([
      { instanceId: "history", width: 2, height: 3 },
      { instanceId: "duplicates", width: 4, height: 3 },
      { instanceId: "analyzed_files", width: 4, height: 2 },
    ]);
  });

  it("preserves an explicitly empty layout instead of restoring defaults", () => {
    const layout = normalizeStatisticPanelLayout("library", { items: [] });

    expect(layout).toEqual({ version: 2, items: [] });
  });
});
