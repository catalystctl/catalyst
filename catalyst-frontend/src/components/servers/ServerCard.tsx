import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { Server } from '../../types/server';
import ServerStatusBadge from './ServerStatusBadge';
import ServerControls from './ServerControls';
import { notifyError } from '../../utils/notify';
import { Button } from '@/components/ui/button';
import { Meter, Segmented } from '../deck/primitives';
import { cn } from '@/lib/utils';
import { ServerIcon, Globe, Terminal, ChevronRight } from 'lucide-react';

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const formatPercent = (value?: number | null) =>
  value != null && typeof value === 'number' ? `${Math.round(value)}%` : 'n/a';
const formatMB = (mb: number) => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
};

/** Severity belongs on the reading; the meter stays a neutral glance. */
const severityClass = (value: number | null) =>
  value != null && value >= 90 ? 'text-danger' : value != null && value >= 75 ? 'text-warning' : undefined;

function ServerCard({ server }: { server: Server }) {
  const { t } = useTranslation('servers');
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

  const diskTotalMb = server.diskTotalMb ?? (server.allocatedDiskMb ? server.allocatedDiskMb : null);
  const diskPercent =
    server.status === 'running' && server.diskUsageMb != null && diskTotalMb
      ? clampPercent((server.diskUsageMb / diskTotalMb) * 100)
      : null;

  const isSuspended = server.status === 'suspended';

  const diskDisplay =
    server.diskUsageMb != null && diskTotalMb
      ? `${formatMB(server.diskUsageMb)} / ${formatMB(diskTotalMb)}`
      : formatPercent(diskPercent);

  const memoryDisplay =
    server.memoryUsageMb != null && server.allocatedMemoryMb
      ? `${formatMB(server.memoryUsageMb)} / ${formatMB(server.allocatedMemoryMb)}`
      : formatPercent(memoryPercent);

  const metrics = useMemo(
    () => [
      { label: t('metrics.labels.cpu'), value: cpuPercent, display: formatPercent(cpuPercent) },
      { label: t('metrics.labels.ram'), value: memoryPercent, display: memoryDisplay },
      { label: t('metrics.labels.disk'), value: diskPercent, display: diskDisplay },
    ],
    [t, cpuPercent, memoryPercent, diskPercent, diskDisplay, memoryDisplay],
  );

  return (
    <div className="deck-panel flex flex-col overflow-hidden">
      <div className="flex-1 p-3">
        {/* Header */}
        <div className="flex items-start gap-2">
          <Link
            to={`/servers/${server.id}`}
            className="min-w-0 truncate font-display text-data font-semibold tracking-tight text-foreground transition-colors hover:text-primary"
          >
            {server.name}
          </Link>
          <ServerStatusBadge status={server.status} operationStage={server.operationStage} operationProgress={server.operationProgress} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-micro text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1">
            <ServerIcon className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate font-mono">{server.nodeName ?? server.nodeId}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1">
            <Globe className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate font-mono tabular-nums">{host}:{port}</span>
          </span>
        </div>

        {/* Resource usage */}
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="type-overline">{metric.label}</span>
                <Segmented muted={metric.value == null} className={severityClass(metric.value)}>
                  {metric.display}
                </Segmented>
              </div>
              <Meter value={metric.value} className="w-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-3 py-2">
        <ServerControls serverId={server.id} status={server.status} permissions={server.effectivePermissions} />
        <Button
          variant="outline"
          size="sm"
          asChild
          disabled={isSuspended}
          onClick={(event) => {
            if (isSuspended) {
              event.preventDefault();
              notifyError(t('errors.serverSuspended'));
            }
          }}
          className={cn('h-8 rounded-sm px-3 text-mini', isSuspended ? 'cursor-not-allowed opacity-60' : '')}
        >
          <Link to={isSuspended ? '#' : `/servers/${server.id}/console`} className="flex items-center gap-1.5">
            <Terminal className="h-3.5 w-3.5" />
            {t('card.console')}
          </Link>
        </Button>
        <Button size="sm" asChild className="ml-auto h-8 rounded-sm px-3 text-mini">
          <Link to={`/servers/${server.id}`} className="flex items-center gap-1.5">
            {t('card.manage')}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default memo(ServerCard);
