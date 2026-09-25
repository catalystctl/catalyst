import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { Server } from '../../types/server';
import ServerStatusBadge from './ServerStatusBadge';
import ServerControls from './ServerControls';
import { notifyError } from '../../utils/notify';
import { Button } from '@/components/ui/button';
import { ServerIcon, Globe, Terminal, ChevronRight } from 'lucide-react';

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const formatPercent = (value?: number | null) =>
 value != null && typeof value === 'number' ? `${Math.round(value)}%` : 'n/a';
const formatMB = (mb: number) => {
 if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
 return `${mb.toFixed(0)} MB`;
};

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
 const cpuBar = cpuPercent ?? 0;
 const memoryBar = memoryPercent ?? 0;
 const diskBar = diskPercent ?? 0;

 const diskDisplay =
  server.diskUsageMb != null && diskTotalMb
    ? `${formatMB(server.diskUsageMb)} / ${formatMB(diskTotalMb)}`
    : formatPercent(diskPercent);

 const memoryDisplay =
  server.memoryUsageMb != null && server.allocatedMemoryMb
    ? `${formatMB(server.memoryUsageMb)} / ${formatMB(server.allocatedMemoryMb)}`
    : formatPercent(memoryPercent);

 const barColor = (val: number) =>
  val > 80 ? 'bg-danger' : val > 60 ? 'bg-warning' : 'bg-primary';

 const metrics = useMemo(
  () => [
    { label: t('metrics.labels.cpu'), value: cpuPercent, bar: cpuBar, display: formatPercent(cpuPercent) },
    { label: t('metrics.labels.ram'), value: memoryPercent, bar: memoryBar, display: memoryDisplay },
    { label: t('metrics.labels.disk'), value: diskPercent, bar: diskBar, display: diskDisplay },
  ],
  [t, cpuPercent, cpuBar, memoryPercent, memoryBar, diskPercent, diskBar, diskDisplay, memoryDisplay],
 );


 return (
 <div className="group relative overflow-hidden rounded-md border border-border/50 bg-card transition-colors hover:border-primary/20">

 <div className="px-4 py-3.5">
 {/* Header */}
 <div className="mb-3 flex items-start justify-between gap-4">
 <div className="flex-1 space-y-2">
 <div className="flex items-center gap-2">
 <Link
 to={`/servers/${server.id}`}
 className="font-display text-sm font-semibold text-foreground transition-colors hover:text-primary"
 >
 {server.name}
 </Link>
 <ServerStatusBadge status={server.status} operationStage={server.operationStage} operationProgress={server.operationProgress} />
 </div>
 <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
 <span className="flex min-w-0 items-center gap-1">
 <ServerIcon className="h-2.5 w-2.5 shrink-0" />
 <span className="truncate font-mono text-[10px]">{server.nodeName ?? server.nodeId}</span>
 </span>
 <span className="flex min-w-0 items-center gap-1">
 <Globe className="h-2.5 w-2.5 shrink-0" />
 <span className="truncate font-mono text-[10px] tabular-nums">{host}:{port}</span>
 </span>
 </div>
 </div>
 </div>

 {/* Resource Usage */}
 <div className="mb-4 grid gap-3 md:grid-cols-3">
 {metrics.map((metric) => (
 <div key={metric.label} className="space-y-1.5">
 <div className="flex items-center justify-between">
        <span className="type-overline">{metric.label}</span>
        <span className="type-numeric text-[11px] text-foreground">{metric.display}</span>

 </div>
 <div className="h-1.5 overflow-hidden rounded-full bg-surface-2/30">
 <div
 className={`h-full rounded-full transition-all duration-500 ${barColor(metric.bar)}`}
 style={{ width: `${metric.bar}%` }}
 />
 </div>
 </div>
 ))}
 </div>

 {/* Actions */}
 <div className="flex flex-wrap items-center gap-2 border-t border-border/30 pt-4">
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
 className={isSuspended ? 'cursor-not-allowed opacity-60' : ''}
 >
 <Link to={isSuspended ? '#' : `/servers/${server.id}/console`} className="flex items-center gap-1.5">
 <Terminal className="h-3.5 w-3.5" />
 {t('card.console')}
 </Link>
 </Button>
 <Button size="sm" asChild className="ml-auto ">
 <Link to={`/servers/${server.id}`} className="flex items-center gap-1.5">
 {t('card.manage')}
 <ChevronRight className="h-3.5 w-3.5" />
 </Link>
 </Button>
 </div>
 </div>
 </div>
 );
}

export default memo(ServerCard);
