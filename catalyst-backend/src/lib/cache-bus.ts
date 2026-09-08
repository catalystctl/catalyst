/**
 * Cache invalidation bus (cluster IPC + Redis pub/sub).
 *
 * Process-local Maps stay coherent via Node cluster IPC on a single host
 * and via Redis pub/sub across hosts. This module is the single Redis
 * publisher for invalidations; event-bus delegates here.
 *
 * Message shape on process IPC:
 *   { type: 'catalyst:cache-invalidate', channel, payload }
 *
 * Primary process relays worker→worker; workers apply handlers for the
 * channel. Handlers must be registered once at module load (side-effect of
 * importing agent-auth / permissions / permissions-catalog).
 */

import cluster from 'cluster';
import { randomUUID } from 'crypto';
import { RedisChannels } from './cache-keys';
import { getRedis } from './redis';

const cacheBusInstanceId = randomUUID();

export function getCacheBusInstanceId(): string {
  return cacheBusInstanceId;
}

/**
 * Apply a remote invalidation locally only (no rebroadcast).
 * Used for Redis cross-host events to avoid publish loops.
 */
export function applyRemoteCacheInvalidate(
  channel: CacheInvalidateChannel,
  payload: CacheInvalidatePayload = {},
): void {
  ensureIpcListener();
  applyLocal(channel, payload);
}

export type CacheInvalidateChannel =
  | 'agent-auth'
  | 'permissions'
  | 'admin-user'
  | 'node-access'
  | 'config'
  | 'sftp'
  | 'template'
  | 'server-list'
  | 'server-access'
  | 'apikey';

export type CacheInvalidatePayload = {
  /** Optional node id for agent-auth scoped invalidation */
  nodeId?: string;
  /** Optional user id for permissions / admin-user scoped invalidation */
  userId?: string;
  /** Optional server id for server-access scoped invalidation */
  serverId?: string;
  /** Optional API key hash prefix for apikey scoped invalidation */
  keyHash?: string;
  /** When true, flush the entire cache for the channel */
  flushAll?: boolean;
};

type CacheHandler = (payload: CacheInvalidatePayload) => void;

const CHANNEL = 'catalyst:cache-invalidate' as const;

const handlers = new Map<CacheInvalidateChannel, Set<CacheHandler>>();
let ipcListening = false;
let primaryRelaying = false;

function ensureIpcListener(): void {
  if (ipcListening) return;
  ipcListening = true;

  // Worker: apply invalidations received from primary
  if (cluster.isWorker) {
    process.on('message', (msg: any) => {
      if (!msg || msg.type !== CHANNEL) return;
      applyLocal(msg.channel as CacheInvalidateChannel, (msg.payload || {}) as CacheInvalidatePayload);
    });
    return;
  }

  // Primary: relay worker broadcasts to all other workers
  if (cluster.isPrimary) {
    if (primaryRelaying) return;
    primaryRelaying = true;
    cluster.on('message', (worker, msg: any) => {
      if (!msg || msg.type !== CHANNEL) return;
      for (const id of Object.keys(cluster.workers || {})) {
        const w = cluster.workers?.[id as any];
        if (!w || w.id === worker.id || !w.isConnected()) continue;
        try {
          w.send(msg);
        } catch {
          // Best-effort — worker may be dying
        }
      }
    });
  }
}

function applyLocal(channel: CacheInvalidateChannel, payload: CacheInvalidatePayload): void {
  const set = handlers.get(channel);
  if (!set) return;
  for (const handler of set) {
    try {
      handler(payload);
    } catch {
      // Handlers must not throw into IPC
    }
  }
}

/**
 * Register a local handler for a cache channel.
 * Returns an unsubscribe function.
 */
export function onCacheInvalidate(
  channel: CacheInvalidateChannel,
  handler: CacheHandler,
): () => void {
  ensureIpcListener();
  let set = handlers.get(channel);
  if (!set) {
    set = new Set();
    handlers.set(channel, set);
  }
  set.add(handler);
  const channelHandlers = set;
  return () => {
    channelHandlers.delete(handler);
  };
}

/**
 * Invalidate local cache AND broadcast to sibling workers when clustered.
 *
 * Call this from mutation paths (role update, API key revoke, etc.).
 * Local handlers run immediately; other workers receive via IPC.
 */
export function broadcastCacheInvalidate(
  channel: CacheInvalidateChannel,
  payload: CacheInvalidatePayload = {},
): void {
  ensureIpcListener();

  // Always apply locally first so the mutating worker is consistent.
  applyLocal(channel, payload);

  // Cross-host: best-effort Redis publish (ignored when Redis is disabled).
  try {
    const redis = getRedis();
    if (redis) {
      const envelope = JSON.stringify({ origin: cacheBusInstanceId, channel, payload, ts: Date.now() });
      redis.publish(RedisChannels.cacheInvalidate(), envelope).catch(() => { /* degraded */ });
    }
  } catch { /* degraded */ }

  const workersEnv = Number(process.env.WORKERS || 0);
  if (!workersEnv || workersEnv <= 0) {
    return; // single-process — nothing to broadcast
  }

  const message = { type: CHANNEL, channel, payload };

  if (cluster.isWorker && typeof process.send === 'function') {
    try {
      process.send(message);
    } catch {
      // Primary may be gone
    }
    return;
  }

  // If somehow called from primary with workers, fan out to all
  if (cluster.isPrimary) {
    for (const id of Object.keys(cluster.workers || {})) {
      const w = cluster.workers?.[id as any];
      if (!w || !w.isConnected()) continue;
      try {
        w.send(message);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Call once from the primary process so worker→worker relay is armed before
 * any worker mutates caches. Safe to call multiple times.
 */
export function initCacheBusPrimary(): void {
  if (!cluster.isPrimary) return;
  ensureIpcListener();
}
