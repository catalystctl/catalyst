/**
 * Redis key namespace + TTL strategy.
 *
 * All Redis keys use `catalyst:{env}:...` so dev/test/prod never collide
 * when they share a Redis instance. User-controlled values are sanitized
 * to prevent cross-tenant collisions or key injection (`*`, spaces, `:`).
 */

export type RedisEnv = 'production' | 'test' | 'development';

export function redisEnv(): RedisEnv {
  const raw = (process.env.NODE_ENV || 'development').toLowerCase();
  if (raw === 'production') return 'production';
  if (raw === 'test') return 'test';
  return 'development';
}

function prefix(): string {
  return `catalyst:${redisEnv()}`;
}

/** Strip characters that would break key structure or enable glob collisions. */
// eslint-disable-next-line no-control-regex
const UNSAFE_KEY_CHARS = /[\s:*?[\]\0-\x1f\x7f]+/g;

export function safeKeyPart(value: string): string {
  const cleaned = String(value ?? '').trim().replace(UNSAFE_KEY_CHARS, '_').slice(0, 128);
  return cleaned || 'unknown';
}

export function cacheKey(...parts: string[]): string {
  return [prefix(), ...parts.map(safeKeyPart)].join(':');
}

export const RedisKeys = {
  config: (kind: 'security' | 'smtp' | 'mod_manager' | 'theme_default' | 'localization'): string =>
    cacheKey('config', kind),
  templateList: (hash: string): string => cacheKey('cache', 'templates', `list_${safeKeyPart(hash)}`),
  template: (id: string): string => cacheKey('cache', 'template', id),
  userPerms: (userId: string): string => cacheKey('cache', 'perms', `user_${safeKeyPart(userId)}`),
  serverPerms: (userId: string, serverId: string): string =>
    cacheKey('cache', 'perms', `server_${safeKeyPart(userId)}_${safeKeyPart(serverId)}`),
  apiKeyMeta: (hash16: string): string => cacheKey('cache', 'apikey', hash16),
  negativeApiKey: (hash16: string): string => cacheKey('cache', 'apikey_miss', hash16),
  rateLimit: (scope: string, id: string, windowId: string): string =>
    cacheKey('ratelimit', safeKeyPart(scope), safeKeyPart(id), safeKeyPart(windowId)),
  loginIp: (ip: string): string => cacheKey('ratelimit', 'login_ip', ip),
  lock: (name: string): string => cacheKey('lock', name),
  idempotency: (scope: string, keyHash: string): string =>
    cacheKey('idempotency', safeKeyPart(scope), safeKeyPart(keyHash)),
  presence: (nodeId: string): string => cacheKey('presence', `node_${safeKeyPart(nodeId)}`),
  outbox: (nodeId: string): string => cacheKey('job', `outbox_${safeKeyPart(nodeId)}`),
} as const;

export const RedisChannels = {
  fanout: (): string => cacheKey('pubsub', 'fanout'),
  toAgent: (): string => cacheKey('pubsub', 'to-agent'),
  toAgentReply: (): string => cacheKey('pubsub', 'to-agent-reply'),
  presence: (): string => cacheKey('pubsub', 'presence'),
  cacheInvalidate: (): string => cacheKey('pubsub', 'cache-invalidate'),
} as const;

/** Deliberate TTLs. Every ephemeral key must have one. */
export const RedisTTL = {
  veryHotSec: 15,
  moderateSec: 120,
  stableSec: 1800,
  apiKeyMetaSec: 45,
  apiKeyMissSec: 8,
  userAuthzSec: 20,
  templateListSec: 60,
  templateSingleSec: 60,
  configSec: 45,
  dashboardSec: 10,
  idempotencySec: 24 * 3600,
  lockSec: 15,
  presenceSec: 45,
  outboxSec: 30,
} as const;

/** Add ±jitter to a TTL so synchronized expirations do not stampede. */
export function ttlWithJitter(ttlSec: number, ratio = 0.15): number {
  if (!Number.isFinite(ttlSec) || ttlSec <= 0) return ttlSec;
  const delta = ttlSec * ratio * (Math.random() * 2 - 1);
  return Math.max(1, Math.round(ttlSec + delta));
}
