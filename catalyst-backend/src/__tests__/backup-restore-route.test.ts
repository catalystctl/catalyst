import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';
import { prisma } from '../db.js';
import { backupRoutes } from '../routes/backups.js';

/**
 * Restore route contract: the panel must hand the agent the stored archive
 * path and lock the server into RESTORING, and it must refuse a restore while
 * the server is not stopped. The agent-side link policy is covered in
 * catalyst-agent/src/websocket_handler/backup.rs.
 */
let ownerId = '';
let roleId = '';
let locationId = '';
let nodeId = '';
let templateId = '';
let serverId = '';
let backupId = '';
let serverUuid = '';
const sent: any[] = [];

function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId: ownerId, email: 'r@t.com', username: 'r', permissions: ['*'] };
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

beforeAll(async () => {
  const role = await prisma.role.create({ data: { name: `test-restore-${nanoid(8)}`, permissions: ['*'] } });
  roleId = role.id;
  const owner = await prisma.user.create({
    data: { email: `restore-${nanoid(6)}@t.com`, username: `r_${nanoid(4)}`, name: 'r', emailVerified: true, roles: { connect: { id: roleId } } },
  });
  ownerId = owner.id;
  const loc = await prisma.location.create({ data: { name: `test-restore-loc-${nanoid(8)}` } });
  locationId = loc.id;
  const node = await prisma.node.create({
    data: { name: `test-restore-node-${nanoid(8)}`, locationId, hostname: 'r.example.com', publicAddress: '10.0.0.9', secret: `s-${nanoid(16)}`, maxMemoryMb: 8192, maxCpuCores: 4, isOnline: true },
  });
  nodeId = node.id;
  const template = await prisma.serverTemplate.create({
    data: { name: `test-restore-tpl-${nanoid(8)}`, author: 'T', version: '1.0.0', image: 'alpine:latest', startup: 'echo hi', stopCommand: 'stop', supportedPorts: [], variables: [], allocatedMemoryMb: 512, allocatedCpuCores: 1 },
  });
  templateId = template.id;
  const server = await prisma.server.create({
    data: { uuid: `test-restore-${nanoid(12)}`, name: `test-restore-srv-${nanoid(8)}`, templateId, nodeId, locationId, ownerId, allocatedMemoryMb: 512, allocatedCpuCores: 1, primaryPort: 25580, status: 'stopped', backupAllocationMb: 1024 },
  });
  serverId = server.id;
  serverUuid = server.uuid;
  const backup = await prisma.backup.create({
    data: { serverId, name: `nightly-${nanoid(6)}`, path: `/var/lib/catalyst/backups/${server.uuid}/nightly.tar.gz`, storageMode: 'local', sizeMb: 12, compressed: true, metadata: { agentPath: `/var/lib/catalyst/backups/${server.uuid}/nightly.tar.gz` } },
  });
  backupId = backup.id;
});

afterAll(async () => {
  if (serverId) {
    await prisma.backup.deleteMany({ where: { serverId } }).catch(() => {});
    await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  }
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => {});
  if (roleId) await prisma.role.delete({ where: { id: roleId } }).catch(() => {});
});

describe('POST /:serverId/backups/:backupId/restore', () => {
  it('dispatches restore_backup with the stored path and locks the server', async () => {
    sent.length = 0;
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/backups/${backupId}/restore` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true });

    expect(sent).toHaveLength(1);
    const message = sent[0];
    expect(message.type).toBe('restore_backup');
    expect(message.serverId).toBe(serverId);
    expect(message.serverUuid).toBe(serverUuid);
    expect(message.backupId).toBe(backupId);
    // The agent resolves an absolute path by filename inside its own backup
    // directory, so the panel must keep sending the stored path verbatim.
    expect(message.backupPath).toBe(`/var/lib/catalyst/backups/${serverUuid}/nightly.tar.gz`);
    expect(message.serverDir).toBe(`/var/lib/catalyst/servers/${serverUuid}`);

    const row = await prisma.server.findUnique({ where: { id: serverId }, select: { status: true } });
    expect(row?.status).toBe('restoring');
  });

  it('refuses a restore while the server is not stopped', async () => {
    sent.length = 0;
    await prisma.server.update({ where: { id: serverId }, data: { status: 'running' } });
    const app = buildApp();
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/backups/${backupId}/restore` });
    await app.close();

    expect(res.statusCode).toBe(409);
    expect(sent).toHaveLength(0);
    const row = await prisma.server.findUnique({ where: { id: serverId }, select: { status: true } });
    expect(row?.status).toBe('running');
  });
});
