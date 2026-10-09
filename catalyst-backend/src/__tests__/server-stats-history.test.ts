import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { serverStatsRoutes } from '../routes/servers/stats.js';

let userId = '';
let serverId = '';
let nodeId = '';
let locationId = '';
let templateId = '';

function makeApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId, email: 'server-stats-history@test', username: 'server-stats-history', permissions: [] };
  });
  app.register(serverStatsRoutes, { prefix: '/api/servers' });
  return app;
}

beforeAll(async () => {
  const tag = nanoid(8);
  const user = await prisma.user.create({ data: { email: `server-stats-${tag}@example.com`, username: `serverstats${tag}`, name: 'Server stats', emailVerified: true } });
  userId = user.id;
  const location = await prisma.location.create({ data: { name: `server-stats-location-${tag}` } });
  locationId = location.id;
  const node = await prisma.node.create({ data: { name: `server-stats-node-${tag}`, locationId, hostname: 'server-stats.test', publicAddress: '127.0.0.1', secret: `stats-${tag}`, maxMemoryMb: 8192, maxCpuCores: 4, isOnline: true } });
  nodeId = node.id;
  const template = await prisma.serverTemplate.create({ data: { name: `server-stats-template-${tag}`, author: 'test', version: '1', image: 'alpine:latest', startup: 'sleep 1', stopCommand: 'stop', supportedPorts: [], variables: [], allocatedMemoryMb: 512, allocatedCpuCores: 1 } });
  templateId = template.id;
  const server = await prisma.server.create({ data: { uuid: `server-stats-${tag}`, name: `Server stats ${tag}`, templateId, nodeId, locationId, ownerId: userId, allocatedMemoryMb: 512, allocatedCpuCores: 1, primaryPort: 25566 } });
  serverId = server.id;
});

afterAll(async () => {
  if (serverId) await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
});

async function getHistory(from: string, to: string, interval = 60) {
  const app = makeApp();
  const response = await app.inject({ method: 'GET', url: `/api/servers/${serverId}/stats/history?from=${from}&to=${to}&interval=${interval}` });
  await app.close();
  return response;
}

describe('server stats history SQL aggregation', () => {
  it('returns empty data and complete metadata for an empty range', async () => {
    const from = new Date('2025-01-01T00:00:00.000Z');
    const to = new Date('2025-01-01T00:05:00.000Z');
    const response = await getHistory(from.toISOString(), to.toISOString());
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: [], meta: { from: from.toISOString(), to: to.toISOString(), interval: 60, totalRaw: 0, returned: 0 } });
  });

  it('returns one earliest row per bucket, reports raw totals, preserves nulls, and orders chronologically', async () => {
    const from = new Date('2025-02-01T00:00:00.000Z');
    const to = new Date('2025-02-01T00:05:00.000Z');
    await prisma.serverStat.createMany({
      data: [
        { serverId, cpuPercent: 10, memoryUsed: 100n, memoryLimit: 1000n, diskUsed: null, netRx: null, netTx: 2, blockRead: null, blockWrite: 4, createdAt: new Date(from.getTime() + 1_000) },
        { serverId, cpuPercent: 20, memoryUsed: 200n, memoryLimit: 1000n, diskUsed: 300n, netRx: 3, netTx: 4, blockRead: 5, blockWrite: 6, createdAt: new Date(from.getTime() + 30_000) },
        { serverId, cpuPercent: 30, memoryUsed: 300n, memoryLimit: 1000n, diskUsed: 400n, netRx: 7, netTx: 8, blockRead: 9, blockWrite: 10, createdAt: new Date(from.getTime() + 61_000) },
      ],
    });
    const body = (await getHistory(from.toISOString(), to.toISOString(), 60)).json();
    expect(body.meta).toEqual({ from: from.toISOString(), to: to.toISOString(), interval: 60, totalRaw: 3, returned: 2 });
    expect(body.data).toHaveLength(2);
    expect(body.data[0].cpuPercent).toBe(10);
    expect(body.data[0].diskUsed).toBeNull();
    expect(body.data[0].memoryUsed).toBe(100);
    expect(body.data[1].cpuPercent).toBe(30);
    expect(body.data[1].createdAt).toBe(new Date(from.getTime() + 61_000).toISOString());
    expect(body.data[0].createdAt < body.data[1].createdAt).toBe(true);
  });
});
