export class LruCache<K, V> {
  private values = new Map<K, V>();

  constructor(private readonly limit: number) {}

  get(key: K): V | undefined {
    const value = this.values.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.values.delete(key);
    this.values.set(key, value);

    while (this.values.size > this.limit) {
      const oldestKey = this.values.keys().next().value as K | undefined;
      if (oldestKey === undefined) {
        return;
      }
      this.values.delete(oldestKey);
    }
  }

  delete(key: K): boolean {
    return this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}
