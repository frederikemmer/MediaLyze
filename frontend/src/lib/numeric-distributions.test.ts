import { describe, expect, it } from "vitest";

import {
  buildNumericDistributionFilterExpression,
  formatNumericDistributionBinLabel,
} from "./numeric-distributions";

describe("numeric distributions", () => {
  it("builds discrete quality score filters", () => {
    expect(
      buildNumericDistributionFilterExpression("quality_score", {
        lower: 8,
        upper: 9,
        count: 12,
        percentage: 24,
      }),
    ).toBe("=8");
  });

  it("builds bounded numeric range filters", () => {
    expect(
      buildNumericDistributionFilterExpression("size", {
        lower: 4_000_000_000,
        upper: 8_000_000_000,
        count: 3,
        percentage: 15,
      }),
    ).toBe(">=4GB,<8GB");
  });

  it("builds open-ended bitrate filters", () => {
    expect(
      buildNumericDistributionFilterExpression("bitrate", {
        lower: 40_000_000,
        upper: null,
        count: 1,
        percentage: 5,
      }),
    ).toBe(">=40Mb/s");
  });

  it("formats duration bin labels for charts", () => {
    expect(
      formatNumericDistributionBinLabel("duration", {
        lower: 5400,
        upper: 7200,
        count: 7,
        percentage: 20,
      }),
    ).toBe("1h 30m - 2h");
  });
});
