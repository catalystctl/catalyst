import { NavLink, Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Server,
  Network,
  Users,
  Bell,
  Ticket,
  Plug,
  Sun,
  Moon,
  LogOut,
  MoreHorizontal,
  Search,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { useThemeStore } from '../../stores/themeStore';
import { hasAnyPermission } from '../auth/ProtectedRoute';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { usePluginTabs } from '../../plugins/hooks';
import { PANEL_VERSION } from '../../utils/version';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { cn } from '@/lib/utils';
import NavSectionsMenu from './NavSectionsMenu';

/**
 * Cabinet rail — the deck's primary navigation. Deliberately a fixed 56px icon
 * rail rather than a 240px labelled sidebar (the generic-admin gesture): hot
 * paths stay one click away, every other destination lives in the sections
 * popover and the Ctrl+K palette. See docs/design/deck-identity.md.
 */
const PRIMARY = [
  { to: '/dashboard', labelKey: 'layout:nav.dashboard', icon: LayoutDashboard },
  { to: '/servers', labelKey: 'layout:nav.servers', icon: Server },
] as const;

const ADMIN_PRIMARY = [
  { to: '/admin/nodes', labelKey: 'layout:nav.nodes', icon: Network, perms: ['node.read', 'admin.read', 'admin.write'] },
  { to: '/admin/users', labelKey: 'layout:nav.users', icon: Users, perms: ['user.read', 'admin.read', 'admin.write'] },
  { to: '/admin/alerts', labelKey: 'layout:nav.alerts', icon: Bell, perms: ['alert.read', 'admin.read', 'admin.write'] },
] as const;

function RailLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const { pathname } = useLocation();
  // Computed here rather than via NavLink's function className: Radix's
  // TooltipTrigger asChild stringifies a function className when it clones
  // the child, which silently drops the link's styling.
  const isActive = pathname === to || pathname.startsWith(`${to}/`);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={to}
          aria-label={label}
          className={cn(
            'relative flex h-9 w-9 items-center justify-center rounded-sm transition-colors',
            isActive
              ? 'bg-primary/15 text-foreground'
              : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
          )}
        >
          {isActive && (
            <span
              className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 bg-primary"
              aria-hidden
            />
          )}
          <Icon className="h-4 w-4" />
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function Sidebar() {
  const { t } = useTranslation('layout');
  const { data: updateData } = useUpdateCheck();
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const themeSettings = useThemeStore((s) => s.themeSettings);
  const pluginTabs = usePluginTabs('admin');
  const [sectionsOpen, setSectionsOpen] = useState(false);

  const permissions = user?.permissions ?? [];
  const displayName =
    user?.firstName || user?.lastName
      ? [user.firstName, user.lastName].filter(Boolean).join(' ')
      : user?.username || t('sidebar.fallbackUser');
  const initials = displayName.slice(0, 2).toUpperCase() || 'U';
  const panelName = themeSettings?.panelName || 'Catalyst';
  const logoUrl = themeSettings?.logoUrl || '/logo.png';
  const canViewVersion = hasAnyPermission(permissions, ['admin.read', 'admin.write']);

  const adminLinks = ADMIN_PRIMARY.filter((link) => hasAnyPermission(permissions, [...link.perms]));

  return (
    <TooltipProvider>
      <aside className="flex h-full w-14 flex-col items-center border-r border-border/70 bg-surface-1/40 py-2">
        <Link
          to="/dashboard"
          className="mb-2 flex h-9 w-9 items-center justify-center"
          aria-label={panelName}
        >
          <img
            src={logoUrl}
            alt=""
            className="h-7 w-7 rounded-sm"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        </Link>

        <span className="deck-hatch mb-2 h-[3px] w-6" aria-hidden />

        <nav className="flex flex-col items-center gap-1">
          {PRIMARY.map((link) => (
            <RailLink key={link.to} to={link.to} label={t(link.labelKey)} icon={link.icon} />
          ))}
          {adminLinks.map((link) => (
            <RailLink key={link.to} to={link.to} label={t(link.labelKey)} icon={link.icon} />
          ))}
          {pluginTabs.map((tab) => (
            <RailLink
              key={tab.id}
              to={`/admin/plugin/${tab.id}`}
              label={tab.label}
              icon={tab.id.includes('ticket') ? Ticket : Plug}
            />
          ))}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t('shell.sections')}
                aria-expanded={sectionsOpen}
                onClick={() => setSectionsOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('shell.sections')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t('shell.openSearch', { shortcut: 'Ctrl+K' })}
                onClick={() => window.dispatchEvent(new CustomEvent('catalyst:open-search'))}
                className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <Search className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('shell.searchButton')}</TooltipContent>
          </Tooltip>
        </nav>

        <div className="flex-1" />

        <div className="flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
                className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {theme === 'dark' ? t('sidebar.light') : t('sidebar.dark')}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <NavLink
                to="/profile"
                aria-label={displayName}
                className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary/15 font-display text-micro font-semibold text-primary ring-1 ring-primary/40"
              >
                {user?.image ? (
                  <img src={user.image} alt="" className="h-full w-full rounded-sm object-cover" />
                ) : (
                  initials
                )}
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">
              {displayName} · {user?.role ? user.role : t('sidebar.fallbackRole')}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={logout}
                aria-label={t('sidebar.logout')}
                className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('sidebar.logout')}</TooltipContent>
          </Tooltip>

          {canViewVersion && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/admin/system"
                  aria-label={`v${PANEL_VERSION}`}
                  className={cn(
                    'flex h-6 items-center justify-center text-[9px]',
                    updateData?.updateAvailable ? 'text-warning' : 'text-muted-foreground/50',
                  )}
                >
                  ●
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                {updateData?.updateAvailable
                  ? t('sidebar.updateTooltip', {
                      current: updateData.currentVersion,
                      latest: updateData.latestVersion,
                    })
                  : t('sidebar.versionTooltip', { version: PANEL_VERSION })}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </aside>

      <NavSectionsMenu open={sectionsOpen} onOpenChange={setSectionsOpen} />
    </TooltipProvider>
  );
}

export default Sidebar;
