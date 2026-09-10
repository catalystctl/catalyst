import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronRight } from 'lucide-react';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NANOID_RE = /^[A-Za-z0-9_-]{8,32}$/;

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
    case 'invites':
      return t('layout:breadcrumbs.invites');
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
  const segments = location.pathname.split('/').filter(Boolean);

  const crumbs = segments
    .map((segment, index) => {
      const href = `/${segments.slice(0, index + 1).join('/')}`;
      const label = formatSegment(t, segment);
      return label ? { href, label, isLast: index === segments.length - 1 } : null;
    })
    .filter((crumb): crumb is { href: string; label: string; isLast: boolean } => crumb !== null);

  if (crumbs.length === 0) {
    return null;
  }

  const skipDashboardHome = crumbs[0]?.href === '/dashboard';

  return (
    <nav
      className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm text-muted-foreground scrollbar-hide"
      aria-label={t('breadcrumbs.nav')}
    >
      {!skipDashboardHome && (
        <Link
          className="shrink-0 rounded-md px-1.5 py-0.5 font-medium transition-colors hover:bg-surface-2 hover:text-foreground"
          to="/dashboard"
        >
          {t('nav.dashboard')}
        </Link>
      )}
      {crumbs.map((crumb, index) => (
        <div key={crumb.href} className="flex min-w-0 items-center gap-1">
          {(index > 0 || !skipDashboardHome) && (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          )}
          {crumb.isLast ? (
            <span
              className="truncate rounded-md bg-surface-2/70 px-1.5 py-0.5 font-medium text-foreground"
              aria-current="page"
            >
              {crumb.label}
            </span>
          ) : (
            <Link
              className="shrink-0 rounded-md px-1.5 py-0.5 font-medium transition-colors hover:bg-surface-2 hover:text-foreground"
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
