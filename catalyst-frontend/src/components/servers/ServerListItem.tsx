import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { Server } from '../../types/server';
import ServerStatusBadge from './ServerStatusBadge';
import ServerControls from './ServerControls';
import { Button } from '@/components/ui/button';
import { Meter, Segmented } from '../deck/primitives';
import { cn } from '@/lib/utils';
import { ServerIcon, Globe, Terminal, ChevronRight, HardDrive, Cpu, MemoryStick } from 'lucide-react';

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const formatPercent = (value?: number | null) =>
  value != null && typeof value === 'number' ? `${Math.round(value)}%` : '—';
const formatMB = (mb: number) => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
};

/** Severity belongs on the reading; the meter stays a neutral glance. */
const severityClass = (value: number | null) =>
  value != null && value >= 90 ? 'text-danger' : value != null && value >= 75 ? 'text-warning' : undefined;

function ServerListItem({ server }: { server: Server }) {
  const host =
    server.connection?.host ??
    server.primaryIp ??
    server.node?.publicAddress ??
    server.node?.hostname ??
    'n/a';
  const port = server.connection?.port ?? server.primaryPort ?? 'n/a';

  const cpuPercent =
    server.status === 'running' && server.cpuPercent != null
      ? clampPercent(server.cpuPercent)
      : null;

  const memoryPercent =
    server.status === 'running' && server.memoryPercent != null
      ? clampPercent(server.memoryPercent)
      : server.status === 'running' && server.memoryUsageMb != null && server.allocatedMemoryMb
        ? clampPercent((server.memoryUsageMb / server.allocatedMemoryMb) * 100)
        : null;

  const diskTotalMb = server.diskTotalMb ?? server.allocatedDiskMb ?? null;
  const diskPercent =
    server.status === 'running' && server.diskUsageMb != null && diskTotalMb
      ? clampPercent((server.diskUsageMb / diskTotalMb) * 100)
      : null;

  const isSuspended = server.status === 'suspended';

  return (
    <div className="group flex items-center gap-4 px-3 py-2">
      {/* Status */}
      <div className="shrink-0">
        <ServerStatusBadge status={server.status} operationStage={server.operationStage} operationProgress={server.operationProgress} />
      </div>

      {/* Name + node */}
      <div className="min-w-0 flex-1">
        <Link
          to={`/servers/${server.id}`}
          className="block truncate font-display text-data font-semibold tracking-tight text-foreground transition-colors hover:text-primary"
        >
          {server.name}
        </Link>
        <div className="mt-0.5 flex items-center gap-2 text-micro text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1">
            <ServerIcon className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate font-mono">{server.nodeName ?? server.nodeId}</span>
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <Globe className="h-2.5 w-2.5 shrink-0" />
            <span className="font-mono tabular-nums">{host}:{port}</span>
          </span>
        </div>
      </div>

      {/* Resource meters — hidden on small screens */}
      <div className="hidden items-center gap-4 lg:flex">
        <div className="flex items-center gap-2">
          <Cpu className="h-3 w-3 text-muted-foreground/60" />
          <Meter value={cpuPercent} />
          <Segmented muted={cpuPercent == null} className={cn('min-w-[3rem] text-right', severityClass(cpuPercent))}>
            {formatPercent(cpuPercent)}
          </Segmented>
        </div>
        <div className="flex items-center gap-2">
          <MemoryStick className="h-3 w-3 text-muted-foreground/60" />
          <Meter value={memoryPercent} />
          <Segmented muted={memoryPercent == null} className={cn('min-w-[8rem] text-right', severityClass(memoryPercent))}>
            {server.memoryUsageMb != null && server.allocatedMemoryMb
              ? `${formatMB(server.memoryUsageMb)}/${formatMB(server.allocatedMemoryMb)}`
              : formatPercent(memoryPercent)}
          </Segmented>
        </div>
        <div className="flex items-center gap-2">
          <HardDrive className="h-3 w-3 text-muted-foreground/60" />
          <Meter value={diskPercent} />
          <Segmented muted={diskPercent == null} className={cn('min-w-[8rem] text-right', severityClass(diskPercent))}>
            {server.diskUsageMb != null && diskTotalMb
              ? `${formatMB(server.diskUsageMb)}/${formatMB(diskTotalMb)}`
              : formatPercent(diskPercent)}
          </Segmented>
        </div>
      </div>

      {/* Controls + actions */}
      <div className="flex shrink-0 items-center gap-1">
        <ServerControls serverId={server.id} status={server.status} permissions={server.effectivePermissions} compact />
        <Button
          variant="outline"
          size="icon-sm"
          asChild
          disabled={isSuspended}
          className="hidden rounded-sm sm:inline-flex"
        >
          <Link to={isSuspended ? '#' : `/servers/${server.id}/console`}>
            <Terminal className="h-3 w-3" />
          </Link>
        </Button>
        <Button size="icon-sm" asChild className="rounded-sm">
          <Link to={`/servers/${server.id}`}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default memo(ServerListItem);
