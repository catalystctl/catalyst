import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import type { NodeStats } from '../../types/node';

function NodeMetricsCard({ stats }: { stats: NodeStats }) {
  const memoryPercent = Math.min(
    100,
    Math.max(
      0,
      stats.resources.actualMemoryTotalMb
        ? (stats.resources.actualMemoryUsageMb / stats.resources.actualMemoryTotalMb) * 100
        : 0,
    ),
  );
  const cpuPercent = Math.min(100, Math.max(0, stats.resources.actualCpuPercent ?? 0));
  const diskPercent = Math.min(
    100,
    Math.max(
      0,
      stats.resources.actualDiskTotalMb
        ? (stats.resources.actualDiskUsageMb / stats.resources.actualDiskTotalMb) * 100
        : 0,
    ),
  );

  const metrics = [
    { label: 'CPU', value: cpuPercent, color: 'bg-primary-500' },
    { label: 'Memory', value: memoryPercent, color: 'bg-emerald-500' },
    { label: 'Disk', value: diskPercent, color: 'bg-amber-500' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-foreground dark:text-white">
          Live usage
        </h3>
        <Badge variant="outline" className="gap-1.5 text-[11px]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Live
        </Badge>
      </div>

      <div className="space-y-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{metric.label}</span>
              <span className="font-semibold tabular-nums text-foreground dark:text-zinc-100">
                {metric.value.toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2 dark:bg-surface-2">
              <motion.div
                className={`h-full rounded-full ${metric.color}`}
                initial={{ width: 0 }}
                animate={{ width: `${metric.value}%` }}
                transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
              />
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default NodeMetricsCard;
