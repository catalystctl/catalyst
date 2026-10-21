/**
 * The setup wizard must never silently re-theme an installed panel.
 *
 * Regression: when the setup flag row is missing on an installed panel
 * (interrupted upgrade / restore), the wizard re-arms. Completing setup
 * upserts ThemeSettings with wizard defaults, which has visibly reset
 * admins' custom themes (ocean → bronze). The backfill path now raises a
 * warn-level SystemError so the event is discoverable in the admin UI.
 *
 * DB-backed: the dev database is an installed panel (flag row present).
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

describe('GET /api/setup/status — wizard re-arm is loud', () => {
  afterAll(async () => {
    // Restore the flag row no matter what happened above.
    await prisma.systemSetting.upsert({
      where: { id: 'setup' },
      create: { id: 'setup' },
      update: {},
    });
  });

  it('raises a warn system error when backfilling on a cold cache', async () => {
    const app = await buildTestApp();
    const before = await prisma.systemError.count({ where: { component: 'Setup' } });
    try {
      // Cold cache + missing flag row + users present → backfill branch.
      await prisma.systemSetting.delete({ where: { id: 'setup' } }).catch(() => {});
      const res = await app.inject({ method: 'GET', url: '/api/setup/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ setupRequired: false });

      // The backfill must surface a warn-level SystemError.
      const after = await prisma.systemError.count({ where: { component: 'Setup' } });
      expect(after).toBeGreaterThan(before);
    } finally {
      await app.close();
    }
  });
});
