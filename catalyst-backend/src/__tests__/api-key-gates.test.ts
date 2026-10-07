/**
 * API-key route gates after the apikey split (TARGET §1 split + §2 fix).
 *
 *  - reads (list/catalog/my-permissions/usage) accept apikey.read, the
 *    legacy apikey.manage (via LEGACY_ALIASES through hasGrant) and the
 *    admin bits; plain users are denied.
 *  - writes (create/rename/enable/revoke) require apikey.write —
 *    apikey.read alone must not mutate.
 *  - the create-key grant validator is hasGrant-based: an admin.write-only
 *    creator may scope keys to concrete permissions it does not literally
 *    hold (frontend blocker fix), while unheld concrete perms are still
 *    rejected.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { apiKeyRoutes } from '../routes/api-keys.js';
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
      email: 'apikey-gates@example.com',
      username: 'apikey-gates',
      permissions: currentUser.permissions,
    };
  });
  app.decorate('wsGateway', { pushToAdminSubscribers: () => {} } as any);

  app.register(apiKeyRoutes);
  return app;
}

function asUser(userId: string, permissions: string[]) {
  currentUser = { userId, permissions };
}

async function createUser(name: string) {
  const user = await prisma.user.create({
    data: {
      email: `${name}-${nanoid(8)}@example.com`,
      username: `${name}${nanoid(6)}`,
      name,
      emailVerified: true,
    },
  });
  return user;
}

let writerId: string;
let readerId: string;
let legacyId: string;
let adminWriteId: string;
let plainId: string;
const createdKeyIds: string[] = [];

beforeAll(async () => {
  if (!process.env.API_KEY_SECRET && !process.env.BETTER_AUTH_SECRET) {
    // Tests run outside production; the service falls back to
    // BETTER_AUTH_SECRET, else needs a dedicated secret to hash keys.
    process.env.API_KEY_SECRET = 'test-api-key-secret';
  }
  writerId = (await createUser('akg-writer')).id;
  readerId = (await createUser('akg-reader')).id;
  legacyId = (await createUser('akg-legacy')).id;
  adminWriteId = (await createUser('akg-adminwrite')).id;
  plainId = (await createUser('akg-plain')).id;
});

afterAll(async () => {
  if (createdKeyIds.length > 0) {
    await prisma.apikey.deleteMany({ where: { id: { in: createdKeyIds } } }).catch(() => {});
  }
  await prisma.user.deleteMany({
    where: { id: { in: [writerId, readerId, legacyId, adminWriteId, plainId].filter(Boolean) } },
  }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

async function createKeyAs(
  userId: string,
  permissions: string[],
  keyPermissions: string[],
  name: string
) {
  const app = buildApp();
  asUser(userId, permissions);
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/api-keys',
    payload: { name, permissions: keyPermissions },
  });
  await app.close();
  return res;
}

describe('read gates: apikey.read / legacy alias / admin bits', () => {
  it('admits apikey.read to the key list', async () => {
    const app = buildApp();
    asUser(readerId, ['apikey.read']);
    const res = await app.inject({ method: 'GET', url: '/api/admin/api-keys' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('admits legacy apikey.manage (alias window)', async () => {
    const app = buildApp();
    asUser(legacyId, ['apikey.manage']);
    const res = await app.inject({ method: 'GET', url: '/api/admin/api-keys' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('denies a plain user the key list', async () => {
    const app = buildApp();
    asUser(plainId, []);
    const res = await app.inject({ method: 'GET', url: '/api/admin/api-keys' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('admits admin.read to the usage read (A-READ-GAP fix)', async () => {
    const app = buildApp();
    asUser(readerId, ['admin.read']);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/api-keys/cknownmissing${nanoid(8)}/usage`,
    });
    // Gate passes; the key itself does not exist.
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('denies a plain user the usage read', async () => {
    const app = buildApp();
    asUser(plainId, []);
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/api-keys/cknownmissing${nanoid(8)}/usage`,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('write gates: apikey.write required', () => {
  it('denies apikey.read the create route', async () => {
    const res = await createKeyAs(readerId, ['apikey.read'], ['server.read'], `ro-${nanoid(4)}`);
    expect(res.statusCode).toBe(403);
  });

  it('denies apikey.read the update route (gate check, not 404)', async () => {
    const app = buildApp();
    asUser(readerId, ['apikey.read']);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/api-keys/cknownmissing${nanoid(8)}`,
      payload: { name: 'nope' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('lets apikey.write through the update gate (404 = key not found)', async () => {
    const app = buildApp();
    asUser(writerId, ['apikey.write']);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/api-keys/cknownmissing${nanoid(8)}`,
      payload: { name: 'nope' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('hasGrant-based create-key grant validator', () => {
  it('creates a key scoped to a permission the creator literally holds', async () => {
    const res = await createKeyAs(writerId, ['apikey.write', 'server.read'], ['server.read'], `lit-${nanoid(4)}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    createdKeyIds.push(body.data?.id ?? body.id);
  });

  it('creates a key scoped to a concrete permission held only via admin.write (frontend blocker fix)', async () => {
    const res = await createKeyAs(adminWriteId, ['admin.write'], ['server.delete'], `aw-${nanoid(4)}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    createdKeyIds.push(body.data?.id ?? body.id);
  });

  it('rejects a concrete permission the creator does not hold', async () => {
    const res = await createKeyAs(writerId, ['apikey.write', 'server.read'], ['server.delete'], `bad-${nanoid(4)}`);
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(String(body.error)).toContain('Cannot grant permissions you don\'t have');
  });
});
