import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { nodeRoutes } from '../routes/nodes.js';
import { nanoid } from 'nanoid';

let testLocationId: string;
let testNodeId: string;
let testUserId: string;
let adminRoleId: string;
let testTemplateId: string;
let testServerId: string;
let nextPort = 41000;

function getNextPort() {
  return nextPort++;
}

function buildTestApp(userOverrides: Record<string, any> = {}) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any, _reply: any) => {
    request.user = {
      userId: testUserId,
      email: 'test@example.com',
      username: 'testuser',
      permissions: ['*'],
      ...userOverrides,
    };
  });
  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true }),
    relayBackupStream: async () => {},
  } as any);
  return app;
}

beforeAll(async () => {
  const location = await prisma.location.create({
    data: { name: `bulk-alloc-location-${nanoid(8)}` },
  });
  testLocationId = location.id;

  const adminRole = await prisma.role.create({
    data: { name: `bulk-alloc-admin-${nanoid(8)}`, permissions: ['*'] },
  });
  adminRoleId = adminRole.id;

  const user = await prisma.user.create({
    data: {
      email: `bulk-alloc-${nanoid(8)}@example.com`,
      username: `bulkalloc${nanoid(4)}`,
      name: 'Bulk Alloc User',
      emailVerified: true,
      roles: { connect: { id: adminRoleId } },
    },
  });
  testUserId = user.id;

  const node = await prisma.node.create({
    data: {
      name: `bulk-alloc-node-${nanoid(8)}`,
      hostname: 'bulk-alloc-host',
      publicAddress: '10.10.0.1',
      secret: `bulk-alloc-${nanoid(12)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      locationId: testLocationId,
    },
  });
  testNodeId = node.id;

  const template = await prisma.serverTemplate.create({
    data: {
      name: `bulk-alloc-template-${nanoid(8)}`,
      author: 'Test',
      version: '1.0.0',
      image: 'alpine:3.19',
      startup: '/bin/sh',
      stopCommand: 'stop',
      sendSignalTo: 'SIGTERM',
      variables: [],
      installScript: '',
      supportedPorts: [],
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
    },
  });
  testTemplateId = template.id;

  const server = await prisma.server.create({
    data: {
      name: `bulk-alloc-server-${nanoid(6)}`,
      uuid: `bulk-alloc-${nanoid(8)}`,
      templateId: testTemplateId,
      nodeId: testNodeId,
      locationId: testLocationId,
      ownerId: testUserId,
      status: 'stopped',
      primaryPort: getNextPort(),
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      networkMode: 'bridge',
    },
  });
  testServerId = server.id;
});

afterAll(async () => {
  await prisma.nodeAllocation.deleteMany({ where: { nodeId: testNodeId } }).catch(() => {});
  if (testServerId) await prisma.server.delete({ where: { id: testServerId } }).catch(() => {});
  await prisma.node.delete({ where: { id: testNodeId } }).catch(() => {});
  await prisma.serverTemplate.delete({ where: { id: testTemplateId } }).catch(() => {});
  await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  await prisma.role.delete({ where: { id: adminRoleId } }).catch(() => {});
  await prisma.location.delete({ where: { id: testLocationId } }).catch(() => {});
});

async function createAllocations(count: number, basePort = getNextPort()) {
  const rows = Array.from({ length: count }, (_, i) => ({
    nodeId: testNodeId,
    ip: '10.10.0.1',
    port: basePort + i,
  }));
  await prisma.nodeAllocation.createMany({ data: rows, skipDuplicates: true });
  const created = await prisma.nodeAllocation.findMany({
    where: { nodeId: testNodeId, port: { gte: basePort, lt: basePort + count } },
    select: { id: true, port: true },
  });
  return created;
}

describe('Node allocations bulk-delete', () => {
  it('deletes available allocations in bulk', async () => {
    const created = await createAllocations(3);
    expect(created).toHaveLength(3);

    const app = buildTestApp();
    await app.register(nodeRoutes, { prefix: '/api/nodes' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/nodes/${testNodeId}/allocations/bulk-delete`,
      payload: { allocationIds: created.map((a) => a.id) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(3);
    expect(body.data.skippedAssigned).toBe(0);

    const remaining = await prisma.nodeAllocation.findMany({
      where: { id: { in: created.map((a) => a.id) } },
    });
    expect(remaining).toHaveLength(0);
    await app.close();
  });

  it('skips assigned allocations and reports notFound', async () => {
    const created = await createAllocations(2);
    await prisma.nodeAllocation.update({
      where: { id: created[0].id },
      data: { serverId: testServerId },
    });

    const app = buildTestApp();
    await app.register(nodeRoutes, { prefix: '/api/nodes' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/nodes/${testNodeId}/allocations/bulk-delete`,
      payload: { allocationIds: [...created.map((a) => a.id), 'alloc-does-not-exist'] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.deleted).toBe(1);
    expect(body.data.skippedAssigned).toBe(1);
    expect(body.data.notFound).toBe(1);

    // Assigned allocation survives; unassign for cleanup.
    const survivor = await prisma.nodeAllocation.findUnique({ where: { id: created[0].id } });
    expect(survivor).not.toBeNull();
    await prisma.nodeAllocation.update({
      where: { id: created[0].id },
      data: { serverId: null },
    });
    await prisma.nodeAllocation.deleteMany({
      where: { id: { in: created.map((a) => a.id) } },
    });
    await app.close();
  });

  it('rejects an empty allocationIds array', async () => {
    const app = buildTestApp();
    await app.register(nodeRoutes, { prefix: '/api/nodes' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/nodes/${testNodeId}/allocations/bulk-delete`,
      payload: { allocationIds: [] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('requires node.manage_allocation', async () => {
    const created = await createAllocations(1);
    const app = buildTestApp({ userId: testUserId, permissions: [] });
    await app.register(nodeRoutes, { prefix: '/api/nodes' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/nodes/${testNodeId}/allocations/bulk-delete`,
      payload: { allocationIds: created.map((a) => a.id) },
    });
    expect(res.statusCode).toBe(403);
    await prisma.nodeAllocation.deleteMany({
      where: { id: { in: created.map((a) => a.id) } },
    });
    await app.close();
  });
});
