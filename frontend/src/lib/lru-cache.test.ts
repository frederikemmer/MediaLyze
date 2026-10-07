import { afterEach, describe, expect, it, vi } from "vitest";

import { LruCache } from "./lru-cache";

describe("LruCache", () => {
  afterEach(() => vi.useRealTimers());

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

  it("drops expired values instead of retaining stale data", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T10:00:00Z"));
    const cache = new LruCache<string, number>(2, { ttlMs: 1_000 });

    cache.set("a", 1);
    vi.advanceTimersByTime(1_001);

    expect(cache.get("a")).toBeUndefined();
  });
});

describe("weighted LRU budgets", () => {
  it("bounds cached rows, preserves recent entries, and does not cache an oversized active list", () => {
    const cache = new LruCache<string, number[]>(12, { maxWeight: 5, weigh: (rows) => rows.length });
    cache.set("a", [1, 2, 3]);
    cache.set("b", [4, 5, 6]);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toEqual([4, 5, 6]);
    const active = [1, 2, 3, 4, 5, 6];
    cache.set("large", active);
    expect(cache.get("large")).toBeUndefined();
    expect(active).toHaveLength(6);
    cache.delete("b");
    cache.set("c", [1, 2, 3, 4, 5]);
    expect(cache.get("c")).toHaveLength(5);
    cache.clear();
    cache.set("d", [1, 2, 3, 4, 5]);
    expect(cache.get("d")).toHaveLength(5);
  });
});
