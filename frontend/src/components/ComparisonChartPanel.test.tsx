import "../i18n";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ComparisonResponse } from "../lib/api";
import { ComparisonChartPanel } from "./ComparisonChartPanel";

const comparison: ComparisonResponse = {
  x_field: "duration",
  y_field: "size",
  x_field_kind: "numeric",
  y_field_kind: "numeric",
  available_renderers: ["heatmap", "scatter", "bar"],
  total_files: 1,
  included_files: 1,
  excluded_files: 0,
  sampled_points: false,
  sample_limit: 5000,
  x_buckets: [{ key: "3600:5400", label: "3600:5400", lower: 3600, upper: 5400 }],
  y_buckets: [{ key: "0:500000000", label: "0:500000000", lower: 0, upper: 500000000 }],
  heatmap_cells: [{ x_key: "3600:5400", y_key: "0:500000000", count: 1 }],
  scatter_points: [
    {
      media_file_id: 1,
      asset_name: "very-long-media-file-name-that-should-be-shortened.mkv",
      x_value: 4200,
      y_value: 400000000,
    },
  ],
  bar_entries: [{ x_key: "3600:5400", x_label: "3600:5400", value: 400000000, count: 1 }],
};

afterEach(() => {
  cleanup();
});

describe("ComparisonChartPanel", () => {
  it("labels scatter tooltip rows with metric names and constrains the asset name width", () => {
    render(
      <ComparisonChartPanel
        comparison={comparison}
        selection={{ xField: "duration", yField: "size", renderer: "scatter" }}
        onChangeXField={vi.fn()}
        onChangeYField={vi.fn()}
        onSwapAxes={vi.fn()}
        onChangeRenderer={vi.fn()}
      />,
    );

    const tooltip = screen.getByTestId("echarts-react").getAttribute("data-tooltip") ?? "";
    expect(tooltip).toContain("very-long-media-file-name-that-should-be-shortened.mkv");
    expect(tooltip).toContain("Duration");
    expect(tooltip).toContain("File size");
    expect(tooltip).toContain("max-width:16ch");
    expect(tooltip).not.toContain("X axis");
    expect(tooltip).not.toContain("Y axis");
  });
});
