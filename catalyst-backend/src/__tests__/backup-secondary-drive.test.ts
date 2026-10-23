/**
 * Secondary ("another drive") backup destination.
 *
 * Covers the security-critical part — path validation and containment — plus
 * the enable/disable contract: with the toggle off the create route rejects a
 * request that asks for the extra copy, and with it on the backup row records
 * a destination that stays inside the admin-configured directory.
 *
 * These run against the real dev database (repo convention) and clean up the
 * rows and the temporary "drive" they create.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { serverRoutes } from '../routes/servers.js';
import { backupRoutes } from '../routes/backups.js';
import { deleteBackupFromStorage } from '../services/backup-storage.js';
import {
  BackupSecondaryPathError,
  deleteSecondaryBackupCopy,
  materializeSecondaryCopy,
  normalizeSecondaryBackupPath,
  planSecondaryBackupPath,
  readBackupSecondarySettings,
  resolveSecondaryBackupFile,
  resolveSecondaryBackupRoot,
  updateBackupSecondarySettings,
  type BackupSecondarySettings,
} from '../services/backup-secondary.js';

let ownerRoleId: string;
let ownerUserId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let tmpRoot: string;
let originalSettings: BackupSecondarySettings;

function buildApp() {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: ownerUserId,
      email: 'backup-secondary@example.com',
      username: 'backup-secondary',
      permissions: ['*'],
    };
  });

  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true }),
    routeToClients: async () => {},
  } as any);

  app.decorate('webhookService', {
    serverCreated: async () => {},
    serverDeleted: async () => {},
  });

  app.decorate('fileTunnel', {
    createTunnel: async () => ({ tunnelId: 'test-tunnel' }),
  });

  app.register(serverRoutes, { prefix: '/api/servers' });
  app.register(backupRoutes, { prefix: '/api/servers' });
  return app;
}

beforeAll(async () => {
  originalSettings = await readBackupSecondarySettings();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'catalyst-secondary-drive-'));

  const role = await prisma.role.create({
    data: { name: `test-backup-secondary-${nanoid(8)}`, permissions: ['*'] },
  });
  ownerRoleId = role.id;

  const owner = await prisma.user.create({
    data: {
      email: `backup-secondary-${nanoid(8)}@example.com`,
      username: `backupsec${nanoid(4)}`,
      name: 'Backup Secondary',
      emailVerified: true,
      roles: { connect: { id: ownerRoleId } },
    },
  });
  ownerUserId = owner.id;

  const location = await prisma.location.create({
    data: { name: `test-backup-secondary-loc-${nanoid(8)}` },
  });
  locationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `test-backup-secondary-node-${nanoid(8)}`,
      locationId,
      hostname: 'backup-secondary.example.com',
      publicAddress: '10.0.0.4',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  nodeId = node.id;

  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-backup-secondary-template-${nanoid(8)}`,
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
      uuid: `backupsec-${nanoid(12)}`,
      name: `test-backup-secondary-server-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: ownerUserId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25566,
      backupStorageMode: 'local',
      backupAllocationMb: 4096,
    },
  });
  serverId = server.id;
});

afterAll(async () => {
  if (serverId) {
    await prisma.serverAccess.deleteMany({ where: { serverId } }).catch(() => {});
    await prisma.backup.deleteMany({ where: { serverId } }).catch(() => {});
    await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  }
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  if (ownerUserId) await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => {});
  if (ownerRoleId) await prisma.role.delete({ where: { id: ownerRoleId } }).catch(() => {});
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
  // Restore the instance-wide row so this suite cannot leak into others.
  if (originalSettings) {
    await updateBackupSecondarySettings(originalSettings).catch(() => {});
  }
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe('secondary backup path validation', () => {
  it('accepts a normal second-drive directory', () => {
    expect(normalizeSecondaryBackupPath('/mnt/backup-drive/catalyst')).toBe(
      '/mnt/backup-drive/catalyst',
    );
    expect(normalizeSecondaryBackupPath('  /srv/backups2  ')).toBe('/srv/backups2');
  });

  it('treats empty input as "not configured"', () => {
    expect(normalizeSecondaryBackupPath('')).toBeNull();
    expect(normalizeSecondaryBackupPath('   ')).toBeNull();
    expect(normalizeSecondaryBackupPath(null)).toBeNull();
  });

  it.each([
    ['relative path', 'mnt/backup-drive'],
    ['single dot segment', '/mnt/./backup-drive'],
    ['parent traversal', '/mnt/backup-drive/../..'],
    ['embedded traversal', '/mnt/../../etc'],
    ['filesystem root', '/'],
    ['too shallow', '/mnt'],
    ['control character', '/mnt/backup\u0000drive'],
    ['non-string', 42],
  ])('rejects %s', (_label, value) => {
    expect(() => normalizeSecondaryBackupPath(value as any)).toThrow(BackupSecondaryPathError);
  });

  it.each([
    '/var/lib/catalyst/backups',
    '/var/lib/catalyst/backups/secondary',
    '/tmp/catalyst-backup-stream/drive',
    '/tmp/catalyst-backup-transfer/drive',
    '/var/lib/catalyst/servers/drive',
    '/var/lib/catalyst',
  ])('refuses to overlap the managed directories (%s)', (value) => {
    expect(() => normalizeSecondaryBackupPath(value)).toThrow(BackupSecondaryPathError);
  });

  it('keeps a planned destination inside the root', () => {
    const root = '/mnt/backup-drive/catalyst';
    expect(planSecondaryBackupPath(root, 'abc-123', 'nightly.tar.gz')).toBe(
      `${root}/abc-123/nightly.tar.gz`,
    );
    expect(() => planSecondaryBackupPath(root, '../etc', 'nightly.tar.gz')).toThrow(
      BackupSecondaryPathError,
    );
    expect(() => planSecondaryBackupPath(root, 'abc', '../../etc/passwd')).toThrow(
      BackupSecondaryPathError,
    );
    expect(() => planSecondaryBackupPath(root, 'abc', '.hidden')).toThrow(
      BackupSecondaryPathError,
    );
  });
});

describe('secondary backup settings', () => {
  it('stores and clears the destination', async () => {
    const enabled = await updateBackupSecondarySettings({ enabled: true, path: tmpRoot });
    expect(enabled).toEqual({ enabled: true, path: tmpRoot });
    await expect(readBackupSecondarySettings()).resolves.toEqual({
      enabled: true,
      path: tmpRoot,
    });

    const disabled = await updateBackupSecondarySettings({ enabled: false, path: tmpRoot });
    expect(disabled.enabled).toBe(false);
    // A disabled destination keeps its path so it can be re-enabled later.
    expect(disabled.path).toBe(tmpRoot);
  });

  it('rejects a traversal path when saving', async () => {
    await expect(
      updateBackupSecondarySettings({ enabled: true, path: `${tmpRoot}/../../etc` }),
    ).rejects.toThrow(BackupSecondaryPathError);
  });

  it('rejects a configured directory that canonically resolves to something unsafe', async () => {
    // A harmless-looking directory name that is really a symlink to / or to the
    // primary backup tree must not become the containment root.
    const rootLink = path.join(tmpRoot, 'root-link');
    await fs.symlink('/', rootLink);
    await updateBackupSecondarySettings({ enabled: true, path: rootLink });
    await expect(resolveSecondaryBackupRoot()).rejects.toThrow(BackupSecondaryPathError);

    const backupsLink = path.join(tmpRoot, 'backups-link');
    await fs.symlink('/var/lib/catalyst/backups', backupsLink);
    await updateBackupSecondarySettings({ enabled: true, path: backupsLink });
    await expect(resolveSecondaryBackupRoot()).rejects.toThrow(BackupSecondaryPathError);

    await fs.unlink(rootLink);
    await fs.unlink(backupsLink);
    await updateBackupSecondarySettings({ enabled: true, path: tmpRoot });
  });

  it('fails loudly when the configured directory is gone', async () => {
    const missing = path.join(tmpRoot, 'unmounted-drive');
    await updateBackupSecondarySettings({ enabled: true, path: missing });
    await expect(resolveSecondaryBackupRoot()).rejects.toThrow(BackupSecondaryPathError);
    await updateBackupSecondarySettings({ enabled: true, path: tmpRoot });
  });
});

describe('secondary backup copy', () => {
  const fileName = 'nightly.tar.gz';

  it('writes atomically and only serves files inside the configured root', async () => {
    await updateBackupSecondarySettings({ enabled: true, path: tmpRoot });
    const target = path.join(tmpRoot, 'server-1', fileName);

    await materializeSecondaryCopy({
      secondaryPath: target,
      fetchTo: async (destination) => {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, 'archive-bytes');
      },
    });

    const resolved = await resolveSecondaryBackupFile(target);
    expect(resolved?.path).toBe(await fs.realpath(target));
    expect(resolved?.size).toBe('archive-bytes'.length);

    // Anything outside the root is refused, whatever the stored value says.
    const outside = path.join(os.tmpdir(), 'catalyst-secondary-escape', fileName);
    await expect(resolveSecondaryBackupFile(outside)).resolves.toBeNull();
    await expect(resolveSecondaryBackupFile('../../etc/passwd')).resolves.toBeNull();
    await expect(resolveSecondaryBackupFile(`${target}/../${fileName}`)).resolves.toBeNull();

    // A symlink planted at the destination is never followed.
    await fs.unlink(target);
    await fs.writeFile(path.join(tmpRoot, 'outside-file'), 'x');
    await fs.symlink(path.join(tmpRoot, 'outside-file'), target);
    await expect(resolveSecondaryBackupFile(target)).resolves.toBeNull();

    expect(await deleteSecondaryBackupCopy(target)).toBe(false);
    await fs.unlink(target);
    await fs.writeFile(target, 'archive-bytes');
    expect(await deleteSecondaryBackupCopy(target)).toBe(true);
    await expect(resolveSecondaryBackupFile(target)).resolves.toBeNull();
  });

  it('never creates a file outside the root', async () => {
    await updateBackupSecondarySettings({ enabled: true, path: tmpRoot });
    await expect(
      materializeSecondaryCopy({
        secondaryPath: path.join(tmpRoot, '..', 'escape', fileName),
        fetchTo: async () => {},
      }),
    ).rejects.toThrow(BackupSecondaryPathError);
  });

  it('is removed together with the backup record', async () => {
    await updateBackupSecondarySettings({ enabled: true, path: tmpRoot });
    const target = path.join(tmpRoot, 'server-delete', fileName);
    await materializeSecondaryCopy({
      secondaryPath: target,
      fetchTo: async (destination) => {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, 'archive-bytes');
      },
    });
    await expect(resolveSecondaryBackupFile(target)).resolves.not.toBeNull();

    const gateway = { sendToAgent: async () => true } as any;
    await deleteBackupFromStorage(
      gateway,
      {
        id: 'backup-delete-test',
        path: path.join(tmpRoot, 'missing-primary.tar.gz'),
        storageMode: 'local',
        metadata: { secondaryPath: target },
      },
      {
        id: serverId,
        uuid: 'server-delete-uuid',
        nodeId,
        node: { isOnline: true },
        backupS3Config: null,
        backupSftpConfig: null,
      },
    );

    await expect(resolveSecondaryBackupFile(target)).resolves.toBeNull();
  });
});

describe('POST /api/servers/:id/backups with secondaryDrive', () => {
  it('rejects the option while the drive is disabled', async () => {
    await updateBackupSecondarySettings({ enabled: false, path: tmpRoot });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/backups`,
      payload: { name: 'nightly', secondaryDrive: true },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BACKUP_SECONDARY_UNAVAILABLE');

    const server = await prisma.server.findUnique({ where: { id: serverId } });
    expect(server?.status).toBe('stopped');
    expect(await prisma.backup.count({ where: { serverId } })).toBe(0);

    await app.close();
  });

  it('records an in-root destination when the drive is enabled', async () => {
    await updateBackupSecondarySettings({ enabled: true, path: tmpRoot });
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/backups`,
      payload: { name: 'nightly', compressed: false, secondaryDrive: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    const backup = await prisma.backup.findUnique({ where: { id: body.backupId } });
    const metadata = backup?.metadata as { secondaryPath?: string };
    const uuid = (
      await prisma.server.findUnique({ where: { id: serverId }, select: { uuid: true } })
    )!.uuid;
    expect(backup?.compressed).toBe(false);
    expect(metadata.secondaryPath).toBe(
      path.join(await fs.realpath(tmpRoot), uuid, 'nightly.tar'),
    );

    // Leave the room tidy for the suite's other assertions.
    await prisma.backup.deleteMany({ where: { serverId } });
    await prisma.server.update({ where: { id: serverId }, data: { status: 'stopped' } });

    await app.close();
  });

  it('serves the download from the secondary copy when the node is offline', async () => {
    await updateBackupSecondarySettings({ enabled: true, path: tmpRoot });
    const uuid = (
      await prisma.server.findUnique({ where: { id: serverId }, select: { uuid: true } })
    )!.uuid;
    const secondary = planSecondaryBackupPath(tmpRoot, uuid, 'offline-backup.tar');
    await materializeSecondaryCopy({
      secondaryPath: secondary,
      fetchTo: async (destination) => {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, 'offline-archive-bytes');
      },
    });

    const backup = await prisma.backup.create({
      data: {
        serverId,
        name: 'offline-backup',
        // The agent copy is gone and the node is offline, so only the secondary
        // drive still holds the archive.
        path: path.join(tmpRoot, 'does-not-exist-primary.tar'),
        sizeMb: 0.01,
        compressed: false,
        storageMode: 'local',
        metadata: { secondaryPath: secondary },
      },
    });
    await prisma.node.update({ where: { id: nodeId }, data: { isOnline: false } });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/backups/${backup.id}/download`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('offline-archive-bytes');
    expect(res.headers['content-disposition']).toContain('offline-backup.tar');

    await app.close();
    await prisma.node.update({ where: { id: nodeId }, data: { isOnline: true } });
    await deleteSecondaryBackupCopy(secondary);
    await prisma.backup.delete({ where: { id: backup.id } });
  });

  it('exposes only the toggle and a directory label to the server UI', async () => {
    await updateBackupSecondarySettings({ enabled: true, path: tmpRoot });
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/backups/secondary-drive`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.enabled).toBe(true);
    expect(body.supported).toBe(true);
    expect(body.label).toBe(path.basename(tmpRoot));
    // The absolute path must never leak to a non-admin.
    expect(JSON.stringify(body)).not.toContain(tmpRoot);

    await app.close();
  });
});
