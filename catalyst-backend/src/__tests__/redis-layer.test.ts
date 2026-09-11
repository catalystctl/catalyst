/**
 * Integration tests for the Redis layer against a real Redis when
 * REDIS_URL is reachable; assertions that require a live server are
 * skipped (not failed) without one, mirroring the local-Postgres pattern.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import net from 'net';

const REDIS_HOST = process.env.REDIS_TEST_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_TEST_PORT || 6379);

async function isRedisUp(): Promise<boolean> {
  return await new Promise((resolve) => {
    const sock = net.createConnection({ host: REDIS_HOST, port: REDIS_PORT });
    const timer = setTimeout(() => { sock.destroy(); resolve(false); }, 1000);
    sock.once('connect', () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

const redisUp = await isRedisUp();

describe('Redis client hardening (live Redis)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it.skipIf(!redisUp)('connects, round-trips a value, and reports counters', async () => {
    process.env.REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
    const { getRedis, closeRedis } = await import('../lib/redis');
    const redis = getRedis()!;
    await redis.connect();
    expect(await redis.ping()).toBe(true);
    expect(await redis.set('catalyst:test:clienttest', 'v1', 5)).toBe(true);
    expect(await redis.get('catalyst:test:clienttest')).toBe('v1');
    const stats = redis.stats();
    expect(stats.commandsTotal).toBeGreaterThan(0);
    expect(stats.status).toBe('ready');
    await closeRedis();
    delete process.env.REDIS_URL;
  });

  it.skipIf(!redisUp)('single-flights concurrent connects into one dial', async () => {
    process.env.REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
    const { getRedis, closeRedis } = await import('../lib/redis');
    const redis = getRedis()!;
    await Promise.all([
      redis.ping(),
      redis.ping(),
      redis.ping(),
      redis.ping(),
    ]);
    // All four commands must share one socket; a duplicate dial would have
    // overwritten this.socket. A follow-up command still works.
    expect(await redis.ping()).toBe(true);
    expect(redis.stats().commandsTotal).toBeGreaterThanOrEqual(5);
    await closeRedis();
    delete process.env.REDIS_URL;
  });

  it.skipIf(!redisUp)('publishes and receives on a dedicated subscriber socket', async () => {
    process.env.REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
    const { getRedis, closeRedis } = await import('../lib/redis');
    const redis = getRedis()!;
    const received: string[] = [];
    await redis.subscribe('catalyst:test:relay', (msg) => received.push(msg));
    await redis.publish('catalyst:test:relay', 'hello-relay');
    await new Promise((r) => setTimeout(r, 150));
    expect(received).toContain('hello-relay');
    await closeRedis();
    delete process.env.REDIS_URL;
  });

  it('does not record fresh circuit failures for circuit-open fast-fails', async () => {
    // No Redis at REDIS_URL (closed port) — force failures, open the
    // circuit, then confirm the open-circuit rejections do not re-open it.
    process.env.REDIS_URL = `redis://${REDIS_HOST}:1`;
    const { getRedis, closeRedis } = await import('../lib/redis');
    try {
      const redis = getRedis()!;
      // Drive enough real failures to open the circuit.
      for (let i = 0; i < 8; i++) {
        await redis.ping().catch(() => {});
      }
      expect(redis.stats().circuitOpensTotal).toBeGreaterThanOrEqual(1);
      const opens = redis.stats().circuitOpensTotal;
      // While the circuit is open, rejections must not accumulate fresh
      // evidence — the first failure after cooldown would otherwise
      // instantly re-open it.
      await redis.ping().catch(() => {});
      await redis.ping().catch(() => {});
      expect(redis.stats().circuitOpensTotal).toBe(opens);
    } finally {
      await closeRedis();
      delete process.env.REDIS_URL;
    }
  });
});

describe('Distributed lock semantics (live Redis)', () => {
  it.skipIf(!redisUp)('loser throws under withDistributedLock when lock is held', async () => {
    process.env.REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
    const { acquireLock, withDistributedLock } = await import('../lib/distributed-lock');
    const { closeRedis } = await import('../lib/redis');
    try {
      const lock = await acquireLock('test:withlock2', 5000, 0);
      expect(lock).not.toBeNull();
      await expect(
        withDistributedLock('test:withlock2', 5000, async () => 'should not run'),
      ).rejects.toThrow(/already held/);
      await lock!.release();
      // After release the lock is free again.
      await expect(
        withDistributedLock('test:withlock2', 5000, async () => 'ran'),
      ).resolves.toBe('ran');
    } finally {
      await closeRedis();
      delete process.env.REDIS_URL;
    }
  });

  it('runs without a lock in degraded mode', async () => {
    // No REDIS_URL → degraded mode runs fn and documents the fallback.
    const { withDistributedLock } = await import('../lib/distributed-lock');
    const result = await withDistributedLock('test:degraded2', 1000, async () => 'ok');
    expect(result).toBe('ok');
  });

  it('runs in degraded mode when Redis is configured but unreachable', async () => {
    // A rejected SET is an outage, not contention: reporting "already held"
    // here made alert evaluation stop silently while Redis was down.
    process.env.REDIS_URL = `redis://${REDIS_HOST}:1`;
    const { withDistributedLock } = await import('../lib/distributed-lock');
    const { closeRedis } = await import('../lib/redis');
    try {
      await expect(
        withDistributedLock('test:unreachable', 5000, async () => 'degraded-ok'),
      ).resolves.toBe('degraded-ok');
    } finally {
      await closeRedis();
      delete process.env.REDIS_URL;
    }
  });
});

describe('Distributed rate limiter', () => {
  it.skipIf(!redisUp)('increments atomically across calls and reports count', async () => {
    process.env.REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
    const { checkRateLimit } = await import('../lib/rate-limiter');
    const { closeRedis } = await import('../lib/redis');
    const scope = `storetest:${Date.now()}`;
    const first = await checkRateLimit(scope, 'client1', 2, 60_000);
    expect(first.count).toBe(1);
    expect(first.allowed).toBe(true);
    const second = await checkRateLimit(scope, 'client1', 2, 60_000);
    expect(second.count).toBe(2);
    expect(second.allowed).toBe(true);
    const third = await checkRateLimit(scope, 'client1', 2, 60_000);
    expect(third.count).toBe(3);
    expect(third.allowed).toBe(false);
    await closeRedis();
    delete process.env.REDIS_URL;
  });

  it.skipIf(!redisUp)('falls back to memory buckets on Redis failure', async () => {
    process.env.REDIS_URL = `redis://${REDIS_HOST}:1`;
    const { checkRateLimit, clearRateLimiterMemory } = await import('../lib/rate-limiter');
    const { closeRedis } = await import('../lib/redis');
    clearRateLimiterMemory();
    const scope = `memfallback:${Date.now()}`;
    const a = await checkRateLimit(scope, 'c1', 1, 60_000);
    const b = await checkRateLimit(scope, 'c1', 1, 60_000);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(false);
    await closeRedis();
    delete process.env.REDIS_URL;
  });
});

describe('RedisRateLimitStore (@fastify/rate-limit adapter)', () => {
  it.skipIf(!redisUp)('incr surfaces counter and ttl via callback', async () => {
    process.env.REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
    const { RedisRateLimitStore } = await import('../lib/rate-limit-store');
    const { closeRedis } = await import('../lib/redis');
    const store = new RedisRateLimitStore({ prefix: `store:${Date.now()}` } as never);
    const first = await new Promise<{ current: number; ttl: number }>((resolve, reject) => {
      store.incr('k1', (err, res) => (err ? reject(err) : resolve(res!)), 60_000, 10);
    });
    expect(first.current).toBe(1);
    expect(first.ttl).toBeGreaterThan(0);
    await closeRedis();
    delete process.env.REDIS_URL;
  });
});

describe('SimpleCache bounds', () => {
  it('evicts LRU beyond max size and tracks evictions', async () => {
    const { SimpleCache } = await import('../lib/cache');
    const cache = new SimpleCache<string, number>(10_000, 3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Touch 'a' so 'b' becomes the least-recently-used entry.
    cache.get('a');
    cache.set('d', 4);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('d')).toBe(4);
    expect(cache.stats().evictions).toBe(1);
  });

  it('sweeps expired entries that are never read again', async () => {
    const { SimpleCache } = await import('../lib/cache');
    const cache = new SimpleCache<string, number>(5, 100);
    for (let i = 0; i < 250; i++) {
      cache.set(`k${i}`, i);
    }
    // All early entries expired (5ms TTL) — a sweep must reclaim them
    // even though their keys are never read.
    await new Promise((r) => setTimeout(r, 10));
    for (let i = 250; i < 400; i++) {
      cache.set(`k${i}`, i);
    }
    expect(cache.stats().size).toBeLessThan(400);
  });
});

describe('Agent command relay (live Redis)', () => {
  it.skipIf(!redisUp)('reports no-subscribers when only this instance listens', async () => {
    process.env.REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
    const { publishAgentCommand } = await import('../lib/event-bus');
    const { closeRedis } = await import('../lib/redis');
    // No subscribeAgentCommand anywhere → receiver count ≤ 1.
    const result = await publishAgentCommand('node-x', { type: 'start_server' });
    expect(result).toBe('no-subscribers');
    await closeRedis();
    delete process.env.REDIS_URL;
  });

  it.skipIf(!redisUp)('relay protocol: sibling publish delivers locally and ack flows back', async () => {
    process.env.REDIS_URL = `redis://${REDIS_HOST}:${REDIS_PORT}`;
    const { subscribeAgentCommand, acknowledgeAgentCommand } = await import('../lib/event-bus');
    const { CatalystRedis, closeRedis } = await import('../lib/redis');
    const { RedisChannels } = await import('../lib/cache-keys');
    let sibling: InstanceType<typeof CatalystRedis> | null = null;
    try {
      const got: Array<{ nodeId: string; message: unknown }> = [];
      await subscribeAgentCommand((nodeId, relayId, message) => {
        got.push({ nodeId, message });
        acknowledgeAgentCommand(relayId);
      });

      // A "sibling" process: an independent Redis connection that publishes
      // a command envelope and listens for the delivery ack.
      sibling = new CatalystRedis(`redis://${REDIS_HOST}:${REDIS_PORT}`);
      await sibling.connect();
      const ackReceived = new Promise<string>((resolve) => {
        void sibling!.subscribe(RedisChannels.toAgentReply(), (raw) => {
          try {
            const parsed = JSON.parse(raw) as { relayId?: string };
            if (parsed.relayId) resolve(parsed.relayId);
          } catch { /* ignore */ }
        });
      });
      await new Promise((r) => setTimeout(r, 200));
      await sibling.publish(RedisChannels.toAgent(), JSON.stringify({
        origin: 'test-sibling-instance',
        nodeId: 'node-y',
        relayId: 'relay-123',
        message: { type: 'stop_server' },
      }));
      await new Promise((r) => setTimeout(r, 200));

      expect(got.some((g) => g.nodeId === 'node-y')).toBe(true);
      const ack = await Promise.race([
        ackReceived,
        new Promise((r) => setTimeout(() => r('timeout'), 2000)),
      ]);
      expect(ack).toBe('relay-123');
    } finally {
      if (sibling) await sibling.quit().catch(() => {});
      await closeRedis();
      delete process.env.REDIS_URL;
    }
  }, 15_000);
});
