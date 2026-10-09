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

import { createHash, randomUUID } from 'crypto';
import { RedisChannels } from './cache-keys';
import { getRedis } from './redis';
import { broadcastCacheInvalidate as broadcastIpc, getCacheBusInstanceId, type CacheInvalidateChannel, type CacheInvalidatePayload } from './cache-bus';
import { tryAcquireLock } from './distributed-lock';

const instanceId = randomUUID();
let fanoutSubscribed = false;
const fanoutHandlers = new Set<(event: FanoutEvent & { origin: string }) => void | Promise<void>>();
const cacheHandlers = new Set<(channel: CacheInvalidateChannel, payload: CacheInvalidatePayload, origin: string) => void>();
let cacheSubscribed = false;

// A metrics stream can be opened by several workers at the same time (for
// example when a dashboard reconnects).  Keep the agent request outside the
// stream itself and coalesce it for a short window. Redis makes the window
// shared between workers; the local map is deliberately retained as the safe
// degraded-mode fallback.
const IMMEDIATE_STATS_COALESCE_MS = 2_000;
const localImmediateStats = new Map<string, Promise<boolean>>();

/**
 * Request one fresh agent snapshot per server/window.
 *
 * Redis is an optimisation only: an unavailable Redis must not prevent an
 * otherwise valid stream from asking its agent for data. A failed request is
 * still considered handled for the coalescing window so a reconnect burst
 * cannot turn an agent outage into a request storm.
 */
export async function requestImmediateStatsCoalesced(
  nodeId: string,
  serverId: string,
  request: () => Promise<boolean>,
): Promise<boolean> {
  const key = `${nodeId}:${serverId}`;
  const existing = localImmediateStats.get(key);
  if (existing) return existing;

  const flight = (async (): Promise<boolean> => {
    const acquisition = await tryAcquireLock(`metrics-immediate:${key}`, IMMEDIATE_STATS_COALESCE_MS);
    if (acquisition.status === 'held') return true;

    // When Redis is unavailable, this process-local flight is the fallback.
    // When it is available, the lock winner performs the actual request.
    try {
      return await request();
    } catch {
      return false;
    }
  })();
  localImmediateStats.set(key, flight);
  void flight.finally(() => {
    setTimeout(() => {
      if (localImmediateStats.get(key) === flight) localImmediateStats.delete(key);
    }, IMMEDIATE_STATS_COALESCE_MS).unref?.();
  }).catch(() => { /* the returned flight carries the result */ });
  return flight;
}

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

// Dropped-publish observability: a silent .catch() here hid sustained
// cross-instance fan-out loss. Count every failure and warn throttled
// (first failure, every 100th, and at most 1/min in between).
let fanoutPublishFailures = 0;
let lastFanoutFailureWarnAt = 0;

/** Total fan-out publishes dropped since process start (Redis publish failures). */
export function getFanoutPublishFailures(): number {
  return fanoutPublishFailures;
}

function recordFanoutPublishFailure(eventType: string, err: unknown): void {
  fanoutPublishFailures += 1;
  const now = Date.now();
  const every100th = fanoutPublishFailures % 100 === 0;
  const oncePerMin = now - lastFanoutFailureWarnAt >= 60_000;
  // First failure, every 100th (rate-limited to 1/s), or at most 1/min otherwise.
  if (fanoutPublishFailures !== 1 && !(every100th && now - lastFanoutFailureWarnAt >= 1_000) && !oncePerMin) {
    return;
  }
  lastFanoutFailureWarnAt = now;
  const reason = err instanceof Error ? err.message : String(err);
  console.warn(
    `[event-bus] fan-out publish failed (${fanoutPublishFailures} dropped total, last eventType=${eventType}): ${reason}`,
  );
}

export function publishFanout(event: FanoutEvent): void {
  const redis = getRedis();
  if (!redis) return;
  const envelope = JSON.stringify({ ...event, origin: instanceId, ts: Date.now() });
  const publish = async (): Promise<void> => {
    // resource_stats is already delivered to this worker's subscribers. Use a
    // content-addressed short lock so duplicate serialized samples published
    // by multiple workers only consume one cross-instance fan-out message.
    if (event.eventType === 'resource_stats') {
      const digest = createHash('sha256').update(JSON.stringify(event.payload)).digest('hex');
      const acquisition = await tryAcquireLock(`metrics-fanout:${event.serverId ?? 'unknown'}:${digest}`, 2_000, 0, redis);
      if (acquisition.status === 'held') return;
    }
    await redis.publish(RedisChannels.fanout(), envelope);
  };
  publish().catch((err) => {
    recordFanoutPublishFailure(event.eventType, err);
  });
}

// ── Fan-out subscriber recovery ─────────────────────────────────────────────
// The Redis subscriber socket resubscribes after a reconnect, but messages
// published while it was down are lost (pub/sub has no replay). Consumers
// register here to tell local SSE subscribers to resync their state.
const fanoutResubscribedHandlers = new Set<() => void>();

/** Register a callback invoked after the fan-out subscriber socket successfully resubscribes. */
export function onFanoutResubscribed(handler: () => void): () => void {
  fanoutResubscribedHandlers.add(handler);
  return () => {
    fanoutResubscribedHandlers.delete(handler);
  };
}

function notifyFanoutResubscribed(): void {
  for (const fn of fanoutResubscribedHandlers) {
    try { fn(); } catch { /* handler must not throw into the redis client */ }
  }
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
    // Recovery hook: fan-out events published during a subscriber disconnect
    // are lost — let the gateway ask local SSE clients to resync.
    redis.subscriberRecoverySink = notifyFanoutResubscribed;
  } catch {
    fanoutSubscribed = false;
  }
}

// ── Agent command relay ─────────────────────────────────────────────────────
// An agent WebSocket lives in exactly one backend process. Without a relay,
// a control command (start/stop/console input) landing on a sibling instance
// is queued in that instance's local outbox and silently expires.
//
// Delivery uses an acknowledge handshake so the caller never claims success
// without a socket owner actually receiving the command:
//   publisher → toAgent {relayId, nodeId, message} → socket owner delivers
//   socket owner → toAgentReply {relayId} → publisher resolves
// The PUBLISH receiver count distinguishes "no sibling subscribed" (count 1
// = this instance only) from "a sibling exists" (count ≥ 2): in the former
// case the caller falls back to its local outbox immediately, preserving
// single-instance replay-on-reconnect semantics.

export type AgentCommandEnvelope = {
  origin: string;
  nodeId: string;
  relayId: string;
  message: unknown;
};

const AGENT_COMMAND_ACK_WAIT_MS = 250;

const agentCommandHandlers = new Set<(nodeId: string, relayId: string, message: unknown) => void>();
const pendingAgentCommandAcks = new Map<string, () => void>();
let agentCommandsSubscribed = false;

export type AgentCommandRelayResult = 'delivered' | 'no-subscribers' | 'timeout';

/**
 * Publish an agent command for delivery by the instance that owns the socket.
 * Resolves 'delivered' only when some instance acknowledged local delivery.
 */
export async function publishAgentCommand(nodeId: string, message: unknown): Promise<AgentCommandRelayResult> {
  const redis = getRedis();
  if (!redis) return 'no-subscribers';
  try {
    const relayId = randomUUID();
    const envelope = JSON.stringify({
      origin: instanceId,
      nodeId,
      relayId,
      message,
    } satisfies AgentCommandEnvelope);
    const receivers = await redis.publish(RedisChannels.toAgent(), envelope);
    if (receivers <= 1) {
      // Only this instance is subscribed (or Redis has no subscribers at
      // all) — no sibling can own the socket.
      return 'no-subscribers';
    }
    return await new Promise<AgentCommandRelayResult>((resolve) => {
      const timer = setTimeout(() => {
        pendingAgentCommandAcks.delete(relayId);
        resolve('timeout');
      }, AGENT_COMMAND_ACK_WAIT_MS);
      pendingAgentCommandAcks.set(relayId, () => {
        clearTimeout(timer);
        resolve('delivered');
      });
    });
  } catch {
    return 'no-subscribers';
  }
}

/** Register to receive agent commands published by sibling instances. */
export async function subscribeAgentCommand(
  deliver: (nodeId: string, relayId: string, message: unknown) => void,
): Promise<void> {
  agentCommandHandlers.add(deliver);
  if (agentCommandsSubscribed) return;
  const redis = getRedis();
  if (!redis) return;
  agentCommandsSubscribed = true;
  try {
    await redis.subscribe(RedisChannels.toAgent(), (raw) => {
      try {
        const parsed = JSON.parse(raw) as AgentCommandEnvelope;
        if (!parsed || typeof parsed.nodeId !== 'string' || parsed.origin === instanceId) return;
        for (const fn of agentCommandHandlers) {
          try { fn(parsed.nodeId, parsed.relayId, parsed.message); } catch { /* ignore */ }
        }
      } catch { /* malformed remote message */ }
    });
    await redis.subscribe(RedisChannels.toAgentReply(), (raw) => {
      try {
        const parsed = JSON.parse(raw) as { relayId?: string };
        if (!parsed?.relayId) return;
        const ack = pendingAgentCommandAcks.get(parsed.relayId);
        if (ack) {
          pendingAgentCommandAcks.delete(parsed.relayId);
          ack();
        }
      } catch { /* malformed remote message */ }
    });
  } catch {
    agentCommandsSubscribed = false;
  }
}

/** Acknowledge a relayed command after successful local delivery. */
export function acknowledgeAgentCommand(relayId: string): void {
  const redis = getRedis();
  if (!redis) return;
  redis
    .publish(RedisChannels.toAgentReply(), JSON.stringify({ relayId, origin: instanceId }))
    .catch(() => { /* best-effort */ });
}
