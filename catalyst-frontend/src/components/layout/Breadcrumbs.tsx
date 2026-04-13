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
};

function Breadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  const crumbs = segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join('/')}`;
    const label = labelMap[segment] ?? segment;
    return { href, label, isLast: index === segments.length - 1 };
  });

  if (crumbs.length === 0) {
    return null;
  }

  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-label="Breadcrumb">
      <Link className="font-medium text-zinc-500 transition-colors hover:text-foreground dark:text-zinc-400 dark:hover:text-zinc-100" to="/dashboard">
        Dashboard
      </Link>
      {crumbs.map((crumb) => (
        <div key={crumb.href} className="flex items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-600" />
          {crumb.isLast ? (
            <span className="font-medium text-foreground">{crumb.label}</span>
          ) : (
            <Link className="font-medium text-zinc-500 transition-colors hover:text-foreground dark:text-zinc-400 dark:hover:text-zinc-100" to={crumb.href}>
              {crumb.label}
            </Link>
          )}
        </div>
      ))}
    </nav>
  );
}

export default Breadcrumbs;
