import { describe, it, expect, beforeEach } from 'vitest';

describe('Redis key strategy', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('namespaces keys per environment to avoid collisions', async () => {
    const { RedisKeys, RedisChannels } = await import('../lib/cache-keys');
    expect(RedisKeys.config('security')).toBe('catalyst:test:config:security');
    expect(RedisKeys.lock('background:alert')).toBe('catalyst:test:lock:background_alert');
    expect(RedisChannels.fanout()).toBe('catalyst:test:pubsub:fanout');
    expect(RedisChannels.cacheInvalidate()).toBe('catalyst:test:pubsub:cache-invalidate');
  });

  it('sanitizes user-controlled key parts', async () => {
    const { safeKeyPart, cacheKey } = await import('../lib/cache-keys');
    expect(safeKeyPart('user:123 *')).toBe('user_123_');
    expect(safeKeyPart('')).toBe('unknown');
    expect(cacheKey('cache', 'perms:user:1')).not.toContain(' ');
  });

  it('adds jitter within bounds', async () => {
    const { ttlWithJitter } = await import('../lib/cache-keys');
    for (let i = 0; i < 50; i++) {
      const v = ttlWithJitter(100, 0.15);
      expect(v).toBeGreaterThanOrEqual(85);
      expect(v).toBeLessThanOrEqual(115);
    }
  });
});

describe('Redis client degraded mode', () => {
  it('returns null client and fallback when REDIS_URL is missing', async () => {
    const prev = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      const { getRedis, isRedisConfigured, withRedisFallback, getRedisStats } = await import('../lib/redis');
      expect(isRedisConfigured()).toBe(false);
      expect(getRedis()).toBeNull();
      expect(await withRedisFallback(async () => 'remote', 'fallback')).toBe('fallback');
      expect(getRedisStats().configured).toBe(false);
    } finally {
      if (prev !== undefined) process.env.REDIS_URL = prev;
    }
  });

  it('respects REDIS_ENABLED=false', async () => {
    const prevUrl = process.env.REDIS_URL;
    const prevEnabled = process.env.REDIS_ENABLED;
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.REDIS_ENABLED = 'false';
    try {
      const { getRedis, isRedisConfigured } = await import('../lib/redis');
      expect(isRedisConfigured()).toBe(false);
      expect(getRedis()).toBeNull();
    } finally {
      if (prevUrl !== undefined) process.env.REDIS_URL = prevUrl;
      else delete process.env.REDIS_URL;
      if (prevEnabled !== undefined) process.env.REDIS_ENABLED = prevEnabled;
      else delete process.env.REDIS_ENABLED;
    }
  });
});

describe('Distributed lock safety', () => {
  it('releases only with the owning token (Lua compare-and-delete)', async () => {
    const { acquireLock } = await import('../lib/distributed-lock');
    const store = new Map<string, string>();
    const fakeRedis: any = {
      set: async (key: string, value: string, _ttl: number, nx: boolean) => {
        if (nx && store.has(key)) return false;
        store.set(key, value);
        return true;
      },
      evalSha: async (_script: string, keys: string[], args: Array<string | number>) => {
        const [key] = keys;
        const [token] = args as string[];
        if (store.get(key) === token) {
          store.delete(key);
          return 1;
        }
        return 0;
      },
    };
    const first = await acquireLock('test:resource', 5000, 0, fakeRedis);
    expect(first).not.toBeNull();
    const second = await acquireLock('test:resource', 5000, 0, fakeRedis);
    expect(second).toBeNull();
    // Wrong token must not release
    const stolen = await fakeRedis.evalSha('lua', [first!.key], ['not-the-owner']);
    expect(stolen).toBe(0);
    expect(await first!.release()).toBe(true);
    const third = await acquireLock('test:resource', 5000, 0, fakeRedis);
    expect(third).not.toBeNull();
    await third!.release();
  });

  it('returns null immediately when Redis is unavailable', async () => {
    const { acquireLock } = await import('../lib/distributed-lock');
    expect(await acquireLock('test:down', 1000, 0, null)).toBeNull();
  });
});

describe('Rate limiter', () => {
  it('enforces fixed window with memory fallback', async () => {
    const { checkRateLimit, clearRateLimiterMemory } = await import('../lib/rate-limiter');
    clearRateLimiterMemory();
    const first = await checkRateLimit('test-scope', 'user-1', 2, 60_000, null);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    const second = await checkRateLimit('test-scope', 'user-1', 2, 60_000, null);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    const third = await checkRateLimit('test-scope', 'user-1', 2, 60_000, null);
    expect(third.allowed).toBe(false);
    expect(third.limited).toBe(true);
  });

  it('uses atomic Lua consume when Redis is available', async () => {
    const { checkRateLimit } = await import('../lib/rate-limiter');
    let count = 0;
    const fakeRedis: any = {
      evalSha: async () => {
        count += 1;
        return [count, 60_000];
      },
    };
    const a = await checkRateLimit('scope', 'id', 1, 60_000, fakeRedis);
    expect(a.allowed).toBe(true);
    const b = await checkRateLimit('scope', 'id', 1, 60_000, fakeRedis);
    expect(b.allowed).toBe(false);
    expect(b.limited).toBe(true);
  });
});

describe('Idempotency store', () => {
  it('first claim wins, replay returns stored result', async () => {
    const { claimIdempotency, completeIdempotency, getIdempotency, clearIdempotencyMemory } =
      await import('../lib/idempotency');
    clearIdempotencyMemory();
    expect(await claimIdempotency('migration', 'abc123', 60, null)).toBe(true);
    expect(await claimIdempotency('migration', 'abc123', 60, null)).toBe(false);
    await completeIdempotency('migration', 'abc123', JSON.stringify({ jobId: 'j1' }), 60, null);
    expect(await getIdempotency('migration', 'abc123', null)).toBe(JSON.stringify({ jobId: 'j1' }));
  });

  it('fingerprints are stable and scoped', async () => {
    const { fingerprintRequest } = await import('../lib/idempotency');
    expect(fingerprintRequest(['a', 1])).toBe(fingerprintRequest(['a', 1]));
    expect(fingerprintRequest(['a', 1])).not.toBe(fingerprintRequest(['a', 2]));
  });
});

describe('RBAC fast path (no N+1)', () => {
  it('hasAny/hasAll resolve with a single role fetch', async () => {
    const { hasAnyPermission, hasAllPermissions, hasPermission } = await import('../lib/permissions');
    let fetchCount = 0;
    const fakePrisma: any = {
      role: {
        findMany: async () => {
          fetchCount += 1;
          return [{ permissions: ['server.read', 'node.read:node_1'] }];
        },
      },
    };
    expect(await hasPermission(fakePrisma, 'u1', 'server.read')).toBe(true);
    expect(await hasAnyPermission(fakePrisma, 'u1', ['server.delete', 'node.read'], 'node_1')).toBe(true);
    expect(await hasAllPermissions(fakePrisma, 'u1', ['server.read', 'node.read'], 'node_1')).toBe(true);
    expect(await hasAllPermissions(fakePrisma, 'u1', ['server.read', 'server.delete'])).toBe(false);
    // One fetch per call (not one per permission checked)
    expect(fetchCount).toBe(4);
  });

  it('pre-resolved permissions avoid DB entirely', async () => {
    const { hasPermission } = await import('../lib/permissions');
    const failingPrisma: any = {
      role: {
        findMany: async () => {
          throw new Error('should not query');
        },
      },
    };
    expect(await hasPermission(failingPrisma, 'u1', 'server.read', undefined, ['server.read'])).toBe(true);
    expect(await hasPermission(failingPrisma, 'u1', 'server.delete', undefined, ['server.read'])).toBe(false);
  });
});

describe('Config cache invalidation', () => {
  it('returns cached value and invalidates on mutation', async () => {
    const prevEnabled = process.env.REDIS_ENABLED;
    process.env.REDIS_ENABLED = 'false';
    try {
      const { cachedConfig, invalidateConfig, clearConfigCacheMemory } = await import('../lib/config-cache');
      clearConfigCacheMemory();
      let fetches = 0;
      const fetcher = async () => {
        fetches += 1;
        return { value: fetches };
      };
      const first = await cachedConfig('security', fetcher);
      const second = await cachedConfig('security', fetcher);
      expect(first).toEqual({ value: 1 });
      expect(second).toEqual({ value: 1 });
      expect(fetches).toBe(1);
      await invalidateConfig('security');
      const third = await cachedConfig('security', fetcher);
      expect(third).toEqual({ value: 2 });
    } finally {
      if (prevEnabled !== undefined) process.env.REDIS_ENABLED = prevEnabled;
      else delete process.env.REDIS_ENABLED;
    }
  });

  it('falls back to the database fetcher when Redis is disabled', async () => {
    const prevEnabled = process.env.REDIS_ENABLED;
    process.env.REDIS_ENABLED = 'false';
    try {
      const { cachedConfig, clearConfigCacheMemory } = await import('../lib/config-cache');
      const { getRedis } = await import('../lib/redis');
      clearConfigCacheMemory();
      expect(getRedis()).toBeNull();
      const value = await cachedConfig('smtp', async () => ({ host: 'mail.example' }));
      expect(value).toEqual({ host: 'mail.example' });
    } finally {
      if (prevEnabled !== undefined) process.env.REDIS_ENABLED = prevEnabled;
      else delete process.env.REDIS_ENABLED;
    }
  });
});

describe('Subscriber handshake (single-consumer)', () => {
  it('routes subscribe acks to waiters and messages to handlers exactly once', async () => {
    const { CatalystRedis } = await import('../lib/redis');
    const client = new CatalystRedis('redis://localhost:6379');
    const seen: string[] = [];
    (client as any).subAckWaiters = [];
    const timer = setTimeout(() => {}, 1000);
    let resolved = false;
    (client as any).subAckWaiters.push({
      command: 'SUBSCRIBE',
      channel: 'chan',
      resolve: () => { resolved = true; },
      reject: () => { throw new Error('should not reject'); },
      timer,
    });
    (client as any).handlePush(['subscribe', 'chan', 1]);
    expect(resolved).toBe(true);
    expect((client as any).subAckWaiters).toHaveLength(0);
    clearTimeout(timer);
    // +OK (AUTH/SELECT reply) resolves the oldest waiter.
    const timer2 = setTimeout(() => {}, 1000);
    let okResolved: unknown = null;
    (client as any).subAckWaiters.push({
      command: 'AUTH',
      channel: 'secret',
      resolve: (v: unknown) => { okResolved = v; },
      reject: () => { throw new Error('should not reject'); },
      timer: timer2,
    });
    (client as any).handlePush('OK');
    expect(okResolved).toBe('OK');
    clearTimeout(timer2);
    // Message kinds route to handlers.
    (client as any).subHandlers.set('chan', new Set([(m: string) => seen.push(m)]));
    (client as any).handlePush(['message', 'chan', 'hello']);
    expect(seen).toEqual(['hello']);
  });
});

describe('Idempotency completion safety', () => {
  it('never overwrites a stored winner result', async () => {
    const { claimIdempotency, completeIdempotency, getIdempotency, clearIdempotencyMemory } =
      await import('../lib/idempotency');
    clearIdempotencyMemory();
    expect(await claimIdempotency('scope', 'k1', 60, null)).toBe(true);
    await completeIdempotency('scope', 'k1', JSON.stringify({ winner: 1 }), 60, null);
    // Loser attempting to complete the same key must not clobber the winner.
    await completeIdempotency('scope', 'k1', JSON.stringify({ loser: 1 }), 60, null);
    expect(await getIdempotency('scope', 'k1', null)).toBe(JSON.stringify({ winner: 1 }));
  });

  it('completes via Lua compare-and-set on Redis (only sentinel is replaced)', async () => {
    const { completeIdempotency } = await import('../lib/idempotency');
    const calls: Array<{ script: string; keys: string[]; args: Array<string | number> }> = [];
    const fakeRedis: any = {
      evalSha: async (script: string, keys: string[], args: Array<string | number>) => {
        calls.push({ script, keys, args });
        return 1;
      },
    };
    await completeIdempotency('scope', 'k2', '{"ok":true}', 60, fakeRedis);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe('claimed');
    expect(calls[0].args[1]).toBe('{"ok":true}');
  });
});

describe('Config cache observability', () => {
  it('counts L1 hits, misses, and serialization failures', async () => {
    const prevEnabled = process.env.REDIS_ENABLED;
    process.env.REDIS_ENABLED = 'false';
    try {
      const { cachedConfig, clearConfigCacheMemory, getConfigCacheStats } = await import('../lib/config-cache');
      clearConfigCacheMemory();
      const before = getConfigCacheStats();
      let fetches = 0;
      const fetcher = async () => ({ n: ++fetches });
      await cachedConfig('security', fetcher);
      await cachedConfig('security', fetcher);
      const after = getConfigCacheStats();
      expect(after.misses).toBe(before.misses + 1);
      expect(after.l1Hits).toBe(before.l1Hits + 1);
      expect(after.serializationFailures).toBe(before.serializationFailures);
    } finally {
      if (prevEnabled !== undefined) process.env.REDIS_ENABLED = prevEnabled;
      else delete process.env.REDIS_ENABLED;
    }
  });
});
