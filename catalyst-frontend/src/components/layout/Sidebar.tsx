import { NavLink, useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { useThemeStore } from '../../stores/themeStore';
import { shallow } from 'zustand/shallow';
import { hasAnyPermission } from '../auth/ProtectedRoute';
import {
  LayoutDashboard,
  Server,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  BarChart3,
  Users,
  Network,
  FileText,
  Bell,
  Database,
  Globe,
  Settings,
  Shield,
  Palette,
  Sun,
  Moon,
  LogOut,
  Key,
  Plug,
  Activity,
  Lock,
  ArrowRightLeft,
} from 'lucide-react';
import { useState, MouseEvent, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { usePluginTabs, usePluginRoutes } from '../../plugins/hooks';

const mainLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/servers', label: 'Servers', icon: Server },
  { to: '/tickets', label: 'Tickets', icon: Plug },
];

const adminSections = [
  {
    title: 'Administration',
    links: [
      {
        to: '/admin',
        label: 'Overview',
        icon: BarChart3,
        permissions: ['admin.read', 'admin.write'],
      },
    ],
  },
  {
    title: 'Infrastructure',
    links: [
      {
        to: '/admin/nodes',
        label: 'Nodes',
        icon: Network,
        permissions: [
          'node.read',
          'node.create',
          'node.update',
          'node.delete',
          'admin.read',
          'admin.write',
        ],
      },
      {
        to: '/admin/servers',
        label: 'All Servers',
        icon: Server,
        permissions: ['admin.read', 'admin.write'],
      },
      {
        to: '/admin/templates',
        label: 'Templates',
        icon: FileText,
        permissions: [
          'template.read',
          'template.create',
          'template.update',
          'template.delete',
          'admin.read',
          'admin.write',
        ],
      },
    ],
  },
  {
    title: 'Access Control',
    links: [
      {
        to: '/admin/users',
        label: 'Users',
        icon: Users,
        permissions: [
          'user.read',
          'user.create',
          'user.update',
          'user.delete',
          'user.set_roles',
          'admin.read',
          'admin.write',
        ],
      },
      {
        to: '/admin/roles',
        label: 'Roles',
        icon: Shield,
        permissions: [
          'role.read',
          'role.create',
          'role.update',
          'role.delete',
          'admin.read',
          'admin.write',
        ],
      },
      {
        to: '/admin/api-keys',
        label: 'API Keys',
        icon: Key,
        permissions: ['apikey.manage', 'admin.read', 'admin.write'],
      },
    ],
  },
  {
    title: 'Configuration',
    links: [
      {
        to: '/admin/database',
        label: 'Databases',
        icon: Database,
        permissions: ['admin.read', 'admin.write'],
      },
      {
        to: '/admin/network',
        label: 'Activity',
        icon: Activity,
        permissions: ['admin.read', 'admin.write'],
      },
      { to: '/admin/system', label: 'System', icon: Settings, permissions: ['admin.write'] },
      {
        to: '/admin/security',
        label: 'Security',
        icon: Lock,
        permissions: ['admin.read', 'admin.write'],
      },
      {
        to: '/admin/migration',
        label: 'Migration',
        icon: ArrowRightLeft,
        permissions: ['admin.read', 'admin.write'],
      },
    ],
  },
  {
    title: 'Monitoring',
    links: [
      {
        to: '/admin/alerts',
        label: 'Alerts',
        icon: Bell,
        permissions: [
          'alert.read',
          'alert.create',
          'alert.update',
          'alert.delete',
          'admin.read',
          'admin.write',
        ],
      },
      {
        to: '/admin/audit-logs',
        label: 'Audit Logs',
        icon: Activity,
        permissions: ['admin.read', 'admin.write'],
      },
    ],
  },
  {
    title: 'Extensions',
    links: [
      {
        to: '/admin/plugins',
        label: 'Plugins',
        icon: Plug,
        permissions: ['admin.read', 'admin.write'],
      },
      { to: '/admin/theme-settings', label: 'Theme', icon: Palette, permissions: ['admin.write'] },
    ],
  },
];

interface MenuItemProps {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  collapsed?: boolean;
}

function MenuItem({ to, label, icon: Icon, collapsed }: MenuItemProps) {
  const location = useLocation();
  const isActive =
    location.pathname === to || (to !== '/admin' && location.pathname.startsWith(`${to}/`));

  if (collapsed) {
    return (
      <NavLink
        to={to}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-200',
          isActive
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-zinc-500 hover:bg-surface-2 hover:text-zinc-100',
        )}
        title={label}
      >
        <Icon className="h-4 w-4" />
      </NavLink>
    );
  }

  return (
    <NavLink
      to={to}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
        isActive
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-zinc-400 hover:bg-surface-2 hover:text-zinc-100',
      )}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

interface SectionProps {
  title: string;
  links: MenuItemProps[];
  defaultExpanded?: boolean;
  collapsed?: boolean;
}

function Section({ title, links, defaultExpanded = false, collapsed }: SectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const location = useLocation();

  const hasActiveLink = links.some(
    (link) => location.pathname === link.to || location.pathname.startsWith(`${link.to}/`),
  );
  const shouldExpand = isExpanded || hasActiveLink;

  const toggleExpanded = (e: MouseEvent) => {
    e.preventDefault();
    setIsExpanded(!isExpanded);
  };

  if (links.length === 0) return null;

  if (collapsed) {
    return (
      <div className="space-y-1">
        {links.map((link) => (
          <MenuItem key={link.to} {...link} collapsed />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <span>{title}</span>
        {shouldExpand ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
      </button>
      {shouldExpand && (
        <div className="space-y-1 border-l border-zinc-800 pl-3">
          <div className="absolute" />
          {links.map((link) => (
            <MenuItem key={link.to} {...link} />
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const themeSettings = useThemeStore((s) => s.themeSettings);
  const sidebarCollapsed = useThemeStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useThemeStore((s) => s.toggleSidebar);
  const userPermissions = user?.permissions || [];
  const pluginTabs = usePluginTabs('admin');
  const pluginRoutes = usePluginRoutes();

  const hasUserTicketPage = pluginRoutes.length > 0;

  const filteredSections = useMemo(() => {
    const sections = adminSections
      .map((section) => ({
        ...section,
        links: section.links.filter((link) => hasAnyPermission(userPermissions, link.permissions)),
      }))
      .filter((section) => section.links.length > 0);

    // Inject plugin tabs as a section
    if (pluginTabs.length > 0 && hasAnyPermission(userPermissions, ['admin.read', 'admin.write'])) {
      sections.push({
        title: 'Plugin Tabs',
        links: pluginTabs.map((tab) => ({
          to: `/admin/plugin/${tab.id}`,
          label: tab.label,
          icon: Plug,
        })),
      });
    }

    return sections;
  }, [userPermissions, pluginTabs]);

  const displayName = user?.firstName || user?.lastName
    ? [user.firstName, user.lastName].filter(Boolean).join(' ')
    : user?.username || 'User';
  const initials =
    displayName.slice(0, 2).toUpperCase() ||
    user?.email?.slice(0, 2).toUpperCase() ||
    'U';
  const panelName = themeSettings?.panelName || 'Catalyst';
  const logoUrl = themeSettings?.logoUrl || '/logo.png';

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen flex-col border-r border-zinc-800 bg-surface-0 transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          'flex items-center border-b border-zinc-800',
          sidebarCollapsed ? 'justify-center p-3' : 'gap-3 px-4 py-4',
        )}
      >
        <Link
          to="/dashboard"
          className={cn('flex items-center', sidebarCollapsed ? 'justify-center' : 'gap-2.5')}
        >
          <img
            src={logoUrl}
            alt={`${panelName} logo`}
            className="h-7 w-7 rounded-lg shadow-sm"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          {!sidebarCollapsed && (
            <span className="font-display text-lg font-bold text-zinc-100">{panelName}</span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <div className={cn('flex-1 overflow-y-auto', sidebarCollapsed ? 'px-2 py-4' : 'px-3 py-4')}>
        <div className="space-y-1">
          {mainLinks
            .filter((link) => link.to !== '/tickets' || hasUserTicketPage)
            .map((link) => (
            <MenuItem key={link.to} {...link} collapsed={sidebarCollapsed} />
          ))}
        </div>

        {filteredSections.length > 0 && (
          <div
            className={cn(
              'border-t border-zinc-800 pt-4',
              sidebarCollapsed ? 'mt-4' : 'mt-6',
            )}
          >
            <div className={cn('space-y-2', sidebarCollapsed ? 'space-y-3' : '')}>
              {filteredSections.map((section) => (
                <Section key={section.title} {...section} collapsed={sidebarCollapsed} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* User Section */}
      <div
        className={cn(
          'border-t border-zinc-800',
          sidebarCollapsed ? 'p-2' : 'p-3',
        )}
      >
        <NavLink
          to="/profile"
          className={cn(
            'flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-surface-2',
            sidebarCollapsed && 'justify-center',
          )}
        >
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground overflow-hidden">
            {user?.image
              ? <img src={user.image} alt="" className="h-full w-full object-cover" />
              : initials
            }
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-zinc-100">
                {displayName}
              </div>
              <div className="truncate text-xs text-zinc-500">
                {user?.role || 'Member'}
              </div>
            </div>
          )}
        </NavLink>

        <div className={cn('mt-2 flex', sidebarCollapsed ? 'flex-col gap-1' : 'gap-2')}>
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={cn(
              'flex h-8 items-center justify-center gap-2 rounded-lg border border-zinc-800 font-medium text-zinc-400 transition-all hover:bg-surface-2 hover:text-zinc-200',
              sidebarCollapsed ? 'w-8 text-xs' : 'flex-1 px-3 text-xs',
            )}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {!sidebarCollapsed && (theme === 'dark' ? 'Light' : 'Dark')}
          </button>
          <button
            type="button"
            onClick={toggleSidebar}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 font-medium text-zinc-400 transition-all hover:bg-surface-2 hover:text-zinc-200"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </button>
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={logout}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-danger transition-all hover:bg-danger/10"
              title="Logout"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {sidebarCollapsed && (
          <button
            type="button"
            onClick={logout}
            className="mt-1 flex h-8 w-full items-center justify-center rounded-lg text-danger transition-all hover:bg-danger/10"
            title="Logout"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
