/**
 * Safe distributed lock (unique token + TTL + Lua compare-and-delete).
 *
 * Never use naive SETNX + DEL: a slow holder whose TTL expires would let a
 * second owner in, then the first DEL would delete the second owner's lock.
 */

import { randomUUID } from 'crypto';
import { RedisKeys } from './cache-keys';
import { getRedis, type CatalystRedis } from './redis';

const RELEASE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end`;

export type DistributedLock = {
  key: string;
  token: string;
  release: () => Promise<boolean>;
};

export type LockAcquisition =
  | { status: 'acquired'; lock: DistributedLock }
  | { status: 'held' }
  /** Redis is not configured, or configured but not answering. */
  | { status: 'unavailable' };

export async function tryAcquireLock(
  name: string,
  ttlMs = 15_000,
  waitMs = 0,
  redis?: CatalystRedis | null,
): Promise<LockAcquisition> {
  const client = redis !== undefined ? redis : getRedis();
  if (!client) return { status: 'unavailable' };
  const key = RedisKeys.lock(name);
  const token = randomUUID();
  const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    try {
      const acquired = await client.set(key, token, ttlSec, true);
      if (acquired) {
        let released = false;
        return {
          status: 'acquired',
          lock: {
            key,
            token,
            release: async (): Promise<boolean> => {
              if (released) return false;
              released = true;
              try {
                const res = await client.evalSha<number>(RELEASE_LUA, [key], [token]);
                return res === 1;
              } catch {
                return false;
              }
            },
          },
        };
      }
    } catch {
      // A rejected SET means Redis is unreachable, not that another owner
      // holds the lock — keep the two outcomes distinct for callers.
      return { status: 'unavailable' };
    }
    if (Date.now() >= deadline) return { status: 'held' };
    const jitter = 25 + Math.random() * 75;
    await new Promise((r) => setTimeout(r, jitter));
  }
}

export async function acquireLock(
  name: string,
  ttlMs = 15_000,
  waitMs = 0,
  redis?: CatalystRedis | null,
): Promise<DistributedLock | null> {
  const acquisition = await tryAcquireLock(name, ttlMs, waitMs, redis);
  return acquisition.status === 'acquired' ? acquisition.lock : null;
}

/**
 * Run `fn` under a Redis lock. On contention the loser THROWS instead of
 * running the critical section concurrently — silently running unguarded
 * would defeat the lock's purpose.
 *
 * Degraded mode (Redis not configured OR configured but unreachable): the
 * lock cannot be acquired, so `fn` still runs (single-process fallback), but
 * callers MUST pair it with a database-side atomic guard (conditional
 * updateMany / unique constraint) for correctness across instances.
 *
 * TTL caveat: there is no renewal. Keep the critical section well under
 * ttlMs or the lock expires mid-flight and a second owner may enter.
 */
export async function withDistributedLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
  waitMs = 0,
): Promise<T> {
  const acquisition = await tryAcquireLock(name, ttlMs, waitMs);
  if (acquisition.status === 'unavailable') {
    return fn();
  }
  if (acquisition.status === 'held') {
    throw new Error(`Lock "${name}" already held`);
  }
  const lock = acquisition.lock;
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
