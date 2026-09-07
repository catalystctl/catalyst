/**
 * Idempotency store (SET NX EX + GET). Used for operations that clients may
 * safely retry: migration create, transfer/clone, restore, template import.
 *
 * Falls back to process-local memory when Redis is unavailable (single
 * process only). Keys combine a scope with a SHA-256 of the stable request
 * fingerprint so different users/servers never collide.
 */

import { createHash } from 'crypto';
import { RedisKeys, RedisTTL } from './cache-keys';
import { getRedis, type CatalystRedis } from './redis';

export function fingerprintRequest(parts: Array<string | number | boolean | null | undefined>): string {
  const hash = createHash('sha256');
  hash.update(parts.map((p) => String(p ?? '')).join('|'));
  return hash.digest('hex').slice(0, 32);
}

type MemoryRecord = { value: string; expiresAt: number };
const memoryStore = new Map<string, MemoryRecord>();

function memoryGet(key: string): string | null {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

function memorySetNx(key: string, value: string, ttlSec: number): boolean {
  if (memoryGet(key) !== null) return false;
  memoryStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  if (memoryStore.size > 5000) {
    const now = Date.now();
    for (const [k, v] of memoryStore) {
      if (now > v.expiresAt) memoryStore.delete(k);
    }
  }
  return true;
}

/** Claim a key. Returns true when this caller owns it, false on replay. */
export async function claimIdempotency(
  scope: string,
  keyHash: string,
  ttlSec = RedisTTL.idempotencySec,
  redis?: CatalystRedis | null,
): Promise<boolean> {
  const key = RedisKeys.idempotency(scope, keyHash);
  const client: CatalystRedis | null = redis !== undefined ? redis : getRedis();
  if (!client) return memorySetNx(key, 'claimed', ttlSec);
  try {
    return await client.set(key, 'claimed', ttlSec, true);
  } catch {
    return memorySetNx(key, 'claimed', ttlSec);
  }
}

const COMPLETE_LUA = `
local current = redis.call("GET", KEYS[1])
if current == false or current == ARGV[1] then
  redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
  return 1
end
return 0`;

export async function completeIdempotency(
  scope: string,
  keyHash: string,
  resultJson: string,
  ttlSec = RedisTTL.idempotencySec,
  redis?: CatalystRedis | null,
): Promise<void> {
  const key = RedisKeys.idempotency(scope, keyHash);
  const client: CatalystRedis | null = redis !== undefined ? redis : getRedis();
  if (!client) {
    const existing = memoryGet(key);
    if (existing === null || existing === 'claimed') {
      memoryStore.set(key, { value: resultJson, expiresAt: Date.now() + ttlSec * 1000 });
    }
    return;
  }
  try {
    // Only replace the 'claimed' sentinel (or a missing key). A concurrent
    // winner's stored result is never overwritten by the loser.
    await client.evalSha<number>(COMPLETE_LUA, [key], ['claimed', resultJson, String(Math.max(1, Math.round(ttlSec)))]);
  } catch {
    const existing = memoryGet(key);
    if (existing === null || existing === 'claimed') {
      memoryStore.set(key, { value: resultJson, expiresAt: Date.now() + ttlSec * 1000 });
    }
  }
}

export async function getIdempotency(
  scope: string,
  keyHash: string,
  redis?: CatalystRedis | null,
): Promise<string | null> {
  const key = RedisKeys.idempotency(scope, keyHash);
  const client: CatalystRedis | null = redis !== undefined ? redis : getRedis();
  if (!client) return memoryGet(key);
  try {
    const remote = await client.get(key);
    if (remote !== null) return remote;
  } catch { /* fall through to memory */ }
  return memoryGet(key);
}

/** Test helper. */
export function clearIdempotencyMemory(): void {
  memoryStore.clear();
}
