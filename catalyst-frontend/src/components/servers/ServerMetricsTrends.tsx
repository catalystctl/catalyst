import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from 'recharts';
import type { ServerMetricsPoint } from '../../types/server';
import { formatBytes } from '../../utils/formatters';

type TrendCard = {
  label: string;
  value: string;
  color: string;
  stroke: string;
  data: Array<{ index: number; value: number }>;
  formatTooltip?: (value: number) => string;
};

const toNumber = (value?: string | number | null) => {
  if (value == null) return 0;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : 0;
};

const toChartData = (values: number[]) => values.map((value, index) => ({ index, value }));

function ServerMetricsTrends({
  history,
  latest,
  allocatedMemoryMb = 0,
  timeRangeLabel = 'Last 60 min',
}: {
  history: ServerMetricsPoint[];
  latest: ServerMetricsPoint | null;
  allocatedMemoryMb?: number;
  timeRangeLabel?: string;
}) {
  const cpuHistory = history.map((point) => point.cpuPercent);
  const memoryHistory = history.map((point) => point.memoryUsageMb);
  const diskHistory = history.map((point) => point.diskUsageMb);
  const diskIoHistory = history.map((point) => point.diskIoMb ?? 0);
  // Network values from backend are now MB/s delta rates (numeric)
  const netRxHistory = history.map((point) => toNumber(point.networkRxBytes));
  const netTxHistory = history.map((point) => toNumber(point.networkTxBytes));
  const throughput = netRxHistory.map((rx, i) => Math.round((rx + netTxHistory[i]) * 100) / 100);

  const cards: TrendCard[] = [
    {
      label: 'CPU',
      value: `${(latest?.cpuPercent ?? 0).toFixed(1)}%`,
      color: 'text-primary',
      stroke: 'hsl(var(--primary))',
      data: toChartData(cpuHistory),
    },
    {
      label: 'Memory',
      value: allocatedMemoryMb
        ? `${(latest?.memoryUsageMb ?? 0).toFixed(0)} / ${allocatedMemoryMb} MB`
        : 'n/a',
      color: 'text-success',
      stroke: 'hsl(var(--success))',
      data: toChartData(memoryHistory),
      formatTooltip: (value) => `${value.toFixed(0)} MB`,
    },
    {
      label: 'Disk Usage',
      value: formatBytes((latest?.diskUsageMb ?? 0) * 1024 * 1024),
      color: 'text-warning',
      stroke: 'hsl(var(--warning))',
      data: toChartData(diskHistory),
      formatTooltip: (value) => formatBytes(value * 1024 * 1024),
    },
    {
      label: 'Disk IO',
      value: formatBytes((latest?.diskIoMb ?? 0) * 1024 * 1024),
      color: 'text-warning',
      stroke: 'hsl(24 90% 50%)',
      data: toChartData(diskIoHistory),
      formatTooltip: (value) => formatBytes(value * 1024 * 1024),
    },
    {
      label: 'Network',
      value: `${(throughput[throughput.length - 1] ?? 0).toFixed(2)} MB/s`,
      color: 'text-info',
      stroke: 'hsl(var(--info))',
      data: toChartData(throughput),
      formatTooltip: (value) => `${value.toFixed(2)} MB/s`,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-border bg-card transition-all duration-300 hover:border-primary/20"
        >
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {card.label}
                </div>
                <div className={`text-lg font-semibold ${card.color}`}>{card.value}</div>
              </div>
              <div className="text-[11px] text-muted-foreground">{timeRangeLabel}</div>
            </div>
            <div className="mt-3">
              <div className="h-24 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={card.data}>
                    <YAxis hide domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--surface-1))',
                        border: '1px solid hsl(var(--border))',
                        fontSize: 12,
                        color: 'hsl(var(--foreground))',
                      }}
                      labelFormatter={() => ''}
                      formatter={(value) => {
                        const numeric = typeof value === 'number' ? value : Number(value);
                        if (!Number.isFinite(numeric)) return value;
                        return card.formatTooltip ? card.formatTooltip(numeric) : numeric.toFixed(1);
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={card.stroke}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default ServerMetricsTrends;
