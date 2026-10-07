type LruCacheEntry<V> = {
  value: V;
  expiresAt: number | null;
  weight: number;
};

type LruCacheOptions<V> = {
  ttlMs?: number;
  maxWeight?: number;
  weigh?: (value: V) => number;
};

export class LruCache<K, V> {
  private values = new Map<K, LruCacheEntry<V>>();
  private totalWeight = 0;

  constructor(
    private readonly limit: number,
    private readonly options: LruCacheOptions<V> = {},
  ) {}

  get(key: K): V | undefined {
    const entry = this.values.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.delete(key);
      return undefined;
    }
    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.pruneExpired();
    this.delete(key);
    const weight = Math.max(0, this.options.weigh?.(value) ?? 1);
    if (!Number.isFinite(weight) || weight > (this.options.maxWeight ?? Infinity)) return;
    this.totalWeight += weight;
    this.values.set(key, {
      value,
      weight,
      expiresAt: this.options.ttlMs === undefined ? null : Date.now() + this.options.ttlMs,
    });

    while (this.values.size > this.limit || this.totalWeight > (this.options.maxWeight ?? Infinity)) {
      const oldestKey = this.values.keys().next().value as K | undefined;
      if (oldestKey === undefined) {
        return;
      }
      this.delete(oldestKey);
    }
  }

  delete(key: K): boolean {
    const entry = this.values.get(key);
    if (!entry) return false;
    this.totalWeight -= entry.weight;
    return this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
    this.totalWeight = 0;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.values) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.delete(key);
      }
    }
  }
}
