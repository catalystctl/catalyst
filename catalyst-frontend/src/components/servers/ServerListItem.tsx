import { Link } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import type { Server } from '../../types/server';
import ServerStatusBadge from './ServerStatusBadge';
import ServerControls from './ServerControls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ServerIcon, Globe, Terminal, ChevronRight, HardDrive, Cpu, MemoryStick } from 'lucide-react';

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 30 } },
};

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const formatPercent = (value?: number | null) =>
  value != null && typeof value === 'number' ? `${Math.round(value)}%` : '—';
const formatMB = (mb: number) => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
};

const barColor = (val: number) =>
  val > 80 ? 'bg-danger' : val > 60 ? 'bg-warning' : 'bg-primary';

function MiniBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={`h-1 w-16 overflow-hidden rounded-full bg-surface-2 ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${barColor(value)}`}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

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
  const cpuBar = cpuPercent ?? 0;
  const memoryBar = memoryPercent ?? 0;
  const diskBar = diskPercent ?? 0;

  return (
    <motion.div
      variants={itemVariants}
      className="group flex items-center gap-4 rounded-xl border border-border/50 bg-card/80 px-4 py-3 backdrop-blur-sm transition-all duration-200 hover:border-primary/20 hover:shadow-md"
    >
      {/* Status indicator */}
      <div className="shrink-0">
        <ServerStatusBadge status={server.status} />
      </div>

      {/* Name + Node */}
      <div className="min-w-0 flex-1">
        <Link
          to={`/servers/${server.id}`}
          className="block truncate text-sm font-semibold text-foreground transition-colors hover:text-primary dark:text-white"
        >
          {server.name}
        </Link>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Badge variant="secondary" className="h-5 gap-1 px-1.5 py-0 text-[10px]">
            <ServerIcon className="h-2.5 w-2.5" />
            {server.nodeName ?? server.nodeId}
          </Badge>
          <Badge variant="secondary" className="h-5 gap-1 px-1.5 py-0 text-[10px]">
            <Globe className="h-2.5 w-2.5" />
            {host}:{port}
          </Badge>
        </div>
      </div>

      {/* Resource bars — hidden on small screens */}
      <div className="hidden items-center gap-4 lg:flex">
        <div className="flex items-center gap-2 text-[11px]">
          <Cpu className="h-3 w-3 text-muted-foreground" />
          <span className="w-8 text-right tabular-nums text-foreground">{formatPercent(cpuPercent)}</span>
          <MiniBar value={cpuBar} />
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <MemoryStick className="h-3 w-3 text-muted-foreground" />
          <span className="w-8 text-right tabular-nums text-foreground">{formatPercent(memoryPercent)}</span>
          <MiniBar value={memoryBar} />
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <HardDrive className="h-3 w-3 text-muted-foreground" />
          <span className="w-12 text-right tabular-nums text-foreground">
            {server.diskUsageMb != null && diskTotalMb
              ? `${formatMB(server.diskUsageMb)}/${formatMB(diskTotalMb)}`
              : formatPercent(diskPercent)}
          </span>
          <MiniBar value={diskBar} />
        </div>
      </div>

      {/* Controls + Actions */}
      <div className="flex shrink-0 items-center gap-2">
        <ServerControls serverId={server.id} status={server.status} permissions={server.effectivePermissions} />
        <Button
          variant="outline"
          size="sm"
          asChild
          disabled={isSuspended}
          className="hidden sm:inline-flex"
        >
          <Link to={isSuspended ? '#' : `/servers/${server.id}/console`} className="flex items-center gap-1">
            <Terminal className="h-3 w-3" />
          </Link>
        </Button>
        <Button size="sm" asChild>
          <Link to={`/servers/${server.id}`} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </motion.div>
  );
}

export default ServerListItem;
