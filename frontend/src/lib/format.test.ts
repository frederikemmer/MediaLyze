import { describe, expect, it } from "vitest";

import { formatCodecLabel } from "./format";

describe("formatCodecLabel", () => {
  it("formats raw audio codec identifiers into readable labels", () => {
    expect(formatCodecLabel("pcm_s16be", "audio")).toBe("PCM 16-bit Big-Endian");
  });

  it("formats raw subtitle codec identifiers into readable labels", () => {
    expect(formatCodecLabel("hdmv_pgs_subtitle", "subtitle")).toBe("PGS");
  });

  it("formats common video codec identifiers into readable labels", () => {
    expect(formatCodecLabel("h264", "video")).toBe("H.264 / AVC");
  });
});
