import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';

import { prisma } from '../db.js';
import { backupRoutes } from '../routes/backups.js';

// Regression guard for the backup API-key scope bypass (server-files audit
// K1): ensureBackupAccess previously ignored the API key's own permission
// list — a key scoped to e.g. [server.read] belonging to the server owner or
// a backup-capable user could create/restore/delete/download backups. The
// helper now threads the request actor and calls enforceKeyScope on every
// allowed path. Tests hit the real dev database, matching the repo policy.

let ownerId: string;
let roleUserId: string;
let plainUserId: string;
let ownerRoleId: string;
let backupRoleId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;

let currentUserId = '';
let currentPerms: string[] = [];
let currentApiKey: string | undefined;

function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: currentUserId,
      email: 'bk@t.com',
      username: 'bk',
      permissions: currentPerms,
      ...(currentApiKey ? { apiKeyId: currentApiKey } : {}),
    };
  });
  app.decorate('wsGateway', { pushToAdminSubscribers: () => {} } as any);
  app.register(backupRoutes, { prefix: '/api/servers' });
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
  const res = await app.inject({ method: 'GET', url: `/api/servers/${serverId}/backups` });
  await app.close();
  return { statusCode: res.statusCode, body: res.json() };
}

beforeAll(async () => {
  const ownerRole = await prisma.role.create({
    data: { name: `test-bk-owner-${nanoid(8)}`, permissions: ['*'] },
  });
  ownerRoleId = ownerRole.id;
  const backupRole = await prisma.role.create({
    data: { name: `test-bk-grant-${nanoid(8)}`, permissions: ['backup.read'] },
  });
  backupRoleId = backupRole.id;

  const owner = await prisma.user.create({
    data: {
      email: `bk-owner-${nanoid(6)}@t.com`,
      username: `bkown_${nanoid(4)}`,
      name: 'bk owner',
      emailVerified: true,
      roles: { connect: { id: ownerRoleId } },
    },
  });
  ownerId = owner.id;
  const roleUser = await prisma.user.create({
    data: {
      email: `bk-role-${nanoid(6)}@t.com`,
      username: `bkrol_${nanoid(4)}`,
      name: 'bk role',
      emailVerified: true,
      roles: { connect: { id: backupRoleId } },
    },
  });
  roleUserId = roleUser.id;
  const plain = await prisma.user.create({
    data: {
      email: `bk-plain-${nanoid(6)}@t.com`,
      username: `bkpln_${nanoid(4)}`,
      name: 'bk plain',
      emailVerified: true,
    },
  });
  plainUserId = plain.id;

  const location = await prisma.location.create({
    data: { name: `test-bk-loc-${nanoid(8)}` },
  });
  locationId = location.id;
  const node = await prisma.node.create({
    data: {
      name: `test-bk-node-${nanoid(8)}`,
      locationId,
      hostname: 'bk.example.com',
      publicAddress: '10.0.0.11',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  nodeId = node.id;
  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-bk-template-${nanoid(8)}`,
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
      uuid: `test-bk-${nanoid(12)}`,
      name: `test-bk-server-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25574,
    },
  });
  serverId = server.id;
});

afterAll(async () => {
  if (serverId) await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  for (const id of [ownerId, roleUserId, plainUserId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [ownerRoleId, backupRoleId]) {
    if (id) await prisma.role.delete({ where: { id } }).catch(() => {});
  }
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('backup API-key scope (ensureBackupAccess actor threading)', () => {
  it('owner via session (no API key) lists backups', async () => {
    const { statusCode } = await requestAs(ownerId, ['*']);
    expect(statusCode).toBe(200);
  });

  it('owner via narrow-scoped API key is rejected (key lacks backup.read)', async () => {
    // The user is the owner (user-level allow), but the key itself only
    // holds server.read — the scope ceiling must 403.
    const { statusCode, body } = await requestAs(ownerId, ['server.read'], 'key_test_1');
    expect(statusCode).toBe(403);
    expect(body.code).toBe('PERMISSION_DENIED');
  });

  it('owner via API key holding backup.read passes', async () => {
    const { statusCode } = await requestAs(ownerId, ['backup.read'], 'key_test_2');
    expect(statusCode).toBe(200);
  });

  it('role-grant user via session passes; via narrow key is rejected', async () => {
    const session = await requestAs(roleUserId, ['backup.read']);
    expect(session.statusCode).toBe(200);

    const narrowKey = await requestAs(roleUserId, ['server.read'], 'key_test_3');
    expect(narrowKey.statusCode).toBe(403);
  });

  it('an unrelated user without any grant is rejected', async () => {
    const { statusCode } = await requestAs(plainUserId, []);
    expect(statusCode).toBe(403);
  });
});
