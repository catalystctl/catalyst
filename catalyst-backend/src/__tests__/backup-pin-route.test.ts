import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { backupRoutes } from '../routes/backups.js';

/**
 * backup.pin gate: pinning a backup exempts it from the retention limit, so it
 * is an explicit grant — server ownership alone must NOT satisfy it.
 */
let currentUserId = '';
const sent: any[] = [];

function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId: currentUserId, email: 'pin@t.com', username: 'pin', permissions: [] };
  });
  app.decorate('wsGateway', {
    sendToAgent: async (_nodeId: string, message: any) => {
      sent.push(message);
      return true;
    },
    routeToClients: async () => {},
    pushToAdminSubscribers: () => {},
  } as any);
  app.register(backupRoutes, { prefix: '/api/servers' });
  return app;
}

let roleNoPinId = '';
let rolePinId = '';
let locationId = '';
let nodeId = '';
let templateId = '';
let userNoPinId = '';
let userPinId = '';
let serverNoPinId = '';
let serverPinId = '';
let backupNoPinId = '';
let backupPinId = '';

beforeAll(async () => {
  const roleNoPin = await prisma.role.create({
    data: { name: `test-pin-nopin-${nanoid(8)}`, permissions: ['server.read', 'backup.read', 'backup.create'] },
  });
  roleNoPinId = roleNoPin.id;
  const rolePin = await prisma.role.create({
    data: { name: `test-pin-pin-${nanoid(8)}`, permissions: ['server.read', 'backup.read', 'backup.create', 'backup.pin'] },
  });
  rolePinId = rolePin.id;

  const u1 = await prisma.user.create({
    data: { email: `pin-nopin-${nanoid(6)}@t.com`, username: `pn_${nanoid(4)}`, name: 'pn', emailVerified: true, roles: { connect: { id: roleNoPinId } } },
  });
  userNoPinId = u1.id;
  const u2 = await prisma.user.create({
    data: { email: `pin-yes-${nanoid(6)}@t.com`, username: `py_${nanoid(4)}`, name: 'py', emailVerified: true, roles: { connect: { id: rolePinId } } },
  });
  userPinId = u2.id;

  const loc = await prisma.location.create({ data: { name: `test-pin-loc-${nanoid(8)}` } });
  locationId = loc.id;
  const node = await prisma.node.create({
    data: { name: `test-pin-node-${nanoid(8)}`, locationId, hostname: 'pin.example.com', publicAddress: '10.0.0.11', secret: `s-${nanoid(16)}`, maxMemoryMb: 8192, maxCpuCores: 4, isOnline: true },
  });
  nodeId = node.id;
  const template = await prisma.serverTemplate.create({
    data: { name: `test-pin-tpl-${nanoid(8)}`, author: 'T', version: '1.0.0', image: 'alpine:latest', startup: 'echo hi', stopCommand: 'stop', supportedPorts: [], variables: [], allocatedMemoryMb: 512, allocatedCpuCores: 1 },
  });
  templateId = template.id;

  const s1 = await prisma.server.create({
    data: { uuid: `test-pin-a-${nanoid(12)}`, name: `test-pin-a-${nanoid(8)}`, templateId, nodeId, locationId, ownerId: userNoPinId, allocatedMemoryMb: 512, allocatedCpuCores: 1, primaryPort: 25590, status: 'stopped', backupAllocationMb: 1024 },
  });
  serverNoPinId = s1.id;
  const s2 = await prisma.server.create({
    data: { uuid: `test-pin-b-${nanoid(12)}`, name: `test-pin-b-${nanoid(8)}`, templateId, nodeId, locationId, ownerId: userPinId, allocatedMemoryMb: 512, allocatedCpuCores: 1, primaryPort: 25591, status: 'stopped', backupAllocationMb: 1024 },
  });
  serverPinId = s2.id;

  const b1 = await prisma.backup.create({
    data: { serverId: serverNoPinId, name: `pin-a-${nanoid(6)}`, path: '/var/lib/catalyst/backups/a.tar.gz', storageMode: 'local', sizeMb: 5, compressed: true },
  });
  backupNoPinId = b1.id;
  const b2 = await prisma.backup.create({
    data: { serverId: serverPinId, name: `pin-b-${nanoid(6)}`, path: '/var/lib/catalyst/backups/b.tar.gz', storageMode: 'local', sizeMb: 5, compressed: true },
  });
  backupPinId = b2.id;
});

afterAll(async () => {
  for (const sid of [serverNoPinId, serverPinId]) {
    if (!sid) continue;
    await prisma.backup.deleteMany({ where: { serverId: sid } }).catch(() => {});
    await prisma.server.delete({ where: { id: sid } }).catch(() => {});
  }
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
  for (const uid of [userNoPinId, userPinId]) if (uid) await prisma.user.delete({ where: { id: uid } }).catch(() => {});
  for (const rid of [roleNoPinId, rolePinId]) if (rid) await prisma.role.delete({ where: { id: rid } }).catch(() => {});
});

describe('backup pinning requires the backup.pin grant', () => {
  it('rejects a pinned create without backup.pin', async () => {
    currentUserId = userNoPinId;
    sent.length = 0;
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverNoPinId}/backups`,
      payload: { pinned: true },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(sent).toHaveLength(0);
  });

  it('allows a pinned create with backup.pin and stores the flag', async () => {
    currentUserId = userPinId;
    sent.length = 0;
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverPinId}/backups`,
      payload: { pinned: true, name: 'keep-me' },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const created = await prisma.backup.findFirst({
      where: { serverId: serverPinId, name: 'keep-me' },
      select: { pinned: true },
    });
    expect(created?.pinned).toBe(true);
  });

  it('rejects pinning an existing backup without backup.pin', async () => {
    currentUserId = userNoPinId;
    const app = buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverNoPinId}/backups/${backupNoPinId}/pin`,
      payload: { pinned: true },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    const row = await prisma.backup.findUnique({ where: { id: backupNoPinId }, select: { pinned: true } });
    expect(row?.pinned).toBe(false);
  });

  it('pins and unpins an existing backup with backup.pin', async () => {
    currentUserId = userPinId;

    const app = buildApp();
    const pinned = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverPinId}/backups/${backupPinId}/pin`,
      payload: { pinned: true },
    });
    await app.close();
    expect(pinned.statusCode).toBe(200);
    expect((await prisma.backup.findUnique({ where: { id: backupPinId }, select: { pinned: true } }))?.pinned).toBe(true);

    const app2 = buildApp();
    const unpinned = await app2.inject({
      method: 'PATCH',
      url: `/api/servers/${serverPinId}/backups/${backupPinId}/pin`,
      payload: { pinned: false },
    });
    await app2.close();
    expect(unpinned.statusCode).toBe(200);
    expect((await prisma.backup.findUnique({ where: { id: backupPinId }, select: { pinned: true } }))?.pinned).toBe(false);
  });
});
