import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

const labelMap: Record<string, string> = {
  dashboard: 'Dashboard',
  nodes: 'Nodes',
  templates: 'Templates',
  alerts: 'Alerts',
  admin: 'Admin',
  users: 'Users',
  servers: 'Servers',
  profile: 'Profile',
  system: 'System',
  network: 'Network',
  'audit-logs': 'Audit Logs',
  files: 'Files',
  console: 'Console',
  tickets: 'Tickets',
  roles: 'Roles',
  'api-keys': 'API Keys',
  plugins: 'Plugins',
  'theme-settings': 'Theme',
  security: 'Security',
  migration: 'Migration',
  databases: 'Databases',
  database: 'Databases',
  'system-errors': 'System Errors',
  backups: 'Backups',
  sftp: 'SFTP',
  tasks: 'Tasks',
  metrics: 'Metrics',
  activity: 'Activity',
  configuration: 'Configuration',
  settings: 'Settings',
  invites: 'Invites',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NANOID_RE = /^[A-Za-z0-9_-]{8,32}$/;

function formatSegment(segment: string): string | null {
  const mapped = labelMap[segment];
  if (mapped) return mapped;
  if (UUID_RE.test(segment)) return `${segment.slice(0, 8)}…`;
  if (segment.startsWith('plugin:')) return 'Plugin';
  if (NANOID_RE.test(segment) && /[0-9]/.test(segment) && /[A-Za-z]/.test(segment)) {
    return `${segment.slice(0, 8)}…`;
  }
  return segment;
}

function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  const crumbs = segments
    .map((segment, index) => {
      const href = `/${segments.slice(0, index + 1).join('/')}`;
      const label = formatSegment(segment);
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
      aria-label="Breadcrumb"
    >
      {!skipDashboardHome && (
        <Link
          className="shrink-0 rounded-md px-1.5 py-0.5 font-medium transition-colors hover:bg-surface-2 hover:text-foreground"
          to="/dashboard"
        >
          Dashboard
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
