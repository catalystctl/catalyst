/**
 * Regression: a per-server custom startup command (`Server.startupCommand`)
 * must be honored consistently by every power path that forwards a template to
 * the agent.
 *
 * It already worked on `POST /:serverId/start` and `POST /:serverId/rebuild`,
 * but `POST /:serverId/restart` (and the install/reinstall payload builder)
 * forwarded `patchTemplateForRuntime(server.template)` without applying the
 * override — so a saved startup command silently reverted to the template
 * default after a restart.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { serverRoutes } from '../routes/servers.js';
import { nanoid } from 'nanoid';

let ownerUserId: string;
let ownerRoleId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let currentUserId = '';

const TEMPLATE_STARTUP = 'echo template-default';
const CUSTOM_STARTUP = './custom-start --flag';

/** Templates forwarded to the agent, keyed by command type. */
const forwarded: Record<string, any> = {};

function buildApp() {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: currentUserId,
      email: 'startup-override@example.com',
      username: 'startup-override',
      permissions: [],
    };
  });

  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    sendToAgent: async (_nodeId: string, command: any) => {
      if (command?.type) forwarded[command.type] = command;
      return true;
    },
    requestFromAgent: async (_nodeId: string, command: any) => {
      if (command?.type) forwarded[command.type] = command;
      return { success: true };
    },
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

beforeAll(async () => {
  const ownerRole = await prisma.role.create({
    data: { name: `test-startup-owner-${nanoid(8)}`, permissions: ['*'] },
  });
  ownerRoleId = ownerRole.id;

  const owner = await prisma.user.create({
    data: {
      email: `startup-owner-${nanoid(8)}@example.com`,
      username: `startup-owner-${nanoid(4)}`,
      name: 'startup-owner',
      emailVerified: true,
      roles: { connect: { id: ownerRoleId } },
    },
  });
  ownerUserId = owner.id;

  const location = await prisma.location.create({
    data: { name: `test-startup-loc-${nanoid(8)}` },
  });
  locationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `test-startup-node-${nanoid(8)}`,
      locationId,
      hostname: 'startup.example.com',
      publicAddress: '10.0.0.9',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  nodeId = node.id;

  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-startup-template-${nanoid(8)}`,
      author: 'Test',
      version: '1.0.0',
      image: 'alpine:latest',
      startup: TEMPLATE_STARTUP,
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
      uuid: `test-startup-${nanoid(12)}`,
      name: `test-startup-server-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: ownerUserId,
      startupCommand: CUSTOM_STARTUP,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25571,
    },
  });
  serverId = server.id;

  currentUserId = ownerUserId;
});

afterAll(async () => {
  if (serverId) await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  if (ownerUserId) await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => {});
  if (ownerRoleId) await prisma.role.delete({ where: { id: ownerRoleId } }).catch(() => {});
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('custom startup command propagation', () => {
  it('honors Server.startupCommand on start', async () => {
    await prisma.server.update({ where: { id: serverId }, data: { status: 'stopped' } });
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/start`, payload: {} });
    expect(res.statusCode).not.toBe(403);
    expect(forwarded['start_server']?.template?.startup).toBe(CUSTOM_STARTUP);
    await app.close();
  });

  it('honors Server.startupCommand on restart', async () => {
    await prisma.server.update({ where: { id: serverId }, data: { status: 'running' } });
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/restart`, payload: {} });
    expect(res.statusCode).not.toBe(403);
    expect(forwarded['restart_server']?.template?.startup).toBe(CUSTOM_STARTUP);
    await app.close();
  });

  it('honors Server.startupCommand on install', async () => {
    await prisma.server.update({ where: { id: serverId }, data: { status: 'stopped' } });
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/install`, payload: {} });
    expect(res.statusCode).not.toBe(403);
    expect(forwarded['install_server']?.template?.startup).toBe(CUSTOM_STARTUP);
    await app.close();
  });
});
