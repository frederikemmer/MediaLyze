import { describe, expect, it } from "vitest";

import { collapseHdrDistribution, formatHdrType } from "./hdr";

describe("hdr helpers", () => {
  it("returns the stored HDR label unchanged", () => {
    expect(formatHdrType("Dolby Vision Profile 8")).toBe("Dolby Vision Profile 8");
    expect(formatHdrType("HDR10")).toBe("HDR10");
  });

  it("returns null for empty HDR values", () => {
    expect(formatHdrType(null)).toBeNull();
  });

  it("keeps HDR distribution buckets unchanged", () => {
    expect(
      collapseHdrDistribution([
        { label: "Dolby Vision Profile 5", value: 3 },
        { label: "Dolby Vision Profile 8", value: 2 },
        { label: "HDR10", value: 4 },
      ]),
    ).toEqual([
      { label: "Dolby Vision Profile 5", value: 3 },
      { label: "Dolby Vision Profile 8", value: 2 },
      { label: "HDR10", value: 4 },
    ]);
  });
});
