import { describe, expect, it } from "vitest";

import { collapseHdrDistribution, formatHdrType } from "./hdr";

describe("hdr helpers", () => {
  it("collapses Dolby Vision profile labels by default", () => {
    expect(formatHdrType("Dolby Vision Profile 8")).toBe("Dolby Vision");
    expect(formatHdrType("Dolby Vision Profile 7 Level 6 FEL")).toBe("Dolby Vision");
    expect(formatHdrType("HDR10")).toBe("HDR10");
  });

  it("keeps Dolby Vision profile labels when in-depth display is enabled", () => {
    expect(formatHdrType("Dolby Vision Profile 8.1", { inDepthDolbyVisionProfiles: true })).toBe(
      "Dolby Vision Profile 8.1",
    );
  });

  it("returns null for empty HDR values", () => {
    expect(formatHdrType(null)).toBeNull();
  });

  it("collapses Dolby Vision distribution buckets by default", () => {
    expect(
      collapseHdrDistribution([
        { label: "Dolby Vision Profile 5", value: 3 },
        { label: "Dolby Vision Profile 8", value: 2 },
        { label: "HDR10", value: 4 },
      ]),
    ).toEqual([
      { label: "Dolby Vision", value: 5, filter_value: "dv" },
      { label: "HDR10", value: 4 },
    ]);
  });

  it("keeps HDR distribution buckets unchanged when in-depth display is enabled", () => {
    expect(
      collapseHdrDistribution(
        [
          { label: "Dolby Vision Profile 5", value: 3 },
          { label: "Dolby Vision Profile 8", value: 2 },
          { label: "HDR10", value: 4 },
        ],
        { inDepthDolbyVisionProfiles: true },
      ),
    ).toEqual([
      { label: "Dolby Vision Profile 5", value: 3 },
      { label: "Dolby Vision Profile 8", value: 2 },
      { label: "HDR10", value: 4 },
    ]);
  });
});
