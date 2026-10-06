/**
 * GET /api/servers pagination regression tests.
 *
 * The list route merges several lean sub-queries (owner / ServerAccess /
 * node- and role-scoped grants) and must apply `offset` AFTER the merge, not
 * per sub-query — otherwise pages overlap or silently drop servers. Also
 * covers the per-request limit cap (500) that lets the panel fetch whole
 * fleets in one request.
 *
 * DB-backed: fixtures are created per run and removed in afterAll.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { serverRoutes } from '../routes/servers.js';
import { nanoid } from 'nanoid';

// ── Fixtures ────────────────────────────────────────────────────────────────

let locationId: string;
let templateId: string;
let nodeId: string;
const userIds: string[] = [];
let nextPort = 26000;

function getNextPort() {
  return nextPort++;
}

function buildTestApp(user: { userId: string; permissions: string[] }) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: user.userId,
      email: 'list@example.com',
      username: 'listuser',
      permissions: user.permissions,
    };
  });
  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    routeToClients: async () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true }),
    relayBackupStream: async () => {},
  } as any);
  app.decorate('webhookService', {
    serverCreated: async () => {},
    serverCloned: async () => {},
  });
  app.decorate('fileTunnel', { createTunnel: async () => ({ tunnelId: 't' }) });
  return app;
}

async function createUser() {
  const user = await prisma.user.create({
    data: {
      email: `list-${nanoid(8)}@example.com`,
      username: `listuser${nanoid(4)}`,
      name: 'List Tester',
      emailVerified: true,
    },
  });
  userIds.push(user.id);
  return user.id;
}

async function createServer(ownerId: string, updatedAt: Date, rank: number) {
  const port = getNextPort();
  const server = await prisma.server.create({
    data: {
      uuid: `uuid-${nanoid(12)}`,
      name: `list-srv-${rank}-${nanoid(4)}`,
      templateId,
      nodeId,
      locationId,
      ownerId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      allocatedDiskMb: 2048,
      primaryPort: port,
      portBindings: { [port]: port },
      networkMode: 'bridge',
      environment: {},
      status: 'stopped',
      updatedAt,
    },
  });
  return server.id;
}

beforeAll(async () => {
  const location = await prisma.location.create({ data: { name: `list-loc-${nanoid(6)}` } });
  locationId = location.id;

  const template = await prisma.serverTemplate.create({
    data: {
      name: `list-template-${nanoid(6)}`,
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

  const node = await prisma.node.create({
    data: {
      name: `list-node-${nanoid(6)}`,
      locationId,
      hostname: 'node.example.com',
      publicAddress: '10.0.0.1',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 1_000_000,
      maxCpuCores: 1024,
      isOnline: true,
    },
  });
  nodeId = node.id;
});

afterAll(async () => {
  // Every fixture server belongs to a per-run user, so owner-scoped deletes
  // cover them without tracking individual ids.
  await prisma.serverAccess.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.server.deleteMany({ where: { ownerId: { in: userIds } } }).catch(() => {});
  await prisma.node.deleteMany({ where: { id: nodeId } }).catch(() => {});
  await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  await prisma.location.deleteMany({ where: { id: locationId } }).catch(() => {});
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('GET / (non-admin UNION path)', () => {
  it('pages the merged set exactly: no overlaps, no dropped servers', async () => {
    const listUserId = await createUser();
    const otherUserId = await createUser();
    const base = Date.now();

    // Ranked s1 (newest) … s5 (oldest). The list user owns the odd ranks; the
    // even ranks belong to another user but are shared via ServerAccess, so
    // both sub-queries contribute rows that interleave in the merged order.
    // Applying `offset` per sub-query (the old bug) lost s3 and s4 here.
    const s1 = await createServer(listUserId, new Date(base - 1 * 60_000), 1);
    const s2 = await createServer(otherUserId, new Date(base - 2 * 60_000), 2);
    const s3 = await createServer(listUserId, new Date(base - 3 * 60_000), 3);
    const s4 = await createServer(otherUserId, new Date(base - 4 * 60_000), 4);
    const s5 = await createServer(listUserId, new Date(base - 5 * 60_000), 5);
    await prisma.serverAccess.createMany({
      data: [
        { userId: listUserId, serverId: s2, permissions: ['server.read'] },
        { userId: listUserId, serverId: s4, permissions: ['server.read'] },
      ],
    });

    const app = buildTestApp({ userId: listUserId, permissions: ['server.read'] });
    await app.register(serverRoutes, { prefix: '/api/servers' });

    const pages: string[][] = [];
    for (const offset of [0, 2, 4, 6]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/servers?limit=2&offset=${offset}`,
      });
      expect(res.statusCode).toBe(200);
      pages.push(JSON.parse(res.body).data.map((s: any) => s.id));
    }
    await app.close();

    expect(pages[0]).toEqual([s1, s2]);
    expect(pages[1]).toEqual([s3, s4]);
    expect(pages[2]).toEqual([s5]);
    expect(pages[3]).toEqual([]);
    // Every server visible exactly once across all pages.
    expect(new Set(pages.flat()).size).toBe(5);
  });

  it('honors limit=500 (the cap was previously 100)', async () => {
    const ownerId = await createUser();
    const rows = Array.from({ length: 120 }, (_, i) => {
      const port = getNextPort();
      return {
        uuid: `uuid-${nanoid(12)}-${i}`,
        name: `list-cap-${i}-${nanoid(4)}`,
        templateId,
        nodeId,
        locationId,
        ownerId,
        allocatedMemoryMb: 512,
        allocatedCpuCores: 1,
        allocatedDiskMb: 2048,
        primaryPort: port,
        portBindings: { [port]: port },
        networkMode: 'bridge',
        environment: {},
        status: 'stopped',
      };
    });
    await prisma.server.createMany({ data: rows });

    const app = buildTestApp({ userId: ownerId, permissions: ['server.read'] });
    await app.register(serverRoutes, { prefix: '/api/servers' });

    const res = await app.inject({ method: 'GET', url: '/api/servers?limit=500' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toHaveLength(120);

    await app.close();
  });
});

describe('GET / (admin fast path)', () => {
  it('windows [offset, offset+limit) over the global ordering', async () => {
    const adminId = await createUser();
    // Future timestamps: the admin fast path lists ALL servers with no where
    // clause, so the fixtures must outrank any pre-existing dev-DB rows.
    const base = Date.now() + 365 * 24 * 3600 * 1000;
    const ranked: string[] = [];
    for (let rank = 1; rank <= 6; rank++) {
      ranked.push(await createServer(adminId, new Date(base - rank * 60_000), rank));
    }

    const app = buildTestApp({ userId: adminId, permissions: ['*'] });
    await app.register(serverRoutes, { prefix: '/api/servers' });

    const pages: string[][] = [];
    for (const offset of [0, 2, 4]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/servers?limit=2&offset=${offset}`,
      });
      expect(res.statusCode).toBe(200);
      pages.push(JSON.parse(res.body).data.map((s: any) => s.id));
    }
    await app.close();

    expect(pages[0]).toEqual([ranked[0], ranked[1]]);
    expect(pages[1]).toEqual([ranked[2], ranked[3]]);
    expect(pages[2]).toEqual([ranked[4], ranked[5]]);
  });
});
