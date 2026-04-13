import { Link } from 'react-router-dom';
import type { Server } from '../../types/server';
import ServerStatusBadge from './ServerStatusBadge';
import ServerControls from './ServerControls';
import { notifyError } from '../../utils/notify';

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const formatPercent = (value?: number | null) =>
  value != null && typeof value === 'number' ? `${Math.round(value)}%` : 'n/a';
const formatMB = (mb: number) => {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb.toFixed(0)} MB`;
};

function ServerCard({ server }: { server: Server }) {
  const host =
    server.connection?.host ??
    server.primaryIp ??
    server.node?.publicAddress ??
    server.node?.hostname ??
    'n/a';
  const port = server.connection?.port ?? server.primaryPort ?? 'n/a';
  
  const cpuPercent =
    server.status === 'running' && server.cpuPercent != null && typeof server.cpuPercent === 'number'
      ? clampPercent(server.cpuPercent)
      : null;
  
  const memoryPercent =
    server.status === 'running' && server.memoryPercent != null && typeof server.memoryPercent === 'number'
      ? clampPercent(server.memoryPercent)
      : server.status === 'running' && server.memoryUsageMb != null && server.allocatedMemoryMb
        ? clampPercent((server.memoryUsageMb / server.allocatedMemoryMb) * 100)
        : null;
  
  const diskTotalMb =
    server.diskTotalMb ?? (server.allocatedDiskMb ? server.allocatedDiskMb : null);
  const diskPercent =
    server.status === 'running' && server.diskUsageMb != null && diskTotalMb
      ? clampPercent((server.diskUsageMb / diskTotalMb) * 100)
      : null;

  const isSuspended = server.status === 'suspended';
  const cpuBar = cpuPercent ?? 0;
  const memoryBar = memoryPercent ?? 0;
  const diskBar = diskPercent ?? 0;

  const diskDisplay =
    server.diskUsageMb != null && diskTotalMb
      ? `${formatMB(server.diskUsageMb)} / ${formatMB(diskTotalMb)}`
      : formatPercent(diskPercent);

  const barColor = (val: number) =>
    val > 80 ? 'bg-danger' : val > 60 ? 'bg-warning' : 'bg-primary';

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card shadow-surface-light transition-all duration-200 hover:border-zinc-300 dark:shadow-surface-dark dark:hover:border-zinc-700">
      <div className="p-5">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Link
                to={`/servers/${server.id}`}
                className="font-display text-xl font-bold text-foreground transition-colors hover:text-primary"
              >
                {server.name}
              </Link>
              <ServerStatusBadge status={server.status} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-muted-foreground">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
                <span className="font-medium text-foreground">
                  {server.nodeName ?? server.nodeId}
                </span>
              </div>
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-muted-foreground">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <span className="font-medium text-foreground">
                  {host}:{port}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Resource Usage */}
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          {[
            { label: 'CPU', value: cpuPercent, bar: cpuBar, display: formatPercent(cpuPercent) },
            { label: 'RAM', value: memoryPercent, bar: memoryBar, display: formatPercent(memoryPercent) },
            { label: 'Disk', value: diskPercent, bar: diskBar, display: diskDisplay },
          ].map((metric) => (
            <div key={metric.label} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium uppercase tracking-wider text-muted-foreground">{metric.label}</span>
                <span className="font-semibold text-foreground">{metric.display}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor(metric.bar)}`}
                  style={{ width: `${metric.bar}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <ServerControls serverId={server.id} status={server.status} permissions={server.effectivePermissions} />
          <Link
            to={isSuspended ? '#' : `/servers/${server.id}/console`}
            className={`flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
              isSuspended
                ? 'cursor-not-allowed text-muted-foreground'
                : 'text-foreground hover:bg-surface-2'
            }`}
            onClick={(event) => {
              if (isSuspended) {
                event.preventDefault();
                notifyError('Server is suspended');
              }
            }}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Console
          </Link>
          <Link
            to={`/servers/${server.id}`}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-all duration-200 hover:opacity-90"
          >
            Manage
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default ServerCard;
