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

  return (
    <div className="group rounded-lg border border-border bg-surface-0 transition-all duration-150 hover:border-primary/30 hover:shadow-surface-md">
      <div className="p-4">
        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <Link
                to={`/servers/${server.id}`}
                className="text-base font-semibold text-foreground transition-colors hover:text-primary"
              >
                {server.name}
              </Link>
              <ServerStatusBadge status={server.status} />
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <div className="flex items-center gap-1 rounded-md bg-surface-1 px-2 py-0.5 text-muted-foreground">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
                <span className="font-medium">{server.nodeName ?? server.nodeId}</span>
              </div>
              <div className="flex items-center gap-1 rounded-md bg-surface-1 px-2 py-0.5 text-muted-foreground">
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <span className="font-mono text-[11px]">{host}:{port}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Resource Usage */}
        <div className="mb-3 grid gap-2.5 md:grid-cols-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium uppercase tracking-wider text-muted-foreground">CPU</span>
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {formatPercent(cpuPercent)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  cpuBar > 80 ? 'bg-destructive' : cpuBar > 60 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${cpuBar}%` }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium uppercase tracking-wider text-muted-foreground">RAM</span>
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {formatPercent(memoryPercent)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  memoryBar > 80 ? 'bg-destructive' : memoryBar > 60 ? 'bg-amber-500' : 'bg-primary'
                }`}
                style={{ width: `${memoryBar}%` }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium uppercase tracking-wider text-muted-foreground">Disk</span>
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {diskDisplay}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  diskBar > 80 ? 'bg-destructive' : diskBar > 60 ? 'bg-amber-500' : 'bg-violet-500'
                }`}
                style={{ width: `${diskBar}%` }}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <ServerControls serverId={server.id} status={server.status} permissions={server.effectivePermissions} />
          <Link
            to={isSuspended ? '#' : `/servers/${server.id}/console`}
            className={`flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-all duration-150 ${
              isSuspended
                ? 'cursor-not-allowed bg-surface-1 text-muted-foreground'
                : 'bg-transparent text-muted-foreground hover:bg-surface-1 hover:text-foreground'
            }`}
            onClick={(event) => {
              if (isSuspended) {
                event.preventDefault();
                notifyError('Server is suspended');
              }
            }}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Console
          </Link>
          <Link
            to={`/servers/${server.id}`}
            className="ml-auto flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-all duration-150 hover:bg-primary-hover"
          >
            Manage
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default ServerCard;
