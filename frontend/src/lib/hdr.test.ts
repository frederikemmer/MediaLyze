import { describe, expect, it } from "vitest";

import { collapseHdrDistribution, formatHdrType } from "./hdr";

describe("hdr helpers", () => {
  it("collapses dolby vision profiles when the feature flag is disabled", () => {
    expect(formatHdrType("Dolby Vision Profile 8", false)).toBe("Dolby Vision");
    expect(formatHdrType("HDR10", false)).toBe("HDR10");
  });

  it("keeps dolby vision profiles separate when the feature flag is enabled", () => {
    expect(formatHdrType("Dolby Vision Profile 8", true)).toBe("Dolby Vision Profile 8");
  });

  it("aggregates dolby vision profile buckets when collapsed", () => {
    expect(
      collapseHdrDistribution(
        [
          { label: "Dolby Vision Profile 5", value: 3 },
          { label: "Dolby Vision Profile 8", value: 2 },
          { label: "HDR10", value: 4 },
        ],
        false,
      ),
    ).toEqual([
      { label: "Dolby Vision", value: 5 },
      { label: "HDR10", value: 4 },
    ]);
  });
});
