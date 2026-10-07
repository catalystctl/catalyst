/**
 * Metrics read-gate contract (test-plan §5d):
 *  - server metrics admit admin.read/admin.write roles (the exact-match
 *    includes() previously locked them out — hasGrant fix);
 *  - bare node assignment WITHOUT node.update cannot read another tenant's
 *    metrics (pin of the node-pairing guard);
 *  - node metrics history admits node.view_stats + admin bits via hasGrant
 *    (metrics.ts /nodes/:nodeId/metrics), with no hasNodeAccess requirement
 *    per the vocabulary decision.
 *
 * P-A inject harness: session-shaped request.user with permissions resolved
 * from the user's global roles (mirrors src/server.ts authenticate →
 * resolveUserPermissions). The route's DB layer (server ownership,
 * ServerAccess row, resolveServerPermissions) runs against the real dev DB.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { metricsRoutes } from '../routes/metrics.js';
import { nanoid } from 'nanoid';

let ownerUserId: string;
let adminReadUserId: string;
let adminWriteUserId: string;
let serverReadUserId: string;
let nodeStatsUserId: string;
let noPermsUserId: string;
let nodeAssigneeUserId: string;
let nodeManagerUserId: string;
let subuserId: string;
let ownerRoleId: string;
let adminReadRoleId: string;
let adminWriteRoleId: string;
let serverReadRoleId: string;
let nodeStatsRoleId: string;
let noPermsRoleId: string;
let nodeAssigneeRoleId: string;
let nodeManagerRoleId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let currentUserId = '';

function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    // Session shape: permissions resolved from global roles (DB), like the
    // production session path.
    const user = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { roles: { select: { permissions: true } } },
    });
    request.user = {
      userId: currentUserId,
      email: 'metrics-test@example.com',
      username: 'metrics-test',
      permissions: user?.roles.flatMap((r) => r.permissions) ?? [],
    };
  });
  app.register(metricsRoutes, { prefix: '/api' });
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

async function getAs(userId: string, url: string) {
  const app = buildApp();
  currentUserId = userId;
  const res = await app.inject({ method: 'GET', url });
  await app.close();
  return res;
}

beforeAll(async () => {
  const mkRole = (perms: string[], tag: string) =>
    prisma.role.create({ data: { name: `test-metrics-${tag}-${nanoid(8)}`, permissions: perms } });

  const [ownerRole, adminReadRole, adminWriteRole, serverReadRole, nodeStatsRole, noPermsRole, nodeAssigneeRole, nodeManagerRole] =
    await Promise.all([
      mkRole(['*'], 'owner'),
      mkRole(['admin.read'], 'adminread'),
      mkRole(['admin.write'], 'adminwrite'),
      mkRole(['server.read'], 'serverread'),
      mkRole(['node.view_stats'], 'nodestats'),
      mkRole(['alert.read'], 'noperms'),
      mkRole(['node.read'], 'nodeassignee'),
      mkRole(['node.read', 'node.update'], 'nodemanager'),
    ]);
  ownerRoleId = ownerRole.id;
  adminReadRoleId = adminReadRole.id;
  adminWriteRoleId = adminWriteRole.id;
  serverReadRoleId = serverReadRole.id;
  nodeStatsRoleId = nodeStatsRole.id;
  noPermsRoleId = noPermsRole.id;
  nodeAssigneeRoleId = nodeAssigneeRole.id;
  nodeManagerRoleId = nodeManagerRole.id;

  [ownerUserId, adminReadUserId, adminWriteUserId, serverReadUserId, nodeStatsUserId, noPermsUserId, nodeAssigneeUserId, nodeManagerUserId] =
    await Promise.all([
      createUser(ownerRoleId, 'metrics-owner'),
      createUser(adminReadRoleId, 'metrics-adminread'),
      createUser(adminWriteRoleId, 'metrics-adminwrite'),
      createUser(serverReadRoleId, 'metrics-serverread'),
      createUser(nodeStatsRoleId, 'metrics-nodestats'),
      createUser(noPermsRoleId, 'metrics-noperms'),
      createUser(nodeAssigneeRoleId, 'metrics-nodeassignee'),
      createUser(nodeManagerRoleId, 'metrics-nodemanager'),
    ]);

  const location = await prisma.location.create({ data: { name: `test-metrics-loc-${nanoid(8)}` } });
  locationId = location.id;
  const node = await prisma.node.create({
    data: {
      name: `test-metrics-node-${nanoid(8)}`,
      locationId,
      hostname: 'metrics.example.com',
      publicAddress: '10.0.0.9',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  nodeId = node.id;

  // Bare node assignment (no node.update) — must NOT read tenant metrics.
  await prisma.nodeAssignment.create({
    data: { nodeId, userId: nodeAssigneeUserId, assignedBy: ownerUserId },
  });
  await prisma.nodeAssignment.create({
    data: { nodeId, userId: nodeManagerUserId, assignedBy: ownerUserId },
  });

  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-metrics-template-${nanoid(8)}`,
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
      uuid: `test-metrics-${nanoid(12)}`,
      name: `test-metrics-server-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: ownerUserId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25570,
    },
  });
  serverId = server.id;

  // Subuser with an explicit read grant row (own user, no roles, so the
  // plain-user deny case below stays row-free).
  const subRowUser = await prisma.user.create({
    data: {
      email: `metrics-subuser-${nanoid(8)}@example.com`,
      username: `metricssub${nanoid(4)}`,
      name: 'metrics-subuser',
      emailVerified: true,
    },
  });
  subuserId = subRowUser.id;
  await prisma.serverAccess.create({
    data: { serverId, userId: subuserId, permissions: ['server.read'] },
  });
});

afterAll(async () => {
  if (serverId) await prisma.serverAccess.deleteMany({ where: { serverId } }).catch(() => {});
  if (serverId) await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) {
    await prisma.nodeAssignment.deleteMany({ where: { nodeId } }).catch(() => {});
    await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  }
  for (const id of [ownerUserId, adminReadUserId, adminWriteUserId, serverReadUserId, nodeStatsUserId, noPermsUserId, nodeAssigneeUserId, nodeManagerUserId, subuserId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [ownerRoleId, adminReadRoleId, adminWriteRoleId, serverReadRoleId, nodeStatsRoleId, noPermsRoleId, nodeAssigneeRoleId, nodeManagerRoleId]) {
    if (id) await prisma.role.delete({ where: { id } }).catch(() => {});
  }
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

function users() {
  return {
    owner: ownerUserId,
    adminRead: adminReadUserId,
    adminWrite: adminWriteUserId,
    serverRead: serverReadUserId,
    nodeStats: nodeStatsUserId,
    noPerms: noPermsUserId,
    nodeAssignee: nodeAssigneeUserId,
    subuser: subuserId,
    nodeManager: nodeManagerUserId,
  };
}

function userByKey(key: string) {
  return users()[key as keyof ReturnType<typeof users>];
}

describe('server metrics read gate (history + stats)', () => {
  it.each([
    ['owner', 'owner'],
    ['admin.read role', 'adminRead'],
    ['bare admin.write role', 'adminWrite'],
    ['server.read role', 'serverRead'],
    ['ServerAccess row [server.read]', 'subuser'],
    ['node manager (assignment + node.update)', 'nodeManager'],
  ])('admits %s', async (_label, key) => {
    const userId = userByKey(key as string);
    const res = await getAs(userId, `/api/servers/${serverId}/metrics`);
    expect(res.statusCode).toBe(200);
    const resStats = await getAs(userId, `/api/servers/${serverId}/stats`);
    expect(resStats.statusCode).toBe(200);
  });

  it('rejects a plain user with no server.read-class grant', async () => {
    const res = await getAs(userByKey('noPerms'), `/api/servers/${serverId}/metrics`);
    expect(res.statusCode).toBe(403);
    const resStats = await getAs(userByKey('noPerms'), `/api/servers/${serverId}/stats`);
    expect(resStats.statusCode).toBe(403);
  });

  it('bare node assignment without node.update cannot read another tenant\'s metrics', async () => {
    const res = await getAs(userByKey('nodeAssignee'), `/api/servers/${serverId}/metrics`);
    expect(res.statusCode).toBe(403);
    const resStats = await getAs(userByKey('nodeAssignee'), `/api/servers/${serverId}/stats`);
    expect(resStats.statusCode).toBe(403);
  });
});

describe('node metrics history gate (/nodes/:nodeId/metrics)', () => {
  it.each([
    ['admin.read role', 'adminRead'],
    ['admin.write role', 'adminWrite'],
    ['node.view_stats role', 'nodeStats'],
  ])('admits %s', async (_label, key) => {
    const res = await getAs(userByKey(key as string), `/api/nodes/${nodeId}/metrics`);
    expect(res.statusCode).toBe(200);
  });

  it('rejects a plain user without node.view_stats or admin bits', async () => {
    const res = await getAs(userByKey('noPerms'), `/api/nodes/${nodeId}/metrics`);
    expect(res.statusCode).toBe(403);
  });
});
