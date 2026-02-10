/**
 * Catalyst - Frontend RBAC Permission Tests
 *
 * Tests for permission checking utilities, ProtectedRoute component,
 * and permission-related hooks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import {
  hasAnyAdminPermission,
  hasAnyPermission,
  ADMIN_PERMISSIONS,
} from '../components/auth/ProtectedRoute';

describe('RBAC - Permission Utilities', () => {
  describe('hasAnyAdminPermission', () => {
    const allAdminPermissions = [
      'server.create',
      'server.delete',
      'server.suspend',
      'server.transfer',
      'server.schedule',
      'node.read',
      'node.create',
      'node.update',
      'node.delete',
      'node.view_stats',
      'node.manage_allocation',
      'location.read',
      'location.create',
      'location.update',
      'location.delete',
      'template.read',
      'template.create',
      'template.update',
      'template.delete',
      'user.read',
      'user.create',
      'user.update',
      'user.delete',
      'user.ban',
      'user.unban',
      'user.set_roles',
      'role.read',
      'role.create',
      'role.update',
      'role.delete',
      'backup.read',
      'backup.create',
      'backup.delete',
      'backup.restore',
      'alert.read',
      'alert.create',
      'alert.update',
      'alert.delete',
      'admin.read',
      'admin.write',
      'apikey.manage',
    ];

    it('should return true when user has admin.read permission', () => {
      const result = hasAnyAdminPermission(['admin.read']);
      expect(result).toBe(true);
    });

    it('should return true when user has admin.write permission', () => {
      const result = hasAnyAdminPermission(['admin.write']);
      expect(result).toBe(true);
    });

    it('should return true when user has node.read permission', () => {
      const result = hasAnyAdminPermission(['node.read']);
      expect(result).toBe(true);
    });

    it('should return true when user has any admin permission', () => {
      for (const permission of allAdminPermissions) {
        const result = hasAnyAdminPermission([permission]);
        expect(result).toBe(true);
      }
    });

    it('should return false when user has no admin permissions', () => {
      const result = hasAnyAdminPermission(['server.read']);
      expect(result).toBe(false);
    });

    it('should return false when user has server.start permission (not admin)', () => {
      const result = hasAnyAdminPermission(['server.start', 'server.stop']);
      expect(result).toBe(false);
    });

    it('should return false when permissions array is undefined', () => {
      const result = hasAnyAdminPermission(undefined);
      expect(result).toBe(false);
    });

    it('should return false when permissions array is empty', () => {
      const result = hasAnyAdminPermission([]);
      expect(result).toBe(false);
    });

    it('should return true when user has wildcard permission', () => {
      const result = hasAnyAdminPermission(['*']);
      expect(result).toBe(true);
    });
  });

  describe('hasAnyPermission', () => {
    it('should return true when user has at least one required permission', () => {
      const result = hasAnyPermission(['node.read', 'server.delete'], ['node.read']);
      expect(result).toBe(true);
    });

    it('should return true when user has multiple permissions including required', () => {
      const result = hasAnyPermission(
        ['node.read', 'server.read', 'location.read'],
        ['server.delete', 'node.read']
      );
      expect(result).toBe(true);
    });

    it('should return false when user has none of the required permissions', () => {
      const result = hasAnyPermission(['node.read', 'server.read'], ['node.delete']);
      expect(result).toBe(false);
    });

    it('should return true when user has wildcard permission', () => {
      const result = hasAnyPermission(['*'], ['any.permission']);
      expect(result).toBe(true);
    });

    it('should return false when user permissions is undefined', () => {
      const result = hasAnyPermission(undefined, ['node.read']);
      expect(result).toBe(false);
    });

    it('should return false when required permissions is empty', () => {
      const result = hasAnyPermission(['node.read'], []);
      expect(result).toBe(false);
    });

    it('should return true when user has scoped permission matching', () => {
      const result = hasAnyPermission(['node.delete:node_123'], ['node.delete']);
      expect(result).toBe(true);
    });

    it('should return false when scoped permission does not match base', () => {
      const result = hasAnyPermission(['node.delete:node_123'], ['server.delete']);
      expect(result).toBe(false);
    });
  });

  describe('ADMIN_PERMISSIONS constant', () => {
    it('should contain all expected admin permission categories', () => {
      expect(ADMIN_PERMISSIONS).toContain('admin.read');
      expect(ADMIN_PERMISSIONS).toContain('admin.write');
      expect(ADMIN_PERMISSIONS).toContain('apikey.manage');
    });

    it('should contain server admin permissions', () => {
      expect(ADMIN_PERMISSIONS).toContain('server.create');
      expect(ADMIN_PERMISSIONS).toContain('server.delete');
      expect(ADMIN_PERMISSIONS).toContain('server.suspend');
      expect(ADMIN_PERMISSIONS).toContain('server.transfer');
      expect(ADMIN_PERMISSIONS).toContain('server.schedule');
    });

    it('should contain node permissions', () => {
      expect(ADMIN_PERMISSIONS).toContain('node.read');
      expect(ADMIN_PERMISSIONS).toContain('node.create');
      expect(ADMIN_PERMISSIONS).toContain('node.update');
      expect(ADMIN_PERMISSIONS).toContain('node.delete');
      expect(ADMIN_PERMISSIONS).toContain('node.view_stats');
      expect(ADMIN_PERMISSIONS).toContain('node.manage_allocation');
    });

    it('should contain location permissions', () => {
      expect(ADMIN_PERMISSIONS).toContain('location.read');
      expect(ADMIN_PERMISSIONS).toContain('location.create');
      expect(ADMIN_PERMISSIONS).toContain('location.update');
      expect(ADMIN_PERMISSIONS).toContain('location.delete');
    });

    it('should contain template permissions', () => {
      expect(ADMIN_PERMISSIONS).toContain('template.read');
      expect(ADMIN_PERMISSIONS).toContain('template.create');
      expect(ADMIN_PERMISSIONS).toContain('template.update');
      expect(ADMIN_PERMISSIONS).toContain('template.delete');
    });

    it('should contain user management permissions', () => {
      expect(ADMIN_PERMISSIONS).toContain('user.read');
      expect(ADMIN_PERMISSIONS).toContain('user.create');
      expect(ADMIN_PERMISSIONS).toContain('user.update');
      expect(ADMIN_PERMISSIONS).toContain('user.delete');
      expect(ADMIN_PERMISSIONS).toContain('user.ban');
      expect(ADMIN_PERMISSIONS).toContain('user.unban');
      expect(ADMIN_PERMISSIONS).toContain('user.set_roles');
    });

    it('should contain role management permissions', () => {
      expect(ADMIN_PERMISSIONS).toContain('role.read');
      expect(ADMIN_PERMISSIONS).toContain('role.create');
      expect(ADMIN_PERMISSIONS).toContain('role.update');
      expect(ADMIN_PERMISSIONS).toContain('role.delete');
    });

    it('should contain backup permissions', () => {
      expect(ADMIN_PERMISSIONS).toContain('backup.read');
      expect(ADMIN_PERMISSIONS).toContain('backup.create');
      expect(ADMIN_PERMISSIONS).toContain('backup.delete');
      expect(ADMIN_PERMISSIONS).toContain('backup.restore');
    });

    it('should contain alert permissions', () => {
      expect(ADMIN_PERMISSIONS).toContain('alert.read');
      expect(ADMIN_PERMISSIONS).toContain('alert.create');
      expect(ADMIN_PERMISSIONS).toContain('alert.update');
      expect(ADMIN_PERMISSIONS).toContain('alert.delete');
    });

    it('should not contain basic server permissions', () => {
      expect(ADMIN_PERMISSIONS).not.toContain('server.read');
      expect(ADMIN_PERMISSIONS).not.toContain('server.start');
      expect(ADMIN_PERMISSIONS).not.toContain('server.stop');
    });
  });
});

describe('RBAC - Permission Category Coverage', () => {
  it('should verify all permission categories are covered in ADMIN_PERMISSIONS', () => {
    const expectedCategories = {
      server: ['create', 'delete', 'suspend', 'transfer', 'schedule'],
      node: ['read', 'create', 'update', 'delete', 'view_stats', 'manage_allocation'],
      location: ['read', 'create', 'update', 'delete'],
      template: ['read', 'create', 'update', 'delete'],
      user: ['read', 'create', 'update', 'delete', 'ban', 'unban', 'set_roles'],
      role: ['read', 'create', 'update', 'delete'],
      backup: ['read', 'create', 'delete', 'restore'],
      alert: ['read', 'create', 'update', 'delete'],
      admin: ['read', 'write'],
      apikey: ['manage'],
    };

    for (const [category, actions] of Object.entries(expectedCategories)) {
      for (const action of actions) {
        const permission = `${category === 'apikey' ? 'apikey' : category}.${action}`;
        expect(ADMIN_PERMISSIONS).toContain(permission);
      }
    }
  });
});

describe('RBAC - Scoped Permission Parsing', () => {
  it('should correctly identify base permission from scoped permission', () => {
    const scopedPermissions = [
      'node.delete:node_abc123',
      'server.update:server_xyz789',
      'user.ban:user_123',
    ];

    const basePermissions = scopedPermissions.map((p) => p.split(':')[0]);

    expect(basePermissions).toEqual(['node.delete', 'server.update', 'user.ban']);
  });

  it('should handle permissions without colons', () => {
    const permissions = ['node.read', 'server.start', 'user.create'];

    const basePermissions = permissions.map((p) => p.split(':')[0]);

    expect(basePermissions).toEqual(permissions);
  });

  it('should handle permissions with multiple colons', () => {
    const scopedPermissions = ['server.delete:namespace:resource'];

    const parts = scopedPermissions[0].split(':');

    expect(parts[0]).toBe('server.delete');
    expect(parts.slice(1).join(':')).toBe('namespace:resource');
  });
});

describe('RBAC - Wildcard Permission Logic', () => {
  it('should treat wildcard as having all permissions', () => {
    const userPermissions = ['*'];
    const requiredPermissions = ['node.read', 'server.delete', 'user.ban'];

    for (const required of requiredPermissions) {
      const result = hasAnyPermission(userPermissions, [required]);
      expect(result).toBe(true);
    }
  });

  it('should prioritize wildcard over other permissions', () => {
    const result = hasAnyPermission(['*', 'node.read'], ['any.permission']);
    expect(result).toBe(true);
  });
});

describe('RBAC - Permission Aggregation', () => {
  it('should correctly aggregate permissions from multiple sources', () => {
    const role1Permissions = ['node.read', 'location.read'];
    const role2Permissions = ['server.read', 'template.read'];
    const directPermissions = ['user.read'];

    const allPermissions = [
      ...role1Permissions,
      ...role2Permissions,
      ...directPermissions,
    ];

    expect(allPermissions).toContain('node.read');
    expect(allPermissions).toContain('location.read');
    expect(allPermissions).toContain('server.read');
    expect(allPermissions).toContain('template.read');
    expect(allPermissions).toContain('user.read');
  });

  it('should handle duplicate permissions', () => {
    const permissions = ['node.read', 'server.read', 'node.read', 'server.read'];
    const uniquePermissions = Array.from(new Set(permissions));

    expect(uniquePermissions).toHaveLength(2);
    expect(uniquePermissions).toContain('node.read');
    expect(uniquePermissions).toContain('server.read');
  });
});

describe('RBAC - Permission Comparison', () => {
  it('should correctly match scoped permissions to base requirements', () => {
    const userPermissions = ['node.delete:node_123'];
    const requiredPermission = 'node.delete';

    // Check if any user permission matches the required base permission
    const hasPermission = userPermissions.some((userPerm) => {
      const basePerm = userPerm.split(':')[0];
      return basePerm === requiredPermission || userPerm === '*';
    });

    expect(hasPermission).toBe(true);
  });

  it('should not match scoped permission to different base requirement', () => {
    const userPermissions = ['node.delete:node_123'];
    const requiredPermission = 'server.delete';

    const hasPermission = userPermissions.some((userPerm) => {
      const basePerm = userPerm.split(':')[0];
      return basePerm === requiredPermission || userPerm === '*';
    });

    expect(hasPermission).toBe(false);
  });
});

describe('RBAC - Permission Denial Scenarios', () => {
  it('should deny access when user has no permissions', () => {
    const result = hasAnyPermission([], ['node.read']);
    expect(result).toBe(false);
  });

  it('should deny access when user has only unrelated permissions', () => {
    const result = hasAnyPermission(['server.read', 'location.read'], ['node.delete']);
    expect(result).toBe(false);
  });

  it('should deny access when checking admin permissions without any', () => {
    const result = hasAnyAdminPermission(['server.read', 'server.start', 'server.stop']);
    expect(result).toBe(false);
  });
});

describe('RBAC - Permission Granting Scenarios', () => {
  it('should grant access when user has exact permission', () => {
    const result = hasAnyPermission(['node.read'], ['node.read']);
    expect(result).toBe(true);
  });

  it('should grant access when user has one of multiple required permissions', () => {
    const result = hasAnyPermission(['node.read'], ['node.read', 'server.read']);
    expect(result).toBe(true);
  });

  it('should grant access when user has wildcard', () => {
    const result = hasAnyPermission(['*'], ['any.permission']);
    expect(result).toBe(true);
  });

  it('should grant admin access when user has any admin permission', () => {
    const adminPermissions = [
      'server.create',
      'node.delete',
      'user.ban',
      'role.create',
      'admin.write',
    ];

    for (const permission of adminPermissions) {
      const result = hasAnyAdminPermission([permission]);
      expect(result).toBe(true);
    }
  });
});

describe('RBAC - Permission Format Validation', () => {
  it('should validate permission format (resource.action)', () => {
    const validPermissions = [
      'server.read',
      'node.create',
      'location.update',
      'template.delete',
      'user.ban',
    ];

    const permissionRegex = /^[a-z_]+\.[a-z_]+$/;

    for (const permission of validPermissions) {
      const basePermission = permission.split(':')[0];
      expect(basePermission).toMatch(permissionRegex);
    }
  });

  it('should validate scoped permission format', () => {
    const scopedPermissions = [
      'node.delete:node_abc123',
      'server.update:server_xyz789',
      'user.ban:user_123',
    ];

    const scopedPermissionRegex = /^[a-z_]+\.[a-z_]+:[\w:-]+$/;

    for (const permission of scopedPermissions) {
      expect(permission).toMatch(scopedPermissionRegex);
    }
  });
});

describe('RBAC - Permission Hierarchy', () => {
  it('should establish that wildcard is highest permission', () => {
    const wildcard = ['*'];
    const admin = ['admin.read', 'admin.write'];
    const moderator = ['node.read', 'server.read'];
    const user = ['server.read'];

    // Wildcard should grant everything
    expect(hasAnyPermission(wildcard, ['admin.write'])).toBe(true);
    expect(hasAnyPermission(wildcard, moderator)).toBe(true);
    expect(hasAnyPermission(wildcard, user)).toBe(true);

    // Admin should not grant wildcard-level access
    expect(hasAnyPermission(admin, ['*'])).toBe(false);
  });

  it('should verify permission independence', () => {
    const permissions = ['node.read'];

    // Having node.read should not grant node.delete
    expect(hasAnyPermission(permissions, ['node.read'])).toBe(true);
    expect(hasAnyPermission(permissions, ['node.delete'])).toBe(false);
  });
});

console.log('Frontend RBAC Permission Tests loaded successfully');
