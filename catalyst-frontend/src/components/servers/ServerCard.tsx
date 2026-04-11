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
  
  // CPU: Use cpuPercent if available and server is running
  const cpuPercent =
    server.status === 'running' && server.cpuPercent != null && typeof server.cpuPercent === 'number'
      ? clampPercent(server.cpuPercent)
      : null;
  
  // Memory: Use memoryPercent if available, otherwise calculate from usage
  const memoryPercent =
    server.status === 'running' && server.memoryPercent != null && typeof server.memoryPercent === 'number'
      ? clampPercent(server.memoryPercent)
      : server.status === 'running' && server.memoryUsageMb != null && server.allocatedMemoryMb
        ? clampPercent((server.memoryUsageMb / server.allocatedMemoryMb) * 100)
        : null;
  
  // Disk: Calculate from usage and total
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

  // Disk display text
  const diskDisplay =
    server.diskUsageMb != null && diskTotalMb
      ? `${formatMB(server.diskUsageMb)} / ${formatMB(diskTotalMb)}`
      : formatPercent(diskPercent);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-surface-light transition-all duration-300 hover:shadow-xl hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
      {/* Gradient overlay on hover */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary-500/0 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-5 dark:group-hover:opacity-10" />
      
      <div className="relative p-5">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Link
                to={`/servers/${server.id}`}
                className="text-xl font-bold text-slate-900 transition-all duration-300 hover:text-primary-600 dark:text-white dark:hover:text-primary-400"
              >
                {server.name}
              </Link>
              <ServerStatusBadge status={server.status} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 dark:border-slate-700 dark:bg-slate-950/50">
                <svg className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {server.nodeName ?? server.nodeId}
                </span>
              </div>
              <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 dark:border-slate-700 dark:bg-slate-950/50">
                <svg className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  {host}:{port}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Resource Usage */}
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
                <span>CPU</span>
              </div>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {formatPercent(cpuPercent)}
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  cpuBar > 80 ? 'bg-rose-500' : cpuBar > 60 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${cpuBar}%` }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                </svg>
                <span>RAM</span>
              </div>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {formatPercent(memoryPercent)}
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  memoryBar > 80 ? 'bg-rose-500' : memoryBar > 60 ? 'bg-amber-500' : 'bg-sky-500'
                }`}
                style={{ width: `${memoryBar}%` }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
                <span>Disk</span>
              </div>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {diskDisplay}
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  diskBar > 80 ? 'bg-rose-500' : diskBar > 60 ? 'bg-amber-500' : 'bg-violet-500'
                }`}
                style={{ width: `${diskBar}%` }}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <ServerControls serverId={server.id} status={server.status} permissions={server.effectivePermissions} />
          <Link
            to={isSuspended ? '#' : `/servers/${server.id}/console`}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-300 ${
              isSuspended
                ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-800 dark:bg-slate-950/50'
                : 'border-slate-200 bg-white text-slate-700 hover:border-primary-500 hover:bg-primary-50 hover:text-primary-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-primary-500/50 dark:hover:bg-primary-950/20 dark:hover:text-primary-400'
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
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
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
