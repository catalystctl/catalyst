/**
 * In-memory TTL cache with size cap + LRU eviction.
 * Used to reduce N+1 permission queries and other repeated DB lookups.
 *
 * This is process-local only — there is no Redis backend. When running with
 * WORKERS > 1, callers that mutate underlying data MUST broadcast invalidation
 * via `lib/cache-bus.ts` (see agent-auth, permissions, permissions-catalog).
 * Brute-force lockout state lives in Postgres and does not use this cache as SoT.
 */

export type SimpleCacheStats = { size: number; hits: number; misses: number; hitRate: number; evictions: number };

export class SimpleCache<K, V> {
  private cache = new Map<K, { value: V; expiresAt: number }>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private lastSweepSize = 0;
  constructor(
    private defaultTtl: number,
    /** Max live entries; the least-recently-used entry is evicted above this. */
    private maxSize = 1000,
  ) {}

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses += 1;
      return undefined;
    }
    // Refresh insertion order for LRU eviction.
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key: K, value: V, ttl?: number): void {
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: Date.now() + (ttl ?? this.defaultTtl) });
    if (this.cache.size > this.maxSize) {
      // Evict the least-recently-used entry (Map iteration order).
      const oldest = this.cache.keys().next();
      if (!oldest.done) {
        this.cache.delete(oldest.value);
        this.evictions += 1;
      }
    }
    this.sweepIfBloated();
  }

  delete(key: K): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  /**
   * Expired entries are otherwise only reclaimed when their key is read
   * again; keys never read again would grow the map forever. Sweep when the
   * map has grown 2x since the last sweep.
   */
  private sweepIfBloated(): void {
    if (this.cache.size <= Math.max(this.maxSize, this.lastSweepSize * 2)) return;
    const now = Date.now();
    for (const [k, v] of this.cache) {
      if (now > v.expiresAt) this.cache.delete(k);
    }
    this.lastSweepSize = this.cache.size;
  }

  stats(): SimpleCacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Math.round((this.hits / total) * 1000) / 1000 : 0,
      evictions: this.evictions,
    };
  }
}

/**
 * Fixed, low-cardinality registry of named cache instances for admin health.
 * Registration is one-time per process (module load); no per-user labels.
 */
const namedCaches = new Map<string, () => SimpleCacheStats>();

export function registerCacheStats(name: string, getStats: () => SimpleCacheStats): void {
  if (!namedCaches.has(name)) namedCaches.set(name, getStats);
}

export function getAllCacheStats(): Record<string, SimpleCacheStats> {
  const out: Record<string, SimpleCacheStats> = {};
  for (const [name, getStats] of namedCaches) {
    try {
      out[name] = getStats();
    } catch {
      // Never let stats collection break the caller.
    }
  }
  return out;
}
