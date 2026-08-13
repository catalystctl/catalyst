import { useEffect, useRef, useState } from 'react';
import { Activity, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { formatBytes } from '../../utils/formatters';
import { cn } from '@/lib/utils';
import type { ServerMetrics } from '../../types/server';

function formatMem(mb: number) {
  if (!Number.isFinite(mb) || mb <= 0) return '0 MB';
  if (mb >= 1024) {
    const gb = mb / 1024;
    return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

function HeaderStat({
  icon: Icon,
  label,
  value,
  percent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  percent?: number;
}) {
  const hot = percent != null && percent >= 90;
  return (
    <div className="min-w-[6.75rem]">
      <div className="flex h-3 items-center gap-1 text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span className="type-overline">{label}</span>
      </div>
      <div className="type-numeric mt-0.5 h-4 whitespace-nowrap text-xs font-medium leading-4 text-foreground">
        {value}
      </div>

      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-3">
        {percent != null ? (
          <div
            className={cn('h-full rounded-full', hot ? 'bg-danger' : 'bg-primary')}
            style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}

export default function ServerHeaderStats({
  metrics,
  allocatedMemoryMb,
  allocatedDiskMb,
}: {
  metrics: ServerMetrics | null;
  allocatedMemoryMb?: number | null;
  allocatedDiskMb?: number | null;
}) {
  const prevNetRef = useRef<{ rx: number; tx: number; t: number } | null>(null);
  const [netRate, setNetRate] = useState({ rx: 0, tx: 0 });

  useEffect(() => {
    if (!metrics) return;
    const now = performance.now();
    const rx = Number(metrics.networkRxBytes ?? 0);
    const tx = Number(metrics.networkTxBytes ?? 0);
    const prev = prevNetRef.current;
    if (prev) {
      const dt = (now - prev.t) / 1000;
      if (dt >= 0.4) {
        setNetRate({
          rx: Math.max(0, (rx - prev.rx) / dt),
          tx: Math.max(0, (tx - prev.tx) / dt),
        });
        prevNetRef.current = { rx, tx, t: now };
      }
    } else {
      prevNetRef.current = { rx, tx, t: now };
    }
  }, [metrics]);

  if (!metrics) return null;

  const memoryLimit = allocatedMemoryMb && allocatedMemoryMb > 0 ? allocatedMemoryMb : null;
  const memoryUsed = metrics.memoryUsageMb ?? null;
  const memoryValue =
    memoryUsed != null && memoryLimit
      ? `${formatMem(memoryUsed)} / ${formatMem(memoryLimit)}`
      : `${metrics.memoryPercent.toFixed(0)}%`;

  const diskTotal = metrics.diskTotalMb && metrics.diskTotalMb > 0 ? metrics.diskTotalMb : allocatedDiskMb;
  const diskUsed = metrics.diskUsageMb;
  const diskValue =
    diskUsed != null && diskTotal ? `${formatMem(diskUsed)} / ${formatMem(diskTotal)}` : '—';
  const diskPercent =
    diskUsed != null && diskTotal && diskTotal > 0 ? Math.min(100, (diskUsed / diskTotal) * 100) : 0;

  return (
    <div className="hidden items-end gap-4 lg:flex">
      <HeaderStat icon={Cpu} label="CPU" value={`${metrics.cpuPercent.toFixed(0)}%`} percent={metrics.cpuPercent} />
      <HeaderStat icon={MemoryStick} label="Memory" value={memoryValue} percent={metrics.memoryPercent} />
      <HeaderStat icon={HardDrive} label="Disk" value={diskValue} percent={diskPercent} />
      <HeaderStat
        icon={Activity}
        label="Network"
        value={`↓ ${formatBytes(netRate.rx)}/s  ↑ ${formatBytes(netRate.tx)}/s`}
      />
    </div>
  );
}
