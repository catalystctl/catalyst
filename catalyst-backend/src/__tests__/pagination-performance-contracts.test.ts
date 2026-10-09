/**
 * Opt-in pagination contracts for relation-heavy endpoints.
 *
 * The unqualified requests are intentionally checked as well: pagination was
 * added as a backwards-compatible opt-in, so existing clients must retain the
 * original array-shaped payloads and must not receive pagination metadata.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { taskRoutes } from '../routes/tasks.js';
import { alertRoutes } from '../routes/alerts.js';
import { nodeRoutes } from '../routes/nodes.js';
import { roleRoutes } from '../routes/roles.js';

let userId: string;
let roleId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let alertId: string;
const taskIds: string[] = [];
const deliveryIds: string[] = [];
const relationUserIds: string[] = [];
const relationServerIds: string[] = [];

function appFor(routes: (app: any) => Promise<void>, permissions: string[], prefix = '/api') {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId,
      email: 'pagination-contract@example.com',
      username: 'pagination-contract',
      permissions,
    };
  });
  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    routeToClients: async () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true }),
  } as any);
  app.register(routes, { prefix });
  return app;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `pagination-${nanoid(8)}@example.com`,
      username: `pagination-${nanoid(6)}`,
      name: 'Pagination contract',
      emailVerified: true,
    },
  });
  userId = user.id;

  const role = await prisma.role.create({
    data: { name: `pagination-role-${nanoid(8)}`, permissions: ['*', 'role.read'] },
  });
  roleId = role.id;

  const location = await prisma.location.create({ data: { name: `pagination-location-${nanoid(8)}` } });
  locationId = location.id;
  const node = await prisma.node.create({
    data: {
      name: `pagination-node-${nanoid(8)}`,
      locationId,
      hostname: 'pagination.example.com',
      publicAddress: '127.0.0.1',
      secret: `pagination-secret-${nanoid(12)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  nodeId = node.id;
  const template = await prisma.serverTemplate.create({
    data: {
      name: `pagination-template-${nanoid(8)}`,
      author: 'Test',
      version: '1.0.0',
      image: 'alpine:latest',
      startup: 'echo test',
      stopCommand: 'stop',
      supportedPorts: [],
      variables: [],
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
    },
  });
  templateId = template.id;
  const server = await prisma.server.create({
    data: {
      uuid: `pagination-${nanoid(12)}`,
      name: `pagination-server-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: userId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      allocatedDiskMb: 2048,
      primaryPort: 28000,
      portBindings: {},
      networkMode: 'bridge',
      environment: {},
    },
  });
  serverId = server.id;

  for (let i = 0; i < 3; i++) {
    const task = await prisma.scheduledTask.create({
      data: { serverId, name: `task-${i}`, action: 'restart', schedule: '0 3 * * *', payload: {} },
    });
    taskIds.push(task.id);
  }
  const alert = await prisma.alert.create({
    data: {
      userId,
      serverId,
      type: 'custom',
      severity: 'warning',
      title: 'Pagination alert',
      message: 'Pagination contract',
      metadata: {},
    },
  });
  alertId = alert.id;
  for (let i = 0; i < 3; i++) {
    const delivery = await prisma.alertDelivery.create({
      data: { alertId, channel: 'email', target: `user-${i}@example.com` },
    });
    deliveryIds.push(delivery.id);
  }

  for (let i = 0; i < 3; i++) {
    const relatedUser = await prisma.user.create({
      data: {
        email: `pagination-related-${nanoid(8)}@example.com`,
        username: `related-${nanoid(6)}`,
        name: `Related ${i}`,
        emailVerified: true,
        roles: { connect: { id: roleId } },
      },
    });
    relationUserIds.push(relatedUser.id);
    const relatedServer = await prisma.server.create({
      data: {
        uuid: `pagination-related-${nanoid(12)}`,
        name: `related-server-${i}`,
        templateId,
        nodeId,
        locationId,
        ownerId: userId,
        allocatedMemoryMb: 512,
        allocatedCpuCores: 1,
        allocatedDiskMb: 2048,
        primaryPort: 28100 + i,
        portBindings: {},
        networkMode: 'bridge',
        environment: {},
      },
    });
    relationServerIds.push(relatedServer.id);
    await prisma.roleServerGrant.create({ data: { roleId, serverId: relatedServer.id, permissions: ['server.read'] } });
  }
  await prisma.roleNodeGrant.create({ data: { roleId, nodeId, permissions: ['node.read'] } });
});

afterAll(async () => {
  await prisma.alertDelivery.deleteMany({ where: { id: { in: deliveryIds } } }).catch(() => {});
  if (alertId) await prisma.alert.delete({ where: { id: alertId } }).catch(() => {});
  await prisma.scheduledTask.deleteMany({ where: { id: { in: taskIds } } }).catch(() => {});
  await prisma.roleServerGrant.deleteMany({ where: { roleId } }).catch(() => {});
  await prisma.roleNodeGrant.deleteMany({ where: { roleId } }).catch(() => {});
  await prisma.server.deleteMany({ where: { id: { in: [serverId, ...relationServerIds] } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [userId, ...relationUserIds] } } }).catch(() => {});
  if (roleId) await prisma.role.delete({ where: { id: roleId } }).catch(() => {});
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('opt-in pagination and legacy compatibility', () => {
  it('pages tasks while preserving the legacy response', async () => {
    const app = appFor(taskRoutes, ['*']);
    const legacy = await app.inject({ method: 'GET', url: `/api/${serverId}/tasks` });
    const page = await app.inject({ method: 'GET', url: `/api/${serverId}/tasks?page=2&limit=1` });
    expect(legacy.statusCode).toBe(200);
    expect(JSON.parse(legacy.body)).toEqual(expect.objectContaining({ tasks: expect.any(Array) }));
    expect(JSON.parse(legacy.body)).not.toHaveProperty('pagination');
    expect(JSON.parse(page.body).tasks).toHaveLength(1);
    expect(JSON.parse(page.body).pagination).toMatchObject({ page: 2, limit: 1, total: 3, totalPages: 3 });
    await app.close();
  });

  it('pages alert deliveries while preserving the legacy response', async () => {
    const app = appFor(alertRoutes, ['*']);
    const legacy = await app.inject({ method: 'GET', url: `/api/alerts/${alertId}/deliveries` });
    const page = await app.inject({ method: 'GET', url: `/api/alerts/${alertId}/deliveries?page=1&limit=2` });
    expect(JSON.parse(legacy.body).deliveries).toHaveLength(3);
    expect(JSON.parse(legacy.body)).not.toHaveProperty('pagination');
    expect(JSON.parse(page.body).deliveries).toHaveLength(2);
    expect(JSON.parse(page.body).pagination).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
    await app.close();
  });

  it('pages node server relations while preserving the legacy response', async () => {
    const app = appFor(nodeRoutes, ['*']);
    const legacy = await app.inject({ method: 'GET', url: `/api/${nodeId}` });
    const page = await app.inject({ method: 'GET', url: `/api/${nodeId}?page=2&limit=1` });
    expect(JSON.parse(legacy.body).data.servers).toHaveLength(4);
    expect(JSON.parse(legacy.body).data).not.toHaveProperty('pagination');
    expect(JSON.parse(page.body).data.servers).toHaveLength(1);
    expect(JSON.parse(page.body).pagination).toMatchObject({ page: 2, limit: 1, total: 4, totalPages: 4 });
    await app.close();
  });

  it('pages role relations without truncating the derived scope', async () => {
    const app = appFor(roleRoutes, ['*', 'role.read'], '/api/roles');
    const legacy = await app.inject({ method: 'GET', url: `/api/roles/${roleId}` });
    const page = await app.inject({ method: 'GET', url: `/api/roles/${roleId}?relationPage=2&relationLimit=1` });
    expect(legacy.statusCode).toBe(200);
    expect(page.statusCode).toBe(200);
    const legacyData = JSON.parse(legacy.body).data;
    const pageData = JSON.parse(page.body).data;
    expect(legacyData.users).toHaveLength(3);
    expect(legacyData).not.toHaveProperty('relationPagination');
    expect(pageData.users).toHaveLength(1);
    expect(pageData.serverGrants).toHaveLength(1);
    expect(pageData.scope.serverIds).toHaveLength(3);
    expect(pageData.relationPagination).toMatchObject({ page: 2, limit: 1 });
    await app.close();
  });
});
