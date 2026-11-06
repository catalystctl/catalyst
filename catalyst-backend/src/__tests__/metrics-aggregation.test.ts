import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { metricsRoutes } from '../routes/metrics.js';
import { WebSocketGateway } from '../websocket/gateway.js';

let userId = '';
let serverId = '';
let nodeId = '';
let locationId = '';
let templateId = '';
let roleId = '';

function appForUser() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId, email: 'metrics-aggregation@test', username: 'metrics-aggregation', permissions: [] };
  });
  app.register(metricsRoutes, { prefix: '/api' });
  return app;
}

beforeAll(async () => {
  const tag = nanoid(8);
  const role = await prisma.role.create({ data: { name: `metrics-aggregation-role-${tag}`, permissions: ['*'] } });
  roleId = role.id;
  const user = await prisma.user.create({
    data: { email: `metrics-aggregation-${tag}@example.com`, username: `metricsagg${tag}`, name: 'Metrics aggregation', emailVerified: true, roles: { connect: { id: role.id } } },
  });
  userId = user.id;
  const location = await prisma.location.create({ data: { name: `metrics-aggregation-location-${tag}` } });
  locationId = location.id;
  const node = await prisma.node.create({
    data: {
      name: `metrics-aggregation-node-${tag}`, locationId, hostname: 'metrics-aggregation.test',
      publicAddress: '127.0.0.1', secret: `metrics-${tag}`, maxMemoryMb: 16384, maxCpuCores: 8, isOnline: true,
    },
  });
  nodeId = node.id;
  const template = await prisma.serverTemplate.create({
    data: {
      name: `metrics-aggregation-template-${tag}`, author: 'test', version: '1', image: 'alpine:latest',
      startup: 'sleep 1', stopCommand: 'stop', supportedPorts: [], variables: [], allocatedMemoryMb: 1024, allocatedCpuCores: 2,
    },
  });
  templateId = template.id;
  const server = await prisma.server.create({
    data: {
      uuid: `metrics-aggregation-${tag}`, name: `Metrics aggregation ${tag}`, templateId, nodeId, locationId,
      ownerId: userId, allocatedMemoryMb: 1024, allocatedCpuCores: 2, primaryPort: 25565,
    },
  });
  serverId = server.id;
});

afterAll(async () => {
  if (serverId) await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  if (roleId) await prisma.role.delete({ where: { id: roleId } }).catch(() => {});
});

async function getHistory(query = '') {
  const app = appForUser();
  const response = await app.inject({ method: 'GET', url: `/api/servers/${serverId}/metrics${query}` });
  await app.close();
  return response.json();
}

function sampleMetrics(count: number) {
  const startedAt = Date.now() - 120_000;
  return Array.from({ length: count }, (_, i) => ({
    serverUuid: serverId,
    cpuPercent: 12 + i,
    memoryUsageMb: 923 + i,
    networkRxBytes: 10_000 + i,
    networkTxBytes: 20_000 + i,
    diskIoMb: 5 + i,
    diskUsageMb: 2_300 + i,
    timestamp: startedAt + i * 5_000,
  }));
}

async function ingestBatch(metrics: any[], failBatch = false) {
  await prisma.serverMetrics.deleteMany({ where: { serverId } });
  const logger = { child: () => logger, info: () => {}, warn: vi.fn(), error: () => {}, debug: () => {} };
  const db = Object.create(prisma);
  db.serverStat = { create: async () => ({}) };
  if (failBatch) db.$executeRaw = async () => { throw new Error('forced batch write failure'); };
  const gateway = new WebSocketGateway(db, logger as any);
  (gateway as any).routeToClients = vi.fn(async () => {});
  const socket = { send: () => {}, readyState: 1 };
  (gateway as any).agents.set(nodeId, { socket, authenticated: true, lastHeartbeat: Date.now() });
  try {
    await (gateway as any).handleAgentMessage(nodeId, socket, JSON.stringify({
      type: 'resource_stats_batch', metrics, timestamp: Date.now(),
    }));
    return {
      gateway,
      logger,
      saved: await prisma.serverMetrics.findMany({ where: { serverId }, orderBy: { timestamp: 'asc' } }),
    };
  } catch (error) {
    gateway.destroy();
    throw error;
  }
}

describe('server metrics SQL aggregation', () => {
  it('persists every buffered sample without applying the live fan-out throttle', async () => {
    const { gateway, saved } = await ingestBatch(sampleMetrics(3));
    try {
      expect(saved).toHaveLength(3);
      expect(saved.map((row) => row.memoryUsageMb)).toEqual([923, 924, 925]);
      expect(saved.map((row) => row.diskUsageMb)).toEqual([2_300, 2_301, 2_302]);
      expect(saved.map((row) => row.networkRxBytes)).toEqual([10_000n, 10_001n, 10_002n]);
      expect((gateway as any).routeToClients).toHaveBeenCalledTimes(1);
      expect((gateway as any).routeToClients.mock.calls[0][1].memoryUsageMb).toBe(925);
    } finally {
      gateway.destroy();
      await prisma.serverMetrics.deleteMany({ where: { serverId } });
    }
  });

  it('does not truncate buffered history when the batch write needs its fallback', async () => {
    const { gateway, saved } = await ingestBatch(sampleMetrics(21), true);
    try {
      expect(saved).toHaveLength(21);
      expect(saved.map((row) => row.memoryUsageMb)).toEqual(Array.from({ length: 21 }, (_, i) => 923 + i));
    } finally {
      gateway.destroy();
      await prisma.serverMetrics.deleteMany({ where: { serverId } });
    }
  });

  it('rejects malformed batch shapes and entries without throwing', async () => {
    const { gateway, saved } = await ingestBatch([null, 42, [], 'invalid', sampleMetrics(1)[0]]);
    try {
      expect(saved).toHaveLength(1);
    } finally {
      gateway.destroy();
      await prisma.serverMetrics.deleteMany({ where: { serverId } });
    }
    const invalid = await ingestBatch(null as any);
    try {
      expect(invalid.saved).toHaveLength(0);
      expect(invalid.logger.warn).toHaveBeenCalledWith('resource_stats_batch.metrics is not an array');
    } finally {
      invalid.gateway.destroy();
    }
  });

  it('returns the stable empty response shape when there is no history', async () => {
    const body = await getHistory('?hours=1&limit=5');
    expect(body).toEqual({ success: true, data: { latest: null, averages: null, history: [], count: 0 } });
  });

  it('preserves bucket ordering, empty-bucket nulls, totals, and network rates', async () => {
    const now = Date.now();
    await prisma.serverMetrics.createMany({
      data: [
        { serverId, cpuPercent: 20, memoryUsageMb: 100, diskIoMb: 4, diskUsageMb: 300, networkRxBytes: 1_000_000_000n, networkTxBytes: 2_000_000_000n, timestamp: new Date(now - 45 * 60_000) },
        { serverId, cpuPercent: 40, memoryUsageMb: 200, diskIoMb: 8, diskUsageMb: 500, networkRxBytes: 3_000_000_000n, networkTxBytes: 5_000_000_000n, timestamp: new Date(now - 15 * 60_000) },
      ],
    });
    const body = await getHistory('?hours=1&limit=4');
    const history = body.data.history;
    expect(body.success).toBe(true);
    expect(body.data.count).toBe(4);
    expect(history).toHaveLength(4);
    expect(history.map((item: any) => item.timestamp)).toEqual([...history].sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp)).map((item: any) => item.timestamp));
    expect(history.filter((item: any) => item.cpuPercent === null)).toHaveLength(2);
    expect(body.data.averages).toEqual({ cpuPercent: 30, memoryUsageMb: 150, diskIoMb: 6, diskUsageMb: 400 });
    expect(body.data.latest.networkRxBytes).toBe('3000000000');
    expect(body.data.latest.networkTxBytes).toBe('5000000000');
    const populated = history.filter((item: any) => item.cpuPercent !== null);
    expect(populated[0].networkRxBytes).toBe(0);
    expect(populated[1].networkRxBytes).toBeGreaterThan(0);
    expect(populated[1].networkTxBytes).toBeGreaterThan(0);
  });

  it('does not include samples outside the requested boundary', async () => {
    await prisma.serverMetrics.deleteMany({ where: { serverId } });
    const now = Date.now();
    await prisma.serverMetrics.create({
      data: { serverId, cpuPercent: 99, memoryUsageMb: 999, networkRxBytes: 9n, networkTxBytes: 9n, diskIoMb: 1, diskUsageMb: 1, timestamp: new Date(now - 61 * 60_000) },
    });
    const body = await getHistory('?hours=1&limit=3');
    expect(body.data.latest).toBeNull();
    expect(body.data.history).toEqual([]);
    expect(body.data.count).toBe(0);
  });
});
