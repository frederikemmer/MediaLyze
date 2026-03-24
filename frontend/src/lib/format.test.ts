import { describe, expect, it } from "vitest";

import { formatCodecLabel, formatDate, formatDuration } from "./format";

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

describe("formatDuration", () => {
  it("formats seconds as minutes", () => {
    expect(formatDuration(120)).toBe("2m");
  });

  it("formats seconds as hours and minutes", () => {
    expect(formatDuration(3665)).toBe("1h 1m");
  });

  it("formats seconds as days, hours, and minutes", () => {
    expect(formatDuration(90061)).toBe("1d 1h 1m");
  });

  it("formats multi-day durations without weeks", () => {
    expect(formatDuration(604800 + 86400)).toBe("8d");
  });

  it("formats seconds as years and days", () => {
    expect(formatDuration(31536000 + 86400)).toBe("1a 1d");
  });

  it("returns 'n/a' for null input", () => {
    expect(formatDuration(null)).toBe("n/a");
  });

  it("returns 'n/a' for invalid input", () => {
    expect(formatDuration(NaN)).toBe("n/a");
  });

  it("returns '0m' for zero seconds", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("formats large durations with all units", () => {
    const years = 2;
    const extraDays = 25;
    const days = 4;
    const hours = 5;
    const minutes = 6;

    const totalSeconds =
      years * 31536000 +
      extraDays * 86400 +
      days * 86400 +
      hours * 3600 +
      minutes * 60;

    expect(formatDuration(totalSeconds)).toBe("2a 29d 5h 6m");
  });
});

describe("formatDate", () => {
  it("formats UTC timestamps in the local browser timezone", () => {
    const value = "2026-03-24T04:06:00Z";

    expect(formatDate(value)).toBe(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)),
    );
  });

  it("returns 'never' for invalid input", () => {
    expect(formatDate("not-a-date")).toBe("never");
  });
});
