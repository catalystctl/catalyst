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

export async function acquireLock(
  name: string,
  ttlMs = 15_000,
  waitMs = 0,
  redis?: CatalystRedis | null,
): Promise<DistributedLock | null> {
  const client = redis !== undefined ? redis : getRedis();
  if (!client) return null;
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
        };
      }
    } catch {
      return null;
    }
    if (Date.now() >= deadline) return null;
    const jitter = 25 + Math.random() * 75;
    await new Promise((r) => setTimeout(r, jitter));
  }
}

/**
 * Run `fn` under a Redis lock when Redis is available.
 * When Redis is unavailable the function still runs (single-process mode),
 * so callers must ensure the database also has an atomic guard for the
 * critical section (e.g. conditional updateMany). Returns fn's result.
 */
export async function withDistributedLock<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await acquireLock(name, ttlMs, 0);
  try {
    return await fn();
  } finally {
    if (lock) await lock.release();
  }
}
