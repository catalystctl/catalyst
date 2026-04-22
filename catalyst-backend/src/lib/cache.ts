/**
 * Simple in-memory LRU cache with TTL support.
 * Used to reduce N+1 permission queries and other repeated DB lookups.
 */
export class SimpleCache<K, V> {
  private cache = new Map<K, { value: V; expiresAt: number }>();
  constructor(private defaultTtl: number) {}

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttl?: number): void {
    this.cache.set(key, { value, expiresAt: Date.now() + (ttl ?? this.defaultTtl) });
  }

  delete(key: K): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}
