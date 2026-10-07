import type { CatalogCategory } from './permissionGroups';

/**
 * Offline fallback for `GET /api/roles/permissions-catalog`.
 *
 * Mirrors `PERMISSION_CATEGORIES` in
 * catalyst-backend/src/lib/permissions-catalog.ts so the role editor still
 * renders when the backend is unreachable. The served catalog always wins;
 * this list only keeps the form usable (and is exercised by unit tests).
 */
export const FALLBACK_PERMISSION_CATEGORIES: CatalogCategory[] = [
  {
    id: 'admin',
    label: 'Administration',
    description: 'Full admin access to all system features',
    permissions: [
      { value: '*', label: 'Super Admin (all permissions)' },
      { value: 'admin.read', label: 'View admin panel' },
      { value: 'admin.write', label: 'Manage admin settings' },
    ],
  },
  {
    id: 'servers',
    label: 'Servers',
    description: 'Create, manage, and delete game servers',
    permissions: [
      { value: 'server.read', label: 'View servers' },
      { value: 'server.create', label: 'Create servers' },
      { value: 'server.start', label: 'Start servers' },
      { value: 'server.stop', label: 'Stop servers' },
      { value: 'server.delete', label: 'Delete servers' },
      { value: 'server.suspend', label: 'Suspend servers' },
      { value: 'server.transfer', label: 'Transfer ownership' },
      { value: 'server.schedule', label: 'Manage schedules/tasks' },
      { value: 'server.update', label: 'Update server settings' },
      { value: 'server.install', label: 'Install servers' },
      { value: 'server.reinstall', label: 'Reinstall servers' },
      { value: 'server.rebuild', label: 'Rebuild servers' },
      { value: 'server.clone', label: 'Clone servers' },
      { value: 'server.kill', label: 'Force-kill servers' },
      { value: 'server.network', label: 'Manage allocations and ports' },
      { value: 'server.storage', label: 'Resize server storage' },
      { value: 'server.archive', label: 'Archive and restore servers' },
      { value: 'server.migrate', label: 'Move servers between nodes' },
    ],
  },
  {
    id: 'nodes',
    label: 'Nodes',
    description: 'Manage compute nodes',
    permissions: [
      { value: 'node.read', label: 'View nodes' },
      { value: 'node.create', label: 'Create nodes' },
      { value: 'node.update', label: 'Update nodes' },
      { value: 'node.delete', label: 'Delete nodes' },
      { value: 'node.view_stats', label: 'View node statistics' },
      { value: 'node.manage_allocation', label: 'Manage allocations' },
      { value: 'node.assign', label: 'Assign nodes' },
      { value: 'node.server_manage', label: 'Manage servers on assigned nodes' },
      { value: 'node.agent_control', label: 'Restart and update node agents' },
    ],
  },
  {
    id: 'locations',
    label: 'Locations',
    description: 'Manage server locations',
    permissions: [
      { value: 'location.read', label: 'View locations' },
      { value: 'location.create', label: 'Create locations' },
      { value: 'location.update', label: 'Update locations' },
      { value: 'location.delete', label: 'Delete locations' },
    ],
  },
  {
    id: 'templates',
    label: 'Templates',
    description: 'Manage game server templates',
    permissions: [
      { value: 'template.read', label: 'View templates' },
      { value: 'template.create', label: 'Create templates' },
      { value: 'template.update', label: 'Update templates' },
      { value: 'template.delete', label: 'Delete templates' },
    ],
  },
  {
    id: 'users',
    label: 'Users',
    description: 'Manage user accounts',
    permissions: [
      { value: 'user.read', label: 'View users' },
      { value: 'user.create', label: 'Create users' },
      { value: 'user.update', label: 'Update users' },
      { value: 'user.delete', label: 'Delete users' },
      { value: 'user.ban', label: 'Ban users' },
      { value: 'user.unban', label: 'Unban users' },
      { value: 'user.set_roles', label: 'Assign roles' },
    ],
  },
  {
    id: 'roles',
    label: 'Roles',
    description: 'Manage permission roles',
    permissions: [
      { value: 'role.read', label: 'View roles' },
      { value: 'role.create', label: 'Create roles' },
      { value: 'role.update', label: 'Update roles' },
      { value: 'role.delete', label: 'Delete roles' },
    ],
  },
  {
    id: 'backups',
    label: 'Backups',
    description: 'Manage server backups',
    permissions: [
      { value: 'backup.read', label: 'View backups' },
      { value: 'backup.create', label: 'Create backups' },
      { value: 'backup.delete', label: 'Delete backups' },
      { value: 'backup.restore', label: 'Restore backups' },
      { value: 'backup.download', label: 'Download backups' },
    ],
  },
  {
    id: 'files',
    label: 'Files',
    description: 'Access server file manager',
    permissions: [
      { value: 'file.read', label: 'Read files' },
      { value: 'file.write', label: 'Write files' },
    ],
  },
  {
    id: 'console',
    label: 'Console',
    description: 'Access server console',
    permissions: [
      { value: 'console.read', label: 'View console' },
      { value: 'console.write', label: 'Send commands' },
    ],
  },
  {
    id: 'databases',
    label: 'Databases',
    description: 'Manage server databases',
    permissions: [
      { value: 'database.read', label: 'View databases' },
      { value: 'database.create', label: 'Create databases' },
      { value: 'database.delete', label: 'Delete databases' },
      { value: 'database.rotate', label: 'Rotate passwords' },
    ],
  },
  {
    id: 'alerts',
    label: 'Alerts',
    description: 'Manage server alerts',
    permissions: [
      { value: 'alert.read', label: 'View alerts' },
      { value: 'alert.create', label: 'Create alerts' },
      { value: 'alert.update', label: 'Update alerts' },
      { value: 'alert.delete', label: 'Delete alerts' },
    ],
  },
  {
    id: 'apikeys',
    label: 'API Keys',
    description: 'Manage API keys',
    permissions: [
      { value: 'apikey.manage', label: 'Create and manage API keys' },
      { value: 'apikey.read', label: 'View API keys' },
      { value: 'apikey.write', label: 'Create and manage own API keys' },
    ],
  },
  {
    id: 'server-content',
    label: 'Server Content',
    description: 'Install and remove mods and plugins on servers',
    permissions: [
      { value: 'mods.manage', label: 'Manage mods and datapacks' },
      { value: 'plugins.manage', label: 'Manage server plugins' },
    ],
  },
  {
    id: 'operations',
    label: 'Panel Operations',
    description: 'Run migrations, trigger panel updates, download diagnostics',
    permissions: [
      { value: 'migration.manage', label: 'Run Pterodactyl migrations' },
      { value: 'update.trigger', label: 'Trigger panel updates' },
      { value: 'diagnostics.download', label: 'Download diagnostics bundles' },
    ],
  },
];
