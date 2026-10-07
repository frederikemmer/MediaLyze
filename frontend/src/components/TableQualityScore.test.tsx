import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TableQualityScore } from "./TableQualityScore";

describe("TableQualityScore", () => {
  it.each([[0, "low"], [3, "low"], [3.1, "medium"], [6, "medium"], [6.1, "high"], [10, "high"]])("colors only score %s using tier %s", (score, tier) => {
    const { container } = render(<TableQualityScore score={Number(score)} />);
    expect(container.textContent).toBe(`${score}/10`);
    expect(container.querySelector(`.table-quality-score-${tier}`)?.textContent).toBe(String(score));
    expect(container.querySelector(".score-meter")).toBeNull();
  });
  it("preserves a fractional grouped score and missing values", () => {
    const { container, rerender } = render(<TableQualityScore score={8.24} />);
    expect(container.textContent).toBe("8.2/10");
    rerender(<TableQualityScore score={null} emptyLabel="Unknown" />);
    expect(container.textContent).toBe("Unknown");
    expect(container.querySelector(".table-quality-score-value")).toBeNull();
  });
});
