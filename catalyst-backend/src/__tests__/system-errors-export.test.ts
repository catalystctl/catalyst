import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { adminRoutes } from '../routes/admin.js';
import { nanoid } from 'nanoid';

let testUserId: string;
const createdIds: string[] = [];

function buildTestApp(perms: string[] = ['*']) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId: testUserId, email: 't@t.com', username: 't', permissions: perms };
  });
  app.decorate('wsGateway', { pushToAdminSubscribers: () => {} } as any);
  return app;
}

beforeAll(async () => {
  const uname = `se_${nanoid(6)}`;
  const user = await prisma.user.create({
    data: { email: `se-${nanoid(6)}@t.com`, name: 'se test', username: uname, emailVerified: true },
  });
  testUserId = user.id;
  const now = Date.now();
  for (let i = 0; i < 3; i++) {
    const e = await prisma.systemError.create({
      data: {
        level: i === 0 ? 'critical' : 'error',
        component: `TestComp${i}`,
        message: `test message ${i}`,
        stack: `stack ${i}`,
        metadata: { idx: i },
        createdAt: new Date(now - i * 3600_000),
      },
    });
    createdIds.push(e.id);
  }
});

afterAll(async () => {
  await prisma.systemError.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
});

describe('system-errors export + resolve-all', () => {
  it('exports JSON filtered by range', async () => {
    const app = buildTestApp(['admin.read']);
    await app.register(adminRoutes, { prefix: '/api/admin' });
    const from = new Date(Date.now() - 2 * 3600_000).toISOString();
    const res = await app.inject({ method: 'GET', url: `/api/admin/system-errors/export?from=${encodeURIComponent(from)}&format=json` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(body.errors)).toBe(true);
    await app.close();
  });

  it('exports markdown', async () => {
    const app = buildTestApp(['admin.read']);
    await app.register(adminRoutes, { prefix: '/api/admin' });
    const res = await app.inject({ method: 'GET', url: '/api/admin/system-errors/export?format=markdown' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.body).toContain('# System Errors Export');
    await app.close();
  });

  it('rejects invalid format', async () => {
    const app = buildTestApp(['admin.read']);
    await app.register(adminRoutes, { prefix: '/api/admin' });
    const res = await app.inject({ method: 'GET', url: '/api/admin/system-errors/export?format=xml' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('requires admin.read for export', async () => {
    const app = buildTestApp([]);
    await app.register(adminRoutes, { prefix: '/api/admin' });
    const res = await app.inject({ method: 'GET', url: '/api/admin/system-errors/export?format=json' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('resolve-all resolves matching unresolved', async () => {
    const app = buildTestApp(['admin.write']);
    await app.register(adminRoutes, { prefix: '/api/admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/system-errors/resolve-all',
      payload: { component: 'TestComp' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().resolvedCount).toBeGreaterThanOrEqual(3);
    const remaining = await prisma.systemError.count({ where: { id: { in: createdIds }, resolved: false } });
    expect(remaining).toBe(0);
    await app.close();
  });

  it('requires admin.write for resolve-all', async () => {
    const app = buildTestApp(['admin.read']);
    await app.register(adminRoutes, { prefix: '/api/admin' });
    const res = await app.inject({ method: 'POST', url: '/api/admin/system-errors/resolve-all', payload: {} });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
