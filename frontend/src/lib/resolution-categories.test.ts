import { describe, expect, it } from "vitest";

import { classifyResolutionCategory } from "./resolution-categories";

describe("classifyResolutionCategory", () => {
  it("uses configured labels and treats rotated dimensions identically", () => {
    const categories = [
      { id: "uhd", label: "UHD", min_width: 3648, min_height: 1600 },
      { id: "fullhd", label: "Full HD", min_width: 1824, min_height: 760 },
      { id: "sd", label: "SD", min_width: 0, min_height: 0 },
    ];

    expect(classifyResolutionCategory(1920, 1080, categories)?.label).toBe("Full HD");
    expect(classifyResolutionCategory(1080, 1920, categories)?.id).toBe("fullhd");
  });

  it("falls back to the configured final category when dimensions are below a threshold", () => {
    const categories = [
      { id: "fullhd", label: "Full HD", min_width: 1824, min_height: 760 },
      { id: "archive", label: "Archive", min_width: 0, min_height: 0 },
    ];

    expect(classifyResolutionCategory(640, 360, categories)?.label).toBe("Archive");
    expect(classifyResolutionCategory(null, 360, categories)).toBeNull();
  });
});
