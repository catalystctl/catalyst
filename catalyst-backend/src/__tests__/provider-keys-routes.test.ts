import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';

import { prisma } from '../db.js';
import { providerKeyRoutes } from '../routes/provider-keys.js';

let testUserId: string;

function buildApp(perms: string[]) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: testUserId,
      email: 'provider-test@t.com',
      username: 'providertest',
      permissions: perms,
    };
  });
  app.register(providerKeyRoutes, { prefix: '/api/provider-keys' });
  return app;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `provider-keys-${nanoid(6)}@t.com`,
      name: 'provider keys test',
      username: `pk_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  testUserId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: testUserId } });
});

describe('GET /api/provider-keys/status', () => {
  it('returns boolean status for configured provider keys', async () => {
    const app = buildApp(['*']);
    const res = await app.inject({ method: 'GET', url: '/api/provider-keys/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('modrinth');
    expect(body.data).toHaveProperty('curseforge');
    expect(typeof body.data.modrinth).toBe('boolean');
    expect(typeof body.data.curseforge).toBe('boolean');
  });

  it('allows authenticated users without admin permissions', async () => {
    const app = buildApp(['server.read']);
    const res = await app.inject({ method: 'GET', url: '/api/provider-keys/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
  });

  it('never exposes actual key values', async () => {
    const app = buildApp(['*']);
    const res = await app.inject({ method: 'GET', url: '/api/provider-keys/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const values = Object.values(body.data);
    for (const val of values) {
      expect(typeof val).toBe('boolean');
    }
  });
});
