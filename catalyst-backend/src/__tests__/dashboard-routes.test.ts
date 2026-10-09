import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';

import { prisma } from '../db.js';
import { dashboardRoutes, __resetDashboardCachesForTests } from '../routes/dashboard.js';

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
      email: `dash-rt-admin-${nanoid(6)}@t.com`,
      name: 'dash routes admin',
      username: `dashrtad_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  const scoped = await prisma.user.create({
    data: {
      email: `dash-rt-scoped-${nanoid(6)}@t.com`,
      name: 'dash routes scoped',
      username: `dashrtsc_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  testAdminId = admin.id;
  testScopedId = scoped.id;
  __resetDashboardCachesForTests();
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [testAdminId, testScopedId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [testAdminId, testScopedId] } } });
});

describe('GET /api/dashboard/stats - authorization', () => {
  it('requires authentication', async () => {
    const app = Fastify({ logger: false });
    app.decorate('authenticate', async () => {
      throw new Error('Unauthorized');
    });
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/stats' });
    expect(res.statusCode).toBe(500);
  });

  it('allows access with server.read permission', async () => {
    const app = buildTestApp(['server.read'], testScopedId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/stats' });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /api/dashboard/activity', () => {
  it('returns recent activity for admin', async () => {
    const app = buildTestApp(['*'], testAdminId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/activity?limit=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('respects limit parameter', async () => {
    const app = buildTestApp(['*'], testAdminId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/activity?limit=3' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeLessThanOrEqual(3);
  });

  it('caps limit at 20', async () => {
    const app = buildTestApp(['*'], testAdminId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/activity?limit=100' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeLessThanOrEqual(20);
  });

  it('scopes activity to user without admin.read', async () => {
    const app = buildTestApp(['server.read'], testScopedId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/activity' });
    expect(res.statusCode).toBe(200);
  });

  it('caches responses', async () => {
    const app = buildTestApp(['*'], testAdminId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const first = await app.inject({ method: 'GET', url: '/api/dashboard/activity?limit=5' });
    const second = await app.inject({ method: 'GET', url: '/api/dashboard/activity?limit=5' });
    expect(second.statusCode).toBe(200);
    expect(second.body).toBe(first.body);
  });
});

describe('GET /api/dashboard/resources', () => {
  it('returns zero utilization without node permissions', async () => {
    const app = buildTestApp(['server.read'], testScopedId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.cpuUtilization).toBe(0);
    expect(body.data.memoryUtilization).toBe(0);
    expect(body.data.networkThroughput).toBe(0);
  });

  it('returns aggregated resources for node.read permission', async () => {
    __resetDashboardCachesForTests();
    const app = buildTestApp(['node.read'], testAdminId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveProperty('cpuUtilization');
    expect(body.data).toHaveProperty('memoryUtilization');
    expect(body.data).toHaveProperty('networkThroughput');
    expect(typeof body.data.cpuUtilization).toBe('number');
    expect(typeof body.data.memoryUtilization).toBe('number');
    expect(typeof body.data.networkThroughput).toBe('number');
  });

  it('returns aggregated resources for node.view_stats permission', async () => {
    __resetDashboardCachesForTests();
    const app = buildTestApp(['node.view_stats'], testScopedId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveProperty('cpuUtilization');
  });

  it('caches resource aggregates', async () => {
    __resetDashboardCachesForTests();
    const app = buildTestApp(['node.read'], testAdminId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const first = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });
    const second = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });
    expect(second.statusCode).toBe(200);
    expect(second.body).toBe(first.body);
  });
});
