/**
 * GET /api/setup/status server-side ratchet cache.
 *
 * The setup-completed flag is written exactly once per install and never
 * deleted by the panel, so the "installed" answer may be cached in-process.
 * Regression: within the cache TTL the endpoint must keep answering
 * `setupRequired: false` even when the flag row is temporarily missing (a
 * mid-restore database), because "setup required" (the only state that needs
 * a live query) is never cached.
 *
 * DB-backed: the dev database is an installed panel (flag row present).
 * The test deletes the flag row and restores it in afterAll.
 */

import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { setupRoutes } from '../routes/setup.js';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(setupRoutes, { prefix: '/api/setup' });
  return app;
}

describe('GET /api/setup/status — ratchet cache', () => {
  afterAll(async () => {
    // Restore the flag row no matter what happened above.
    await prisma.systemSetting.upsert({
      where: { id: 'setup' },
      create: { id: 'setup' },
      update: {},
    });
  });

  it('answers from the in-process cache while the flag row is missing mid-restore', async () => {
    const app = await buildTestApp();
    try {
      // Prime: the dev DB is installed, so the first request goes to the DB
      // and caches the answer.
      const first = await app.inject({ method: 'GET', url: '/api/setup/status' });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ setupRequired: false });

      // Simulate a mid-restore database: the flag row disappears after the
      // answer was cached. The cached ratchet answer must hold.
      await prisma.systemSetting.delete({ where: { id: 'setup' } }).catch(() => {});
      const cached = await app.inject({ method: 'GET', url: '/api/setup/status' });
      expect(cached.statusCode).toBe(200);
      expect(cached.json()).toEqual({ setupRequired: false });
    } finally {
      await app.close();
    }
  });

  it('re-queries after the flag row is lost with a cold cache (user-count backfill)', async () => {
    const app = await buildTestApp();
    try {
      await prisma.systemSetting.delete({ where: { id: 'setup' } }).catch(() => {});
      // Fresh app instance = cold cache: the missing flag must be answered
      // by the live user count (dev DB has users), not by a stale cache.
      const res = await app.inject({ method: 'GET', url: '/api/setup/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ setupRequired: false });
    } finally {
      await app.close();
    }
  });
});
