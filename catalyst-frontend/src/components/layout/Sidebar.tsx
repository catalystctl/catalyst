import { NavLink, Link, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ChevronRight,
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
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { useThemeStore } from '../../stores/themeStore';
import { hasAnyPermission } from '../auth/ProtectedRoute';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { usePluginTabs } from '../../plugins/hooks';
import { PANEL_VERSION } from '../../utils/version';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { useDashboardStats } from '../../hooks/useDashboard';
import { cn } from '@/lib/utils';
import { StatusLed } from '../deck/primitives';
import NavSectionsMenu from './NavSectionsMenu';
import { buildGroups, buildMain, type NavLinkItem } from './navSections';

/**
 * Navigation with two densities over one source of truth.
 *
 * Collapsed is the 56px cabinet rail: hot paths stay one click away
 * and every other destination lives in the sections popover and Ctrl+K.
 * New operators start with labelled navigation; saved density is respected.
 * Expanded is a labelled, sectioned sidebar for people who prefer to read the
 * map rather than memorise it. Both render the same `buildMain`/`buildGroups`
 * data with the same RBAC filtering, so nothing can drift between them.
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

/**
 * The one active destination for a pathname: the *longest* nav target that
 * matches. A plain prefix test marked `/admin` active on `/admin/nodes`, so a
 * labelled sidebar highlighted two rows at once.
 */
function useActiveTarget() {
  const { pathname } = useLocation();
  return useCallback(
    (targets: string[]) => {
      let best: string | null = null;
      for (const to of targets) {
        if (pathname !== to && !pathname.startsWith(`${to}/`)) continue;
        if (!best || to.length > best.length) best = to;
      }
      return best;
    },
    [pathname],
  );
}

/** One destination. Icon-only + tooltip when collapsed, icon + label when expanded. */
function NavRow({
  to,
  label,
  icon: Icon,
  expanded,
  active,
  badge,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  expanded: boolean;
  active: boolean;
  badge?: { value: number; tone?: 'hazard' | 'alarm' };
}) {

  // Density is intentional: 30px labelled rows when expanded, 36px targets
  // on the collapsed rail (same split as RailButton below). Keep in sync.
  const className = cn(
    'group/row relative flex items-center rounded-sm text-muted-foreground/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
    expanded
      ? 'h-[1.875rem] w-full gap-2.5 px-2 text-data hover:bg-surface-2/70 hover:text-foreground'
      : 'h-9 w-9 justify-center hover:bg-surface-2 hover:text-foreground',
    // A raised neutral row with the signal colour reduced to a marker and the
    // icon: a full-width magenta fill made the current page look like a button.
    active && 'bg-surface-2 text-foreground',
  );

  const body = (
    <>
      {active && (
        <span
          className="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-r-full bg-primary"
          aria-hidden
        />
      )}
      <IconSlot>
        <Icon
          className={cn('h-4 w-4', active && 'text-primary', !active && expanded && 'group-hover/row:text-foreground')}
        />
      </IconSlot>
      {expanded && <span className="truncate font-medium">{label}</span>}
      {expanded && badge && (
        <span
          className={cn(
            'ml-auto min-w-7 shrink-0 rounded-sm border px-1.5 py-0.5 text-center font-mono text-micro leading-none tabular-nums',
            badge.tone === 'alarm'
              ? 'border-danger/40 bg-danger/10 text-danger'
              : badge.tone === 'hazard'
                ? 'border-warning/40 bg-warning/10 text-warning'
                : 'border-border/60 bg-surface-1/60 text-muted-foreground/80',
          )}
        >
          {badge.value}
        </span>
      )}
      {/* Collapsed, the same signal rides the icon so an administrator still
          sees the count without expanding the rail. */}
      {!expanded && badge && (
        <span
          className={cn(
            'absolute right-1 top-1 h-1.5 w-1.5 rounded-full',
            badge.tone === 'alarm'
              ? 'bg-danger'
              : badge.tone === 'hazard'
                ? 'bg-warning'
                : 'bg-muted-foreground/60',
          )}
          aria-hidden
        />
      )}
    </>
  );

  if (expanded) {
    return (
      <NavLink to={to} aria-current={active ? 'page' : undefined} className={className}>
        {body}
      </NavLink>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink to={to} aria-label={badge ? `${label} · ${badge.value}` : label} className={className}>
          {body}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{badge ? `${label} · ${badge.value}` : label}</TooltipContent>
    </Tooltip>
  );
}

/** Collapsed-only rail button with a tooltip. */
function RailButton({
  label,
  onClick,
  children,
  danger,
  expanded,
  className,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  danger?: boolean;
  expanded: boolean;
  className?: string;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'flex items-center rounded-sm text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
        // Same 30px/36px density split as NavRow above. Keep in sync.
        expanded ? 'h-[1.875rem] w-full gap-2.5 px-2 text-data' : "relative h-9 w-9 justify-center after:absolute after:-inset-1 after:content-['']",
        danger ? 'hover:bg-danger/10 hover:text-danger' : 'hover:bg-surface-2 hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );

  if (expanded) {
    return <div className="flex w-full items-center">{button}</div>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  // Aligned with the row labels (icon column + gap), so the nav keeps two
  // clean columns instead of a ragged set of headings.
  return (
    <div className="pb-1 pl-[calc(0.5rem+1rem+0.625rem)] pr-2 pt-4 text-micro font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground">
      {children}
    </div>
  );
}

/** Every row's icon occupies the same 24px slot, so all labels share one column. */
function IconSlot({ children }: { children: React.ReactNode }) {
  return <span className="flex w-4 shrink-0 items-center justify-center">{children}</span>;
}

/** Permission-filtered groups, shared by both densities. */
function visibleGroups(t: TFunction, permissions: string[]) {
  return buildGroups(t)
    .map((group) => ({
      ...group,
      links: group.links.filter((link) => hasAnyPermission(permissions, link.permissions ?? [])),
    }))
    .filter((group) => group.links.length > 0);
}

export default function Sidebar({ hideCollapseOnMobile = false }: { hideCollapseOnMobile?: boolean }) {
  const { t } = useTranslation('layout');
  const { data: updateData } = useUpdateCheck();
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const themeSettings = useThemeStore((s) => s.themeSettings);
  const navExpanded = useThemeStore((s) => s.navExpanded);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  // The drawer is always labelled; the saved desktop rail preference must not
  // turn mobile navigation into a 56px icon strip with no expand control.
  const expanded = hideCollapseOnMobile && isMobile ? true : navExpanded;
  const toggleNav = useThemeStore((s) => s.toggleNav);
  const pluginTabs = usePluginTabs('admin');
  const [sectionsOpen, setSectionsOpen] = useState(false);
  // Already fetched app-wide by the marquee heartbeat, so this shares one
  // cached query instead of adding requests.
  const { data: stats } = useDashboardStats();
  const badgeFor = (to: string): { value: number; tone?: 'hazard' | 'alarm' } | undefined => {
    if (!stats) return undefined;
    if (to === '/servers') return { value: stats.servers ?? 0 };
    if (to === '/admin/nodes') return { value: stats.nodes ?? 0 };
    if (to === '/admin/servers') return { value: stats.servers ?? 0 };
    if (to === '/admin/alerts') {
      const unack = stats.alertsUnacknowledged ?? 0;
      return unack > 0 ? { value: unack, tone: 'alarm' } : undefined;
    }
    return undefined;
  };

  const permissions = user?.permissions ?? [];
  const displayName =
    user?.firstName || user?.lastName
      ? [user.firstName, user.lastName].filter(Boolean).join(' ')
      : user?.username || t('sidebar.fallbackUser');
  const initials = displayName.slice(0, 2).toUpperCase() || 'U';
  const panelName = themeSettings?.panelName || 'Catalyst';
  const logoUrl = themeSettings?.logoUrl || '/logo.png';
  const canViewVersion = hasAnyPermission(permissions, ['admin.read', 'admin.write']);
  const canWriteAdmin = hasAnyPermission(permissions, ['admin.write']);

  const adminLinks = ADMIN_PRIMARY.filter((link) => hasAnyPermission(permissions, [...link.perms]));
  const groups = visibleGroups(t, permissions);
  const activeTarget = useActiveTarget();
  const navRef = useRef<HTMLElement>(null);
  const [navScrolls, setNavScrolls] = useState(false);

  // A half-scrolled row under the footer rule read as a rendering bug; measure
  // the overflow so the cut edge can fade deliberately instead.
  useEffect(() => {
    const el = navRef.current;
    if (!el || !expanded) {
      setNavScrolls(false);
      return;
    }
    const measure = () => setNavScrolls(el.scrollHeight > el.clientHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, groups.length]);

  const pluginRows: NavLinkItem[] = pluginTabs
    .filter((tab) => hasAnyPermission(permissions, ['admin.read', 'admin.write']) &&
      (!tab.requiredPermissions?.length || hasAnyPermission(permissions, tab.requiredPermissions)))
    .map((tab) => ({
    to: `/admin/plugin/${tab.id}`,
    label: tab.label,
    icon: tab.id.includes('ticket') ? Ticket : Plug,
  }));

  // The drawer sits at z-50 under the sections dialog; close it first so the
  // dialog never stacks beneath it on mobile. AppLayout listens for this.
  const openSections = () => {
    window.dispatchEvent(new CustomEvent('catalyst:close-mobile-nav'));
    setSectionsOpen(true);
  };

  const mainLinks = buildMain(t);
  const allTargets = [
    ...mainLinks.map((l) => l.to),
    ...groups.flatMap((group) => group.links.map((l) => l.to)),
    ...pluginRows.map((r) => r.to),
  ];
  const isActive = activeTarget(allTargets) !== null ? (to: string) => activeTarget(allTargets) === to : () => false;

  const themeIcon = theme === 'dark' ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />;
  const themeLabel = theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode');

  return (
    <TooltipProvider>
      <aside
        className={cn(
          'flex h-full flex-col border-r border-border/70 bg-surface-1/40 transition-[width,padding] duration-200 ease-standard',
          expanded ? 'w-60 px-2 pb-2' : 'w-14 items-center py-2',
        )}
      >
        {/* Brand row: wordmark when expanded, toggle in the top-right corner */}
        <div
          className={cn(
            'flex items-center',
            expanded
              ? 'mb-2 w-full gap-2 border-b border-border/50 px-1 pb-2 pt-2.5'
              : 'mb-2 flex-col gap-2',
          )}
        >
          <Link
            to="/dashboard"
            className={cn('flex h-9 items-center gap-2 rounded-sm px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', expanded && 'min-w-0 flex-1', hideCollapseOnMobile && 'max-lg:mr-9')}
            aria-label={panelName}
          >
            <img
              src={logoUrl}
              alt=""
              className="h-6 w-6 shrink-0 rounded-sm"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
            {expanded && (
              <span className="truncate font-display text-mini font-semibold uppercase tracking-[0.16em] text-foreground">
                {panelName}
              </span>
            )}
          </Link>
          {/* Brand row: wordmark when expanded, nav toggle beside it. Both
              densities keep the toggle here so it never jumps between the
              brand row and the nav. Hidden below lg inside the drawer, where
              the drawer's own close button already sits. */}
          {expanded ? (
            <RailButton label={t('shell.collapseNav')} onClick={toggleNav} expanded={false} className={cn('h-8 w-8', hideCollapseOnMobile && 'max-lg:hidden')}>
              <PanelLeftClose className="h-4 w-4" />
            </RailButton>
          ) : (
            <span className={cn(hideCollapseOnMobile && 'max-lg:hidden')}>
              <RailButton label={t('shell.expandNav')} onClick={toggleNav} expanded={false}>
                <PanelLeftOpen className="h-4 w-4" />
              </RailButton>
            </span>
          )}
        </div>

        {!expanded && <span className="deck-hatch mb-2 h-[2px] w-5" aria-hidden />}

        <nav
          ref={navRef}
          className={cn(
            'flex min-h-0 flex-col',
            expanded
              ? 'w-full flex-1 gap-px overflow-y-auto pb-10 pr-2 [scrollbar-width:thin]'
              : 'flex-1 items-center gap-1 overflow-y-auto [scrollbar-width:none]',
            expanded &&
              navScrolls &&
              '[mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent_calc(100%-1rem))]',
          )}
        >
          {expanded ? (
            <>
              <SectionLabel>{t('layout:sections.main')}</SectionLabel>
              {mainLinks.map((link) => (
                <NavRow key={link.to} to={link.to} label={link.label} icon={link.icon} expanded active={isActive(link.to)} badge={badgeFor(link.to)} />
              ))}
              {groups.map((group) => (
                <div key={group.id} className="flex flex-col">
                  <SectionLabel>{group.title}</SectionLabel>
                  {group.links.map((link) => (
                    <NavRow key={link.to} to={link.to} label={link.label} icon={link.icon} expanded active={isActive(link.to)} badge={badgeFor(link.to)} />
                  ))}
                  {group.id === 'extensions' &&
                    pluginRows.map((row) => (
                      <NavRow key={row.to} to={row.to} label={row.label} icon={row.icon} expanded active={isActive(row.to)} badge={badgeFor(row.to)} />
                    ))}
                </div>
              ))}
            </>
          ) : (
            <>
              {PRIMARY.map((link) => (
                <NavRow key={link.to} to={link.to} label={t(link.labelKey)} icon={link.icon} expanded={false} active={isActive(link.to)} badge={badgeFor(link.to)} />
              ))}
              {adminLinks.map((link) => (
                <NavRow key={link.to} to={link.to} label={t(link.labelKey)} icon={link.icon} expanded={false} active={isActive(link.to)} badge={badgeFor(link.to)} />
              ))}
              {pluginRows.map((row) => (
                <NavRow key={row.to} to={row.to} label={row.label} icon={row.icon} expanded={false} active={isActive(row.to)} badge={badgeFor(row.to)} />
              ))}

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('shell.sections')}
                    aria-expanded={sectionsOpen}
                    onClick={openSections}
                    className="relative flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                    className="relative flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Search className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t('shell.searchButton')}</TooltipContent>
              </Tooltip>
            </>
          )}
        </nav>

        {/* Footer: same controls, labelled when expanded */}
        <div
          className={cn(
            'flex flex-col',
            expanded ? 'w-full gap-0.5 border-t border-border/50 bg-surface-1 pt-2' : 'items-center gap-1',
          )}
        >
          <RailButton label={themeLabel} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} expanded={expanded}>
            <IconSlot>{themeIcon}</IconSlot>
            {expanded && <span className="truncate">{themeLabel}</span>}
          </RailButton>

          {expanded ? (
            <NavLink
              to="/profile"
              className="group/me mt-1 flex w-full items-center gap-2.5 rounded-sm border border-border/60 bg-surface-1/60 px-2 py-2 text-muted-foreground transition-colors hover:border-border hover:bg-surface-2/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              title={`${displayName} · ${user?.role ? user.role : t('sidebar.fallbackRole')}`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-surface-2 font-display text-micro font-semibold text-foreground ring-1 ring-border">
                {user?.image ? (
                  <img src={user.image} alt="" className="h-full w-full rounded-sm object-cover" />
                ) : (
                  initials
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-mini font-medium text-foreground">{displayName}</span>
                <span className="truncate text-micro uppercase tracking-[0.08em]">
                  {user?.role ? user.role : t('sidebar.fallbackRole')}
                </span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/me:opacity-70 group-focus-visible/me:opacity-70 group-focus-within/me:opacity-70" />
            </NavLink>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink
                  to="/profile"
                  aria-label={displayName}
                  className="flex h-9 w-9 items-center justify-center rounded-sm font-display text-micro font-semibold text-muted-foreground ring-1 ring-border transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
          )}

          <RailButton label={t('sidebar.logout')} onClick={logout} danger expanded={expanded}>
            <IconSlot>
              <LogOut className="h-4 w-4" />
            </IconSlot>
            {expanded && <span className="truncate">{t('sidebar.logout')}</span>}
          </RailButton>

          {canViewVersion && (
            <Link
              to={canWriteAdmin ? '/admin/system' : '/admin'}
              aria-label={`v${PANEL_VERSION}`}
              title={
                updateData?.updateAvailable
                  ? t('sidebar.updateTooltip', {
                      current: updateData.currentVersion,
                      latest: updateData.latestVersion,
                    })
                  : t('sidebar.versionTooltip', { version: PANEL_VERSION })
              }
              className={cn(
                'flex items-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                expanded ? 'h-[1.875rem] w-full gap-2.5 px-2 text-data' : 'h-9 w-9 justify-center',
              )}
            >
              {/* Update state rides the LED tone; the rail keeps its h-9 hit box
                  instead of collapsing to the old 14×24 glyph. */}
              <IconSlot>
                <StatusLed
                  tone={updateData?.updateAvailable ? 'hazard' : 'idle'}
                  className={cn(!updateData?.updateAvailable && 'opacity-80')}
                />
              </IconSlot>
              {expanded && <span className="truncate font-mono">v{PANEL_VERSION}</span>}
            </Link>
          )}
        </div>
      </aside>

      <NavSectionsMenu open={sectionsOpen} onOpenChange={setSectionsOpen} />
    </TooltipProvider>
  );
}
