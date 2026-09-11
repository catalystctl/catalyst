/**
 * Regression: a global role granting `alert.read` (e.g. the Support preset)
 * was not accepted by the alerts route's local access check — the
 * role_permission branch of decideServerAccess was missing, so server-scoped
 * alert queries returned 403 for role-scoped readers. Bare node assignment
 * must still be rejected without node.update, and the check stays
 * per-permission (alert.read must not grant alert.create).
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { alertRoutes } from '../routes/alerts.js';
import { nanoid } from 'nanoid';

let supportUserId: string;
let nodeOnlyUserId: string;
let ownerUserId: string;
let supportRoleId: string;
let nodeOnlyRoleId: string;
let ownerRoleId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let currentUserId = '';

function buildApp() {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: currentUserId,
      email: 'alerts-test@example.com',
      username: 'alerts-test',
      permissions: [],
    };
  });
  app.decorate('wsGateway', { pushToAdminSubscribers: () => {} } as any);

  app.register(alertRoutes, { prefix: '/api' });
  return app;
}

async function createUser(roleId: string, name: string) {
  const user = await prisma.user.create({
    data: {
      email: `${name}-${nanoid(8)}@example.com`,
      username: `${name}${nanoid(4)}`,
      name,
      emailVerified: true,
      roles: { connect: { id: roleId } },
    },
  });
  return user.id;
}

beforeAll(async () => {
  const supportRole = await prisma.role.create({
    data: { name: `test-alerts-support-${nanoid(8)}`, permissions: ['server.read', 'alert.read'] },
  });
  supportRoleId = supportRole.id;
  const nodeOnlyRole = await prisma.role.create({
    data: { name: `test-alerts-node-${nanoid(8)}`, permissions: ['server.read'] },
  });
  nodeOnlyRoleId = nodeOnlyRole.id;
  const ownerRole = await prisma.role.create({
    data: { name: `test-alerts-owner-${nanoid(8)}`, permissions: ['*'] },
  });
  ownerRoleId = ownerRole.id;

  supportUserId = await createUser(supportRoleId, 'alerts-support');
  nodeOnlyUserId = await createUser(nodeOnlyRoleId, 'alerts-node');
  ownerUserId = await createUser(ownerRoleId, 'alerts-owner');

  const location = await prisma.location.create({
    data: { name: `test-alerts-loc-${nanoid(8)}` },
  });
  locationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `test-alerts-node-${nanoid(8)}`,
      locationId,
      hostname: 'alerts.example.com',
      publicAddress: '10.0.0.5',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  nodeId = node.id;

  await prisma.nodeAssignment.create({
    data: { nodeId, userId: nodeOnlyUserId, assignedBy: ownerUserId },
  });

  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-alerts-template-${nanoid(8)}`,
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

  const server = await prisma.server.create({
    data: {
      uuid: `test-alerts-${nanoid(12)}`,
      name: `test-alerts-server-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: ownerUserId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25571,
    },
  });
  serverId = server.id;
});

afterAll(async () => {
  if (serverId) await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) {
    await prisma.nodeAssignment.deleteMany({ where: { nodeId } }).catch(() => {});
    await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  }
  for (const id of [supportUserId, nodeOnlyUserId, ownerUserId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [supportRoleId, nodeOnlyRoleId, ownerRoleId]) {
    if (id) await prisma.role.delete({ where: { id } }).catch(() => {});
  }
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('alerts route access decisions', () => {
  it('allows a role holding alert.read to query a server it does not own', async () => {
    const app = buildApp();
    currentUserId = supportUserId;
    const res = await app.inject({ method: 'GET', url: `/api/alerts?serverId=${serverId}` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('still rejects bare node assignment without node.update', async () => {
    const app = buildApp();
    currentUserId = nodeOnlyUserId;
    const res = await app.inject({ method: 'GET', url: `/api/alerts?serverId=${serverId}` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('keeps the check per-permission (alert.read does not grant alert.create)', async () => {
    const app = buildApp();
    currentUserId = supportUserId;
    const res = await app.inject({
      method: 'POST',
      url: '/api/alert-rules',
      payload: {
        name: 'test-rule',
        type: 'resource_threshold',
        target: 'server',
        targetId: serverId,
        conditions: {},
        actions: {},
      },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
