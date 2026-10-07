import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';

import { updateRoutes } from '../routes/update.js';
import { migrationRoutes } from '../routes/migration.js';

// Targeted gate tests for the admin.read read-tier move on the update and
// migration surfaces (TARGET-VOCABULARY §2.1): reads accept admin.read via
// hasGrant (so admin.write/* also pass and admin.write-only users are no
// longer locked out by raw includes), while writes stay on the admin.write
// tier — admin.read must NEVER authorize a write. Uses the P-A inject-perms
// harness; the deny paths short-circuit before any DB or network work.

let currentPerms: string[] = [];

function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId: 'u_test', email: 't@t.com', username: 't', permissions: currentPerms };
  });
  return app;
}

async function inject(
  register: (app: ReturnType<typeof buildApp>) => Promise<void>,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<number> {
  const app = buildApp();
  await register(app);
  const res = await app.inject({
    method,
    url,
    ...(payload !== undefined ? { payload, headers: { 'content-type': 'application/json' } } : {}),
  });
  await app.close();
  return res.statusCode;
}

const registerUpdate = async (app: ReturnType<typeof buildApp>) => {
  await app.register(updateRoutes, { prefix: '/api/admin/update' });
};
const registerMigration = async (app: ReturnType<typeof buildApp>) => {
  await app.register(migrationRoutes);
};

describe('update routes — reads move to admin.read', () => {
  it.each([
    ['admin.read', ['admin.read']],
    ['admin.write (was the only tier before)', ['admin.write']],
    ['*', ['*']],
  ])('GET /state accepts %s', async (_label, perms) => {
    currentPerms = perms as string[];
    expect(await inject(registerUpdate, 'GET', '/api/admin/update/state')).toBe(200);
  });

  it.each([
    ['admin.read', ['admin.read']],
    ['admin.write', ['admin.write']],
  ])('GET /settings accepts %s', async (_label, perms) => {
    currentPerms = perms as string[];
    expect(await inject(registerUpdate, 'GET', '/api/admin/update/settings')).toBe(200);
  });

  it('GET /state rejects a bare server.read user', async () => {
    currentPerms = ['server.read'];
    expect(await inject(registerUpdate, 'GET', '/api/admin/update/state')).toBe(403);
  });

  it('POST /trigger stays admin.write-tier: admin.read is rejected', async () => {
    currentPerms = ['admin.read'];
    expect(await inject(registerUpdate, 'POST', '/api/admin/update/trigger')).toBe(403);
  });

  it('POST /check stays write-tier: admin.read is rejected', async () => {
    currentPerms = ['admin.read'];
    expect(await inject(registerUpdate, 'POST', '/api/admin/update/check')).toBe(403);
    currentPerms = ['server.read'];
    expect(await inject(registerUpdate, 'POST', '/api/admin/update/check')).toBe(403);
  });

  it('PUT /settings stays admin.write-tier: admin.read is rejected', async () => {
    currentPerms = ['admin.read'];
    expect(await inject(registerUpdate, 'PUT', '/api/admin/update/settings')).toBe(403);
  });
});

describe('migration routes — reads move to admin.read', () => {
  it.each([
    ['admin.read', ['admin.read']],
    ['admin.write', ['admin.write']],
    ['*', ['*']],
  ])('GET /api/admin/migration accepts %s', async (_label, perms) => {
    currentPerms = perms as string[];
    expect(await inject(registerMigration, 'GET', '/api/admin/migration')).toBe(200);
  });

  it('GET /api/admin/migration/catalyst-nodes accepts admin.read', async () => {
    currentPerms = ['admin.read'];
    expect(await inject(registerMigration, 'GET', '/api/admin/migration/catalyst-nodes')).toBe(200);
  });

  it('reads pass the gate and reach the handler (404, not 403, for a missing job)', async () => {
    currentPerms = ['admin.read'];
    expect(await inject(registerMigration, 'GET', '/api/admin/migration/job_does_not_exist')).toBe(404);
  });

  it('reads reject a bare server.read user', async () => {
    currentPerms = ['server.read'];
    expect(await inject(registerMigration, 'GET', '/api/admin/migration')).toBe(403);
  });

  it('writes require the migration.manage tier: admin.read is rejected before any work', async () => {
    currentPerms = ['admin.read'];
    expect(await inject(registerMigration, 'POST', '/api/admin/migration/job_x/pause')).toBe(403);
    expect(await inject(registerMigration, 'POST', '/api/admin/migration/job_x/cancel')).toBe(403);
    expect(await inject(registerMigration, 'POST', '/api/admin/migration/test')).toBe(403);
  });

  it('admin.write and migration.manage pass the write gate (400 = validation, not 403)', async () => {
    currentPerms = ['admin.write'];
    expect(await inject(registerMigration, 'POST', '/api/admin/migration/test', {})).toBe(400);
    currentPerms = ['migration.manage'];
    expect(await inject(registerMigration, 'POST', '/api/admin/migration/test', {})).toBe(400);
  });
});
