/**
 * Regression: the panel shows masked backup secrets ("********") and sends
 * them back on the next save. The route must treat the mask as "keep the
 * stored value" (storing it destroyed the S3/SFTP credentials), and an
 * unchanged resend must not count as a credential change (that 403'd
 * retention-only saves for backup.create holders).
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { serverRoutes } from '../routes/servers.js';
import {
  encryptBackupConfig,
  decryptBackupConfig,
} from '../services/backup-credentials.js';
import { nanoid } from 'nanoid';

let ownerUserId: string;
let limitedUserId: string;
let ownerRoleId: string;
let limitedRoleId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let previousKey: string | undefined;

function buildApp() {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: limitedUserId,
      email: 'backup-limited@example.com',
      username: 'backup-limited',
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

beforeAll(async () => {
  previousKey = process.env.BACKUP_CREDENTIALS_ENCRYPTION_KEY;
  process.env.BACKUP_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

  const ownerRole = await prisma.role.create({
    data: { name: `test-backup-owner-${nanoid(8)}`, permissions: ['*'] },
  });
  ownerRoleId = ownerRole.id;
  const limitedRole = await prisma.role.create({
    data: { name: `test-backup-limited-${nanoid(8)}`, permissions: [] },
  });
  limitedRoleId = limitedRole.id;

  const owner = await prisma.user.create({
    data: {
      email: `backup-owner-${nanoid(8)}@example.com`,
      username: `backupowner${nanoid(4)}`,
      name: 'Backup Owner',
      emailVerified: true,
      roles: { connect: { id: ownerRoleId } },
    },
  });
  ownerUserId = owner.id;

  const limited = await prisma.user.create({
    data: {
      email: `backup-limited-${nanoid(8)}@example.com`,
      username: `backupltd${nanoid(4)}`,
      name: 'Backup Limited',
      emailVerified: true,
      roles: { connect: { id: limitedRoleId } },
    },
  });
  limitedUserId = limited.id;

  const location = await prisma.location.create({
    data: { name: `test-backup-loc-${nanoid(8)}` },
  });
  locationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `test-backup-node-${nanoid(8)}`,
      locationId,
      hostname: 'backup.example.com',
      publicAddress: '10.0.0.3',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
    },
  });
  nodeId = node.id;

  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-backup-template-${nanoid(8)}`,
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
      uuid: `test-backup-${nanoid(12)}`,
      name: `test-backup-server-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: ownerUserId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25565,
      backupStorageMode: 's3',
      backupS3Config: encryptBackupConfig({
        bucket: 'bucket',
        region: 'region',
        endpoint: 'endpoint',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'real-secret',
        pathStyle: false,
      }) as any,
    },
  });
  serverId = server.id;

  await prisma.serverAccess.create({
    data: {
      serverId,
      userId: limitedUserId,
      permissions: ['backup.create'],
    },
  });
});

afterAll(async () => {
  if (serverId) {
    await prisma.serverAccess.deleteMany({ where: { serverId } }).catch(() => {});
    await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  }
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  if (limitedUserId) await prisma.user.delete({ where: { id: limitedUserId } }).catch(() => {});
  if (ownerUserId) await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => {});
  if (ownerRoleId) await prisma.role.delete({ where: { id: ownerRoleId } }).catch(() => {});
  if (limitedRoleId) await prisma.role.delete({ where: { id: limitedRoleId } }).catch(() => {});
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
  if (previousKey === undefined) delete process.env.BACKUP_CREDENTIALS_ENCRYPTION_KEY;
  else process.env.BACKUP_CREDENTIALS_ENCRYPTION_KEY = previousKey;
});

describe('PATCH /api/servers/:id/backup-settings', () => {
  it('keeps the stored secret when the panel sends the redaction mask', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/backup-settings`,
      payload: {
        storageMode: 's3',
        retentionCount: 7,
        s3Config: {
          bucket: 'bucket',
          region: 'region',
          endpoint: 'endpoint',
          accessKeyId: 'AKIAEXAMPLE',
          secretAccessKey: '********',
          pathStyle: false,
        },
      },
    });

    expect(res.statusCode).toBe(200);

    const stored = await prisma.server.findUnique({ where: { id: serverId } });
    const config = decryptBackupConfig(stored?.backupS3Config as any);
    expect(config?.secretAccessKey).toBe('real-secret');
    expect(stored?.backupRetentionCount).toBe(7);

    await app.close();
  });

  it('still requires the admin path when a real new secret is submitted', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/backup-settings`,
      payload: {
        s3Config: {
          bucket: 'bucket',
          region: 'region',
          endpoint: 'endpoint',
          accessKeyId: 'AKIAEXAMPLE',
          secretAccessKey: 'attacker-endpoint-secret',
          pathStyle: false,
        },
      },
    });

    expect(res.statusCode).toBe(403);

    const stored = await prisma.server.findUnique({ where: { id: serverId } });
    const config = decryptBackupConfig(stored?.backupS3Config as any);
    expect(config?.secretAccessKey).toBe('real-secret');

    await app.close();
  });
});
