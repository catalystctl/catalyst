import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { metricsRoutes } from '../routes/metrics.js';

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

describe('server metrics SQL aggregation', () => {
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
