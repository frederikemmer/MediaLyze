import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useChartVisibility } from "./chart-visibility";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("observes a chart arriving after loading and mounts it only when near the viewport", () => {
  let notify: IntersectionObserverCallback = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  function Panel({ loaded }: { loaded: boolean }) {
    const { ref, ready } = useChartVisibility();
    return loaded ? <div ref={ref}>{ready ? "Chart" : "Waiting"}</div> : <div>Loading</div>;
  }
  const view = render(<Panel loaded={false} />);
  expect(observe).not.toHaveBeenCalled();
  view.rerender(<Panel loaded />);
  expect(observe).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Waiting")).toBeInTheDocument();
  act(() => notify([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(screen.queryByText("Chart")).not.toBeInTheDocument();
  act(() => notify([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver));
  expect(screen.getByText("Chart")).toBeInTheDocument();
  view.rerender(<Panel loaded={false} />);
  view.rerender(<Panel loaded />);
  expect(screen.getByText("Chart")).toBeInTheDocument();
  expect(disconnect).toHaveBeenCalled();
});
