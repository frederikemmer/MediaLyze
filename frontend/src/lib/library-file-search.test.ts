import { describe, expect, it } from "vitest";

import { LIBRARY_METADATA_SEARCH_FIELDS } from "./library-file-search";

describe("library file search metadata fields", () => {
  it("includes every newly added audio metadata filter", () => {
    expect(LIBRARY_METADATA_SEARCH_FIELDS).toEqual(
      expect.arrayContaining([
        "audio_title",
        "audio_artist",
        "audio_album",
        "audio_album_artist",
        "audio_genre",
        "audio_date",
        "audio_disc",
        "audio_composer",
        "audio_channels",
        "sample_rate",
        "track_number",
        "bit_rate_mode",
        "has_embedded_cover",
      ]),
    );
  });
});
