/**
 * Regression: the panel advertises Start/Stop/Restart/Kill/Install for node
 * managers (node assignment + node.update) and for roles holding the matching
 * server permission, but the power routes only accepted owner / admin.write /
 * a ServerAccess row and returned 403. They must use the canonical
 * decideServerAccess contract instead.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { serverRoutes } from '../routes/servers.js';
import { nanoid } from 'nanoid';

let nodeManagerUserId: string;
let roleStarterUserId: string;
let noPermsUserId: string;
let ownerUserId: string;
let managerRoleId: string;
let starterRoleId: string;
let noPermsRoleId: string;
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
      email: 'power-test@example.com',
      username: 'power-test',
      permissions: [],
    };
  });

  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true }),
    relayBackupStream: async () => {},
  } as any);

  app.decorate('webhookService', {
    serverCreated: async () => {},
    serverDeleted: async () => {},
  });

  app.decorate('fileTunnel', {
    createTunnel: async () => ({ tunnelId: 'test-tunnel' }),
  });

  app.register(serverRoutes, { prefix: '/api/servers' });
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
  const managerRole = await prisma.role.create({
    data: { name: `test-power-manager-${nanoid(8)}`, permissions: ['node.read', 'node.update'] },
  });
  managerRoleId = managerRole.id;
  const starterRole = await prisma.role.create({
    data: { name: `test-power-starter-${nanoid(8)}`, permissions: ['server.start', 'server.stop'] },
  });
  starterRoleId = starterRole.id;
  const noPermsRole = await prisma.role.create({
    data: { name: `test-power-none-${nanoid(8)}`, permissions: ['server.read'] },
  });
  noPermsRoleId = noPermsRole.id;
  const ownerRole = await prisma.role.create({
    data: { name: `test-power-owner-${nanoid(8)}`, permissions: ['*'] },
  });
  ownerRoleId = ownerRole.id;

  nodeManagerUserId = await createUser(managerRoleId, 'power-manager');
  roleStarterUserId = await createUser(starterRoleId, 'power-starter');
  noPermsUserId = await createUser(noPermsRoleId, 'power-none');
  ownerUserId = await createUser(ownerRoleId, 'power-owner');

  const location = await prisma.location.create({
    data: { name: `test-power-loc-${nanoid(8)}` },
  });
  locationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `test-power-node-${nanoid(8)}`,
      locationId,
      hostname: 'power.example.com',
      publicAddress: '10.0.0.4',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  nodeId = node.id;

  await prisma.nodeAssignment.create({
    data: { nodeId, userId: nodeManagerUserId, assignedBy: ownerUserId },
  });

  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-power-template-${nanoid(8)}`,
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
      uuid: `test-power-${nanoid(12)}`,
      name: `test-power-server-${nanoid(8)}`,
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
});

afterAll(async () => {
  if (serverId) await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) {
    await prisma.nodeAssignment.deleteMany({ where: { nodeId } }).catch(() => {});
    await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  }
  for (const id of [nodeManagerUserId, roleStarterUserId, noPermsUserId, ownerUserId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [managerRoleId, starterRoleId, noPermsRoleId, ownerRoleId]) {
    if (id) await prisma.role.delete({ where: { id } }).catch(() => {});
  }
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('power route access decisions', () => {
  it('allows a node manager (node assignment + node.update) to start a server', async () => {
    const app = buildApp();
    currentUserId = nodeManagerUserId;
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/start`, payload: {} });
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it('allows a role holding server.start/server.stop to start and stop', async () => {
    const app = buildApp();
    currentUserId = roleStarterUserId;
    const start = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/start`, payload: {} });
    expect(start.statusCode).not.toBe(403);
    const stop = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/stop`, payload: {} });
    expect(stop.statusCode).not.toBe(403);
    await app.close();
  });

  it('still rejects a user with no power permission', async () => {
    const app = buildApp();
    currentUserId = noPermsUserId;
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/start`, payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
