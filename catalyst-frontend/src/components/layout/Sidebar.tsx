import { NavLink, useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { useThemeStore } from '../../stores/themeStore';
import { hasAnyPermission } from '../auth/ProtectedRoute';
import {
  LayoutDashboard,
  Server,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Users,
  Network,
  FileText,
  Bell,
  Database,
  Globe,
  Settings,
  Shield,
  FileKey,
  Plug,
  Palette,
  Sun,
  Moon,
  LogOut,
  Key,
} from 'lucide-react';
import { useState, MouseEvent, useMemo } from 'react';

const mainLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/servers', label: 'Servers', icon: Server },
];

const adminLinksConfig = [
  { to: '/admin', label: 'Overview', icon: BarChart3, permissions: ['admin.read', 'admin.write'] },
  { to: '/admin/users', label: 'Users', icon: Users, permissions: ['user.read', 'user.create', 'user.update', 'user.delete', 'user.set_roles', 'admin.read', 'admin.write'] },
  { to: '/admin/roles', label: 'Roles', icon: Shield, permissions: ['role.read', 'role.create', 'role.update', 'role.delete', 'admin.read', 'admin.write'] },
  { to: '/admin/nodes', label: 'Nodes', icon: Network, permissions: ['node.read', 'node.create', 'node.update', 'node.delete', 'admin.read', 'admin.write'] },
  { to: '/admin/servers', label: 'All Servers', icon: Server, permissions: ['server.read', 'server.create', 'server.delete', 'admin.read', 'admin.write'] },
  { to: '/admin/templates', label: 'Templates', icon: FileText, permissions: ['template.read', 'template.create', 'template.update', 'template.delete', 'admin.read', 'admin.write'] },
  { to: '/admin/alerts', label: 'Alerts', icon: Bell, permissions: ['alert.read', 'alert.create', 'alert.update', 'alert.delete', 'admin.read', 'admin.write'] },
  { to: '/admin/database', label: 'Databases', icon: Database, permissions: ['admin.read', 'admin.write'] },
  { to: '/admin/network', label: 'Network', icon: Globe, permissions: ['admin.read', 'admin.write'] },
  { to: '/admin/system', label: 'System', icon: Settings, permissions: ['admin.write'] },
  { to: '/admin/security', label: 'Security', icon: Shield, permissions: ['admin.read', 'admin.write'] },
  { to: '/admin/audit-logs', label: 'Audit Logs', icon: FileText, permissions: ['admin.read', 'admin.write'] },
  { to: '/admin/api-keys', label: 'API Keys', icon: Key, permissions: ['apikey.manage', 'admin.read', 'admin.write'] },
  { to: '/admin/plugins', label: 'Plugins', icon: Plug, permissions: ['admin.read', 'admin.write'] },
  { to: '/admin/theme-settings', label: 'Theme Settings', icon: Palette, permissions: ['admin.write'] },
];

interface MenuItemProps {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

function MenuItem({ to, label, icon: Icon }: MenuItemProps) {
  const location = useLocation();
  const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <NavLink
      to={to}
      className={`flex items-center px-3 py-2 rounded-md font-medium transition-all duration-300 ${
        isActive
          ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
      }`}
    >
      <Icon className="w-5 mr-3" />
      <span className="text-sm">{label}</span>
    </NavLink>
  );
}

interface SectionProps {
  title: string;
  links: MenuItemProps[];
  defaultExpanded?: boolean;
}

function Section({ title, links, defaultExpanded = true }: Section) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const toggleExpanded = (e: MouseEvent) => {
    e.preventDefault();
    setIsExpanded(!isExpanded);
  };

  // Don't render section if no links
  if (links.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex items-center justify-between px-2 py-2 cursor-pointer text-xs font-semibold uppercase text-slate-500 dark:text-slate-400"
      >
        <span>{title}</span>
        {isExpanded ? (
          <ChevronDown className="text-slate-400 dark:text-slate-500" />
        ) : (
          <ChevronRight className="text-slate-400 dark:text-slate-500" />
        )}
      </button>
      {isExpanded && (
        <div className="flex flex-col gap-1 mt-1">
          {links.map((link) => (
            <MenuItem key={link.to} {...link} />
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar() {
  const { theme, setTheme } = useUIStore();
  const { user, logout } = useAuthStore();
  const { themeSettings } = useThemeStore();

  const userPermissions = user?.permissions || [];

  // Filter admin links based on user permissions
  const visibleAdminLinks = useMemo(() => {
    return adminLinksConfig.filter((link) =>
      hasAnyPermission(userPermissions, link.permissions)
    );
  }, [userPermissions]);

  const initials =
    user?.username?.slice(0, 2).toUpperCase() ||
    user?.email?.slice(0, 2).toUpperCase() ||
    'U';

  const panelName = themeSettings?.panelName || 'Catalyst';
  const logoUrl = themeSettings?.logoUrl || '/logo.png';

  return (
    <aside className="sticky top-0 flex h-screen w-64 flex-col border-r border-slate-200 bg-white shadow-surface-light transition-all duration-300 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark">
      {/* Header with Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-200 dark:border-slate-800">
        <Link to="/dashboard" className="flex items-center gap-2">
          <img
            src={logoUrl}
            alt={`${panelName} logo`}
            className="h-6 w-6"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <span className="text-lg font-semibold text-slate-900 dark:text-white">
            {panelName}
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-2 py-4">
        <Section title="Main" links={mainLinks} />
        {visibleAdminLinks.length > 0 && (
          <Section title="Admin" links={visibleAdminLinks} defaultExpanded={false} />
        )}
      </div>

      {/* Footer with user info and actions */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800">
        <NavLink
          to="/profile"
          className="flex items-center p-2 rounded-lg bg-slate-50 hover:bg-slate-100 transition-all duration-300 dark:bg-slate-800 dark:hover:bg-slate-700"
        >
          <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white text-sm font-medium mr-3">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
              {user?.username || 'admin'}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 capitalize truncate">
              {user?.roles?.[0] || 'Admin'}
            </div>
          </div>
        </NavLink>

        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex items-center justify-between w-full px-3 py-2 mt-2 text-sm font-medium text-slate-600 rounded-md border border-slate-200 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-500/30 dark:hover:text-white"
        >
          <div className="flex items-center">
            {theme === 'dark' ? (
              <Moon className="w-4 mr-2" />
            ) : (
              <Sun className="w-4 mr-2" />
            )}
            <span>Theme: {theme}</span>
          </div>
        </button>

        <button
          type="button"
          onClick={logout}
          className="flex items-center w-full px-3 py-2 mt-2 text-sm font-medium text-rose-600 rounded-md border border-transparent transition-all duration-300 hover:bg-rose-50 hover:border-rose-200 dark:text-rose-400 dark:hover:bg-rose-500/10 dark:hover:border-rose-500/30"
        >
          <LogOut className="w-4 mr-2" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
