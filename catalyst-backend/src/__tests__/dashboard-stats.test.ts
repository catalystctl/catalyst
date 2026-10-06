import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';

import { prisma } from '../db.js';
import { dashboardRoutes } from '../routes/dashboard.js';

// Regression guard for GET /api/dashboard/stats: the six figures must always
// be numbers (a $queryRaw row-indexing bug once returned `{"data":{}}` with
// every field undefined), and the cached second hit must return the identical
// body. Tests hit the real dev database, matching the repo's test policy.

let testAdminId: string;
let testScopedId: string;

function buildTestApp(perms: string[], userId: string) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId, email: 't@t.com', username: 't', permissions: perms };
  });
  return app;
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      email: `dash-admin-${nanoid(6)}@t.com`,
      name: 'dash admin',
      username: `dashad_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  const scoped = await prisma.user.create({
    data: {
      email: `dash-scoped-${nanoid(6)}@t.com`,
      name: 'dash scoped',
      username: `dashsc_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  testAdminId = admin.id;
  testScopedId = scoped.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [testAdminId, testScopedId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [testAdminId, testScopedId] } } });
});

const COUNT_KEYS = [
  'servers',
  'serversOnline',
  'nodes',
  'nodesOnline',
  'alerts',
  'alertsUnacknowledged',
] as const;

describe('GET /api/dashboard/stats', () => {
  it('returns every count as a number for a wildcard admin', async () => {
    const app = buildTestApp(['*'], testAdminId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const key of COUNT_KEYS) {
      expect(typeof body.data[key], `${key} should be a number`).toBe('number');
    }
    expect(body.data.servers).toBeGreaterThanOrEqual(0);
  });

  it('returns every count as a number for a scoped (server.read-only) user', async () => {
    const app = buildTestApp(['server.read'], testScopedId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const key of COUNT_KEYS) {
      expect(typeof body.data[key], `${key} should be a number`).toBe('number');
    }
  });

  it('serves the identical cached body on the second hit', async () => {
    const app = buildTestApp(['*'], testAdminId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const first = await app.inject({ method: 'GET', url: '/api/dashboard/stats' });
    const second = await app.inject({ method: 'GET', url: '/api/dashboard/stats' });
    expect(second.statusCode).toBe(200);
    expect(second.body).toBe(first.body);
  });
});
