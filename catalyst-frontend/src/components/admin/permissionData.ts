import type { PermissionCategory } from '../../types/admin';

// Permission categories for organization
export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    label: 'Server',
    permissions: [
      'server.read',
      'server.create',
      'server.start',
      'server.stop',
      'server.delete',
      'server.suspend',
      'server.transfer',
      'server.schedule',
    ],
  },
  {
    label: 'Node',
    permissions: [
      'node.read',
      'node.create',
      'node.update',
      'node.delete',
      'node.view_stats',
      'node.manage_allocation',
    ],
  },
  {
    label: 'Location',
    permissions: [
      'location.read',
      'location.create',
      'location.update',
      'location.delete',
    ],
  },
  {
    label: 'Template',
    permissions: [
      'template.read',
      'template.create',
      'template.update',
      'template.delete',
    ],
  },
  {
    label: 'User Management',
    permissions: [
      'user.read',
      'user.create',
      'user.update',
      'user.delete',
      'user.ban',
      'user.unban',
      'user.set_roles',
    ],
  },
  {
    label: 'Role Management',
    permissions: [
      'role.read',
      'role.create',
      'role.update',
      'role.delete',
    ],
  },
  {
    label: 'Backup',
    permissions: [
      'backup.read',
      'backup.create',
      'backup.delete',
      'backup.restore',
    ],
  },
  {
    label: 'File Management',
    permissions: ['file.read', 'file.write'],
  },
  {
    label: 'Console',
    permissions: ['console.read', 'console.write'],
  },
  {
    label: 'Database',
    permissions: [
      'database.create',
      'database.read',
      'database.delete',
      'database.rotate',
    ],
  },
  {
    label: 'Alerts',
    permissions: [
      'alert.read',
      'alert.create',
      'alert.update',
      'alert.delete',
    ],
  },
  {
    label: 'System Administration',
    permissions: ['admin.read', 'admin.write', 'apikey.manage'],
  },
];

// Permission presets for quick setup
export const PERMISSION_PRESETS = [
  {
    key: 'administrator',
    label: 'Administrator',
    description: 'Full system access',
    permissions: ['*'],
  },
  {
    key: 'moderator',
    label: 'Moderator',
    description: 'Can manage most resources but not users/roles',
    permissions: [
      'node.read',
      'node.update',
      'node.view_stats',
      'location.read',
      'template.read',
      'user.read',
      'server.read',
      'server.start',
      'server.stop',
      'file.read',
      'file.write',
      'console.read',
      'console.write',
      'alert.read',
      'alert.create',
      'alert.update',
      'alert.delete',
    ],
  },
  {
    key: 'user',
    label: 'User',
    description: 'Basic access to own servers',
    permissions: ['server.read'],
  },
  {
    key: 'support',
    label: 'Support',
    description: 'Read-only access for support staff',
    permissions: [
      'node.read',
      'node.view_stats',
      'location.read',
      'template.read',
      'server.read',
      'file.read',
      'console.read',
      'alert.read',
      'user.read',
    ],
  },
];
