/**
 * Permission split regression tests (issues #318 and #319).
 *
 * #319 — `server.update` used to gate the startup command, template variables
 *        and the resource/port fields at once. It is now split into
 *        `server.startup`, `server.resources` and `server.network`, with
 *        `server.update` kept as the umbrella through LEGACY_ALIASES.
 * #318 — `PATCH /:id/backup-settings` accepted `backupAllocationMb` from a
 *        subuser holding only `backup.create`, letting them raise their own
 *        quota to the 1 TB ceiling. It now needs the same `server.update`
 *        grant as `PUT /:id`.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { serverRoutes } from '../routes/servers.js';

let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let ownerUserId: string;
let ownerRoleId: string;
const createdUserIds: string[] = [];
const createdRoleIds: string[] = [];
const createdAccessIds: string[] = [];

let currentUserId = '';

function buildApp() {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: currentUserId,
      email: 'split-test@example.com',
      username: 'split-test',
      permissions: [],
    };
  });

  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true }),
    relayBackupStream: async () => {},
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
  return app;
}

/** Create a subuser holding exactly `permissions` on the shared server. */
async function grantSubuser(permissions: string[]): Promise<string> {
  const role = await prisma.role.create({
    data: { name: `split-sub-${nanoid(8)}`, permissions: [] },
  });
  createdRoleIds.push(role.id);
  const user = await prisma.user.create({
    data: {
      email: `split-sub-${nanoid(8)}@example.com`,
      username: `split-sub-${nanoid(4)}`,
      name: 'split-sub',
      emailVerified: true,
      roles: { connect: { id: role.id } },
    },
  });
  createdUserIds.push(user.id);
  const access = await prisma.serverAccess.create({
    data: { serverId, userId: user.id, permissions },
  });
  createdAccessIds.push(access.id);
  return user.id;
}

beforeAll(async () => {
  const ownerRole = await prisma.role.create({
    data: { name: `split-owner-${nanoid(8)}`, permissions: ['*'] },
  });
  ownerRoleId = ownerRole.id;

  const owner = await prisma.user.create({
    data: {
      email: `split-owner-${nanoid(8)}@example.com`,
      username: `split-owner-${nanoid(4)}`,
      name: 'split-owner',
      emailVerified: true,
      roles: { connect: { id: ownerRoleId } },
    },
  });
  ownerUserId = owner.id;

  const location = await prisma.location.create({
    data: { name: `split-loc-${nanoid(8)}` },
  });
  locationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `split-node-${nanoid(8)}`,
      locationId,
      hostname: 'split.example.com',
      publicAddress: '10.0.0.11',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 32768,
      maxCpuCores: 16,
      isOnline: true,
    },
  });
  nodeId = node.id;

  const template = await prisma.serverTemplate.create({
    data: {
      name: `split-template-${nanoid(8)}`,
      author: 'Test',
      version: '1.0.0',
      image: 'alpine:latest',
      startup: 'echo template-default',
      stopCommand: 'stop',
      supportedPorts: [],
      variables: [
        {
          name: 'PUBLIC_SERVER',
          description: 'Advertise the server',
          default: '1',
          required: false,
          input: 'checkbox',
          rules: ['boolean'],
          trueValue: '1',
          falseValue: '0',
        },
        {
          name: 'WORLD_NAME',
          description: 'World name',
          default: 'Midgard',
          required: false,
          input: 'text',
          rules: [],
        },
      ] as any,
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 1,
    },
  });
  templateId = template.id;

  const server = await prisma.server.create({
    data: {
      uuid: `split-${nanoid(12)}`,
      name: `split-server-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: ownerUserId,
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 1,
      allocatedDiskMb: 10240,
      primaryPort: 25572,
      status: 'stopped',
      environment: { PUBLIC_SERVER: '1', WORLD_NAME: 'Midgard' },
      backupStorageMode: 'local',
      backupAllocationMb: 5120,
      backupRetentionCount: 3,
    },
  });
  serverId = server.id;
});

afterAll(async () => {
  if (createdAccessIds.length) {
    await prisma.serverAccess.deleteMany({ where: { id: { in: createdAccessIds } } });
  }
  if (serverId) await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  if (ownerUserId) await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => {});
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (ownerRoleId) await prisma.role.delete({ where: { id: ownerRoleId } }).catch(() => {});
  if (createdRoleIds.length) {
    await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
  }
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('server.update split (#319)', () => {
  it('lets server.startup edit the startup command and variables only', async () => {
    currentUserId = await grantSubuser(['server.read', 'server.startup']);
    const app = buildApp();

    const startup = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: { startupCommand: 'echo from-startup-grant' },
    });
    expect(startup.statusCode).toBe(200);

    const vars = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/variables`,
      payload: { WORLD_NAME: 'Asgard', PUBLIC_SERVER: 'true' },
    });
    expect(vars.statusCode).toBe(200);

    const stored = await prisma.server.findUnique({ where: { id: serverId } });
    expect(stored?.startupCommand).toBe('echo from-startup-grant');
    // The imported-egg 1/0 format survives the save (#313).
    expect((stored?.environment as any).PUBLIC_SERVER).toBe('1');

    // …but resources and ports stay out of reach.
    const resources = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: { allocatedMemoryMb: 4096 },
    });
    expect(resources.statusCode).toBe(403);

    const network = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: { primaryPort: 25599 },
    });
    expect(network.statusCode).toBe(403);

    await app.close();
  });

  it('lets server.resources change memory/CPU/disk but not startup', async () => {
    currentUserId = await grantSubuser(['server.read', 'server.resources']);
    const app = buildApp();

    const resources = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: { allocatedMemoryMb: 2048, allocatedCpuCores: 2 },
    });
    expect(resources.statusCode).toBe(200);

    const startup = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: { startupCommand: 'echo nope' },
    });
    expect(startup.statusCode).toBe(403);

    const vars = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/variables`,
      payload: { WORLD_NAME: 'Nope' },
    });
    expect(vars.statusCode).toBe(403);

    await app.close();
  });

  it('lets server.network bind ports but not change resources', async () => {
    currentUserId = await grantSubuser(['server.read', 'server.network']);
    const app = buildApp();

    const network = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: { primaryPort: 25580 },
    });
    expect(network.statusCode).toBe(200);

    const resources = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: { allocatedMemoryMb: 8192 },
    });
    expect(resources.statusCode).toBe(403);

    await app.close();
  });

  it('keeps server.update as the umbrella for every family', async () => {
    currentUserId = await grantSubuser(['server.read', 'server.update']);
    const app = buildApp();

    const update = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: {
        name: 'renamed-by-umbrella',
        startupCommand: 'echo umbrella',
        allocatedMemoryMb: 1536,
        primaryPort: 25581,
      },
    });
    expect(update.statusCode).toBe(200);

    const vars = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/variables`,
      payload: { WORLD_NAME: 'Umbrella' },
    });
    expect(vars.statusCode).toBe(200);

    await app.close();
  });

  it('rejects a name-only edit without server.update', async () => {
    currentUserId = await grantSubuser(['server.read', 'server.startup']);
    const app = buildApp();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/servers/${serverId}`,
      payload: { name: 'renamed-without-update' },
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });
});

describe('backup settings allocation gate (#318)', () => {
  it('refuses a backupAllocationMb raise from backup.create alone', async () => {
    currentUserId = await grantSubuser(['server.read', 'backup.create']);
    const app = buildApp();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/backup-settings`,
      payload: { backupAllocationMb: 1048576 },
    });
    expect(res.statusCode).toBe(403);

    const stored = await prisma.server.findUnique({ where: { id: serverId } });
    expect(stored?.backupAllocationMb).toBe(5120);

    await app.close();
  });

  it('still lets backup.create change retention', async () => {
    currentUserId = await grantSubuser(['server.read', 'backup.create']);
    const app = buildApp();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/backup-settings`,
      payload: { retentionCount: 7 },
    });
    expect(res.statusCode).toBe(200);

    const stored = await prisma.server.findUnique({ where: { id: serverId } });
    expect(stored?.backupRetentionCount).toBe(7);

    await app.close();
  });

  it('allows a server.update holder to change the allocation', async () => {
    currentUserId = await grantSubuser(['server.read', 'backup.create', 'server.update']);
    const app = buildApp();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/backup-settings`,
      payload: { backupAllocationMb: 20480 },
    });
    expect(res.statusCode).toBe(200);

    const stored = await prisma.server.findUnique({ where: { id: serverId } });
    expect(stored?.backupAllocationMb).toBe(20480);

    await app.close();
  });
});
