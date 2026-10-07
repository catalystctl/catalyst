/**
 * Regression: the panel advertises Start/Stop/Restart/Kill/Install for node
 * managers (node assignment + node.update) and for roles holding the matching
 * server permission, but the power routes only accepted owner / admin.write /
 * a ServerAccess row and returned 403. They must use the canonical
 * decideServerAccess contract instead.
 *
 * Extended for the API-key scope ceiling: a key must itself hold the required
 * permission — the owner's identity, roles, and node assignments never widen
 * a key (mirrors the real API-key auth shape).
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { serverRoutes } from '../routes/servers.js';
import { bulkServerRoutes } from '../routes/bulk-servers.js';
import { pluginRoutes } from '../routes/plugins.js';
import { nanoid } from 'nanoid';

let nodeManagerUserId: string;
let roleStarterUserId: string;
let noPermsUserId: string;
let ownerUserId: string;
let adminReadUserId: string;
let adminWriteUserId: string;
let killOnlyUserId: string;
let suspendUserId: string;
let archiveUserId: string;
let transferUserId: string;
let migrateUserId: string;
let networkUserId: string;
let updateUserId: string;
let subuserUserId: string;
let creatorUserId: string;
let clonerUserId: string;
let bareAssignedUserId: string;
let managerRoleId: string;
let starterRoleId: string;
let noPermsRoleId: string;
let ownerRoleId: string;
let adminReadRoleId: string;
let adminWriteRoleId: string;
let killOnlyRoleId: string;
let suspendRoleId: string;
let archiveRoleId: string;
let transferRoleId: string;
let migrateRoleId: string;
let networkRoleId: string;
let updateRoleId: string;
let creatorRoleId: string;
let clonerRoleId: string;
let bareAssignedRoleId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let keyScopeServerId: string;
let currentUserId = '';
let currentApiKey: { apiKeyId: string; permissions: string[] } | null = null;

afterEach(() => {
  currentApiKey = null;
});

function buildApp() {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (request: any) => {
    const base = {
      userId: currentUserId,
      email: 'power-test@example.com',
      username: 'power-test',
    };
    if (currentApiKey) {
      request.user = { ...base, permissions: currentApiKey.permissions, apiKeyId: currentApiKey.apiKeyId };
      return;
    }
    // Session auth resolves the user's global role permissions, exactly like
    // production (src/server.ts authenticate → resolveUserPermissions) —
    // checkIsAdmin-based gates read request.user.permissions.
    const user = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { roles: { select: { permissions: true } } },
    });
    request.user = {
      ...base,
      permissions: user?.roles.flatMap((role) => role.permissions) ?? [],
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
  app.register(bulkServerRoutes, { prefix: '/api/servers' });
  // Plugin inventory routes: empty registry stub — the admin.read gate is
  // testable without any installed plugin (mounted like src/server.ts).
  const loaderStub: any = {
    getPluginsDir: () => '/tmp/power-test-plugins',
    getRegistry: () => ({ getAll: () => [], get: () => undefined, getExposedApiNames: () => [] }),
  };
  app.register((sub: any) => pluginRoutes(sub, loaderStub, prisma));
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
  const adminReadRole = await prisma.role.create({
    data: { name: `test-power-adminread-${nanoid(8)}`, permissions: ['admin.read'] },
  });
  adminReadRoleId = adminReadRole.id;
  const adminWriteRole = await prisma.role.create({
    data: { name: `test-power-adminwrite-${nanoid(8)}`, permissions: ['admin.write'] },
  });
  adminWriteRoleId = adminWriteRole.id;
  const killOnlyRole = await prisma.role.create({
    data: { name: `test-power-killonly-${nanoid(8)}`, permissions: ['server.kill'] },
  });
  killOnlyRoleId = killOnlyRole.id;
  const suspendRole = await prisma.role.create({
    data: { name: `test-power-suspend-${nanoid(8)}`, permissions: ['server.suspend'] },
  });
  suspendRoleId = suspendRole.id;
  const archiveRole = await prisma.role.create({
    data: { name: `test-power-archive-${nanoid(8)}`, permissions: ['server.archive'] },
  });
  archiveRoleId = archiveRole.id;
  const transferRole = await prisma.role.create({
    data: { name: `test-power-transfer-${nanoid(8)}`, permissions: ['server.transfer'] },
  });
  transferRoleId = transferRole.id;
  const migrateRole = await prisma.role.create({
    data: { name: `test-power-migrate-${nanoid(8)}`, permissions: ['server.migrate'] },
  });
  migrateRoleId = migrateRole.id;
  const networkRole = await prisma.role.create({
    data: { name: `test-power-network-${nanoid(8)}`, permissions: ['server.network'] },
  });
  networkRoleId = networkRole.id;
  const updateRole = await prisma.role.create({
    data: { name: `test-power-update-${nanoid(8)}`, permissions: ['server.update'] },
  });
  updateRoleId = updateRole.id;
  const creatorRole = await prisma.role.create({
    data: { name: `test-power-creator-${nanoid(8)}`, permissions: ['server.create'] },
  });
  creatorRoleId = creatorRole.id;
  const clonerRole = await prisma.role.create({
    data: { name: `test-power-cloner-${nanoid(8)}`, permissions: ['server.clone'] },
  });
  clonerRoleId = clonerRole.id;
  const bareAssignedRole = await prisma.role.create({
    data: { name: `test-power-bare-${nanoid(8)}`, permissions: ['node.read'] },
  });
  bareAssignedRoleId = bareAssignedRole.id;

  nodeManagerUserId = await createUser(managerRoleId, 'power-manager');
  roleStarterUserId = await createUser(starterRoleId, 'power-starter');
  noPermsUserId = await createUser(noPermsRoleId, 'power-none');
  ownerUserId = await createUser(ownerRoleId, 'power-owner');
  adminReadUserId = await createUser(adminReadRoleId, 'power-adminread');
  adminWriteUserId = await createUser(adminWriteRoleId, 'power-adminwrite');
  killOnlyUserId = await createUser(killOnlyRoleId, 'power-killonly');
  suspendUserId = await createUser(suspendRoleId, 'power-suspend');
  archiveUserId = await createUser(archiveRoleId, 'power-archive');
  transferUserId = await createUser(transferRoleId, 'power-transfer');
  migrateUserId = await createUser(migrateRoleId, 'power-migrate');
  networkUserId = await createUser(networkRoleId, 'power-network');
  updateUserId = await createUser(updateRoleId, 'power-update');
  creatorUserId = await createUser(creatorRoleId, 'power-creator');
  clonerUserId = await createUser(clonerRoleId, 'power-cloner');
  bareAssignedUserId = await createUser(bareAssignedRoleId, 'power-bare');
  subuserUserId = await createUser(noPermsRoleId, 'power-subuser');

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

  // Subuser with an explicit per-server server.transfer grant (the new
  // ownership-transfer path).
  await prisma.serverAccess.create({
    data: { serverId, userId: subuserUserId, permissions: ['server.transfer'] },
  });

  // Bare node assignment WITHOUT the node.update/server_manage pairing —
  // must not pass the server-creation gate.
  await prisma.nodeAssignment.create({
    data: { nodeId, userId: bareAssignedUserId, assignedBy: ownerUserId },
  });

  // Throwaway server for the delete/resize/variables key-scope tests (the
  // positive delete case consumes it).
  const keyScopeServer = await prisma.server.create({
    data: {
      uuid: `test-power-key-${nanoid(12)}`,
      name: `test-power-key-server-${nanoid(8)}`,
      templateId,
      nodeId,
      locationId,
      ownerId: ownerUserId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25571,
      status: 'stopped',
    },
  });
  keyScopeServerId = keyScopeServer.id;
});

afterAll(async () => {
  if (keyScopeServerId) {
    await prisma.serverAccess.deleteMany({ where: { serverId: keyScopeServerId } }).catch(() => {});
    await prisma.server.delete({ where: { id: keyScopeServerId } }).catch(() => {});
  }
  if (serverId) {
    await prisma.serverAccess.deleteMany({ where: { serverId } }).catch(() => {});
    await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  }
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) {
    await prisma.nodeAssignment.deleteMany({ where: { nodeId } }).catch(() => {});
    await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  }
  for (const id of [nodeManagerUserId, roleStarterUserId, noPermsUserId, ownerUserId, adminReadUserId, adminWriteUserId, killOnlyUserId, suspendUserId, archiveUserId, transferUserId, migrateUserId, networkUserId, updateUserId, creatorUserId, clonerUserId, bareAssignedUserId, subuserUserId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [managerRoleId, starterRoleId, noPermsRoleId, ownerRoleId, adminReadRoleId, adminWriteRoleId, killOnlyRoleId, suspendRoleId, archiveRoleId, transferRoleId, migrateRoleId, networkRoleId, updateRoleId, creatorRoleId, clonerRoleId, bareAssignedRoleId]) {
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

describe('power route API-key scope ceiling', () => {
  beforeAll(async () => {
    await prisma.server.update({ where: { id: serverId }, data: { status: 'stopped' } });
  });

  it("rejects the owner's key scoped below the required permission", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'power-key-narrow', permissions: ['server.read'] };
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/start`, payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("allows the owner's key holding the required permission", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'power-key-start', permissions: ['server.start'] };
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/start`, payload: {} });
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it('rejects a role-granted user whose key scope omits the permission', async () => {
    const app = buildApp();
    currentUserId = roleStarterUserId;
    currentApiKey = { apiKeyId: 'power-key-stale', permissions: ['server.read'] };
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/start`, payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('admits a role-granted user whose key scope covers the permission', async () => {
    const app = buildApp();
    currentUserId = roleStarterUserId;
    currentApiKey = { apiKeyId: 'power-key-cover', permissions: ['server.start', 'server.stop'] };
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/start`, payload: {} });
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it('admits an admin.write-scoped key and rejects an admin.read-scoped key', async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'power-key-adminwrite', permissions: ['admin.write'] };
    const write = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/start`, payload: {} });
    expect(write.statusCode).not.toBe(403);
    currentApiKey = { apiKeyId: 'power-key-adminread', permissions: ['admin.read'] };
    const read = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/start`, payload: {} });
    expect(read.statusCode).toBe(403);
    await app.close();
  });

  it('requires an all-of gate (restart) key to hold every permission', async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'power-key-start-only', permissions: ['server.start'] };
    const partial = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/restart`, payload: {} });
    expect(partial.statusCode).toBe(403);
    currentApiKey = { apiKeyId: 'power-key-full', permissions: ['server.start', 'server.stop'] };
    const full = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/restart`, payload: {} });
    expect(full.statusCode).not.toBe(403);
    await app.close();
  });
});

describe('allocation route API-key scope ceiling', () => {
  beforeAll(async () => {
    await prisma.server.update({ where: { id: serverId }, data: { status: 'stopped' } });
  });

  it("rejects the owner's key scoped below server.update on every allocation write", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'net-key-narrow', permissions: ['server.read'] };
    const bind = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/allocations`,
      payload: { allocationId: 'no-such-allocation' },
    });
    expect(bind.statusCode).toBe(403);
    const unbind = await app.inject({
      method: 'DELETE',
      url: `/api/servers/${serverId}/allocations/25565`,
    });
    expect(unbind.statusCode).toBe(403);
    const primary = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/allocations/primary`,
      payload: { containerPort: 25565 },
    });
    expect(primary.statusCode).toBe(403);
    await app.close();
  });

  it('admits a server.update-scoped key past the gate', async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'net-key-update', permissions: ['server.update'] };
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/allocations`,
      payload: { allocationId: 'no-such-allocation' },
    });
    // ALLOCATION_NOT_FOUND after the gate proves the gate opened.
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('lets a session owner pass the gate (no key ceiling)', async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = null;
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/allocations`,
      payload: { allocationId: 'no-such-allocation' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('accepts admin.write on allocation writes (pre-wave-2 contract pin)', async () => {
    const app = buildApp();
    currentUserId = adminWriteUserId;
    currentApiKey = null;
    const session = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/allocations`,
      payload: { allocationId: 'no-such-allocation' },
    });
    expect(session.statusCode).toBe(404);
    currentUserId = noPermsUserId;
    currentApiKey = { apiKeyId: 'net-key-adminwrite', permissions: ['admin.write'] };
    const key = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/allocations`,
      payload: { allocationId: 'no-such-allocation' },
    });
    expect(key.statusCode).toBe(404);
    await app.close();
  });
});

describe('backup-settings API-key scope ceiling', () => {
  it("rejects the owner's key scoped below backup.create", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'backup-key-narrow', permissions: ['server.read'] };
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/backup-settings`,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("admits the owner's key holding backup.create", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'backup-key-ok', permissions: ['backup.create'] };
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/backup-settings`,
      payload: {},
    });
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });
});

describe('transfer-candidates read access', () => {
  it('admits admin.read (read-everything contract)', async () => {
    const app = buildApp();
    currentUserId = adminReadUserId;
    const res = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/transfer-candidates?search=zzz`,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('admits admin.write and the owner', async () => {
    const app = buildApp();
    currentUserId = adminWriteUserId;
    const adminRes = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/transfer-candidates?search=zzz`,
    });
    expect(adminRes.statusCode).toBe(200);
    currentUserId = ownerUserId;
    const ownerRes = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/transfer-candidates?search=zzz`,
    });
    expect(ownerRes.statusCode).toBe(200);
    await app.close();
  });

  it('masquerades as 404 for plain users', async () => {
    const app = buildApp();
    currentUserId = noPermsUserId;
    const res = await app.inject({
      method: 'GET',
      url: `/api/servers/${serverId}/transfer-candidates?search=zzz`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('wave 1 vocabulary: kill split with legacy alias', () => {
  beforeAll(async () => {
    await prisma.server.update({ where: { id: serverId }, data: { status: 'stopped' } });
  });

  it('lets a legacy server.stop holder force-kill (alias window)', async () => {
    const app = buildApp();
    currentUserId = roleStarterUserId;
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/kill`, payload: {} });
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it('lets a server.kill-only holder kill but not gracefully stop (narrow split)', async () => {
    const app = buildApp();
    currentUserId = killOnlyUserId;
    const kill = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/kill`, payload: {} });
    expect(kill.statusCode).not.toBe(403);
    const stop = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/stop`, payload: {} });
    expect(stop.statusCode).toBe(403);
    await app.close();
  });

  it('admits a server.stop-scoped API key to kill (alias in the key ceiling)', async () => {
    const app = buildApp();
    currentUserId = roleStarterUserId;
    currentApiKey = { apiKeyId: 'kill-key-legacy', permissions: ['server.stop'] };
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/kill`, payload: {} });
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it('rejects admin.read on kill', async () => {
    const app = buildApp();
    currentUserId = adminReadUserId;
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/kill`, payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('wave 1 vocabulary: archive split with legacy alias', () => {
  beforeAll(async () => {
    await prisma.server.update({ where: { id: serverId }, data: { status: 'stopped' } });
  });

  it('lets a legacy server.suspend holder archive and restore (alias window)', async () => {
    const app = buildApp();
    currentUserId = suspendUserId;
    const archive = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/archive`, payload: {} });
    expect(archive.statusCode).not.toBe(403);
    const restore = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/restore`, payload: {} });
    expect(restore.statusCode).not.toBe(403);
    await app.close();
  });

  it('lets a server.archive-only holder archive but not suspend (narrow split)', async () => {
    const app = buildApp();
    currentUserId = archiveUserId;
    const archive = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/archive`, payload: {} });
    expect(archive.statusCode).not.toBe(403);
    const suspend = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/suspend`, payload: {} });
    expect(suspend.statusCode).toBe(403);
    await app.close();
  });

  it('rejects admin.read on archive', async () => {
    const app = buildApp();
    currentUserId = adminReadUserId;
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/archive`, payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('admits a server.suspend-scoped API key to archive (alias in the gate)', async () => {
    const app = buildApp();
    currentUserId = suspendUserId;
    currentApiKey = { apiKeyId: 'archive-key-legacy', permissions: ['server.suspend'] };
    const res = await app.inject({ method: 'POST', url: `/api/servers/${serverId}/archive`, payload: {} });
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });
});

describe('wave 1 vocabulary: migrate split (node transfer)', () => {
  it('lets a legacy server.transfer holder migrate (alias window)', async () => {
    const app = buildApp();
    currentUserId = transferUserId;
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/transfer`,
      payload: { targetNodeId: 'no-such-node' },
    });
    // NODE_NOT_FOUND after the gate proves the gate opened.
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('lets a server.migrate holder migrate', async () => {
    const app = buildApp();
    currentUserId = migrateUserId;
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/transfer`,
      payload: { targetNodeId: 'no-such-node' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('rejects a plain user and an admin.read user', async () => {
    const app = buildApp();
    currentUserId = noPermsUserId;
    const plain = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/transfer`,
      payload: { targetNodeId: 'no-such-node' },
    });
    expect(plain.statusCode).toBe(403);
    currentUserId = adminReadUserId;
    const reader = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/transfer`,
      payload: { targetNodeId: 'no-such-node' },
    });
    expect(reader.statusCode).toBe(403);
    await app.close();
  });

  it('admits a server.transfer-scoped API key (alias in the key ceiling)', async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'migrate-key-legacy', permissions: ['server.transfer'] };
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/transfer`,
      payload: { targetNodeId: 'no-such-node' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('wave 1 vocabulary: ownership transfer enforces server.transfer', () => {
  it('admits a ServerAccess row holding server.transfer', async () => {
    const app = buildApp();
    currentUserId = subuserUserId;
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/transfer-ownership`,
      payload: { newOwnerId: 'no-such-user' },
    });
    // USER_NOT_FOUND after the gate proves the gate opened.
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('admits a global role holding server.transfer', async () => {
    const app = buildApp();
    currentUserId = transferUserId;
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/transfer-ownership`,
      payload: { newOwnerId: 'no-such-user' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('still rejects plain users and admin.read', async () => {
    const app = buildApp();
    currentUserId = noPermsUserId;
    const plain = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/transfer-ownership`,
      payload: { newOwnerId: 'no-such-user' },
    });
    expect(plain.statusCode).toBe(403);
    currentUserId = adminReadUserId;
    const reader = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/transfer-ownership`,
      payload: { newOwnerId: 'no-such-user' },
    });
    expect(reader.statusCode).toBe(403);
    await app.close();
  });
});

describe('wave 1 vocabulary: allocation gates use server.network', () => {
  beforeAll(async () => {
    await prisma.server.update({ where: { id: serverId }, data: { status: 'stopped' } });
  });

  it('lets a legacy server.update holder bind allocations (alias window)', async () => {
    const app = buildApp();
    currentUserId = updateUserId;
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/allocations`,
      payload: { allocationId: 'no-such-allocation' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('lets a server.network holder bind allocations', async () => {
    const app = buildApp();
    currentUserId = networkUserId;
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/allocations`,
      payload: { allocationId: 'no-such-allocation' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('keeps server.network narrow: settings writes still need server.update', async () => {
    const app = buildApp();
    currentUserId = networkUserId;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${serverId}/restart-policy`,
      payload: { restartPolicy: 'always' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('admits a server.update-scoped API key to bind allocations (alias in the key ceiling)', async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'net-key-legacy', permissions: ['server.update'] };
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}/allocations`,
      payload: { allocationId: 'no-such-allocation' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('server list & bulk status admin.read visibility', () => {
  it('admits admin.read to the all-servers list with the READ subset of effectivePermissions', async () => {
    const app = buildApp();
    currentUserId = adminReadUserId;
    const res = await app.inject({ method: 'GET', url: '/api/servers?limit=100' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // admin.read is read-everything: the fixture server (owned by someone
    // else) must appear.
    const row = body.data.find((s: any) => s.id === serverId);
    expect(row).toBeTruthy();
    expect(row.effectivePermissions).toContain('server.read');
    expect(row.effectivePermissions).not.toContain('server.start');
    await app.close();
  });

  it('keeps the plain user list scoped (own servers only)', async () => {
    const app = buildApp();
    currentUserId = noPermsUserId;
    const res = await app.inject({ method: 'GET', url: '/api/servers?limit=100' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.some((s: any) => s.id === serverId)).toBe(false);
    await app.close();
  });

  it('admits admin.read to POST /api/servers/bulk/status (read-everything contract)', async () => {
    const app = buildApp();
    currentUserId = adminReadUserId;
    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/bulk/status',
      payload: { serverIds: [serverId] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data[0].id).toBe(serverId);
    expect(body.data[0].status).not.toBe('not_found');
    await app.close();
  });

  it('masks bulk status rows for plain users without grants', async () => {
    const app = buildApp();
    currentUserId = noPermsUserId;
    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/bulk/status',
      payload: { serverIds: [serverId] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data[0].status).toBe('not_found');
    await app.close();
  });
});

describe('server creation gate', () => {
  const createPayload = {
    name: `gate-test-${nanoid(4)}`,
    // Schema-valid body pointing at a missing template: 404 proves the
    // caller got PAST the permission gate (never 403).
    templateId: 'no-such-template',
    nodeId: undefined as any,
    locationId: undefined as any,
    primaryPort: 25572,
    allocatedMemoryMb: 512,
    allocatedCpuCores: 1,
    allocatedDiskMb: 1024,
  };

  it('rejects a bare node assignment (no node.update/server_manage pairing)', async () => {
    const app = buildApp();
    currentUserId = bareAssignedUserId;
    const res = await app.inject({
      method: 'POST',
      url: '/api/servers',
      payload: { ...createPayload, nodeId, locationId },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('admits a node manager via the node_manage path (past the gate)', async () => {
    const app = buildApp();
    currentUserId = nodeManagerUserId;
    const res = await app.inject({
      method: 'POST',
      url: '/api/servers',
      payload: { ...createPayload, nodeId, locationId },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('rejects a plain user without server.create or a node grant', async () => {
    const app = buildApp();
    currentUserId = noPermsUserId;
    const res = await app.inject({
      method: 'POST',
      url: '/api/servers',
      payload: { ...createPayload, nodeId, locationId },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('clone route gate (server.clone)', () => {
  it('admits a legacy server.create grant through the alias window', async () => {
    const app = buildApp();
    currentUserId = creatorUserId;
    // Non-existent source: 404 proves the caller passed the gate.
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}x/clone/preflight`,
      payload: { mode: 'full', targetNodeId: nodeId },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('admits the new server.clone permission value', async () => {
    const app = buildApp();
    currentUserId = clonerUserId;
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}x/clone/preflight`,
      payload: { mode: 'full', targetNodeId: nodeId },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('rejects callers without either value', async () => {
    const app = buildApp();
    currentUserId = noPermsUserId;
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${serverId}x/clone/preflight`,
      payload: { mode: 'full', targetNodeId: nodeId },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('delete / resize / variables key-scope ceiling (owner bypass paths)', () => {
  it("rejects the owner's key below server.update on variables PATCH", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'vars-key-narrow', permissions: ['server.read'] };
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${keyScopeServerId}/variables`,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("allows the owner's key holding server.update on variables PATCH", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'vars-key-full', permissions: ['server.update'] };
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/servers/${keyScopeServerId}/variables`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("rejects the owner's key below server.read on variables GET", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'vars-key-get', permissions: ['console.read'] };
    const res = await app.inject({ method: 'GET', url: `/api/servers/${keyScopeServerId}/variables` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("rejects the owner's key below server.storage on storage resize", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'resize-key-narrow', permissions: ['server.read'] };
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${keyScopeServerId}/storage/resize`,
      payload: { allocatedDiskMb: 2048 },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("allows the owner's key holding server.storage (new value) on storage resize", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'resize-key-new', permissions: ['server.storage'] };
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${keyScopeServerId}/storage/resize`,
      payload: { allocatedDiskMb: 2048 },
    });
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it("allows the owner's key holding legacy server.update (alias) on storage resize", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'resize-key-legacy', permissions: ['server.update'] };
    const res = await app.inject({
      method: 'POST',
      url: `/api/servers/${keyScopeServerId}/storage/resize`,
      payload: { allocatedDiskMb: 2048 },
    });
    expect(res.statusCode).not.toBe(403);
    await app.close();
  });

  it("rejects the owner's key below server.delete on server delete", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'del-key-narrow', permissions: ['server.read'] };
    const res = await app.inject({ method: 'DELETE', url: `/api/servers/${keyScopeServerId}` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("allows the owner's key holding server.delete (consumes the throwaway server)", async () => {
    const app = buildApp();
    currentUserId = ownerUserId;
    currentApiKey = { apiKeyId: 'del-key-full', permissions: ['server.delete'] };
    const res = await app.inject({ method: 'DELETE', url: `/api/servers/${keyScopeServerId}` });
    expect(res.statusCode).not.toBe(403);
    const gone = await prisma.server.findUnique({ where: { id: keyScopeServerId } });
    expect(gone).toBeNull();
    await app.close();
  });
});

describe('plugin inventory admin.read gate', () => {
  it('admits admin.read to GET /api/plugins', async () => {
    const app = buildApp();
    currentUserId = adminReadUserId;
    const res = await app.inject({ method: 'GET', url: '/api/plugins' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data).toEqual([]);
    await app.close();
  });

  it('rejects plain users from GET /api/plugins', async () => {
    const app = buildApp();
    currentUserId = noPermsUserId;
    const res = await app.inject({ method: 'GET', url: '/api/plugins' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('rejects plain users from plugin frontend-manifest and assets', async () => {
    const app = buildApp();
    currentUserId = noPermsUserId;
    const manifest = await app.inject({ method: 'GET', url: '/api/plugins/some-plugin/frontend-manifest' });
    expect(manifest.statusCode).toBe(403);
    const asset = await app.inject({ method: 'GET', url: '/plugins-assets/some-plugin/index.js' });
    expect(asset.statusCode).toBe(403);
    await app.close();
  });

  it('admits admin.read to frontend-manifest (404 for unknown plugin — past the gate)', async () => {
    const app = buildApp();
    currentUserId = adminReadUserId;
    const res = await app.inject({ method: 'GET', url: '/api/plugins/some-plugin/frontend-manifest' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
