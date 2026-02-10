import { Link } from 'react-router-dom';
import EmptyState from '../../components/shared/EmptyState';
import { useAdminStats, useAuditLogs } from '../../hooks/useAdmin';

const adminSections = [
  {
    title: 'Users',
    description: 'Manage accounts, roles, and access.',
    to: '/admin/users',
  },
  {
    title: 'Servers',
    description: 'Audit and manage all servers.',
    to: '/admin/servers',
  },
  {
    title: 'Nodes',
    description: 'Monitor and register infrastructure nodes.',
    to: '/admin/nodes',
  },
  {
    title: 'Templates',
    description: 'Curate the templates catalog.',
    to: '/admin/templates',
  },
  {
    title: 'Customer Databases',
    description: 'Configure database hosts for customer provisioning.',
    to: '/admin/database',
  },
  {
    title: 'Networks',
    description: 'Allocate and manage IP pools.',
    to: '/admin/network',
  },
  {
    title: 'API Keys',
    description: 'Manage API keys for automated access.',
    to: '/admin/api-keys',
  },
  {
    title: 'Mod Manager',
    description: 'Configure mod marketplace access keys.',
    to: '/admin/system',
  },
  {
    title: 'System',
    description: 'Review platform health and services.',
    to: '/admin/system',
  },
  {
    title: 'Security',
    description: 'Manage lockouts and rate limits.',
    to: '/admin/security',
  },
  {
    title: 'Alerts',
    description: 'Configure alert rules and resolve incidents.',
    to: '/admin/alerts',
  },
  {
    title: 'Audit Logs',
    description: 'Track privileged actions.',
    to: '/admin/audit-logs',
  },
];

function AdminDashboardPage() {
  const { data: stats } = useAdminStats();
  const { data: auditResponse, isLoading: auditLoading } = useAuditLogs({ page: 1, limit: 5 });
  const logs = auditResponse?.logs ?? [];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-surface-dark dark:hover:border-primary-500/30">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              Admin Command Center
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Oversee operations, respond to incidents, and manage platform access.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-400">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              Fleet overview
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              Security monitoring
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              Audit trail
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: 'Users', value: stats?.users ?? 0, accent: 'text-primary-600 dark:text-primary-400' },
          { title: 'Servers', value: stats?.servers ?? 0, accent: 'text-sky-600 dark:text-sky-400' },
          { title: 'Nodes', value: stats?.nodes ?? 0, accent: 'text-emerald-600 dark:text-emerald-400' },
          { title: 'Active Servers', value: stats?.activeServers ?? 0, accent: 'text-amber-600 dark:text-amber-400' },
        ].map((card) => (
          <div
            key={card.title}
            className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light transition-all duration-300 hover:-translate-y-1 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-surface-dark dark:hover:border-primary-500/30"
          >
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-500">
              {card.title}
            </div>
            <div className={`mt-2 text-2xl font-semibold ${card.accent}`}>{card.value}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Updated in real time
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Admin areas</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Jump into the tools you manage most.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {adminSections.map((section) => (
              <Link
                key={section.to}
                to={section.to}
                className="group rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-surface-light transition-all duration-300 hover:-translate-y-1 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950/60 dark:shadow-surface-dark dark:hover:border-primary-500/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-slate-900 transition-all duration-300 group-hover:text-primary-600 dark:text-slate-100 dark:group-hover:text-primary-400">
                      {section.title}
                    </div>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {section.description}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-400 transition-all duration-300 group-hover:text-primary-500 dark:text-slate-500 dark:group-hover:text-primary-400">
                    Open →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-primary-500/30">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Recent audit logs
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Latest 5 actions across the platform.
              </p>
            </div>
            <Link
              to="/admin/audit-logs"
              className="text-xs font-semibold text-primary-600 transition-all duration-300 hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300"
            >
              View all
            </Link>
          </div>
          {auditLoading ? (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
              Loading audit logs...
            </div>
          ) : logs.length ? (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {logs.map((log) => (
                <div key={log.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {log.action}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      {log.user?.username ?? log.user?.email ?? log.userId ?? 'Unknown user'} ·{' '}
                      {log.resource}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-500">
                    {new Date(log.timestamp).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No audit activity yet"
              description="Audit events will appear once actions are recorded."
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminDashboardPage;
