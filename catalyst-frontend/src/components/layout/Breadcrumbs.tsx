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
    <nav className="flex items-center gap-1 text-xs text-muted-foreground" aria-label="Breadcrumb">
      <Link className="transition-colors hover:text-foreground" to="/dashboard">
        Dashboard
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3" />
          {crumb.isLast ? (
            <span className="font-medium text-foreground">{crumb.label}</span>
          ) : (
            <Link className="transition-colors hover:text-foreground" to={crumb.href}>
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

export default Breadcrumbs;
