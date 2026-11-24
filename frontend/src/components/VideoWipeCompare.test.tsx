import "../i18n";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VideoWipeCompare } from "./VideoWipeCompare";

afterEach(cleanup);

describe("VideoWipeCompare", () => {
  it("keeps seek, volume, audio mix, and the draggable wipe control synchronized", () => {
    const { container } = render(
      <VideoWipeCompare
        first={{ src: "/api/files/1/media", label: "Original" }}
        second={{ src: "/api/files/2/media", label: "Variant" }}
      />,
    );
    const [first, second] = Array.from(container.querySelectorAll("video"));
    expect(first).toHaveAttribute("playsinline");
    expect(second).toHaveAttribute("playsinline");
    expect(screen.getByRole("combobox", { name: "First audio track" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Second audio track" })).toBeDisabled();
    Object.defineProperty(first, "duration", { configurable: true, value: 120 });
    Object.defineProperty(second, "duration", { configurable: true, value: 121 });
    fireEvent.loadedMetadata(first);
    fireEvent.loadedMetadata(second);

    fireEvent.change(screen.getByRole("slider", { name: "Seek both videos" }), { target: { value: "42" } });
    expect(first.currentTime).toBe(42);
    expect(second.currentTime).toBe(42);

    fireEvent.change(screen.getByRole("slider", { name: "Volume for both videos" }), { target: { value: "0.35" } });
    expect(first.volume).toBeCloseTo(0.175);
    expect(second.volume).toBeCloseTo(0.175);

    const audioMix = screen.getByRole("slider", { name: "Audio mix between both videos" });
    fireEvent.change(audioMix, { target: { value: "5" } });
    expect(first.volume).toBeCloseTo(0.3325);
    expect(second.volume).toBeCloseTo(0.0175);
    expect(screen.getByText("95% first / 5% second")).toBeInTheDocument();

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
    expect(wipeHandle).toHaveAttribute("aria-valuenow", "28");
    expect(container.querySelector(".video-wipe-second")).toHaveStyle({ clipPath: "inset(0 0 0 72%)" });
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

  it("switches the selected audio track on only the requested side", () => {
    type TestTrack = { enabled: boolean; label: string; language: string };
    const trackLists = new WeakMap<HTMLVideoElement, EventTarget & ArrayLike<TestTrack>>();
    Object.defineProperty(HTMLVideoElement.prototype, "audioTracks", {
      configurable: true,
      get(this: HTMLVideoElement) {
        if (!trackLists.has(this)) {
          const tracks: ArrayLike<TestTrack> = {
            0: { enabled: true, label: "English", language: "en" },
            1: { enabled: false, label: "German", language: "de" },
            length: 2,
          };
          trackLists.set(this, Object.assign(new EventTarget(), tracks));
        }
        return trackLists.get(this);
      },
    });
    try {
      const { container, unmount } = render(
        <VideoWipeCompare
          first={{ src: "/api/files/1/media", label: "Original" }}
          second={{ src: "/api/files/2/media", label: "Variant" }}
        />,
      );
      const firstSelect = screen.getByRole("combobox", { name: "First audio track" });
      const secondSelect = screen.getByRole("combobox", { name: "Second audio track" });
      fireEvent.change(firstSelect, { target: { value: "1" } });
      expect(firstSelect).toHaveValue("1");
      expect(secondSelect).toHaveValue("0");
      const [first, second] = container.querySelectorAll("video");
      expect(Array.from(trackLists.get(first)!, (track) => track.enabled)).toEqual([false, true]);
      expect(Array.from(trackLists.get(second)!, (track) => track.enabled)).toEqual([true, false]);
      unmount();
    } finally {
      Reflect.deleteProperty(HTMLVideoElement.prototype, "audioTracks");
    }
  });
});
