import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';

import { prisma } from '../db.js';
import { dashboardRoutes, __resetDashboardCachesForTests } from '../routes/dashboard.js';

// Regression guard for the admin.read contract on the dashboard (TARGET-
// VOCABULARY §2.1): admin.read is the read-everything grant, so it must see
// panel-wide server counts (previously scoped to own servers for anyone
// below the admin.write tier), the global activity feed, and fleet
// aggregates. A bare server.read stays scoped. Tests hit the real dev
// database, matching the repo's test policy.

let readerId: string;
let scopedUserId: string;
let otherUserId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let scopedServerId: string;
let otherServerId: string;
let markerAction = '';

function buildTestApp(perms: string[], userId: string) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId, email: 't@t.com', username: 't', permissions: perms };
  });
  return app;
}

beforeAll(async () => {
  const reader = await prisma.user.create({
    data: {
      email: `dash-reader-${nanoid(6)}@t.com`,
      name: 'dash reader',
      username: `dashrd_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  const scoped = await prisma.user.create({
    data: {
      email: `dash-scoped2-${nanoid(6)}@t.com`,
      name: 'dash scoped2',
      username: `dashsc2_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  const other = await prisma.user.create({
    data: {
      email: `dash-other-${nanoid(6)}@t.com`,
      name: 'dash other',
      username: `dashot_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  readerId = reader.id;
  scopedUserId = scoped.id;
  otherUserId = other.id;

  const location = await prisma.location.create({
    data: { name: `test-dash-loc-${nanoid(8)}` },
  });
  locationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `test-dash-node-${nanoid(8)}`,
      locationId,
      hostname: 'dash.example.com',
      publicAddress: '10.0.0.9',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  nodeId = node.id;

  // Two metric samples so the /resources throughput math has a delta
  // (100 MB/s RX on the planted node).
  const baseTs = new Date();
  await prisma.nodeMetrics.createMany({
    data: [
      {
        nodeId,
        cpuPercent: 50,
        memoryUsageMb: 1024,
        memoryTotalMb: 4096,
        diskUsageMb: 512,
        diskTotalMb: 4096,
        networkRxBytes: 0,
        networkTxBytes: 0,
        containerCount: 1,
        timestamp: new Date(baseTs.getTime() - 1000),
      },
      {
        nodeId,
        cpuPercent: 50,
        memoryUsageMb: 1024,
        memoryTotalMb: 4096,
        diskUsageMb: 512,
        diskTotalMb: 4096,
        networkRxBytes: 100 * 1024 * 1024,
        networkTxBytes: 100 * 1024 * 1024,
        containerCount: 1,
        timestamp: baseTs,
      },
    ],
  });

  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-dash-template-${nanoid(8)}`,
      author: 'Test',
      version: '1.0.0',
      image: 'alpine:latest',
      startup: 'echo hello',
      stopCommand: 'stop',
      supportedPorts: [],
      variables: [],
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
    },
  });
  templateId = template.id;

  const scopedServer = await prisma.server.create({
    data: {
      uuid: `test-dash-${nanoid(12)}`,
      name: `test-dash-scoped-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: scopedUserId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25572,
    },
  });
  scopedServerId = scopedServer.id;
  const otherServer = await prisma.server.create({
    data: {
      uuid: `test-dash-${nanoid(12)}`,
      name: `test-dash-other-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: otherUserId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25573,
    },
  });
  otherServerId = otherServer.id;

  markerAction = `test.dash_planted_${nanoid(4)}`;
  await prisma.auditLog.create({
    data: {
      userId: otherUserId,
      action: markerAction,
      resource: 'server',
      resourceId: otherServerId,
      details: { planted: true },
      timestamp: new Date(),
    },
  });
});

afterAll(async () => {
  await prisma.auditLog
    .deleteMany({ where: { userId: { in: [readerId, scopedUserId, otherUserId] } } })
    .catch(() => {});
  for (const id of [scopedServerId, otherServerId]) {
    if (id) await prisma.server.delete({ where: { id } }).catch(() => {});
  }
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  for (const id of [readerId, scopedUserId, otherUserId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('GET /api/dashboard/stats — global counts for admin.read', () => {
  it('admin.read sees panel-wide server counts (hasGrant, not raw includes)', async () => {
    const app = buildTestApp(['admin.read'], readerId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const key of ['servers', 'serversOnline', 'nodes', 'nodesOnline', 'alerts', 'alertsUnacknowledged']) {
      expect(typeof body.data[key], `${key} should be a number`).toBe('number');
    }
    await app.close();
  });

  it('admin.read counts equal the wildcard admin counts (both global)', async () => {
    const adminApp = buildTestApp(['admin.read'], readerId);
    await adminApp.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const adminRes = await adminApp.inject({ method: 'GET', url: '/api/dashboard/stats' });

    const wildApp = buildTestApp(['*'], readerId);
    await wildApp.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const wildRes = await wildApp.inject({ method: 'GET', url: '/api/dashboard/stats' });

    expect(adminRes.statusCode).toBe(200);
    expect(wildRes.statusCode).toBe(200);
    expect(adminRes.json().data.servers).toBe(wildRes.json().data.servers);
    expect(adminRes.json().data.nodes).toBe(wildRes.json().data.nodes);
    await adminApp.close();
    await wildApp.close();
  });

  it('a bare server.read user stays scoped to servers they own', async () => {
    const app = buildTestApp(['server.read'], scopedUserId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/stats' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    // Owns exactly one server and has no ServerAccess rows: scoped count is 1
    // and strictly below the global inventory (two planted servers exist).
    expect(data.servers).toBe(1);
    const adminApp = buildTestApp(['admin.read'], readerId);
    await adminApp.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const adminRes = await adminApp.inject({ method: 'GET', url: '/api/dashboard/stats' });
    expect(adminRes.json().data.servers).toBeGreaterThanOrEqual(2);
    await app.close();
    await adminApp.close();
  });
});

describe('GET /api/dashboard/activity — admin.read parity', () => {
  it('admin.read sees the global audit feed incl. other users', async () => {
    const app = buildTestApp(['admin.read'], readerId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/activity?limit=20' });
    expect(res.statusCode).toBe(200);
    // The feed carries the humanized title; the planted action words are
    // case-stable ('Dash Planted') while the random suffix is not.
    const text = JSON.stringify(res.json().data);
    expect(text).toContain('Dash Planted');
    await app.close();
  });

  it('a bare server.read user sees only their own activity', async () => {
    const app = buildTestApp(['server.read'], scopedUserId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/activity?limit=20' });
    expect(res.statusCode).toBe(200);
    const text = JSON.stringify(res.json().data);
    expect(text).not.toContain('Dash Planted');
    await app.close();
  });
});

describe('GET /api/dashboard/resources — read tier parity', () => {
  // /resources serves a module-global 10s cache shared across the vitest
  // module cache; reset it so suite ordering can't serve a poisoned zero
  // aggregate from another file's call.
  beforeEach(() => {
    __resetDashboardCachesForTests();
  });

  it('a bare server.read user gets the zero fallback', async () => {
    const app = buildTestApp(['server.read'], scopedUserId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.cpuUtilization).toBe(0);
    expect(data.memoryUtilization).toBe(0);
    expect(data.networkThroughput).toBe(0);
    await app.close();
  });

  it.each([
    ['admin.read', ['admin.read']],
    ['node.read', ['node.read']],
    ['node.view_stats (stats-only grant)', ['node.view_stats']],
  ])('%s sees computed fleet aggregates', async (_label, perms) => {
    const app = buildTestApp(perms as string[], readerId);
    await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/resources' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    // The planted node streams 100 MB/s, so a non-fallback response is > 0.
    expect(data.networkThroughput).toBeGreaterThan(0);
    await app.close();
  });
});
