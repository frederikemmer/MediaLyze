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

  it("adds new panels with a default size of one wide by two high", () => {
    const layout = addStatisticPanelLayoutItem("library", { items: [] }, "bitrate");

    expect(layout.items).toHaveLength(1);
    expect(layout.items[0]).toMatchObject({
      statisticId: "bitrate",
      width: 1,
      height: 2,
    });
  });

  it("allows panel heights above four when unlimited height is enabled", () => {
    const layout = resizeStatisticPanelLayoutItem(
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

  it("preserves an explicitly empty layout instead of restoring defaults", () => {
    const layout = normalizeStatisticPanelLayout("library", { items: [] });

    expect(layout).toEqual({ items: [] });
  });
});
