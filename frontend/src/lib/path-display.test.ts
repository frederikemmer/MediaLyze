import { describe, expect, it } from "vitest";

import { splitDisplayPath } from "./path-display";

describe("splitDisplayPath", () => {
  it("splits a unix path into segments", () => {
    expect(splitDisplayPath("shows/Season 01/Episode 01.mkv")).toEqual(["shows", "Season 01", "Episode 01.mkv"]);
  });

  it("normalizes windows separators", () => {
    expect(splitDisplayPath("shows\\Season 01\\Episode 01.mkv")).toEqual(["shows", "Season 01", "Episode 01.mkv"]);
  });

  it("removes duplicate and empty separators", () => {
    expect(splitDisplayPath("//shows///Season 01//Episode 01.mkv")).toEqual(["shows", "Season 01", "Episode 01.mkv"]);
  });

  it("returns the original value when no displayable segments remain", () => {
    expect(splitDisplayPath("")).toEqual([""]);
  });
});
