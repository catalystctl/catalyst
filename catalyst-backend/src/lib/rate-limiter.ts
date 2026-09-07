/**
 * Distributed rate limiter (fixed window, atomic INCR + EXPIRE via Lua).
 *
 * Falls back to a process-local map when Redis is unavailable so
 * single-process installs keep working. Multi-instance installs should
 * ensure REDIS_URL is set, otherwise each instance enforces its own budget.
 */

import { RedisKeys } from './cache-keys';
import { getRedis, type CatalystRedis } from './redis';

const CONSUME_LUA = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return {current, ttl}`;

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  limited: boolean;
};

type MemoryEntry = { count: number; resetAt: number };
const memoryBuckets = new Map<string, MemoryEntry>();

function memoryConsume(key: string, max: number, windowMs: number): RateLimitDecision {
  const now = Date.now();
  const entry = memoryBuckets.get(key);
  if (!entry || now >= entry.resetAt) {
    const resetAt = now + windowMs;
    memoryBuckets.set(key, { count: 1, resetAt });
    if (memoryBuckets.size > 10_000) {
      for (const [k, v] of memoryBuckets) {
        if (now >= v.resetAt) memoryBuckets.delete(k);
      }
    }
    return { allowed: 1 <= max, remaining: Math.max(0, max - 1), resetMs: windowMs, limited: 1 > max };
  }
  entry.count += 1;
  const resetMs = Math.max(0, entry.resetAt - now);
  return {
    allowed: entry.count <= max,
    remaining: Math.max(0, max - entry.count),
    resetMs,
    limited: entry.count > max,
  };
}

export async function checkRateLimit(
  scope: string,
  id: string,
  max: number,
  windowMs: number,
  redis?: CatalystRedis | null,
): Promise<RateLimitDecision> {
  const safeMax = Math.max(1, Math.floor(max));
  const safeWindow = Math.max(1000, Math.floor(windowMs));
  const windowId = Math.floor(Date.now() / safeWindow).toString();
  const key = RedisKeys.rateLimit(scope, id, windowId);
  const client: CatalystRedis | null = redis !== undefined ? redis : getRedis();
  if (!client) return memoryConsume(`${scope}:${id}:${windowId}`, safeMax, safeWindow);
  try {
    const res = (await client.evalSha<[number, number]>(CONSUME_LUA, [key], [String(safeWindow)])) as unknown as [number, number];
    const count = Number(res?.[0] ?? 0);
    const ttl = Number(res?.[1] ?? safeWindow);
    return {
      allowed: count <= safeMax,
      remaining: Math.max(0, safeMax - count),
      resetMs: Number.isFinite(ttl) && ttl >= 0 ? ttl : safeWindow,
      limited: count > safeMax,
    };
  } catch {
    return memoryConsume(`${scope}:${id}:${windowId}`, safeMax, safeWindow);
  }
}

/** Test helper: clear process-local fallback buckets. */
export function clearRateLimiterMemory(): void {
  memoryBuckets.clear();
}
