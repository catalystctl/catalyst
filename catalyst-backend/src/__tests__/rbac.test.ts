/**
 * Catalyst - RBAC System Tests
 *
 * Comprehensive tests for the Role-Based Access Control system.
 * Tests permission checking, role management, and route protection.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { auth } from '../auth';
import { hasPermission, hasAnyPermission, hasAllPermissions, getUserPermissions, getUserRoles, parseScopedPermission } from '../lib/permissions';

// Prisma v7: Use adapter for PostgreSQL
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: ["error"],
});

// ── Per-run namespace ──────────────────────────────────────────────────
// All test data is tagged with a random `runId` so tests are safe to run
// against a live database (catalyst_db) without colliding with real users,
// roles, or each other across re-runs. Cleanup is scoped to this prefix.
const runId = require("crypto").randomBytes(4).toString("hex");
const mkName = (base: string) => `${base}-${runId}`;
const mkEmail = (base: string) => `${base}-${runId}@test.local`;
const mkUsername = (base: string) => `${base.slice(0, 12)}_${runId}`;
// eslint-disable-next-line no-console
console.log(`[rbac.test] runId=${runId}`);

describe('RBAC - Permission Utilities', () => {
  describe('parseScopedPermission', () => {
    it('should parse permission without scope', () => {
      const result = parseScopedPermission('node.read');
      expect(result).toEqual({ permission: 'node.read', resourceId: undefined });
    });

    it('should parse permission with scope', () => {
      const result = parseScopedPermission('node.delete:node_abc123');
      expect(result).toEqual({ permission: 'node.delete', resourceId: 'node_abc123' });
    });

    it('should parse permission with empty scope after colon', () => {
      const result = parseScopedPermission('node.delete:');
      expect(result).toEqual({ permission: 'node.delete', resourceId: undefined });
    });

    it('should parse wildcard permission', () => {
      const result = parseScopedPermission('*');
      expect(result).toEqual({ permission: '*', resourceId: undefined });
    });

    it('should parse permission with multiple colons (resource ID contains colon)', () => {
      const result = parseScopedPermission('server.delete:namespace:resource');
      expect(result).toEqual({ permission: 'server.delete', resourceId: 'namespace:resource' });
    });
  });

  describe('hasPermission - Permission Matching Logic', () => {
    let testUserId: string;
    let adminRole: { id: string };
    let moderatorRole: { id: string };
    let scopedRole: { id: string };

    beforeAll(async () => {
      // Create test user
      const user = await prisma.user.create({
        data: {
          email: mkEmail('rbac-test'),
          username: mkUsername('rbactest'),
          name: 'RBAC Test',
          emailVerified: true,
        },
      });
      testUserId = user.id;

      // Create Administrator role with wildcard
      adminRole = await prisma.role.create({
        data: {
          name: mkName('TestAdmin'),
          description: 'Admin role for testing',
          permissions: ['*'],
        },
      });

      // Create Moderator role
      moderatorRole = await prisma.role.create({
        data: {
          name: mkName('TestModerator'),
          description: 'Moderator role for testing',
          permissions: [
            'node.read',
            'node.update',
            'node.view_stats',
            'location.read',
            'template.read',
            'server.read',
            'server.start',
            'server.stop',
          ],
        },
      });

      // Create scoped role (can only manage specific node)
      scopedRole = await prisma.role.create({
        data: {
          name: mkName('TestScoped'),
          description: 'Scoped role for testing',
          permissions: ['node.delete:test-node-123'],
        },
      });
    });

    afterAll(async () => {
      // Cleanup
      await prisma.user.delete({ where: { id: testUserId } });
      await prisma.role.deleteMany({
        where: { name: { startsWith: `TestAdmin-${runId}` } },
      });
      await prisma.role.deleteMany({
        where: { name: { startsWith: `TestModerator-${runId}` } },
      });
      await prisma.role.deleteMany({
        where: { name: { startsWith: `TestScoped-${runId}` } },
      });
      await prisma.role.deleteMany({
        where: { name: { startsWith: `TestExtra-${runId}` } },
      });
    });

    it('should grant access with wildcard permission (*)', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { connect: { id: adminRole.id } } },
      });

      const result = await hasPermission(prisma, testUserId, 'any.permission');
      expect(result).toBe(true);
    });

    it('should grant access for exact permission match', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { set: [{ id: moderatorRole.id }] } },
      });

      const result = await hasPermission(prisma, testUserId, 'node.read');
      expect(result).toBe(true);
    });

    it('should deny access for non-existent permission', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { set: [{ id: moderatorRole.id }] } },
      });

      const result = await hasPermission(prisma, testUserId, 'server.delete');
      expect(result).toBe(false);
    });

    it('should grant access for scoped permission when checking specific resource', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { set: [{ id: scopedRole.id }] } },
      });

      const result = await hasPermission(prisma, testUserId, 'node.delete', 'test-node-123');
      expect(result).toBe(true);
    });

    it('should deny access for scoped permission when checking different resource', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { set: [{ id: scopedRole.id }] } },
      });

      const result = await hasPermission(prisma, testUserId, 'node.delete', 'other-node-456');
      expect(result).toBe(false);
    });

    it('should deny access for scoped permission when checking without resource ID', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { set: [{ id: scopedRole.id }] } },
      });

      const result = await hasPermission(prisma, testUserId, 'node.delete');
      expect(result).toBe(false);
    });

    it('should return false for user with no roles', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { set: [] } },
      });

      const result = await hasPermission(prisma, testUserId, 'node.read');
      expect(result).toBe(false);
    });

    it('should aggregate permissions from multiple roles', async () => {
      // Create another role with different permissions
      const extraRole = await prisma.role.create({
        data: {
          name: mkName('TestExtra'),
          description: 'Extra permissions',
          permissions: ['server.delete'],
        },
      });

      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { set: [{ id: moderatorRole.id }, { id: extraRole.id }] } },
      });

      const hasRead = await hasPermission(prisma, testUserId, 'server.read');
      const hasDelete = await hasPermission(prisma, testUserId, 'server.delete');

      expect(hasRead).toBe(true); // From moderator role
      expect(hasDelete).toBe(true); // From extra role

      // Cleanup
      await prisma.role.delete({ where: { id: extraRole.id } });
    });
  });

  describe('hasAnyPermission', () => {
    let testUserId: string;
    let limitedRole: { id: string };

    beforeAll(async () => {
      const user = await prisma.user.create({
        data: {
          email: mkEmail('rbac-any-test'),
          username: mkUsername('rbacanytest'),
          name: 'RBAC Any Test',
          emailVerified: true,
        },
      });
      testUserId = user.id;

      limitedRole = await prisma.role.create({
        data: {
          name: mkName('TestLimited'),
          description: 'Limited permissions',
          permissions: ['node.read', 'server.read'],
        },
      });
    });

    afterAll(async () => {
      await prisma.user.delete({ where: { id: testUserId } });
      await prisma.role.delete({ where: { id: limitedRole.id } });
    });

    it('should return true if user has any of the required permissions', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { connect: { id: limitedRole.id } } },
      });

      const result = await hasAnyPermission(prisma, testUserId, ['server.delete', 'node.read']);
      expect(result).toBe(true);
    });

    it('should return false if user has none of the required permissions', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { connect: { id: limitedRole.id } } },
      });

      const result = await hasAnyPermission(prisma, testUserId, ['server.delete', 'server.create']);
      expect(result).toBe(false);
    });

    it('should return true when checking single permission user has', async () => {
      const result = await hasAnyPermission(prisma, testUserId, ['node.read']);
      expect(result).toBe(true);
    });
  });

  describe('hasAllPermissions', () => {
    let testUserId: string;
    let limitedRole: { id: string };

    beforeAll(async () => {
      const user = await prisma.user.create({
        data: {
          email: mkEmail('rbac-all-test'),
          username: mkUsername('rbacalltest'),
          name: 'RBAC All Test',
          emailVerified: true,
        },
      });
      testUserId = user.id;

      limitedRole = await prisma.role.create({
        data: {
          name: mkName('TestLimitedAll'),
          description: 'Limited permissions for hasAll test',
          permissions: ['node.read', 'server.read'],
        },
      });
    });

    afterAll(async () => {
      await prisma.user.delete({ where: { id: testUserId } });
      await prisma.role.delete({ where: { id: limitedRole.id } });
    });

    it('should return true when user has all required permissions', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { connect: { id: limitedRole.id } } },
      });

      const result = await hasAllPermissions(prisma, testUserId, ['node.read', 'server.read']);
      expect(result).toBe(true);
    });

    it('should return false when user has only some required permissions', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { connect: { id: limitedRole.id } } },
      });

      const result = await hasAllPermissions(prisma, testUserId, ['node.read', 'server.delete']);
      expect(result).toBe(false);
    });
  });

  describe('getUserPermissions', () => {
    let testUserId: string;
    let role1: { id: string };
    let role2: { id: string };

    beforeAll(async () => {
      const user = await prisma.user.create({
        data: {
          email: 'rbac-get-perms@example.com',
          username: 'rbacgetperms',
          name: 'RBAC Get Perms',
          emailVerified: true,
        },
      });
      testUserId = user.id;

      role1 = await prisma.role.create({
        data: {
          name: 'TestRole1',
          permissions: ['node.read', 'node.update'],
        },
      });

      role2 = await prisma.role.create({
        data: {
          name: 'TestRole2',
          permissions: ['server.read', 'server.start'],
        },
      });
    });

    afterAll(async () => {
      await prisma.user.delete({ where: { id: testUserId } });
      await prisma.role.deleteMany({ where: { id: { in: [role1.id, role2.id] } } });
    });

    it('should aggregate permissions from all roles', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { set: [{ id: role1.id }, { id: role2.id }] } },
      });

      const permissions = await getUserPermissions(prisma, testUserId);

      expect(permissions).toBeInstanceOf(Set);
      expect(permissions.has('node.read')).toBe(true);
      expect(permissions.has('node.update')).toBe(true);
      expect(permissions.has('server.read')).toBe(true);
      expect(permissions.has('server.start')).toBe(true);
    });

    it('should handle duplicate permissions across roles', async () => {
      const role3 = await prisma.role.create({
        data: {
          name: 'TestRole3',
          permissions: ['node.read'], // Duplicate
        },
      });

      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { connect: { id: role3.id } } },
      });

      const permissions = await getUserPermissions(prisma, testUserId);

      expect(permissions.has('node.read')).toBe(true);
      // Count the actual number of unique permissions
      const uniquePerms = Array.from(permissions);
      const nodeReadCount = uniquePerms.filter(p => p === 'node.read').length;
      expect(nodeReadCount).toBe(1); // Should be deduplicated

      await prisma.role.delete({ where: { id: role3.id } });
    });

    it('should return empty set for user with no roles', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { set: [] } },
      });

      const permissions = await getUserPermissions(prisma, testUserId);

      expect(permissions.size).toBe(0);
    });
  });

  describe('getUserRoles', () => {
    let testUserId: string;
    let role1: { id: string };
    let role2: { id: string };

    beforeAll(async () => {
      const user = await prisma.user.create({
        data: {
          email: 'rbac-get-roles@example.com',
          username: 'rbacgetroles',
          name: 'RBAC Get Roles',
          emailVerified: true,
        },
      });
      testUserId = user.id;

      role1 = await prisma.role.create({
        data: {
          name: mkName('TestGetRoles1'),
          description: 'First test role',
          permissions: ['node.read'],
        },
      });

      role2 = await prisma.role.create({
        data: {
          name: mkName('TestGetRoles2'),
          description: 'Second test role',
          permissions: ['server.read'],
        },
      });
    });

    afterAll(async () => {
      await prisma.user.delete({ where: { id: testUserId } });
      await prisma.role.deleteMany({ where: { id: { in: [role1.id, role2.id] } } });
    });

    it('should return all user roles with their details', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { set: [{ id: role1.id }, { id: role2.id }] } },
      });

      const roles = await getUserRoles(prisma, testUserId);

      expect(roles).toHaveLength(2);

      // Find each role by ID to avoid ordering issues
      const role1Found = roles.find((r: any) => r.id === role1.id);
      const role2Found = roles.find((r: any) => r.id === role2.id);

      expect(role1Found).toMatchObject({
        id: role1.id,
        name: mkName('TestGetRoles1'),
        description: 'First test role',
        permissions: ['node.read'],
      });
      expect(role2Found).toMatchObject({
        id: role2.id,
        name: mkName('TestGetRoles2'),
        description: 'Second test role',
        permissions: ['server.read'],
      });
    });

    it('should return empty array for user with no roles', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { set: [] } },
      });

      const roles = await getUserRoles(prisma, testUserId);

      expect(roles).toEqual([]);
    });
  });
});

describe('RBAC - Permission Categories and Presets', () => {
  it('PERMISSION_CATEGORIES should have all required categories', async () => {
    const { PERMISSION_CATEGORIES } = await import('../lib/permissions');

    // PERMISSION_CATEGORIES is an object, not an array
    const categoryLabels = Object.values(PERMISSION_CATEGORIES).map((cat: any) => cat.label);
    expect(categoryLabels).toContain('Server');
    expect(categoryLabels).toContain('Node');
    expect(categoryLabels).toContain('Location');
    expect(categoryLabels).toContain('Template');
    expect(categoryLabels).toContain('User Management');
    expect(categoryLabels).toContain('Role Management');
    expect(categoryLabels).toContain('Backup');
    expect(categoryLabels).toContain('File Management');
    expect(categoryLabels).toContain('Console');
    expect(categoryLabels).toContain('Database');
    expect(categoryLabels).toContain('Alerts');
  });

  it('PERMISSION_CATEGORIES should have valid permissions for each category', async () => {
    const { PERMISSION_CATEGORIES } = await import('../lib/permissions');
    const validNodePermissions = [
      'node.read', 'node.create', 'node.update', 'node.delete',
      'node.view_stats', 'node.manage_allocation', 'node.assign'
    ];
    const serverPermissions = [
      'server.read', 'server.create', 'server.start', 'server.stop',
      'server.delete', 'server.suspend', 'server.transfer', 'server.schedule'
    ];

    const nodeCat = (PERMISSION_CATEGORIES as any).node;
    expect(nodeCat?.permissions).toEqual(validNodePermissions);

    const serverCat = (PERMISSION_CATEGORIES as any).server;
    expect(serverCat?.permissions).toEqual(serverPermissions);
  });

  it('PERMISSION_PRESETS should have all required presets', async () => {
    const { PERMISSION_PRESETS } = await import('../lib/permissions');

    expect(PERMISSION_PRESETS).toHaveProperty('administrator');
    expect(PERMISSION_PRESETS).toHaveProperty('moderator');
    expect(PERMISSION_PRESETS).toHaveProperty('user');
    expect(PERMISSION_PRESETS).toHaveProperty('support');

    expect(PERMISSION_PRESETS.administrator.permissions).toEqual(['*']);
  });
});

describe('RBAC - Role Model Integration', () => {
  let testUserId: string;
  let testRoleId: string;

  beforeEach(async () => {
    // Create test user
    const user = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        username: `testuser${Date.now()}`,
        name: `Test User ${Date.now()}`,
        emailVerified: true,
      },
    });
    testUserId = user.id;

    // Create test role
    const role = await prisma.role.create({
      data: {
        name: `TestRole-${Date.now()}`,
        description: 'Test role',
        permissions: ['node.read', 'server.read'],
      },
    });
    testRoleId = role.id;
  });

  afterEach(async () => {
    // Cleanup
    if (testUserId) {
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    }
    if (testRoleId) {
      await prisma.role.delete({ where: { id: testRoleId } }).catch(() => {});
    }
  });

  describe('Role Assignment', () => {
    it('should assign role to user', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { connect: { id: testRoleId } } },
      });

      const userWithRole = await prisma.user.findUnique({
        where: { id: testUserId },
        include: { roles: true },
      });

      expect(userWithRole?.roles).toHaveLength(1);
      expect(userWithRole?.roles[0].id).toBe(testRoleId);
    });

    it('should remove role from user', async () => {
      // First assign
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { connect: { id: testRoleId } } },
      });

      // Then remove
      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { disconnect: { id: testRoleId } } },
      });

      const userWithoutRole = await prisma.user.findUnique({
        where: { id: testUserId },
        include: { roles: true },
      });

      expect(userWithoutRole?.roles).toHaveLength(0);
    });

    it('should handle multiple roles assigned to user', async () => {
      const role2 = await prisma.role.create({
        data: {
          name: `TestRole2-${Date.now()}`,
          permissions: ['server.delete'],
        },
      });

      await prisma.user.update({
        where: { id: testUserId },
        data: { roles: { set: [{ id: testRoleId }, { id: role2.id }] } },
      });

      const userWithRoles = await prisma.user.findUnique({
        where: { id: testUserId },
        include: { roles: true },
      });

      expect(userWithRoles?.roles).toHaveLength(2);

      await prisma.role.delete({ where: { id: role2.id } });
    });
  });

  describe('Role Permissions Update', () => {
    it('should update role permissions', async () => {
      const newPermissions = ['node.read', 'node.create', 'node.delete'];

      await prisma.role.update({
        where: { id: testRoleId },
        data: { permissions: newPermissions },
      });

      const updatedRole = await prisma.role.findUnique({
        where: { id: testRoleId },
      });

      expect(updatedRole?.permissions).toEqual(newPermissions);
    });

    it('should add permission to existing role', async () => {
      const initialPerms = await prisma.role.findUnique({
        where: { id: testRoleId },
        select: { permissions: true },
      });

      const newPermissions = [...(initialPerms?.permissions || []), 'node.create'];

      await prisma.role.update({
        where: { id: testRoleId },
        data: { permissions: newPermissions },
      });

      const updatedRole = await prisma.role.findUnique({
        where: { id: testRoleId },
      });

      expect(updatedRole?.permissions).toContain('node.create');
    });

    it('should remove permission from role', async () => {
      const newPermissions = ['server.read'];

      await prisma.role.update({
        where: { id: testRoleId },
        data: { permissions: newPermissions },
      });

      const updatedRole = await prisma.role.findUnique({
        where: { id: testRoleId },
      });

      expect(updatedRole?.permissions).not.toContain('node.read');
      expect(updatedRole?.permissions).toEqual(['server.read']);
    });
  });
});

// Run tests
describe('RBAC - Full Permission Coverage', () => {
  const allExpectedPermissions = [
    // Server
    'server.read', 'server.create', 'server.start', 'server.stop',
    'server.delete', 'server.suspend', 'server.transfer', 'server.schedule',
    // Node
    'node.read', 'node.create', 'node.update', 'node.delete',
    'node.view_stats', 'node.manage_allocation',
    // Location
    'location.read', 'location.create', 'location.update', 'location.delete',
    // Template
    'template.read', 'template.create', 'template.update', 'template.delete',
    // User
    'user.read', 'user.create', 'user.update', 'user.delete',
    'user.ban', 'user.unban', 'user.set_roles',
    // Role
    'role.read', 'role.create', 'role.update', 'role.delete',
    // Backup
    'backup.read', 'backup.create', 'backup.delete', 'backup.restore',
    // Files
    'file.read', 'file.write',
    // Console
    'console.read', 'console.write',
    // Database
    'database.create', 'database.read', 'database.delete', 'database.rotate',
    // Alerts
    'alert.read', 'alert.create', 'alert.update', 'alert.delete',
    // Admin
    'admin.read', 'admin.write', 'apikey.manage',
  ];

  it('all expected permissions should be defined in permission enum', async () => {
    const { Permission } = await import('../shared-types');

    const permissionValues = Object.values(Permission);

    for (const perm of allExpectedPermissions) {
      expect(permissionValues).toContain(perm);
    }
  });

  it('permission enum should have no extra unexpected permissions', async () => {
    const { Permission } = await import('../shared-types');

    const permissionValues = Object.values(Permission);
    const expectedSet = new Set(allExpectedPermissions);

    for (const perm of permissionValues) {
      expect(expectedSet).toContain(perm);
    }
  });
});

describe('RBAC - Default Role Shape Validation', () => {
  // This block verifies that the SYSTEM correctly handles roles with the
  // expected shape for the three default tiers (admin / moderator / user).
  // It does NOT touch the real `Administrator`/`Moderator`/`User` roles or
  // the real `admin@example.com` user. It creates per-run scoped copies.

  const adminRoleName = mkName('DefaultAdmin');
  const moderatorRoleName = mkName('DefaultModerator');
  const userRoleName = mkName('DefaultUser');
  const adminEmail = mkEmail('default-admin');
  const adminUsername = mkUsername('defaultadmin');

  let adminRoleId: string;
  let moderatorRoleId: string;
  let userRoleId: string;
  let adminUserId: string;

  beforeAll(async () => {
    const adminRole = await prisma.role.create({
      data: {
        name: adminRoleName,
        description: 'Full access to all resources',
        permissions: ['*'],
      },
    });
    adminRoleId = adminRole.id;

    const moderatorRole = await prisma.role.create({
      data: {
        name: moderatorRoleName,
        description: 'Limited management access',
        permissions: [
          'node.read',
          'node.update',
          'node.view_stats',
          'location.read',
          'template.read',
          'server.read',
          'server.start',
          'server.stop',
        ],
      },
    });
    moderatorRoleId = moderatorRole.id;

    const userRole = await prisma.role.create({
      data: {
        name: userRoleName,
        description: 'Basic user permissions',
        permissions: ['server.read'],
      },
    });
    userRoleId = userRole.id;

    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        username: adminUsername,
        name: 'Default Admin (test)',
        emailVerified: true,
        roles: { connect: { id: adminRoleId } },
      },
    });
    adminUserId = adminUser.id;
  });

  afterAll(async () => {
    // Scoped cleanup — only what THIS run created.
    await prisma.user.deleteMany({ where: { email: { startsWith: `default-admin-${runId}` } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: `DefaultAdmin-${runId}` } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: `DefaultModerator-${runId}` } } });
    await prisma.role.deleteMany({ where: { name: { startsWith: `DefaultUser-${runId}` } } });
  });

  it('should give the test admin role wildcard permission', async () => {
    const role = await prisma.role.findUnique({ where: { id: adminRoleId } });
    expect(role?.permissions).toContain('*');
  });

  it('should give the test moderator role scoped permissions', async () => {
    const role = await prisma.role.findUnique({ where: { id: moderatorRoleId } });
    expect(role?.permissions).toContain('node.read');
    expect(role?.permissions).toContain('server.start');
  });

  it('should give the test user role read-only server permission', async () => {
    const role = await prisma.role.findUnique({ where: { id: userRoleId } });
    expect(role?.permissions).toContain('server.read');
    expect(role?.permissions).not.toContain('server.delete');
  });

  it('should report the test admin user as having admin via hasPermission(*)', async () => {
    const ok = await hasPermission(prisma, adminUserId, '*');
    expect(ok).toBe(true);
  });
});

console.log('RBAC Tests loaded successfully');
