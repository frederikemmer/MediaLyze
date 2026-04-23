import { beforeEach, describe, expect, it } from "vitest";

import {
  getLibraryStatisticsSettings,
  saveLibraryStatisticsSettings,
  updateLibraryStatisticVisibility,
} from "./library-statistics-settings";
import {
  addStatisticPanelLayoutItem,
  buildDefaultStatisticPanelLayout,
  getStatisticPanelLayout,
  getStatisticPanelLayoutReadResult,
  normalizeStatisticPanelLayout,
  normalizeStatisticPanelLayoutWithIssues,
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
      { statisticId: "history", width: 4, height: 3 },
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

  it("preserves older dashboard layouts without adding new default panels", () => {
    const layout = normalizeStatisticPanelLayout("dashboard", {
      version: 2,
      items: [{ instanceId: "size", statisticId: "size", width: 2, height: 2 }],
    });

    expect(layout.items).toEqual([
      { instanceId: "size", statisticId: "size", width: 2, height: 2 },
    ]);
  });

  it("preserves older empty dashboard layouts without restoring defaults", () => {
    const layout = normalizeStatisticPanelLayout("dashboard", { version: 2, items: [] });

    expect(layout).toEqual({ version: 3, items: [] });
  });

  it("preserves older library layouts without adding new default panels", () => {
    const layout = normalizeStatisticPanelLayout("library", {
      version: 2,
      items: [{ instanceId: "size", statisticId: "size", width: 2, height: 2 }],
    });

    expect(layout.items).toEqual([
      { instanceId: "size", statisticId: "size", width: 2, height: 2 },
    ]);
  });

  it("adds dashboard history back with its default editable size", () => {
    const layout = addStatisticPanelLayoutItem("dashboard", { version: 3, items: [] }, "history");

    expect(layout.items).toHaveLength(1);
    expect(layout.items[0]).toMatchObject({
      statisticId: "history",
      width: 4,
      height: 3,
    });
  });

  it("keeps newly saved empty dashboard layouts empty after history was removed", () => {
    const layout = normalizeStatisticPanelLayout("dashboard", { version: 3, items: [] });

    expect(layout).toEqual({ version: 3, items: [] });
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

    expect(layout).toEqual({ version: 3, items: [] });
  });

  it("normalizes stored layouts for display without overwriting the stored configuration", () => {
    const storedLayout = {
      version: 2,
      items: [{ instanceId: "history", statisticId: "history", width: 4, height: 9 }],
    };
    window.localStorage.setItem("medialyze-statistic-panel-layout-dashboard-main", JSON.stringify(storedLayout));

    expect(getStatisticPanelLayout("dashboard", "main")).toEqual({
      version: 3,
      items: [{ instanceId: "history", statisticId: "history", width: 4, height: 4 }],
    });
    expect(window.localStorage.getItem("medialyze-statistic-panel-layout-dashboard-main")).toBe(
      JSON.stringify(storedLayout),
    );
  });

  it("reports layout parts that could not be carried over", () => {
    const result = normalizeStatisticPanelLayoutWithIssues("dashboard", {
      version: 2,
      items: [
        { instanceId: "old", statisticId: "legacy_metric", width: 1, height: 1 },
        { instanceId: "size", statisticId: "size", width: 2, height: 7 },
        { instanceId: "size-copy", statisticId: "size", width: 1, height: 1 },
        { instanceId: "size", statisticId: "duration", width: 1, height: 1 },
        {
          instanceId: "comparison-1",
          statisticId: "comparison",
          width: 2,
          height: 2,
          comparisonSelection: {
            xField: "removed_field",
            yField: "container",
            renderer: "scatter",
          },
        },
      ],
    });

    expect(result.layout.items.map((item) => item.statisticId)).toEqual(["size", "comparison"]);
    expect(result.issues).toContainEqual({ kind: "unsupported_panel", index: 0, statisticId: "legacy_metric" });
    expect(result.issues).toContainEqual({
      kind: "resized_panel",
      statisticId: "size",
      instanceId: "size",
      axis: "height",
      requested: 7,
      applied: 4,
    });
    expect(result.issues).toContainEqual({ kind: "duplicate_panel", statisticId: "size" });
    expect(result.issues).toContainEqual({
      kind: "duplicate_instance",
      statisticId: "duration",
      instanceId: "size",
    });
    expect(result.issues).toContainEqual({
      kind: "comparison_selection_adjusted",
      instanceId: "comparison-1",
      previousSelection: "removed_field / container / scatter",
      appliedSelection: "duration / container / heatmap",
    });
  });

  it("reports unreadable stored layout data", () => {
    window.localStorage.setItem("medialyze-statistic-panel-layout-dashboard-main", "{broken");

    const result = getStatisticPanelLayoutReadResult("dashboard", "main");

    expect(result.layout).toEqual(buildDefaultStatisticPanelLayout("dashboard"));
    expect(result.issues).toEqual([{ kind: "invalid_json" }]);
  });
});
