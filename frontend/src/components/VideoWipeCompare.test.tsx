import "../i18n";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VideoWipeCompare } from "./VideoWipeCompare";

afterEach(cleanup);

describe("VideoWipeCompare", () => {
  it("keeps seek, volume, and the draggable wipe control synchronized", () => {
    const { container } = render(
      <VideoWipeCompare
        first={{ src: "/api/files/1/media", label: "Original" }}
        second={{ src: "/api/files/2/media", label: "Variant" }}
      />,
    );
    const [first, second] = Array.from(container.querySelectorAll("video"));
    expect(first).toHaveAttribute("playsinline");
    expect(second).toHaveAttribute("playsinline");
    Object.defineProperty(first, "duration", { configurable: true, value: 120 });
    Object.defineProperty(second, "duration", { configurable: true, value: 121 });
    fireEvent.loadedMetadata(first);
    fireEvent.loadedMetadata(second);

    fireEvent.change(screen.getByRole("slider", { name: "Seek both videos" }), { target: { value: "42" } });
    expect(first.currentTime).toBe(42);
    expect(second.currentTime).toBe(42);

    fireEvent.change(screen.getByRole("slider", { name: "Volume for both videos" }), { target: { value: "0.35" } });
    expect(first.volume).toBe(0.35);
    expect(second.volume).toBe(0.35);

    const wipeHandle = screen.getByRole("slider", { name: "Visible share of the second video" });
    expect(container.querySelector("label input[type=\"range\"]")).toBeNull();
    const stage = container.querySelector(".video-wipe-stage") as HTMLDivElement;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      bottom: 582,
      height: 562,
      left: 10,
      right: 1010,
      top: 20,
      width: 1000,
      x: 10,
      y: 20,
    } as DOMRect);
    fireEvent.pointerDown(wipeHandle, { clientX: 510, pointerId: 1 });
    fireEvent.pointerMove(wipeHandle, { clientX: 730, pointerId: 1 });
    fireEvent.pointerUp(wipeHandle, { clientX: 730, pointerId: 1 });
    expect(wipeHandle).toHaveAttribute("aria-valuenow", "72");
    expect(container.querySelector(".video-wipe-second")).toHaveStyle({ clipPath: "inset(0 28% 0 0)" });
    expect(screen.getByText(/different durations/i)).toBeInTheDocument();
  });

  it("shows the browser playback fallback when either video fails", () => {
    const { container } = render(
      <VideoWipeCompare
        first={{ src: "/api/files/1/media", label: "Original" }}
        second={{ src: "/api/files/2/media", label: "Variant" }}
      />,
    );
    fireEvent.error(container.querySelectorAll("video")[1]);
    expect(screen.getByText(/cannot be played by this browser/i)).toBeInTheDocument();
  });
});
