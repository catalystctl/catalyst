/**
 * Cross-instance event bus (Redis pub/sub with IPC fallback).
 *
 * - Cache invalidations keep using lib/cache-bus IPC on a single host and
 *   are additionally published to Redis so multi-host backends stay coherent.
 * - Browser fan-out events (server/global/admin) are published so an agent
 *   event landing on instance A reaches SSE viewers connected to instance B.
 *   Local subscriber maps remain the last-hop delivery table; sockets and
 *   pending promise maps are never stored in Redis.
 */

import { randomUUID } from 'crypto';
import { RedisChannels } from './cache-keys';
import { getRedis } from './redis';
import { broadcastCacheInvalidate as broadcastIpc, getCacheBusInstanceId, type CacheInvalidateChannel, type CacheInvalidatePayload } from './cache-bus';

const instanceId = randomUUID();
let fanoutSubscribed = false;
const fanoutHandlers = new Set<(event: FanoutEvent & { origin: string }) => void | Promise<void>>();
const cacheHandlers = new Set<(channel: CacheInvalidateChannel, payload: CacheInvalidatePayload, origin: string) => void>();
let cacheSubscribed = false;

export function getEventBusInstanceId(): string {
  return instanceId;
}

export function publishCacheInvalidate(
  channel: CacheInvalidateChannel,
  payload: Record<string, unknown> = {},
): void {
  // Single publisher: cache-bus broadcasts via IPC and publishes once to
  // Redis. Publishing here as well delivered every invalidation twice.
  broadcastIpc(channel, payload as CacheInvalidatePayload);
}

export async function subscribeCacheInvalidations(
  apply: (channel: CacheInvalidateChannel, payload: CacheInvalidatePayload, origin: string) => void,
): Promise<void> {
  cacheHandlers.add(apply);
  if (cacheSubscribed) return;
  const redis = getRedis();
  if (!redis) return;
  cacheSubscribed = true;
  try {
    await redis.subscribe(RedisChannels.cacheInvalidate(), (message) => {
      try {
        const parsed = JSON.parse(message) as { origin: string; channel: CacheInvalidateChannel; payload: CacheInvalidatePayload };
        if (!parsed || parsed.origin === instanceId) return;
        if (parsed.origin === getCacheBusInstanceId()) return;
        // Also ignore our own cache-bus instance id (same process publishes via cache-bus).
        for (const fn of cacheHandlers) {
          try { fn(parsed.channel, parsed.payload ?? {}, parsed.origin); } catch { /* ignore */ }
        }
      } catch { /* malformed remote message */ }
    });
  } catch {
    cacheSubscribed = false;
  }
}

export type FanoutEvent = {
  scope: 'server' | 'global' | 'admin';
  serverId?: string;
  eventType: string;
  payload: unknown;
};

export function publishFanout(event: FanoutEvent): void {
  const redis = getRedis();
  if (!redis) return;
  const envelope = JSON.stringify({ ...event, origin: instanceId, ts: Date.now() });
  redis.publish(RedisChannels.fanout(), envelope).catch(() => { /* degraded */ });
}

export async function subscribeFanout(
  deliver: (event: FanoutEvent & { origin: string }) => void | Promise<void>,
): Promise<void> {
  fanoutHandlers.add(deliver);
  if (fanoutSubscribed) return;
  const redis = getRedis();
  if (!redis) return;
  fanoutSubscribed = true;
  try {
    await redis.subscribe(RedisChannels.fanout(), (message) => {
      try {
        const parsed = JSON.parse(message) as FanoutEvent & { origin: string };
        if (!parsed || parsed.origin === instanceId) return;
        for (const fn of fanoutHandlers) {
          try { void fn(parsed); } catch { /* ignore */ }
        }
      } catch { /* malformed remote message */ }
    });
  } catch {
    fanoutSubscribed = false;
  }
}
