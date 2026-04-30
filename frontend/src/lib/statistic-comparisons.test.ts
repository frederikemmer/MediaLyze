import { beforeEach, describe, expect, it } from "vitest";

import {
  getComparisonFieldDefinitionsForLibraryType,
  isComparisonFieldFilterable,
  getAvailableComparisonRenderers,
  getComparisonSelection,
  normalizeComparisonSelectionForLibraryType,
  sanitizeComparisonRenderer,
  saveComparisonSelection,
} from "./statistic-comparisons";

describe("statistic comparisons", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the expected defaults for both scopes", () => {
    expect(getComparisonSelection("dashboard")).toEqual({
      xField: "duration",
      yField: "size",
      renderer: "heatmap",
    });
    expect(getComparisonSelection("library")).toEqual({
      xField: "duration",
      yField: "size",
      renderer: "heatmap",
    });
  });

  it("stores dashboard and library selections separately", () => {
    saveComparisonSelection("dashboard", {
      xField: "duration",
      yField: "quality_score",
      renderer: "bar",
    });
    saveComparisonSelection("library", {
      xField: "container",
      yField: "hdr_type",
      renderer: "heatmap",
    });

    expect(getComparisonSelection("dashboard")).toEqual({
      xField: "duration",
      yField: "quality_score",
      renderer: "bar",
    });
    expect(getComparisonSelection("library")).toEqual({
      xField: "container",
      yField: "hdr_type",
      renderer: "heatmap",
    });
  });

  it("limits renderers to combinations that are supported", () => {
    expect(getAvailableComparisonRenderers("duration", "size")).toEqual(["heatmap", "scatter", "bar"]);
    expect(getAvailableComparisonRenderers("resolution_mp", "size")).toEqual(["heatmap", "scatter", "bar"]);
    expect(getAvailableComparisonRenderers("container", "size")).toEqual(["heatmap", "bar"]);
    expect(getAvailableComparisonRenderers("container", "hdr_type")).toEqual(["heatmap"]);
    expect(sanitizeComparisonRenderer("container", "hdr_type", "bar")).toBe("heatmap");
  });

  it("marks resolution_mp as non-filterable for analyzed-files shortcuts", () => {
    expect(isComparisonFieldFilterable("resolution_mp")).toBe(false);
    expect(isComparisonFieldFilterable("duration")).toBe(true);
  });

  it("hides video-only comparison fields for music libraries", () => {
    const musicFields = getComparisonFieldDefinitionsForLibraryType("music").map((field) => field.id);

    expect(musicFields).not.toContain("video_codec");
    expect(musicFields).not.toContain("resolution");
    expect(musicFields).not.toContain("hdr_type");
    expect(musicFields).not.toContain("bitrate");
    expect(musicFields).not.toContain("resolution_mp");
    expect(musicFields).toContain("audio_bitrate");
    expect(musicFields).toContain("duration");
  });

  it("normalizes invalid music comparison selections to supported fields", () => {
    const normalized = normalizeComparisonSelectionForLibraryType(
      {
        xField: "video_codec",
        yField: "hdr_type",
        renderer: "scatter",
      },
      "music",
    );

    expect(normalized.xField).not.toBe("video_codec");
    expect(normalized.yField).not.toBe("hdr_type");
    expect(normalized.xField).not.toBe(normalized.yField);
    expect(["heatmap", "bar", "scatter"]).toContain(normalized.renderer);
  });
});
