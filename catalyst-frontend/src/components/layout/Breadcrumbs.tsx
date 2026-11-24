import { useEffect, useReducer } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronRight } from 'lucide-react';
import { partialMatchKey, useQueryClient, type QueryKey } from '@/csync';
import { qk } from '@/lib/queryKeys';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NANOID_RE = /^[A-Za-z0-9_-]{8,32}$/;

/** A crumb whose segment is an id we can resolve to a name from the cache. */
type EntityKind = 'server' | 'node';

/** Which entity a route segment is, based on the segment before it. */
function entityKindFor(previous: string | undefined, segment: string): EntityKind | null {
  if (!segment) return null;
  const idLike = UUID_RE.test(segment) || NANOID_RE.test(segment);
  if (!idLike) return null;
  if (previous === 'servers') return 'server';
  if (previous === 'nodes') return 'node';
  return null;
}

/** Name for an id from data already in the cache — never fetches. */
function resolveCachedName(
  queryClient: ReturnType<typeof useQueryClient>,
  kind: EntityKind,
  id: string,
): string | null {
  const key = kind === 'server' ? qk.server(id) : qk.node(id);
  const cached = queryClient.getQueryData<{ name?: string }>(key);
  const name = cached?.name?.trim();
  return name ? name : null;
}

/** Ids in the path that could carry a name, paired with what kind they are. */
function resolveEntityTargets(segments: string[]): { kind: EntityKind; id: string }[] {
  const targets: { kind: EntityKind; id: string }[] = [];
  segments.forEach((segment, index) => {
    const kind = entityKindFor(segments[index - 1], segment);
    if (kind) targets.push({ kind, id: segment });
  });
  return targets;
}

/**
 * Label for one path segment. A switch over literal keys (instead of a
 * lookup map) keeps every translation key visible to the extraction tooling.
 */
function formatSegment(t: TFunction, segment: string): string | null {
  switch (segment) {
    case 'dashboard':
      return t('layout:nav.dashboard');
    case 'nodes':
      return t('layout:nav.nodes');
    case 'templates':
      return t('layout:nav.templates');
    case 'alerts':
      return t('layout:nav.alerts');
    case 'admin':
      return t('layout:nav.admin');
    case 'users':
      return t('layout:nav.users');
    case 'servers':
      return t('layout:nav.servers');
    case 'profile':
      return t('layout:nav.profile');
    case 'system':
      return t('layout:nav.system');
    case 'network':
      return t('layout:breadcrumbs.network');
    case 'audit-logs':
      return t('layout:nav.auditLogs');
    case 'files':
      return t('layout:breadcrumbs.files');
    case 'console':
      return t('layout:breadcrumbs.console');
    case 'tickets':
      return t('layout:nav.tickets');
    case 'roles':
      return t('layout:nav.roles');
    case 'api-keys':
      return t('layout:nav.apiKeys');
    case 'plugins':
      return t('layout:nav.plugins');
    case 'marketplace':
      return t('layout:nav.marketplace');
    case 'theme-settings':
      return t('layout:nav.theme');
    case 'security':
      return t('layout:nav.security');
    case 'migration':
      return t('layout:nav.migration');
    case 'databases':
    case 'database':
      return t('layout:nav.databases');
    case 'system-errors':
      return t('layout:nav.systemErrors');
    case 'backups':
      return t('layout:breadcrumbs.backups');
    case 'sftp':
      return t('layout:breadcrumbs.sftp');
    case 'tasks':
      return t('layout:breadcrumbs.tasks');
    case 'metrics':
      return t('layout:breadcrumbs.metrics');
    case 'activity':
      return t('layout:breadcrumbs.activity');
    case 'configuration':
      return t('layout:sections.configuration');
    case 'settings':
      return t('layout:breadcrumbs.settings');
    case 'modManager':
      return t('layout:search.serverTabs.modManager.label');
    case 'pluginManager':
      return t('layout:search.serverTabs.pluginManager.label');
    case 'invites':
      return t('layout:breadcrumbs.invites');
    case 'environment':
      return t('layout:nav.environment');
    case 'allocations':
      return t('layout:breadcrumbs.allocations');
    case 'nests':
      return t('layout:breadcrumbs.nests');
    default:
      break;
  }
  if (UUID_RE.test(segment)) return `${segment.slice(0, 8)}…`;
  if (segment.startsWith('plugin:')) return t('layout:breadcrumbs.plugin');
  if (NANOID_RE.test(segment) && /[0-9]/.test(segment) && /[A-Za-z]/.test(segment)) {
    return `${segment.slice(0, 8)}…`;
  }
  return segment;
}

function Breadcrumbs() {
  const { t } = useTranslation('layout');
  const location = useLocation();
  const queryClient = useQueryClient();
  const segments = location.pathname.split('/').filter(Boolean);
  const pathnameKey = segments.join('/');

  // Re-render when the route's own detail query lands, so an id that was still
  // unknown on first paint is replaced by the entity name instead of staying
  // truncated. Subscribing is passive — nothing is fetched from here.
  const [, forceCacheRead] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const targets = resolveEntityTargets(segments);
    if (targets.length === 0) return;
    const signature = () =>
      targets.map((target) => resolveCachedName(queryClient, target.kind, target.id) ?? '').join('\u0000');
    let current = signature();
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const changedKey = event?.query?.queryKey;
      if (!changedKey) return;
      // Only the entities this path names can change a crumb.
      const relevant = targets.some((target) =>
        partialMatchKey(changedKey as QueryKey, (target.kind === 'server' ? qk.server(target.id) : qk.node(target.id)) as unknown as QueryKey),
      );
      if (!relevant) return;
      const next = signature();
      if (next === current) return;
      current = next;
      forceCacheRead();
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- segments derive from pathnameKey
  }, [pathnameKey, queryClient]);

  const crumbs = segments
    .map((segment, index) => {
      const href = `/${segments.slice(0, index + 1).join('/')}`;
      // An id in the path reads as `cmwuqkfc…` unless the route's own query
      // already holds the entity. Resolve the name from that cache entry; the
      // truncated id stays as the fallback when the page has not loaded it.
      const entityKind = entityKindFor(segments[index - 1], segment);
      const resolvedName = entityKind ? resolveCachedName(queryClient, entityKind, segment) : null;
      const label = resolvedName ?? formatSegment(t, segment);
      return label
        ? {
            href,
            label,
            raw: segment,
            isLast: index === segments.length - 1,
            truncated: !resolvedName && label.endsWith('…'),
          }
        : null;
    })
    .filter(
      (crumb): crumb is { href: string; label: string; raw: string; isLast: boolean; truncated: boolean } =>
        crumb !== null,
    );

  if (crumbs.length === 0) {
    return null;
  }

  const skipDashboardHome = crumbs[0]?.href === '/dashboard';

  return (
    <nav
      className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm text-muted-foreground scrollbar-hide [mask-image:linear-gradient(to_right,black_calc(100%-1.25rem),transparent_100%)]"
      aria-label={t('breadcrumbs.nav')}
    >
      {!skipDashboardHome && (
        <Link
          className="inline-flex h-7 shrink-0 items-center rounded-sm px-1.5 font-medium transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          to="/dashboard"
        >
          {t('nav.dashboard')}
        </Link>
      )}
      {crumbs.map((crumb, index) => (
        <div key={crumb.href} className="flex shrink-0 items-center gap-1">
          {(index > 0 || !skipDashboardHome) && (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
          )}
          {crumb.isLast ? (
            <span
              className={`inline-flex h-7 min-w-0 items-center px-1.5 font-medium text-foreground ${crumb.truncated ? 'font-mono text-mini tabular-nums' : ''}`}
              aria-current="page"
              title={crumb.raw}
            >
              <span className="truncate">{crumb.label}</span>
            </span>
          ) : (
            <Link
              className="inline-flex h-7 shrink-0 items-center rounded-sm px-1.5 font-medium transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              to={crumb.href}
            >
              {crumb.label}
            </Link>
          )}
        </div>
      ))}
    </nav>
  );
}

export default Breadcrumbs;
