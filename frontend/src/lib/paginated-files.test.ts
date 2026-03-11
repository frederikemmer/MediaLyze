import { describe, expect, it } from "vitest";

import type { MediaFileRow } from "./api";
import {
  InflightPageRequestGate,
  buildFilePageRequestKey,
  mergeUniqueFiles,
  resolveFileLoadTransition,
  shouldRequestNextPage,
} from "./paginated-files";

function createFile(id: number): MediaFileRow {
  return {
    id,
    library_id: 1,
    relative_path: `folder/file-${id}.mkv`,
    filename: `file-${id}.mkv`,
    extension: "mkv",
    size_bytes: 1000 + id,
    mtime: id,
    last_seen_at: "2025-01-01T00:00:00Z",
    last_analyzed_at: "2025-01-01T00:00:00Z",
    scan_status: "ready",
    quality_score: 5,
    duration: 1200,
    video_codec: "h264",
    resolution: "1920x1080",
    hdr_type: null,
    audio_codecs: ["aac"],
    audio_languages: ["en"],
    subtitle_languages: ["en"],
    subtitle_codecs: ["srt"],
    subtitle_sources: ["external"],
  };
}

describe("paginated file helpers", () => {
  it("keeps existing rows visible during same-library refreshes", () => {
    expect(
      resolveFileLoadTransition({
        hasCachedFiles: false,
        currentFilesLength: 50,
        isSameLibrary: true,
      }),
    ).toEqual({
      clearExisting: false,
      showFullLoader: false,
      showInlineRefresh: true,
    });
  });

  it("switches to a full loader when a different library has no cached rows", () => {
    expect(
      resolveFileLoadTransition({
        hasCachedFiles: false,
        currentFilesLength: 50,
        isSameLibrary: false,
      }),
    ).toEqual({
      clearExisting: true,
      showFullLoader: true,
      showInlineRefresh: false,
    });
  });

  it("deduplicates appended pages by media id", () => {
    expect(mergeUniqueFiles([createFile(1), createFile(2)], [createFile(2), createFile(3)])).toEqual([
      createFile(1),
      createFile(2),
      createFile(3),
    ]);
  });

  it("blocks duplicate in-flight page requests for the same query and offset", () => {
    const gate = new InflightPageRequestGate();
    const requestKey = buildFilePageRequestKey("library-1::query::file::asc", 50);

    expect(gate.begin(requestKey)).toBe(true);
    expect(gate.begin(requestKey)).toBe(false);

    gate.end(requestKey);

    expect(gate.begin(requestKey)).toBe(true);
  });

  it("only auto-loads the next page when no other page request is active", () => {
    expect(
      shouldRequestNextPage({
        hasMoreFiles: true,
        isFilesLoading: false,
        isLoadingMore: false,
      }),
    ).toBe(true);

    expect(
      shouldRequestNextPage({
        hasMoreFiles: true,
        isFilesLoading: true,
        isLoadingMore: false,
      }),
    ).toBe(false);

    expect(
      shouldRequestNextPage({
        hasMoreFiles: true,
        isFilesLoading: false,
        isLoadingMore: true,
      }),
    ).toBe(false);
  });
});
