/**
 * Simple in-memory LRU cache with TTL support.
 * Used to reduce N+1 permission queries and other repeated DB lookups.
 *
 * This is process-local only — there is no Redis backend. When running with
 * WORKERS > 1, callers that mutate underlying data MUST broadcast invalidation
 * via `lib/cache-bus.ts` (see agent-auth, permissions, permissions-catalog).
 * Brute-force lockout state lives in Postgres and does not use this cache as SoT.
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
