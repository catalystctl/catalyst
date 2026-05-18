import { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Server } from '../../types/server';
import ServerStatusBadge from './ServerStatusBadge';
import ServerControls from './ServerControls';
import { notifyError } from '../../utils/notify';
import { Badge } from '@/components/ui/badge';
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

 const barColor = (val: number) =>
 val > 80 ? 'bg-danger' : val > 60 ? 'bg-warning' : 'bg-primary';

 const metrics = useMemo(
 () => [
 { label: 'CPU', value: cpuPercent, bar: cpuBar, display: formatPercent(cpuPercent) },
 { label: 'RAM', value: memoryPercent, bar: memoryBar, display: formatPercent(memoryPercent) },
 { label: 'Disk', value: diskPercent, bar: diskBar, display: diskDisplay },
 ],
 [cpuPercent, cpuBar, memoryPercent, memoryBar, diskPercent, diskBar, diskDisplay],
 );

 return (
 <div className="group relative overflow-hidden rounded-lg border border-border/30 bg-card transition-all duration-150 hover:border-primary/20 hover:bg-primary/[0.02]">
 {/* Left accent bar */}
 <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary/0 transition-colors duration-150 group-hover:bg-primary/50" />

 <div className="p-5 pl-6">
 {/* Header */}
 <div className="mb-4 flex items-start justify-between gap-4">
 <div className="flex-1 space-y-2">
 <div className="flex items-center gap-2">
 <Link
 to={`/servers/${server.id}`}
 className="font-display text-sm font-semibold text-foreground transition-colors hover:text-primary"
 >
 {server.name}
 </Link>
 <ServerStatusBadge status={server.status} />
 </div>
 <div className="flex flex-wrap gap-2 text-xs">
 <Badge variant="secondary" className="gap-1.5">
 <ServerIcon className="h-3 w-3" />
 {server.nodeName ?? server.nodeId}
 </Badge>
 {server.subdomain ? (
 <Badge variant="secondary" className="gap-1.5">
 <Globe className="h-3 w-3" />
 {server.subdomain}
 </Badge>
 ) : (
 <Badge variant="secondary" className="gap-1.5">
 <Globe className="h-3 w-3" />
 {host}:{port}
 </Badge>
 )}
 </div>
 </div>
 </div>

 {/* Resource Usage */}
 <div className="mb-4 grid gap-3 md:grid-cols-3">
 {metrics.map((metric) => (
 <div key={metric.label} className="space-y-1.5">
 <div className="flex items-center justify-between">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">{metric.label}</span>
 <span className="font-mono text-[11px] tabular-nums text-foreground">{metric.display}</span>
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
 notifyError('Server is suspended');
 }
 }}
 className={isSuspended ? 'cursor-not-allowed opacity-60' : ''}
 >
 <Link to={isSuspended ? '#' : `/servers/${server.id}/console`} className="flex items-center gap-1.5">
 <Terminal className="h-3.5 w-3.5" />
 Console
 </Link>
 </Button>
 <Button size="sm" asChild className="ml-auto ">
 <Link to={`/servers/${server.id}`} className="flex items-center gap-1.5">
 Manage
 <ChevronRight className="h-3.5 w-3.5" />
 </Link>
 </Button>
 </div>
 </div>
 </div>
 );
}

export default memo(ServerCard);
