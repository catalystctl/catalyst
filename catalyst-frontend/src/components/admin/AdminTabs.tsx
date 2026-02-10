import React from 'react';
import { NavLink } from 'react-router-dom';
import { usePluginTabs } from '../../plugins/hooks';
import { useAuthStore } from '../../stores/authStore';

interface TabConfig {
  to: string;
  label: string;
  end?: boolean;
  requiredPermissions?: string[];
}

const baseTabs: TabConfig[] = [
  { to: '/admin', label: 'Overview', end: true, requiredPermissions: ['admin.read', 'admin.write', 'user.read', 'user.create', 'user.update', 'user.delete', 'user.set_roles', 'role.read', 'role.create', 'role.update', 'role.delete', 'server.read', 'server.create', 'server.delete', 'node.read', 'node.create', 'node.update', 'node.delete', 'template.read', 'template.create', 'template.update', 'template.delete', 'alert.read', 'alert.create', 'alert.update', 'alert.delete', 'apikey.manage'] },
  { to: '/admin/users', label: 'Users', requiredPermissions: ['user.read', 'user.create', 'user.update', 'user.delete', 'user.set_roles', 'admin.read', 'admin.write'] },
  { to: '/admin/roles', label: 'Roles', requiredPermissions: ['role.read', 'role.create', 'role.update', 'role.delete', 'admin.read', 'admin.write'] },
  { to: '/admin/servers', label: 'Servers', requiredPermissions: ['server.read', 'server.create', 'server.delete', 'admin.read', 'admin.write'] },
  { to: '/admin/nodes', label: 'Nodes', requiredPermissions: ['node.read', 'node.create', 'node.update', 'node.delete', 'admin.read', 'admin.write'] },
  { to: '/admin/templates', label: 'Templates', requiredPermissions: ['template.read', 'template.create', 'template.update', 'template.delete', 'admin.read', 'admin.write'] },
  { to: '/admin/database', label: 'Database', requiredPermissions: ['admin.read', 'admin.write'] },
  { to: '/admin/network', label: 'Network', requiredPermissions: ['admin.read', 'admin.write'] },
  { to: '/admin/api-keys', label: 'API Keys', requiredPermissions: ['apikey.manage', 'admin.read', 'admin.write'] },
  { to: '/admin/system', label: 'System', requiredPermissions: ['admin.write'] },
  { to: '/admin/security', label: 'Security', requiredPermissions: ['admin.read', 'admin.write'] },
  { to: '/admin/theme-settings', label: 'Theme', requiredPermissions: ['admin.write'] },
  { to: '/admin/plugins', label: 'Plugins', requiredPermissions: ['admin.read', 'admin.write'] },
  { to: '/admin/alerts', label: 'Alerts', requiredPermissions: ['alert.read', 'alert.create', 'alert.update', 'alert.delete', 'admin.read', 'admin.write'] },
  { to: '/admin/audit-logs', label: 'Audit Logs', requiredPermissions: ['admin.read', 'admin.write'] },
];

function hasPermission(userPermissions: string[] | undefined, requiredPermissions: string[] | undefined): boolean {
  if (!requiredPermissions || requiredPermissions.length === 0) return true;
  if (!userPermissions) return false;
  if (userPermissions.includes('*')) return true;
  return requiredPermissions.some((perm) => userPermissions.includes(perm));
}

function AdminTabs() {
  const { user } = useAuthStore();
  const userPermissions = user?.permissions || [];
  const pluginTabs = usePluginTabs('admin');

  // Filter tabs based on user permissions
  const visibleTabs = React.useMemo(
    () => baseTabs.filter((tab) => hasPermission(userPermissions, tab.requiredPermissions)),
    [userPermissions]
  );

  // Convert plugin tabs to route format (plugin tabs are always visible for admins)
  const pluginRoutes = React.useMemo(
    () =>
      pluginTabs
        .filter(() => hasPermission(userPermissions, ['admin.read', 'admin.write']))
        .map((tab) => ({
          to: `/admin/plugin/${tab.id}`,
          label: tab.label,
          end: false,
        })),
    [pluginTabs, userPermissions]
  );

  const allTabs = React.useMemo(() => [...visibleTabs, ...pluginRoutes], [visibleTabs, pluginRoutes]);

  // Don't render if no tabs are available
  if (allTabs.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
      {allTabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `rounded-full px-3 py-1.5 font-semibold transition-all duration-300 ${
              isActive
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}

export default AdminTabs;
