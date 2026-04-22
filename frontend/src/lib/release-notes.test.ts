import { beforeEach, describe, expect, it } from "vitest";

import {
  RELEASE_NOTES_SEEN_VERSION_STORAGE_KEY,
  markReleaseNotesSeen,
  parseReleaseNotes,
  shouldShowReleaseNotes,
} from "./release-notes";

describe("release notes", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("parses the matching changelog version section", () => {
    const notes = parseReleaseNotes(
      [
        "# Changelog",
        "",
        "## v1.2.3",
        "",
        ">2026-04-22",
        "",
        "### New",
        "",
        "- add `one` feature ([#1](https://example.test/1))",
        "- improve **two**",
        "",
        "## v1.2.2",
        "",
        "- older entry",
      ].join("\n"),
      "1.2.3",
    );

    expect(notes).toEqual({
      version: "1.2.3",
      date: "2026-04-22",
      sections: [{ title: "New", items: ["add one feature (#1)", "improve two"] }],
    });
  });

  it("shows release notes once per non-dev version", () => {
    const notes = { version: "1.2.3", date: null, sections: [{ title: "New", items: ["entry"] }] };

    expect(shouldShowReleaseNotes("1.2.3", notes)).toBe(true);

    markReleaseNotesSeen("1.2.3");

    expect(window.localStorage.getItem(RELEASE_NOTES_SEEN_VERSION_STORAGE_KEY)).toBe("1.2.3");
    expect(shouldShowReleaseNotes("1.2.3", notes)).toBe(false);
    expect(shouldShowReleaseNotes("1.2.4", { ...notes, version: "1.2.4" })).toBe(true);
    expect(shouldShowReleaseNotes("dev", notes)).toBe(false);
  });
});
