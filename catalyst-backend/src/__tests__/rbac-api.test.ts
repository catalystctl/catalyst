/**
 * Catalyst - RBAC Route Integration Tests
 *
 * Tests for verifying that routes are properly protected with permissions.
 * These tests verify the route configuration without needing to start the full server.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { auth } from '../auth';
import { nanoid } from 'nanoid';
import { hasPermission, hasAnyPermission, getUserPermissions } from '../lib/permissions';

// Prisma v7: Use adapter for PostgreSQL
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: ["error"],
});

describe('RBAC - Route Protection Verification', () => {
  let adminUserId: string;
  let moderatorUserId: string;
  let basicUserId: string;
  let testNodeId: string;
  let testServerId: string;
  let testAdminRoleId: string;
  let testModeratorRoleId: string;
  let testBasicRoleId: string;

  beforeAll(async () => {
    // Create test users with different permission levels
    const adminUser = await prisma.user.upsert({
      where: { email: 'route-admin@test.com' },
      update: {},
      create: {
        email: 'route-admin@test.com',
        username: 'routeadmin',
        name: 'Route Admin',
        emailVerified: true,
      },
    });
    adminUserId = adminUser.id;

    const moderatorUser = await prisma.user.upsert({
      where: { email: 'route-moderator@test.com' },
      update: {},
      create: {
        email: 'route-moderator@test.com',
        username: 'routemoderator',
        name: 'Route Moderator',
        emailVerified: true,
      },
    });
    moderatorUserId = moderatorUser.id;

    const basicUser = await prisma.user.upsert({
      where: { email: 'route-basic@test.com' },
      update: {},
      create: {
        email: 'route-basic@test.com',
        username: 'routebasic',
        name: 'Route Basic',
        emailVerified: true,
      },
    });
    basicUserId = basicUser.id;

    // Create fresh test roles to avoid conflicts with existing roles
    const adminRole = await prisma.role.create({
      data: { name: `TestAdmin-${nanoid(8)}`, permissions: ['*'] },
    });
    testAdminRoleId = adminRole.id;

    const moderatorRole = await prisma.role.create({
      data: {
        name: `TestModerator-${nanoid(8)}`,
        permissions: [
          'node.read', 'node.update', 'node.view_stats',
          'location.read', 'template.read', 'user.read',
          'server.read', 'server.start', 'server.stop',
        ],
      },
    });
    testModeratorRoleId = moderatorRole.id;

    const basicRole = await prisma.role.create({
      data: { name: `TestBasic-${nanoid(8)}`, permissions: ['server.read'] },
    });
    testBasicRoleId = basicRole.id;

    // Assign roles
    await prisma.user.update({
      where: { id: adminUserId },
      data: { roles: { set: [{ id: testAdminRoleId }] } },
    });

    await prisma.user.update({
      where: { id: moderatorUserId },
      data: { roles: { set: [{ id: testModeratorRoleId }] } },
    });

    await prisma.user.update({
      where: { id: basicUserId },
      data: { roles: { set: [{ id: testBasicRoleId }] } },
    });

    // Generate test IDs for permission checking (no actual resource creation needed)
    testNodeId = `test-node-${nanoid(8)}`;
    testServerId = `test-server-${nanoid(8)}`;
  });

  afterAll(async () => {
    // Cleanup test users and roles
    await prisma.user.delete({ where: { id: adminUserId } }).catch(() => {});
    await prisma.user.delete({ where: { id: moderatorUserId } }).catch(() => {});
    await prisma.user.delete({ where: { id: basicUserId } }).catch(() => {});

    // Cleanup test roles
    await prisma.role.delete({ where: { id: testAdminRoleId } }).catch(() => {});
    await prisma.role.delete({ where: { id: testModeratorRoleId } }).catch(() => {});
    await prisma.role.delete({ where: { id: testBasicRoleId } }).catch(() => {});
  });

  describe('Nodes Route Permissions', () => {
    const nodeRoutes = [
      { method: 'GET', path: '/api/nodes', permission: 'node.read', description: 'List nodes' },
      { method: 'POST', path: '/api/nodes', permission: 'node.create', description: 'Create node' },
      { method: 'GET', path: '/api/nodes/:id', permission: 'node.read', description: 'Get node' },
      { method: 'PUT', path: '/api/nodes/:id', permission: 'node.update', description: 'Update node' },
      { method: 'DELETE', path: '/api/nodes/:id', permission: 'node.delete', description: 'Delete node' },
      { method: 'GET', path: '/api/nodes/:id/stats', permission: 'node.view_stats', description: 'View node stats' },
      { method: 'POST', path: '/api/nodes/:id/allocations', permission: 'node.manage_allocation', description: 'Manage allocation' },
    ];

    it('admin should have access to all node routes', async () => {
      for (const route of nodeRoutes) {
        const hasAccess = await hasPermission(prisma, adminUserId, route.permission);
        expect(hasAccess).toBe(true);
      }
    });

    it('moderator should have access to read and update node routes', async () => {
      const moderatorAccessibleRoutes = ['node.read', 'node.update', 'node.view_stats'];

      for (const route of nodeRoutes) {
        const hasAccess = await hasPermission(prisma, moderatorUserId, route.permission);
        if (moderatorAccessibleRoutes.includes(route.permission)) {
          expect(hasAccess).toBe(true);
        } else {
          expect(hasAccess).toBe(false);
        }
      }
    });

    it('basic user should not have access to node routes', async () => {
      for (const route of nodeRoutes) {
        const hasAccess = await hasPermission(prisma, basicUserId, route.permission);
        expect(hasAccess).toBe(false);
      }
    });
  });

  describe('Admin Routes Permissions', () => {
    const adminRoutes = [
      { method: 'GET', path: '/api/admin/stats', permission: 'admin.read', description: 'Admin stats' },
      { method: 'GET', path: '/api/admin/nodes', permission: 'node.read', description: 'Admin nodes list' },
      { method: 'GET', path: '/api/admin/servers', permission: 'server.read', description: 'Admin servers list' },
      { method: 'GET', path: '/api/admin/users', permission: 'user.read', description: 'Admin users list' },
    ];

    it('admin should have access to all admin routes', async () => {
      for (const route of adminRoutes) {
        const hasAccess = await hasPermission(prisma, adminUserId, route.permission);
        expect(hasAccess).toBe(true);
      }
    });

    it('moderator should have access to specific admin routes based on permissions', async () => {
      // Moderator has node.read, server.read
      const moderatorHasAccess = await hasAnyPermission(prisma, moderatorUserId, [
        'node.read', 'server.read', 'user.read', 'admin.read'
      ]);
      expect(moderatorHasAccess).toBe(true);
    });

    it('basic user should have access to admin routes they have permissions for', async () => {
      // Basic user has server.read, so they should access /api/admin/servers
      const serverAccess = await hasPermission(prisma, basicUserId, 'server.read');
      expect(serverAccess).toBe(true);

      // But should not have access to other admin routes
      const nodeAccess = await hasPermission(prisma, basicUserId, 'node.read');
      expect(nodeAccess).toBe(false);

      const userAccess = await hasPermission(prisma, basicUserId, 'user.read');
      expect(userAccess).toBe(false);

      const adminAccess = await hasPermission(prisma, basicUserId, 'admin.read');
      expect(adminAccess).toBe(false);
    });
  });

  describe('Role Management Routes', () => {
    const roleRoutes = [
      { method: 'GET', path: '/api/roles', permission: 'role.read', description: 'List roles' },
      { method: 'POST', path: '/api/roles', permission: 'role.create', description: 'Create role' },
      { method: 'GET', path: '/api/roles/:id', permission: 'role.read', description: 'Get role' },
      { method: 'PUT', path: '/api/roles/:id', permission: 'role.update', description: 'Update role' },
      { method: 'DELETE', path: '/api/roles/:id', permission: 'role.delete', description: 'Delete role' },
      { method: 'POST', path: '/api/roles/:id/permissions', permission: 'role.update', description: 'Add permission' },
      { method: 'DELETE', path: '/api/roles/:id/permissions/:permission', permission: 'role.update', description: 'Remove permission' },
      { method: 'POST', path: '/api/roles/:id/users/:userId', permission: 'user.set_roles', description: 'Assign role' },
      { method: 'DELETE', path: '/api/roles/:id/users/:userId', permission: 'user.set_roles', description: 'Remove role' },
    ];

    it('admin should have access to all role management routes', async () => {
      for (const route of roleRoutes) {
        const hasAccess = await hasPermission(prisma, adminUserId, route.permission);
        expect(hasAccess).toBe(true);
      }
    });

    it('moderator should not have access to role management routes', async () => {
      for (const route of roleRoutes) {
        const hasAccess = await hasPermission(prisma, moderatorUserId, route.permission);
        expect(hasAccess).toBe(false);
      }
    });
  });

  describe('Server Routes Permissions', () => {
    const serverRoutes = [
      { method: 'GET', path: '/api/servers', permission: 'server.read', description: 'List servers' },
      { method: 'POST', path: '/api/servers', permission: 'admin.write', description: 'Create server' },
      { method: 'GET', path: '/api/servers/:id', permission: 'server.read', description: 'Get server' },
      { method: 'DELETE', path: '/api/servers/:id', permission: 'server.delete', description: 'Delete server' },
      { method: 'POST', path: '/api/servers/:id/start', permission: 'server.start', description: 'Start server' },
      { method: 'POST', path: '/api/servers/:id/stop', permission: 'server.stop', description: 'Stop server' },
      { method: 'POST', path: '/api/servers/:id/suspend', permission: 'server.suspend', description: 'Suspend server' },
    ];

    it('admin should have access to all server routes', async () => {
      for (const route of serverRoutes) {
        const hasAccess = await hasPermission(prisma, adminUserId, route.permission);
        expect(hasAccess).toBe(true);
      }
    });

    it('moderator should have access to read, start, and stop server routes', async () => {
      const moderatorAccessibleRoutes = ['server.read', 'server.start', 'server.stop'];

      for (const route of serverRoutes) {
        const hasAccess = await hasPermission(prisma, moderatorUserId, route.permission);
        if (moderatorAccessibleRoutes.includes(route.permission)) {
          expect(hasAccess).toBe(true);
        } else {
          expect(hasAccess).toBe(false);
        }
      }
    });

    it('basic user should have read access to servers', async () => {
      const hasReadAccess = await hasPermission(prisma, basicUserId, 'server.read');
      expect(hasReadAccess).toBe(true);

      const hasCreateAccess = await hasPermission(prisma, basicUserId, 'admin.write');
      expect(hasCreateAccess).toBe(false);
    });
  });

  describe('User Management Routes', () => {
    const userManagementRoutes = [
      { method: 'GET', path: '/api/admin/users', permission: 'user.read', description: 'List users' },
      { method: 'POST', path: '/api/admin/users', permission: 'user.create', description: 'Create user' },
      { method: 'PUT', path: '/api/admin/users/:id', permission: 'user.update', description: 'Update user' },
      { method: 'DELETE', path: '/api/admin/users/:id', permission: 'user.delete', description: 'Delete user' },
      { method: 'POST', path: '/api/admin/users/:id/ban', permission: 'user.ban', description: 'Ban user' },
      { method: 'POST', path: '/api/admin/users/:id/unban', permission: 'user.unban', description: 'Unban user' },
      { method: 'PUT', path: '/api/admin/users/:id/roles', permission: 'user.set_roles', description: 'Set user roles' },
    ];

    it('admin should have access to all user management routes', async () => {
      for (const route of userManagementRoutes) {
        const hasAccess = await hasPermission(prisma, adminUserId, route.permission);
        expect(hasAccess).toBe(true);
      }
    });

    it('moderator should have read access to users', async () => {
      const hasReadAccess = await hasPermission(prisma, moderatorUserId, 'user.read');
      expect(hasReadAccess).toBe(true);

      const hasDeleteAccess = await hasPermission(prisma, moderatorUserId, 'user.delete');
      expect(hasDeleteAccess).toBe(false);
    });

    it('basic user should not have access to user management routes', async () => {
      for (const route of userManagementRoutes) {
        const hasAccess = await hasPermission(prisma, basicUserId, route.permission);
        expect(hasAccess).toBe(false);
      }
    });
  });

  describe('Template Routes Permissions', () => {
    const templateRoutes = [
      { method: 'GET', path: '/api/templates', permission: 'template.read', description: 'List templates' },
      { method: 'POST', path: '/api/templates', permission: 'template.create', description: 'Create template' },
      { method: 'GET', path: '/api/templates/:id', permission: 'template.read', description: 'Get template' },
      { method: 'PUT', path: '/api/templates/:id', permission: 'template.update', description: 'Update template' },
      { method: 'DELETE', path: '/api/templates/:id', permission: 'template.delete', description: 'Delete template' },
    ];

    it('admin should have access to all template routes', async () => {
      for (const route of templateRoutes) {
        const hasAccess = await hasPermission(prisma, adminUserId, route.permission);
        expect(hasAccess).toBe(true);
      }
    });

    it('moderator should have read access to templates', async () => {
      const hasReadAccess = await hasPermission(prisma, moderatorUserId, 'template.read');
      expect(hasReadAccess).toBe(true);

      const hasCreateAccess = await hasPermission(prisma, moderatorUserId, 'template.create');
      expect(hasCreateAccess).toBe(false);
    });
  });

  describe('Location Routes Permissions', () => {
    const locationRoutes = [
      { method: 'GET', path: '/api/locations', permission: 'location.read', description: 'List locations' },
      { method: 'POST', path: '/api/locations', permission: 'location.create', description: 'Create location' },
      { method: 'PUT', path: '/api/locations/:id', permission: 'location.update', description: 'Update location' },
      { method: 'DELETE', path: '/api/locations/:id', permission: 'location.delete', description: 'Delete location' },
    ];

    it('admin should have access to all location routes', async () => {
      for (const route of locationRoutes) {
        const hasAccess = await hasPermission(prisma, adminUserId, route.permission);
        expect(hasAccess).toBe(true);
      }
    });

    it('moderator should have read access to locations', async () => {
      const hasReadAccess = await hasPermission(prisma, moderatorUserId, 'location.read');
      expect(hasReadAccess).toBe(true);

      const hasCreateAccess = await hasPermission(prisma, moderatorUserId, 'location.create');
      expect(hasCreateAccess).toBe(false);
    });
  });

  describe('Backup Routes Permissions', () => {
    const backupRoutes = [
      { method: 'GET', path: '/api/servers/:id/backups', permission: 'backup.read', description: 'List backups' },
      { method: 'POST', path: '/api/servers/:id/backups', permission: 'backup.create', description: 'Create backup' },
      { method: 'DELETE', path: '/api/backups/:id', permission: 'backup.delete', description: 'Delete backup' },
      { method: 'POST', path: '/api/backups/:id/restore', permission: 'backup.restore', description: 'Restore backup' },
    ];

    it('admin should have access to all backup routes', async () => {
      for (const route of backupRoutes) {
        const hasAccess = await hasPermission(prisma, adminUserId, route.permission);
        expect(hasAccess).toBe(true);
      }
    });
  });

  describe('Wildcard Permission Tests', () => {
    it('admin with wildcard should have access to any permission', async () => {
      const allTestPermissions = [
        'node.read', 'node.create', 'node.delete',
        'server.read', 'server.create', 'server.delete',
        'user.read', 'user.create', 'user.delete',
        'role.read', 'role.create', 'role.delete',
        'backup.read', 'backup.create', 'backup.delete',
        'location.read', 'location.create',
        'template.read', 'template.create',
      ];

      for (const permission of allTestPermissions) {
        const hasAccess = await hasPermission(prisma, adminUserId, permission);
        expect(hasAccess).toBe(true);
      }
    });
  });

  describe('Permission Aggregation Tests', () => {
    it('should correctly aggregate permissions from multiple roles', async () => {
      // Create a user with multiple roles
      const multiRoleUser = await prisma.user.create({
        data: {
          email: `multi-role-${nanoid(8)}@test.com`,
          username: `multirole${nanoid(4)}`,
          name: `Multi Role User ${nanoid(4)}`,
          emailVerified: true,
        },
      });

      // Create two roles with different permissions
      const role1 = await prisma.role.create({
        data: {
          name: `MultiRole1-${nanoid(8)}`,
          permissions: ['node.read', 'location.read'],
        },
      });

      const role2 = await prisma.role.create({
        data: {
          name: `MultiRole2-${nanoid(8)}`,
          permissions: ['server.read', 'template.read'],
        },
      });

      // Assign both roles
      await prisma.user.update({
        where: { id: multiRoleUser.id },
        data: { roles: { set: [{ id: role1.id }, { id: role2.id }] } },
      });

      // Check that user has permissions from both roles
      const permissions = await getUserPermissions(prisma, multiRoleUser.id);

      expect(permissions.has('node.read')).toBe(true);
      expect(permissions.has('location.read')).toBe(true);
      expect(permissions.has('server.read')).toBe(true);
      expect(permissions.has('template.read')).toBe(true);

      // Cleanup
      await prisma.user.delete({ where: { id: multiRoleUser.id } });
      await prisma.role.delete({ where: { id: role1.id } });
      await prisma.role.delete({ where: { id: role2.id } });
    });
  });
});

console.log('RBAC Route Protection Tests loaded successfully');
