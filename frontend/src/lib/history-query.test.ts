import { describe, expect, it } from "vitest";
import { buildHistoryQuery } from "./api";
import { historyQuery } from "./history-query";

describe("history queries", () => {
  it.each([["7d", 7], ["30d", 30], ["1y", 365]] as const)("anchors %s to the newest stored snapshot", (mode, days) => {
    expect(historyQuery("resolution_mix", { mode })).toEqual({ metric: "resolution_mix", days });
  });
  it("keeps the full range available and sorts custom bounds", () => {
    expect(buildHistoryQuery(historyQuery("file_count", { mode: "all" }))).toBe("?metric=file_count");
    expect(historyQuery("size_distribution", { mode: "custom", startDate: "2026-10-03", endDate: "2026-01-01" })).toEqual({ metric: "size_distribution", start: "2026-01-01", end: "2026-10-03" });
    expect(buildHistoryQuery()).toBe("");
  });
});
