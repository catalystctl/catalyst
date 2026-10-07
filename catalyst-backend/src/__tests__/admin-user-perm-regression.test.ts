/**
 * Admin user-management permission regression (test-plan.md §5f).
 *
 * Pins the owner contract on /api/admin/users and /api/roles after the
 * wave-2 fixes:
 *  - canManageUsers is hasGrant-based: admin.write manages users,
 *    admin.read reads them, plain users are denied (admin.ts:84-88).
 *  - PUT /api/admin/users body-shape: profile fields (username/email/
 *    password/serverIds) always require user.update, even when roleIds is
 *    present — an empty roleIds array must not downgrade the gate.
 *  - Role hierarchy guards (TARGET §2.14): removing an admin-equivalent
 *    role from a user, or editing an admin-equivalent role, requires '*'.
 *  - roles.ts route gates are request-based (Phase 3 key-scope swap).
 *  - GET /api/roles/permissions-catalog serves the catalog to any
 *    role.read/create/update holder.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { adminRoutes } from '../routes/admin.js';
import { roleRoutes } from '../routes/roles.js';
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
      email: 'regression-test@example.com',
      username: 'regression-test',
      permissions: currentUser.permissions,
    };
  });
  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    invalidateServerAccess: () => {},
  } as any);

  app.register(adminRoutes, { prefix: '/api/admin' });
  app.register(roleRoutes, { prefix: '/api/roles' });
  return app;
}

function asUser(userId: string, permissions: string[]) {
  currentUser = { userId, permissions };
}

async function createRole(name: string, permissions: string[]) {
  const role = await prisma.role.create({
    data: { name: `test-${name}-${nanoid(8)}`, permissions },
  });
  return role;
}

async function createUser(name: string, roleId?: string) {
  const user = await prisma.user.create({
    data: {
      email: `${name}-${nanoid(8)}@example.com`,
      username: `${name}${nanoid(6)}`,
      name,
      emailVerified: true,
      ...(roleId ? { roles: { connect: { id: roleId } } } : {}),
    },
  });
  return user;
}

// roles
let readAdminRole: { id: string };
let writeAdminRole: { id: string };
let setRolesRole: { id: string };
let superRole: { id: string };
let plainRole: { id: string };
let adminEquivRole: { id: string };
let adminEquivRole2: { id: string };
let concreteRole: { id: string };
let wildcardRole: { id: string };

// users
let readAdminId: string;
let writeAdminId: string;
let setRolesUserId: string;
let superUserId: string;
let targetUserId: string;
let adminTargetId: string;
let spareAdminId: string;
let noRoleUserId: string;

beforeAll(async () => {
  readAdminRole = await createRole('reg-read-admin', ['admin.read']);
  writeAdminRole = await createRole('reg-write-admin', ['admin.write']);
  setRolesRole = await createRole('reg-set-roles', ['user.set_roles', 'user.update', 'server.read']);
  superRole = await createRole('reg-super', ['*']);
  plainRole = await createRole('reg-plain', ['server.read']);
  adminEquivRole = await createRole('reg-admin-equiv', ['admin.write']);
  adminEquivRole2 = await createRole('reg-admin-equiv-2', ['admin.write']);
  concreteRole = await createRole('reg-concrete', ['server.read', 'server.start']);
  wildcardRole = await createRole('reg-wildcard', ['*']);

  readAdminId = (await createUser('reg-read-admin', readAdminRole.id)).id;
  writeAdminId = (await createUser('reg-write-admin', writeAdminRole.id)).id;
  setRolesUserId = (await createUser('reg-set-roles', setRolesRole.id)).id;
  superUserId = (await createUser('reg-super', superRole.id)).id;
  targetUserId = (await createUser('reg-target', plainRole.id)).id;
  adminTargetId = (await createUser('reg-admin-target', adminEquivRole.id)).id;
  // Guarantees another admin-tier user exists so wildcard demotion of the
  // first admin is never the "last admin" case on a shared dev database.
  spareAdminId = (await createUser('reg-spare-admin', adminEquivRole2.id)).id;
  noRoleUserId = (await createUser('reg-norole')).id;
});

afterAll(async () => {
  // Reverse-deletion cleanup; every row this file creates is removed.
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [
          readAdminId,
          writeAdminId,
          setRolesUserId,
          superUserId,
          targetUserId,
          adminTargetId,
          spareAdminId,
          noRoleUserId,
        ].filter(Boolean),
      },
    },
  }).catch(() => {});
  await prisma.role.deleteMany({
    where: {
      id: {
        in: [
          readAdminRole?.id,
          writeAdminRole?.id,
          setRolesRole?.id,
          superRole?.id,
          plainRole?.id,
          adminEquivRole?.id,
          adminEquivRole2?.id,
          concreteRole?.id,
          wildcardRole?.id,
        ].filter(Boolean) as string[],
      },
    },
  }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
});

describe('canManageUsers honors hasGrant (owner contract)', () => {
  it('admits admin.write to GET /api/admin/users', async () => {
    const app = buildApp();
    asUser(writeAdminId, ['admin.write']);
    const res = await app.inject({ method: 'GET', url: `/api/admin/users?page=1&limit=5&search=${nanoid(4)}` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('admits admin.read to GET /api/admin/users', async () => {
    const app = buildApp();
    asUser(readAdminId, ['admin.read']);
    const res = await app.inject({ method: 'GET', url: `/api/admin/users?page=1&limit=5&search=${nanoid(4)}` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('denies a plain user GET /api/admin/users', async () => {
    const app = buildApp();
    asUser(targetUserId, ['server.read']);
    const res = await app.inject({ method: 'GET', url: `/api/admin/users?page=1&limit=5&search=${nanoid(4)}` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('denies admin.read user-management writes (POST /api/admin/users)', async () => {
    const app = buildApp();
    asUser(readAdminId, ['admin.read']);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { email: `x-${nanoid(6)}@example.com`, username: `x${nanoid(4)}`, password: 'password123' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('PUT /api/admin/users body-shape permission check', () => {
  it('requires user.update for profile fields even when roleIds is present', async () => {
    const app = buildApp();
    // set_roles alone (the old gate for a truthy roleIds) must not unlock
    // a username change on someone else's account.
    asUser(setRolesUserId, ['user.set_roles', 'server.read']);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${targetUserId}`,
      payload: { roleIds: [], username: `renamed${nanoid(4)}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('accepts roleIds+username with set_roles AND user.update', async () => {
    const app = buildApp();
    asUser(setRolesUserId, ['user.set_roles', 'user.update', 'server.read']);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${targetUserId}`,
      payload: { roleIds: [], username: `renamed${nanoid(4)}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('admits admin.write (hasGrant) to the user.update requirement', async () => {
    const app = buildApp();
    asUser(writeAdminId, ['admin.write']);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${targetUserId}`,
      payload: { roleIds: [], username: `renamed${nanoid(4)}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('pure role change still needs only user.set_roles', async () => {
    const app = buildApp();
    asUser(setRolesUserId, ['user.set_roles', 'server.read']);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${targetUserId}`,
      payload: { roleIds: [plainRole.id] },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('PUT /users role-assignment escalation guard is hasGrant-based (unified)', () => {
  it('lets an admin.write-only actor assign a concrete-perm role', async () => {
    const app = buildApp();
    // Fresh DB resolution returns ['admin.write'] for this actor — the guard
    // must accept delegation of concrete perms it does not literally hold.
    asUser(writeAdminId, ['admin.write']);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${targetUserId}`,
      payload: { roleIds: [concreteRole.id] },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
    // restore the plain role membership for later assertions
    await prisma.user.update({
      where: { id: targetUserId },
      data: { roles: { set: [{ id: plainRole.id }] } },
    });
  });

  it('assigns multiple roles without replacing the existing role', async () => {
    const app = buildApp();
    asUser(writeAdminId, ['admin.write']);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${targetUserId}`,
      payload: { roleIds: [plainRole.id, concreteRole.id] },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json() as { roles: Array<{ id: string }> };
    expect(updated.roles.map((role) => role.id)).toEqual(expect.arrayContaining([plainRole.id, concreteRole.id]));
    expect(updated.roles).toHaveLength(2);
    await app.close();
    await prisma.user.update({
      where: { id: targetUserId },
      data: { roles: { set: [{ id: plainRole.id }] } },
    });
  });

  it('denies an admin.write-only actor assigning a wildcard role', async () => {
    const app = buildApp();
    asUser(writeAdminId, ['admin.write']);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${targetUserId}`,
      payload: { roleIds: [wildcardRole.id] },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('still denies unheld concrete perms to a non-admin set_roles holder', async () => {
    const app = buildApp();
    // Fresh perms: user.set_roles, user.update, server.read — no server.start.
    asUser(setRolesUserId, ['user.set_roles', 'user.update', 'server.read']);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${targetUserId}`,
      payload: { roleIds: [concreteRole.id] },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('role hierarchy guards (TARGET §2.14)', () => {
  it('blocks user.set_roles-only from removing an admin-equivalent role', async () => {
    const app = buildApp();
    asUser(setRolesUserId, ['user.set_roles', 'server.read']);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/roles/${adminEquivRole.id}/users/${adminTargetId}`,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('allows wildcard to remove an admin-equivalent role (another admin remains)', async () => {
    const app = buildApp();
    asUser(superUserId, ['*']);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/roles/${adminEquivRole.id}/users/${adminTargetId}`,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
    // restore membership for later assertions
    await prisma.user.update({
      where: { id: adminTargetId },
      data: { roles: { connect: { id: adminEquivRole.id } } },
    });
  });

  it('allows set_roles to remove a plain (non-admin) role', async () => {
    const app = buildApp();
    asUser(setRolesUserId, ['user.set_roles', 'server.read']);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/roles/${plainRole.id}/users/${targetUserId}`,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
    await prisma.user.update({
      where: { id: targetUserId },
      data: { roles: { connect: { id: plainRole.id } } },
    });
  });

  it('blocks role.update-only from editing an admin-equivalent role', async () => {
    const app = buildApp();
    asUser(noRoleUserId, ['role.update']);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/roles/${adminEquivRole.id}`,
      payload: { name: `renamed-role-${nanoid(4)}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('blocks role.update-only from stripping a permission of an admin-equivalent role', async () => {
    const app = buildApp();
    asUser(noRoleUserId, ['role.update']);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/roles/${adminEquivRole.id}/permissions/admin.write`,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('roles route gates are request-based (Phase 3 swap)', () => {
  it('admits role.read from the request permission set (no DB role needed)', async () => {
    const app = buildApp();
    // DB user holds no roles at all — the gate must read request.user.permissions.
    asUser(noRoleUserId, ['role.read']);
    const res = await app.inject({ method: 'GET', url: '/api/roles' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('GET /api/roles/permissions-catalog', () => {
  it('serves the catalog to a role.read holder', async () => {
    const app = buildApp();
    asUser(noRoleUserId, ['role.read']);
    const res = await app.inject({ method: 'GET', url: '/api/roles/permissions-catalog' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    await app.close();
  });

  it('serves the catalog to a role.create holder', async () => {
    const app = buildApp();
    asUser(noRoleUserId, ['role.create']);
    const res = await app.inject({ method: 'GET', url: '/api/roles/permissions-catalog' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('denies a plain user', async () => {
    const app = buildApp();
    asUser(noRoleUserId, []);
    const res = await app.inject({ method: 'GET', url: '/api/roles/permissions-catalog' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
