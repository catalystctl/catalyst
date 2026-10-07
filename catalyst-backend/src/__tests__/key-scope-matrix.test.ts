/**
 * API-key scope ceiling matrix (test-plan §5b):
 *  - unit: enforceRouteKeyScope over {apiKeyId, permissions} × required
 *    permission configs (single / any-of array / all-of / exemption / `*`);
 *  - route-level (P-C): the production wiring — a decorated authenticate
 *    that injects request.user with apiKeyId + the app-level preHandler
 *    hook — against routes that declare config.requiredPermission
 *    (metrics server.read, sftp file.read/server.update, tasks
 *    server.schedule). The owner's DB identity passing the route's own
 *    access checks while a narrow key 403s proves the ceiling comes from
 *    the KEY's scope, not the owner's rights;
 *  - sftp mint gate (C2): session callers must hold effective
 *    file.read-class access (row or read-tier role), not just server.read.
 *
 * Middleware-level cases (allPermissions keys inheriting live user perms,
 * banned/locked rejection) live behind verifyApiKey's DB path and are
 * covered by api-key-service tests; createAuthenticate wiring is exercised
 * end-to-end by the running panel. KEY_SCOPE_ENFORCE is a load-time flag —
 * default-on; asserting it stays a boolean documents the rollback knob.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { metricsRoutes } from '../routes/metrics.js';
import { sftpRoutes } from '../routes/sftp.js';
import { taskRoutes } from '../routes/tasks.js';
import { enforceRouteKeyScope, KEY_SCOPE_ENFORCED } from '../middleware/authenticate.js';
import { nanoid } from 'nanoid';

// ── Unit matrix ────────────────────────────────────────────────────────────

function fakeReply() {
  const sent: { status: number; body: unknown }[] = [];
  const reply: any = {
    status: (s: number) => ({ send: (b: unknown) => { sent.push({ status: s, body: b }); return reply; } }),
  };
  return { reply: reply as unknown as FastifyReply, sent };
}

function fakeReq(user: unknown, config: unknown) {
  return { user, routeOptions: { config } } as unknown as FastifyRequest;
}

describe('enforceRouteKeyScope unit matrix', () => {
  it('sessions (no apiKeyId) are never key-scoped', () => {
    const { reply, sent } = fakeReply();
    expect(enforceRouteKeyScope(fakeReq({ permissions: [] }, { requiredPermission: 'file.write' }), reply)).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('missing config and null exemptions pass', () => {
    const { reply } = fakeReply();
    expect(enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['server.read'] }, {}), reply)).toBe(true);
    expect(enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['server.read'] }, { requiredPermission: null }), reply)).toBe(true);
  });

  it('single requiredPermission: exact, *, and admin.write satisfaction', () => {
    const { reply } = fakeReply();
    expect(enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['server.read'] }, { requiredPermission: 'file.write' }), reply)).toBe(false);
    const { reply: r2 } = fakeReply();
    expect(enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['file.write'] }, { requiredPermission: 'file.write' }), r2)).toBe(true);
    const { reply: r3 } = fakeReply();
    expect(enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['*'] }, { requiredPermission: 'mods.manage' }), r3)).toBe(true);
    const { reply: r4 } = fakeReply();
    expect(enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['admin.write'] }, { requiredPermission: 'plugins.manage' }), r4)).toBe(true);
  });

  it('post-vocab ceilings: file.write does not satisfy mods.manage', () => {
    const { reply } = fakeReply();
    expect(enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['file.write'] }, { requiredPermission: 'mods.manage' }), reply)).toBe(false);
    const { reply: r2 } = fakeReply();
    expect(enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['mods.manage'] }, { requiredPermission: 'mods.manage' }), r2)).toBe(true);
  });

  it('array requiredPermission is ANY-of', () => {
    const { reply } = fakeReply();
    expect(enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['file.read'] }, { requiredPermission: ['file.write', 'file.read'] }), reply)).toBe(true);
    const { reply: r2 } = fakeReply();
    expect(enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['server.read'] }, { requiredPermission: ['file.write', 'file.read'] }), r2)).toBe(false);
  });

  it('requiredAllPermissions is ALL-of (restart = start + stop)', () => {
    const { reply } = fakeReply();
    expect(enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['server.start'] }, { requiredAllPermissions: ['server.start', 'server.stop'] }), reply)).toBe(false);
    const { reply: r2 } = fakeReply();
    expect(enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['server.start', 'server.stop'] }, { requiredAllPermissions: ['server.start', 'server.stop'] }), r2)).toBe(true);
  });

  it('sends a 403 with PERMISSION_DENIED when the ceiling fails', () => {
    const { reply, sent } = fakeReply();
    enforceRouteKeyScope(fakeReq({ apiKeyId: 'k1', permissions: ['server.read'] }, { requiredPermission: 'file.write' }), reply);
    expect(sent).toHaveLength(1);
    expect(sent[0].status).toBe(403);
    expect((sent[0].body as { code?: string }).code).toBe('PERMISSION_DENIED');
  });

  it('KEY_SCOPE_ENFORCE documents the rollback knob', () => {
    expect(typeof KEY_SCOPE_ENFORCED).toBe('boolean');
  });
});

// ── Route-level (P-C) harness ──────────────────────────────────────────────

let ownerUserId: string;
let serverReadUserId: string;
let adminReadUserId: string;
let subuserFileReadId: string;
let ownerRoleId: string;
let serverReadRoleId: string;
let adminReadRoleId: string;
let locationId: string;
let nodeId: string;
let templateId: string;
let serverId: string;
let currentUserId = '';
let currentApiKey: { apiKeyId: string; permissions: string[] } | null = null;

function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    const base = { userId: currentUserId, email: 'keyscope@example.com', username: 'keyscope' };
    if (currentApiKey) {
      request.user = { ...base, permissions: currentApiKey.permissions, apiKeyId: currentApiKey.apiKeyId };
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { roles: { select: { permissions: true } } },
    });
    request.user = { ...base, permissions: user?.roles.flatMap((r) => r.permissions) ?? [] };
  });
  // Production wiring (src/server.ts): the app-level preHandler hook that
  // enforces config.requiredPermission ceilings for API-key requests.
  app.addHook('preHandler', async (request: any, reply: any) => {
    enforceRouteKeyScope(request as FastifyRequest, reply as FastifyReply);
  });
  app.register(metricsRoutes, { prefix: '/api' });
  app.register(sftpRoutes);
  app.register(taskRoutes, { prefix: '/api/servers' });
  return app;
}

async function injectAs(
  userId: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  opts: { key?: { apiKeyId: string; permissions: string[] } | null; payload?: Record<string, unknown> | string } = {},
): Promise<{ statusCode: number; body: string }> {
  const app = buildApp();
  currentUserId = userId;
  currentApiKey = opts.key ?? null;
  const { payload } = opts;
  const res = await app.inject({
    method,
    url,
    ...(payload !== undefined ? { payload, headers: { 'content-type': 'application/json' } } : {}),
  });
  await app.close();
  return res as unknown as { statusCode: number; body: string };
}

async function createUser(roleId: string | null, name: string) {
  const user = await prisma.user.create({
    data: {
      email: `${name}-${nanoid(8)}@example.com`,
      username: `${name}${nanoid(4)}`,
      name,
      emailVerified: true,
      ...(roleId ? { roles: { connect: { id: roleId } } } : {}),
    },
  });
  return user.id;
}

beforeAll(async () => {
  const mkRole = (perms: string[], tag: string) =>
    prisma.role.create({ data: { name: `test-keyscope-${tag}-${nanoid(8)}`, permissions: perms } });
  const [ownerRole, serverReadRole, adminReadRole] = await Promise.all([
    mkRole(['*'], 'owner'),
    mkRole(['server.read'], 'serverread'),
    mkRole(['admin.read'], 'adminread'),
  ]);
  ownerRoleId = ownerRole.id;
  serverReadRoleId = serverReadRole.id;
  adminReadRoleId = adminReadRole.id;

  [ownerUserId, serverReadUserId, adminReadUserId, subuserFileReadId] = await Promise.all([
    createUser(ownerRoleId, 'keyscope-owner'),
    createUser(serverReadRoleId, 'keyscope-serverread'),
    createUser(adminReadRoleId, 'keyscope-adminread'),
    createUser(null, 'keyscope-subuser'),
  ]);

  const location = await prisma.location.create({ data: { name: `test-keyscope-loc-${nanoid(8)}` } });
  locationId = location.id;
  const node = await prisma.node.create({
    data: {
      name: `test-keyscope-node-${nanoid(8)}`,
      locationId,
      hostname: 'keyscope.example.com',
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
      name: `test-keyscope-template-${nanoid(8)}`,
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
      uuid: `test-keyscope-${nanoid(12)}`,
      name: `test-keyscope-server-${nanoid(8)}`,
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

  await prisma.serverAccess.create({
    data: { serverId, userId: subuserFileReadId, permissions: ['file.read'] },
  });
});

afterAll(async () => {
  if (serverId) {
    await prisma.scheduledTask.deleteMany({ where: { serverId } }).catch(() => {});
    await prisma.serverAccess.deleteMany({ where: { serverId } }).catch(() => {});
    await prisma.server.delete({ where: { id: serverId } }).catch(() => {});
  }
  if (templateId) await prisma.serverTemplate.delete({ where: { id: templateId } }).catch(() => {});
  if (nodeId) await prisma.node.delete({ where: { id: nodeId } }).catch(() => {});
  for (const id of [ownerUserId, serverReadUserId, adminReadUserId, subuserFileReadId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of [ownerRoleId, serverReadRoleId, adminReadRoleId]) {
    if (id) await prisma.role.delete({ where: { id } }).catch(() => {});
  }
  if (locationId) await prisma.location.delete({ where: { id: locationId } }).catch(() => {});
});

describe('route-level key ceilings (owner DB identity + narrow key)', () => {
  it('metrics stats: key with server.read passes, console.write-only key 403s, session passes', async () => {
    const okKey = await injectAs(ownerUserId, 'GET', `/api/servers/${serverId}/stats`, {
      key: { apiKeyId: 'k-read', permissions: ['server.read'] },
    });
    expect(okKey.statusCode).toBe(200);

    const deniedKey = await injectAs(ownerUserId, 'GET', `/api/servers/${serverId}/stats`, {
      key: { apiKeyId: 'k-console', permissions: ['console.write'] },
    });
    // The owner's DB identity passes the route's own access check; the 403
    // comes from the KEY's scope alone.
    expect(deniedKey.statusCode).toBe(403);

    const session = await injectAs(ownerUserId, 'GET', `/api/servers/${serverId}/stats`);
    expect(session.statusCode).toBe(200);
  });

  it('task create: owner with a server.read-only key is ceilinged to 403', async () => {
    const res = await injectAs(ownerUserId, 'POST', `/api/servers/${serverId}/tasks`, {
      key: { apiKeyId: 'k-read', permissions: ['server.read'] },
      payload: { name: 'ceiling-test', action: 'stop', schedule: '0 3 * * *' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('sftp connection-info: owner with file.read key mints a token; server.read-only key 403s', async () => {
    const okKey = await injectAs(ownerUserId, 'GET', `/api/sftp/connection-info?serverId=${serverId}`, {
      key: { apiKeyId: 'k-file', permissions: ['file.read'] },
    });
    expect(okKey.statusCode).toBe(200);
    expect(JSON.parse(okKey.body).data.sftpPassword).toBeTruthy();

    const deniedKey = await injectAs(ownerUserId, 'GET', `/api/sftp/connection-info?serverId=${serverId}`, {
      key: { apiKeyId: 'k-read', permissions: ['server.read'] },
    });
    expect(deniedKey.statusCode).toBe(403);
  });
});

describe('sftp mint gate (C2: effective file access, not server.read)', () => {
  it('server.read-only role session user cannot mint', async () => {
    const res = await injectAs(serverReadUserId, 'GET', `/api/sftp/connection-info?serverId=${serverId}`);
    expect(res.statusCode).toBe(403);
  });

  it('admin.read role session user mints a read-only session', async () => {
    const res = await injectAs(adminReadUserId, 'GET', `/api/sftp/connection-info?serverId=${serverId}`);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.sftpPassword).toBeTruthy();
  });

  it('subuser with a file.read row mints', async () => {
    const res = await injectAs(subuserFileReadId, 'GET', `/api/sftp/connection-info?serverId=${serverId}`);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.sftpPassword).toBeTruthy();
  });
});
