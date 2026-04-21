import { describe, expect, it } from "vitest";

import { LruCache } from "./lru-cache";

describe("LruCache", () => {
  it("evicts the least recently used value when the limit is exceeded", () => {
    const cache = new LruCache<string, number>(2);

    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);

    cache.set("c", 3);

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });
});
