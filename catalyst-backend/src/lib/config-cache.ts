/**
 * Short-lived cache for rarely-changing configuration rows.
 *
 * Kills 2-4 `SystemSetting` primary-key reads per HTTP request (rate-limit
 * closures and auth hooks call getSecuritySettings on hot paths). L1 is a
 * process-local TTL map; L2 is Redis when configured. Mutations invalidate
 * both levels immediately so disabling registration or rotating SMTP takes
 * effect without waiting for TTL expiry.
 */

import { RedisKeys, RedisTTL, ttlWithJitter } from './cache-keys';
import { getRedis } from './redis';
import { publishCacheInvalidate, subscribeCacheInvalidations } from './event-bus';
import type { CacheInvalidateChannel } from './cache-bus';

type Entry<T> = { value: T; expiresAt: number };
const local = new Map<string, Entry<unknown>>();
let remoteSubscribed = false;

const counters = { l1Hits: 0, l2Hits: 0, misses: 0, serializationFailures: 0 };

/** Low-cardinality cache counters for admin health. No per-key labels. */
export function getConfigCacheStats(): { l1Hits: number; l2Hits: number; misses: number; serializationFailures: number; size: number } {
  return { ...counters, size: local.size };
}

const LOCAL_TTL_MS = 30_000;

function localGet<T>(key: string): T | null {
  const entry = local.get(key) as Entry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    local.delete(key);
    return null;
  }
  return entry.value;
}

function localSet<T>(key: string, value: T, ttlMs = LOCAL_TTL_MS): void {
  local.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function localDelete(key: string): void {
  local.delete(key);
}

async function ensureRemoteSubscription(): Promise<void> {
  if (remoteSubscribed) return;
  remoteSubscribed = true;
  try {
    await subscribeCacheInvalidations((channel: CacheInvalidateChannel) => {
      if (channel === 'config') {
        local.clear();
      }
    });
  } catch {
    remoteSubscribed = false;
  }
}

export async function cachedConfig<T>(kind: 'security' | 'smtp' | 'mod_manager' | 'theme_default', fetcher: () => Promise<T>): Promise<T> {
  void ensureRemoteSubscription();
  const localKey = `config:${kind}`;
  const hit = localGet<T>(localKey);
  if (hit !== null) {
    counters.l1Hits += 1;
    return hit;
  }
  const redisKey = RedisKeys.config(kind);
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(redisKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as T;
          counters.l2Hits += 1;
          localSet(localKey, parsed);
          return parsed;
        } catch {
          counters.serializationFailures += 1;
        }
      }
    } catch { /* fall through to DB */ }
  }
  counters.misses += 1;
  const fresh = await fetcher();
  localSet(localKey, fresh);
  if (redis) {
    try {
      await redis.set(redisKey, JSON.stringify(fresh), ttlWithJitter(RedisTTL.configSec));
    } catch { /* degraded */ }
  }
  return fresh;
}

export async function invalidateConfig(kind?: 'security' | 'smtp' | 'mod_manager' | 'theme_default'): Promise<void> {
  if (kind) {
    localDelete(`config:${kind}`);
    const redis = getRedis();
    if (redis) {
      try { await redis.del(RedisKeys.config(kind)); } catch { /* degraded */ }
    }
  } else {
    local.clear();
  }
  publishCacheInvalidate('config', kind ? { nodeId: kind } : { flushAll: true });
}

/** Test helper. */
export function clearConfigCacheMemory(): void {
  local.clear();
}
