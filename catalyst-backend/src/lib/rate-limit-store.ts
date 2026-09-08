/**
 * Redis-backed store for @fastify/rate-limit.
 *
 * The default store is process-local: with WORKERS > 1 or multiple backend
 * hosts, every instance enforces its own budget (N× the configured limit).
 * This store makes the counters shared via the atomic Lua INCR+PEXPIRE in
 * lib/rate-limiter.ts. When Redis is unavailable, checkRateLimit falls back
 * to per-process memory, so the panel degrades to the previous behavior
 * instead of failing.
 */

import type { RouteOptions } from 'fastify';
import type { FastifyRateLimitOptions } from '@fastify/rate-limit';
import { checkRateLimit } from './rate-limiter';

type IncrResult = { current: number; ttl: number };

type RouteShape = { url?: string; method?: string; path?: string; prefix?: string };

export class RedisRateLimitStore {
  private prefix: string;

  constructor(options: FastifyRateLimitOptions & { routeOptions?: RouteShape; prefix?: string }) {
    // Namespace keys by route path so identical client keys cannot collide
    // across routes with different max/timeWindow settings.
    const url = options.routeOptions?.url ?? options.routeOptions?.path ?? 'global';
    const method = options.routeOptions?.method ?? '';
    this.prefix = options.prefix ?? `${method}:${url}`;
  }

  incr(
    key: string,
    callback: (error: Error | null, result?: IncrResult) => void,
    timeWindow: number,
    max: number,
  ): void {
    const scope = this.prefix;
    checkRateLimit(scope, key, max, timeWindow)
      .then((decision) => {
        callback(null, { current: decision.count, ttl: decision.resetMs });
      })
      .catch((err: Error) => {
        callback(err);
      });
  }

  child(routeOptions: RouteOptions & { path?: string; prefix?: string }): RedisRateLimitStore {
    return new RedisRateLimitStore({
      prefix: `${routeOptions.method ?? ''}:${routeOptions.url ?? routeOptions.path ?? 'global'}`,
    });
  }
}
