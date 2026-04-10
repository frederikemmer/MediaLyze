import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TooltipTrigger } from "./TooltipTrigger";

afterEach(() => {
  cleanup();
});

describe("TooltipTrigger", () => {
  it("keeps only one tooltip open at a time", async () => {
    render(
      <>
        <TooltipTrigger ariaLabel="Open first tooltip" content="First tooltip">
          First
        </TooltipTrigger>
        <TooltipTrigger ariaLabel="Open second tooltip" content="Second tooltip">
          Second
        </TooltipTrigger>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open first tooltip" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("First tooltip");

    fireEvent.click(screen.getByRole("button", { name: "Open second tooltip" }));
    const tooltips = await screen.findAllByRole("tooltip");
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0]).toHaveTextContent("Second tooltip");
  });

  it("closes an open tooltip when the page scrolls elsewhere", async () => {
    render(
      <div>
        <div data-testid="scroll-host">
          <TooltipTrigger ariaLabel="Open tooltip" content="Scrollable tooltip">
            Trigger
          </TooltipTrigger>
        </div>
        <div data-testid="outside-scroll-target" />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open tooltip" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Scrollable tooltip");

    fireEvent.scroll(screen.getByTestId("outside-scroll-target"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
