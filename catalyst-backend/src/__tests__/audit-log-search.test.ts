/**
 * Audit-log free-text search (`q`) on GET /api/admin/audit-logs.
 *
 * The panel used to filter only the 50 rows it had already fetched; `q` now
 * runs in the database across action, resource, resourceId, userId, actor
 * username/email and the stored JSON details (audit D19). Pins:
 *  - `q` matches a row whose ONLY hit is inside the JSON details text,
 *  - `q` matches on the actor username and on the action substring,
 *  - `q` is case-insensitive and narrows `pagination.total`, not just the page,
 *  - `q` composes with the existing filters instead of replacing them,
 *  - a non-matching `q` returns an empty page rather than everything,
 *  - the parameter stays parameterized: an injection-shaped value matches
 *    nothing and does not error.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { adminRoutes } from '../routes/admin.js';
import { nanoid } from 'nanoid';

let currentUser: { userId: string; permissions: string[] } = {
  userId: '',
  permissions: [],
};

function buildApp() {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: currentUser.userId,
      email: 'audit-q@example.com',
      username: 'audit-q',
      permissions: currentUser.permissions,
    };
  });
  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    invalidateServerAccess: () => {},
  } as any);

  app.register(adminRoutes, { prefix: '/api/admin' });
  return app;
}

const marker = `aq${nanoid(8).toLowerCase()}`;

let app: ReturnType<typeof Fastify>;
let adminUserId = '';
let readerUserId = '';
let adminRoleId = '';
let readerRoleId = '';
const createdLogIds: string[] = [];

async function seedLog(data: {
  action: string;
  resource: string;
  resourceId?: string;
  userId?: string;
  details?: unknown;
  timestamp?: Date;
}) {
  const log = await prisma.auditLog.create({
    data: {
      action: data.action,
      resource: data.resource,
      resourceId: data.resourceId ?? null,
      userId: data.userId ?? null,
      details: (data.details ?? undefined) as any,
      timestamp: data.timestamp ?? new Date(),
    },
  });
  createdLogIds.push(log.id);
  return log;
}

async function fetchLogs(query: Record<string, string>) {
  const qs = new URLSearchParams(query).toString();
  const res = await app.inject({
    method: 'GET',
    url: `/api/admin/audit-logs?${qs}`,
  });
  return { status: res.statusCode, body: res.json() as any };
}

beforeAll(async () => {
  const adminRole = await prisma.role.create({
    data: { name: `test-auditq-admin-${marker}`, permissions: ['admin.read'] },
  });
  adminRoleId = adminRole.id;
  const readerRole = await prisma.role.create({
    data: { name: `test-auditq-reader-${marker}`, permissions: ['server.read'] },
  });
  readerRoleId = readerRole.id;

  const adminUser = await prisma.user.create({
    data: {
      email: `${marker}-admin@example.com`,
      username: `${marker}-admin`,
      name: 'Audit Q Admin',
      emailVerified: true,
      roles: { connect: { id: adminRole.id } },
    },
  });
  adminUserId = adminUser.id;

  const readerUser = await prisma.user.create({
    data: {
      email: `${marker}-reader@example.com`,
      username: `${marker}-reader`,
      name: 'Audit Q Reader',
      emailVerified: true,
      roles: { connect: { id: readerRole.id } },
    },
  });
  readerUserId = readerUser.id;

  // 1: the only match for `${marker}-needle` lives inside the JSON details.
  await seedLog({
    action: `${marker}.details.only`,
    resource: 'server',
    resourceId: `${marker}-srv-1`,
    userId: adminUserId,
    details: { ip: '10.1.2.3', note: `needle ${marker}-needle inside details` },
  });
  // 2: matches on the action substring, and is also the actor-username match.
  await seedLog({
    action: `${marker}.action.match`,
    resource: 'node',
    resourceId: `${marker}-node-1`,
    userId: readerUserId,
    details: { plain: 'nothing to see' },
  });
  // 3: unrelated row, must never match.
  await seedLog({
    action: `${marker}.unrelated`,
    resource: 'template',
    resourceId: `${marker}-tpl-1`,
    userId: adminUserId,
    details: { plain: 'completely different' },
  });
  // 4: matches the resourceId text only.
  await seedLog({
    action: `${marker}.byResourceId`,
    resource: 'server',
    resourceId: `${marker}-resid-only`,
    details: {},
    timestamp: new Date(Date.now() - 60_000),
  });

  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  if (createdLogIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { id: { in: createdLogIds } } }).catch(() => {});
  }
  await prisma.user
    .deleteMany({ where: { id: { in: [adminUserId, readerUserId].filter(Boolean) } } })
    .catch(() => {});
  await prisma.role
    .deleteMany({ where: { id: { in: [adminRoleId, readerRoleId].filter(Boolean) } } })
    .catch(() => {});
});

describe('GET /api/admin/audit-logs?q=', () => {
  it('rejects a caller without admin.read', async () => {
    currentUser = { userId: readerUserId, permissions: ['server.read'] };
    const { status } = await fetchLogs({ q: 'x' });
    expect(status).toBe(403);
  });

  it('matches rows whose only hit is inside the stored JSON details', async () => {
    currentUser = { userId: adminUserId, permissions: ['admin.read'] };
    const { status, body } = await fetchLogs({ q: `${marker}-needle` });
    expect(status).toBe(200);
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].action).toBe(`${marker}.details.only`);
    expect(body.pagination.total).toBe(1);
  });

  it('matches the action substring case-insensitively', async () => {
    currentUser = { userId: adminUserId, permissions: ['admin.read'] };
    const { body } = await fetchLogs({ q: `${marker.toUpperCase()}.ACTION.MATCH` });
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].action).toBe(`${marker}.action.match`);
  });

  it('matches on the actor username', async () => {
    currentUser = { userId: adminUserId, permissions: ['admin.read'] };
    const { body } = await fetchLogs({ q: `${marker}-READER` });
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].resource).toBe('node');
  });

  it('matches the resourceId text', async () => {
    currentUser = { userId: adminUserId, permissions: ['admin.read'] };
    const { body } = await fetchLogs({ q: `${marker}-resid-only` });
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0].resourceId).toBe(`${marker}-resid-only`);
  });

  it('counts across the whole window and paginates the matches', async () => {
    currentUser = { userId: adminUserId, permissions: ['admin.read'] };
    const { body } = await fetchLogs({ q: marker, limit: '2', page: '1' });
    // All four seeded rows contain the marker somewhere.
    expect(body.pagination.total).toBe(4);
    expect(body.logs).toHaveLength(2);
    expect(body.pagination.totalPages).toBe(2);
  });

  it('composes with the existing resource filter instead of replacing it', async () => {
    currentUser = { userId: adminUserId, permissions: ['admin.read'] };
    const { body } = await fetchLogs({ q: marker, resource: 'server' });
    expect(body.pagination.total).toBe(2);
    expect(body.logs.every((log: any) => log.resource === 'server')).toBe(true);
  });

  it('returns an empty page for a query that matches nothing', async () => {
    currentUser = { userId: adminUserId, permissions: ['admin.read'] };
    const { body } = await fetchLogs({ q: `${marker}-absent` });
    expect(body.logs).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it('treats an injection-shaped q as a literal (parameterized)', async () => {
    currentUser = { userId: adminUserId, permissions: ['admin.read'] };
    const { status, body } = await fetchLogs({ q: `%' OR 1=1 --` });
    expect(status).toBe(200);
    expect(body.logs).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it('keeps the unfiltered listing unchanged when q is absent', async () => {
    currentUser = { userId: adminUserId, permissions: ['admin.read'] };
    const { body } = await fetchLogs({ limit: '100' });
    expect(body.pagination.total).toBeGreaterThanOrEqual(4);
  });
});
