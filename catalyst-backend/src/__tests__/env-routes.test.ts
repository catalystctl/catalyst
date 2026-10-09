import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';

import { prisma } from '../db.js';
import { envRoutes } from '../routes/env.js';
import { resetEnvSettingsState } from '../services/env-settings.js';

let adminUserId: string;
let readUserId: string;
let basicUserId: string;

function buildApp(userId: string, perms: string[]) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId,
      email: 'env-test@t.com',
      username: 'envtest',
      permissions: perms,
    };
  });
  app.decorate('wsGateway', { pushToAdminSubscribers: () => {} } as any);
  app.register(envRoutes, { prefix: '/api/admin/environment' });
  return app;
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      email: `env-admin-${nanoid(6)}@t.com`,
      name: 'env admin',
      username: `envad_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  const reader = await prisma.user.create({
    data: {
      email: `env-reader-${nanoid(6)}@t.com`,
      name: 'env reader',
      username: `envrd_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  const basic = await prisma.user.create({
    data: {
      email: `env-basic-${nanoid(6)}@t.com`,
      name: 'env basic',
      username: `envbs_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  adminUserId = admin.id;
  readUserId = reader.id;
  basicUserId = basic.id;
});

afterEach(async () => {
  await prisma.envSetting.deleteMany({
    where: { key: { in: ['DOCS_ENABLED', 'LOG_LEVEL'] } },
  });
  resetEnvSettingsState();
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: { in: [adminUserId, readUserId, basicUserId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminUserId, readUserId, basicUserId] } } });
});

describe('GET /api/admin/environment/', () => {
  it('returns environment settings overview for admin.read', async () => {
    const app = buildApp(readUserId, ['admin.read']);
    const res = await app.inject({ method: 'GET', url: '/api/admin/environment/' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('entries');
    expect(Array.isArray(body.data.entries)).toBe(true);
  });

  it('denies access without admin.read', async () => {
    const app = buildApp(basicUserId, ['server.read']);
    const res = await app.inject({ method: 'GET', url: '/api/admin/environment/' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('PERMISSION_DENIED');
  });
});

describe('PUT /api/admin/environment/', () => {
  it('updates environment overrides with admin.write', async () => {
    const app = buildApp(adminUserId, ['admin.write']);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/environment/',
      payload: { values: { DOCS_ENABLED: 'true' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('entries');
    const override = await prisma.envSetting.findUnique({ where: { key: 'DOCS_ENABLED' } });
    expect(override?.value).toBe('true');
  });

  it('denies updates without admin.write', async () => {
    const app = buildApp(readUserId, ['admin.read']);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/environment/',
      payload: { values: { DOCS_ENABLED: 'false' } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('PERMISSION_DENIED');
  });

  it('validates environment values', async () => {
    const app = buildApp(adminUserId, ['admin.write']);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/environment/',
      payload: { values: { LOG_LEVEL: 'invalid_level' } },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error || body.code).toBeTruthy();
  });

  it('rejects updates to read-only bootstrap keys', async () => {
    const app = buildApp(adminUserId, ['admin.write']);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/environment/',
      payload: { values: { DATABASE_URL: 'postgresql://x' } },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error || body.code).toBeTruthy();
  });
});

describe('DELETE /api/admin/environment/:key', () => {
  it('resets an override back to default', async () => {
    await prisma.envSetting.create({ data: { key: 'DOCS_ENABLED', value: 'false' } });
    const app = buildApp(adminUserId, ['admin.write']);
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/environment/DOCS_ENABLED' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    const override = await prisma.envSetting.findUnique({ where: { key: 'DOCS_ENABLED' } });
    expect(override).toBeNull();
  });

  it('denies reset without admin.write', async () => {
    const app = buildApp(readUserId, ['admin.read']);
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/environment/DOCS_ENABLED' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('PERMISSION_DENIED');
  });
});

describe('GET /api/admin/environment/restart-status', () => {
  it('returns restart status for admin.read', async () => {
    const app = buildApp(readUserId, ['admin.read']);
    const res = await app.inject({ method: 'GET', url: '/api/admin/environment/restart-status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('strategy');
  });

  it('denies access without admin.read', async () => {
    const app = buildApp(basicUserId, ['server.read']);
    const res = await app.inject({ method: 'GET', url: '/api/admin/environment/restart-status' });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/admin/environment/restart', () => {
  it('requires admin.write permission', async () => {
    const app = buildApp(readUserId, ['admin.read']);
    const res = await app.inject({ method: 'POST', url: '/api/admin/environment/restart' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('PERMISSION_DENIED');
  });
});
