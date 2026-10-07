import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';

import { prisma } from '../db.js';
import { serverDatabasesRoutes } from '../routes/servers/databases.js';

// Regression guard for GET /api/servers/database-hosts (server-files audit
// C-NO-CHECK + TARGET-VOCABULARY §2.3): the full panel-wide host inventory
// now requires admin.read (via hasGrant, so admin.write/* still pass, and
// the request's own permission list is consulted so API-key scopes are
// enforced). Non-admin callers keep a minimal create-database dropdown
// scoped to hosts already referenced by their accessible servers' databases
// — no panel-wide infra disclosure. Tests hit the real dev database.

let adminUserId: string;
let subuserId: string;
let strangerUserId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let referencedHostId: string;
let unreferencedHostId: string;
let serverDatabaseId: string;

let currentUserId = '';
let currentPerms: string[] = [];
let currentApiKey: string | undefined;

function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: currentUserId,
      email: 'dh@t.com',
      username: 'dh',
      permissions: currentPerms,
      ...(currentApiKey ? { apiKeyId: currentApiKey } : {}),
    };
  });
  app.register(serverDatabasesRoutes, { prefix: '/api/servers' });
  return app;
}

async function requestAs(
  userId: string,
  perms: string[],
  apiKeyId?: string,
): Promise<{ statusCode: number; body: any }> {
  currentUserId = userId;
  currentPerms = perms;
  currentApiKey = apiKeyId;
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/api/servers/database-hosts' });
  await app.close();
  return { statusCode: res.statusCode, body: res.json() };
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      email: `dh-admin-${nanoid(6)}@t.com`,
      username: `dhadm_${nanoid(4)}`,
      name: 'dh admin',
      emailVerified: true,
    },
  });
  adminUserId = admin.id;
  const subuser = await prisma.user.create({
    data: {
      email: `dh-sub-${nanoid(6)}@t.com`,
      username: `dhsub_${nanoid(4)}`,
      name: 'dh sub',
      emailVerified: true,
    },
  });
  subuserId = subuser.id;
  const stranger = await prisma.user.create({
    data: {
      email: `dh-str-${nanoid(6)}@t.com`,
      username: `dhstr_${nanoid(4)}`,
      name: 'dh stranger',
      emailVerified: true,
    },
  });
  strangerUserId = stranger.id;

  const location = await prisma.location.create({
    data: { name: `test-dh-loc-${nanoid(8)}` },
  });
  locationId = location.id;
  const node = await prisma.node.create({
    data: {
      name: `test-dh-node-${nanoid(8)}`,
      locationId,
      hostname: 'dh.example.com',
      publicAddress: '10.0.0.12',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  nodeId = node.id;
  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-dh-template-${nanoid(8)}`,
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
      uuid: `test-dh-${nanoid(12)}`,
      name: `test-dh-server-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: adminUserId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25575,
    },
  });
  serverId = server.id;

  await prisma.serverAccess.create({
    data: {
      serverId,
      userId: subuserId,
      permissions: ['file.read'],
    },
  });

  const referencedHost = await prisma.databaseHost.create({
    data: {
      name: `test-dh-host-a-${nanoid(6)}`,
      host: 'db-a.example.com',
      port: 3306,
      username: 'dh_a',
      password: `pw-${nanoid(8)}`,
    },
  });
  referencedHostId = referencedHost.id;
  const unreferencedHost = await prisma.databaseHost.create({
    data: {
      name: `test-dh-host-b-${nanoid(6)}`,
      host: 'db-b.example.com',
      port: 3306,
      username: 'dh_b',
      password: `pw-${nanoid(8)}`,
    },
  });
  unreferencedHostId = unreferencedHost.id;

  const serverDatabase = await prisma.serverDatabase.create({
    data: {
      serverId,
      hostId: referencedHostId,
      name: `dhdb_${nanoid(6)}`,
      username: `dhdb_${nanoid(6)}`,
      password: `pw-${nanoid(8)}`,
    },
  });
  serverDatabaseId = serverDatabase.id;
});

afterAll(async () => {
  if (serverDatabaseId) await prisma.serverDatabase.delete({ where: { id: serverDatabaseId } }).catch(() => {});
  for (const id of [referencedHostId, unreferencedHostId]) {
    if (id) await prisma.databaseHost.delete({ where: { id } }).catch(() => {});
  }
  if (serverId) {
    await prisma.serverAccess.deleteMany({ where: { serverId } }).catch(() => {});
    await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  }
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  for (const id of [adminUserId, subuserId, strangerUserId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('GET /api/servers/database-hosts', () => {
  it('admin.read sees the full panel-wide host inventory', async () => {
    const { statusCode, body } = await requestAs(adminUserId, ['admin.read']);
    expect(statusCode).toBe(200);
    const ids = body.data.map((h: { id: string }) => h.id);
    expect(ids).toContain(referencedHostId);
    expect(ids).toContain(unreferencedHostId);
  });

  it('admin.write and * tiers still pass (hasGrant implications)', async () => {
    const write = await requestAs(adminUserId, ['admin.write']);
    expect(write.statusCode).toBe(200);
    const wild = await requestAs(adminUserId, ['*']);
    expect(wild.statusCode).toBe(200);
  });

  it('a narrow-scoped API key is held to the key scope, not the user roles', async () => {
    // Same admin user, but the key itself only holds server.read: the key
    // must not unlock the panel-wide inventory, and the user has no server
    // relation beyond ownership — ownership does grant the scoped list, so
    // assert the response is scoped, not full.
    const { statusCode, body } = await requestAs(adminUserId, ['server.read'], 'key_dh_1');
    expect(statusCode).toBe(200);
    const ids = body.data.map((h: { id: string }) => h.id);
    expect(ids).toContain(referencedHostId);
    expect(ids).not.toContain(unreferencedHostId);
  });

  it('a subuser with ServerAccess sees only hosts referenced by their servers', async () => {
    const { statusCode, body } = await requestAs(subuserId, ['file.read']);
    expect(statusCode).toBe(200);
    const ids = body.data.map((h: { id: string }) => h.id);
    expect(ids).toEqual([referencedHostId]);
  });

  it('a user with no server relation gets 403', async () => {
    const { statusCode } = await requestAs(strangerUserId, ['server.read']);
    expect(statusCode).toBe(403);
  });
});
