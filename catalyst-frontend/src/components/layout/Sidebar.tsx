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
  ChevronLeft,
  BarChart3,
  Users,
  Network,
  FileText,
  Bell,
  Database,
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
  Bug,
  Ticket,
} from 'lucide-react';
import { useState, MouseEvent, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { usePluginTabs, usePluginRoutes } from '../../plugins/hooks';
import { PluginSlot } from '../../plugins/PluginSlot';
import { PANEL_VERSION } from '../../utils/version';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';

const mainLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/servers', label: 'Servers', icon: Server },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
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
      {
        to: '/admin/system-errors',
        label: 'System Errors',
        icon: Bug,
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
  /** Used for admin section filtering only; not rendered by MenuItem. */
  permissions?: string[];
}

function MenuItem({ to, label, icon: Icon, collapsed }: MenuItemProps) {
  const location = useLocation();
  const isActive =
    location.pathname === to || (to !== '/admin' && location.pathname.startsWith(`${to}/`));

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
      <NavLink
        to={to}
        className={cn(
          'pressable relative flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-200',
          isActive
            ? 'bg-primary/10 text-foreground'
            : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        )}
        aria-label={label}
      >
        {isActive && (
          <span className="absolute -left-1.5 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
        )}
        <Icon className="h-4 w-4" />
      </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <NavLink
      to={to}
      className={cn(
        'pressable group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
        isActive
          ? 'bg-primary/10 text-foreground'
          : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <Icon className="h-4 w-4 flex-shrink-0 opacity-90" />
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
    (link) => location.pathname === link.to || (link.to !== '/admin' && location.pathname.startsWith(`${link.to}/`)),
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
        aria-expanded={shouldExpand}
        aria-controls={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}
        className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80 transition-colors hover:text-foreground"
      >
        <span>{title}</span>
        {shouldExpand ? (
          <ChevronDown className="h-3 w-3 opacity-70" />
        ) : (
          <ChevronRight className="h-3 w-3 opacity-70" />
        )}
      </button>
      {shouldExpand && (
        <div id={`section-${title.toLowerCase().replace(/\s+/g, '-')}`} className="relative space-y-0.5 border-l border-border/70 ml-3 pl-2.5">
          {links.map((link) => (
            <MenuItem key={link.to} {...link} />
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar() {
  const { data: updateData } = useUpdateCheck();
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const themeSettings = useThemeStore((s) => s.themeSettings);
  const sidebarCollapsed = useThemeStore((s) => s.sidebarCollapsed);
  const [isLargeViewport, setIsLargeViewport] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  const toggleSidebar = useThemeStore((s) => s.toggleSidebar);
  const pluginTabs = usePluginTabs('admin');
  const pluginRoutes = usePluginRoutes();

  // Show main "Tickets" nav only when the ticketing user route is loaded.
  const hasUserTicketPage = pluginRoutes.some(
    (r) => r.path === '/ticketing-plugin' || r.path === '/tickets',
  );

  const filteredSections = useMemo(() => {
    const userPermissions = user?.permissions || [];
    const sections = adminSections
      .map((section) => ({
        ...section,
        links: section.links.filter((link) => hasAnyPermission(userPermissions, link.permissions)),
      }))
      .filter((section) => section.links.length > 0);

    // Inject enabled plugin admin tabs (e.g. Ticketing)
    if (pluginTabs.length > 0 && hasAnyPermission(userPermissions, ['admin.read', 'admin.write'])) {
      sections.push({
        title: 'Plugins',
        links: pluginTabs.map((tab) => ({
          to: `/admin/plugin/${tab.id}`,
          label: tab.label,
          icon: tab.id.includes('ticket') ? Ticket : Plug,
          permissions: tab.requiredPermissions?.length
            ? tab.requiredPermissions
            : ['admin.read', 'admin.write'],
        })),
      });
    }

    return sections;
  }, [user, pluginTabs]);

  const displayName = user?.firstName || user?.lastName
    ? [user.firstName, user.lastName].filter(Boolean).join(' ')
    : user?.username || 'User';
  const initials =
    displayName.slice(0, 2).toUpperCase() ||
    user?.email?.slice(0, 2).toUpperCase() ||
    'U';
  const panelName = themeSettings?.panelName || 'Catalyst';
  const logoUrl = themeSettings?.logoUrl || '/logo.png';

  useEffect(() => { const media = window.matchMedia('(min-width: 1024px)'); const update = () => setIsLargeViewport(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  const collapsed = sidebarCollapsed && isLargeViewport;
  const canViewVersion = hasAnyPermission(user?.permissions || [], ['admin.read', 'admin.write']);

  return (
    <TooltipProvider>
    <aside
      className={cn(
        'flex h-full flex-col border-r border-border/80 bg-card shadow-panel transition-all duration-200 ease-standard',
        collapsed ? 'w-60 lg:w-16' : 'w-60',
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          'flex items-center border-b border-border/70',
          collapsed ? 'justify-center px-3 py-2.5' : 'gap-2.5 px-3 py-2.5',
        )}
      >
        <Link
          to="/dashboard"
          className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-2.5')}
        >
          <img
            src={logoUrl}
            alt={`${panelName} logo`}
            className="h-8 w-8 rounded-md border border-border/70"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight text-foreground">
              {panelName}
            </span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <div className={cn('flex-1 overflow-y-auto', collapsed ? 'px-2 py-3' : 'px-3 py-3')}>
        <div className="space-y-0.5">
          {mainLinks
            .filter((link) => link.to !== '/tickets' || hasUserTicketPage)
            .map((link) => (
              <MenuItem key={link.to} {...link} collapsed={collapsed} />
            ))}
        </div>

        {filteredSections.length > 0 && (
          <div className={cn('border-t border-border/70 pt-3', collapsed ? 'mt-3' : 'mt-4')}>
            <div className={cn(collapsed ? 'space-y-2' : 'space-y-2.5')}>
              {filteredSections.map((section) => (
                <Section key={section.title} {...section} collapsed={collapsed} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* User Section */}
      <div className={cn('border-t border-border/70', collapsed ? 'p-2' : 'p-3')}>
        <NavLink
          to="/profile"
          className={cn(
            'pressable flex items-center gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-surface-2',
            collapsed && 'justify-center',
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary text-xs font-semibold text-primary-foreground ring-1 ring-primary/30">
            {user?.image
              ? <img src={user.image} alt={displayName} className="h-full w-full object-cover" />
              : initials
            }
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{displayName}</div>
              <div className="truncate text-[11px] text-muted-foreground">{user?.role || 'Member'}</div>
            </div>
          )}
        </NavLink>

        <div className={cn('mt-2 flex', collapsed ? 'flex-col gap-1' : 'gap-1.5')}>
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={cn(
              'pressable flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border/80 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground',
              collapsed ? 'w-8' : 'flex-1 px-2 text-[11px] font-medium',
            )}
            aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {!collapsed && (theme === 'dark' ? 'Light' : 'Dark')}
          </button>
          <button
            type="button"
            onClick={toggleSidebar}
            className="pressable flex h-8 w-8 items-center justify-center rounded-lg border border-border/80 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={logout}
            className={cn(
              'pressable flex h-8 items-center justify-center rounded-lg border border-border/80 text-danger transition-colors hover:bg-danger/10',
              collapsed ? 'w-8' : 'w-8',
            )}
            aria-label="Logout"
            title="Logout"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Plugin extension point */}
      {!collapsed && (
        <PluginSlot
          name="sidebar-bottom"
          className="border-t border-border/70 px-3 py-2 space-y-1"
        />
      )}

      {/* Version + update status */}
      {canViewVersion && <div className={cn('border-t border-border/70', collapsed ? 'px-2 py-1.5' : 'px-3 py-2')}>
        <Link
          to="/admin/system"
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-md font-mono transition-colors hover:text-foreground',
            collapsed ? 'text-[9px]' : 'text-[10px]',
            updateData?.updateAvailable
              ? 'text-warning hover:text-warning'
              : 'text-muted-foreground/55 hover:text-foreground/70',
          )}
          title={
            updateData?.updateAvailable
              ? `v${updateData.currentVersion} - out of date (latest: v${updateData.latestVersion})`
              : `Catalyst Panel v${PANEL_VERSION}`
          }
        >
          <span>v{PANEL_VERSION}</span>
          {!collapsed && updateData?.updateAvailable && <span className="text-warning">(out of date)</span>}
          {collapsed && updateData?.updateAvailable && <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />}
        </Link>
      </div>}
    </aside>
    </TooltipProvider>
  );
}

export default Sidebar;
