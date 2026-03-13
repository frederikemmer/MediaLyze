import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api.libraryFiles", () => {
  it("serializes field-specific search filters into query parameters", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          total: 0,
          offset: 0,
          limit: 200,
          items: [],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    await api.libraryFiles(42, {
      offset: 0,
      limit: 200,
      filters: {
        file: "episode",
        video_codec: "hevc",
        subtitle_sources: "external",
      },
      sortKey: "quality_score",
      sortDirection: "desc",
    });

    const [requestPath] = fetchSpy.mock.calls[0] ?? [];
    expect(String(requestPath)).toContain("/libraries/42/files?");
    expect(String(requestPath)).toContain("file_search=episode");
    expect(String(requestPath)).toContain("search_video_codec=hevc");
    expect(String(requestPath)).toContain("search_subtitle_sources=external");
    expect(String(requestPath)).toContain("sort_key=quality_score");
    expect(String(requestPath)).toContain("sort_direction=desc");
  });
});
