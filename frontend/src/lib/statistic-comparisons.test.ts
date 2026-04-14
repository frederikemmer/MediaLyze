import { beforeEach, describe, expect, it } from "vitest";

import {
  isComparisonFieldFilterable,
  getAvailableComparisonRenderers,
  getComparisonSelection,
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
});
