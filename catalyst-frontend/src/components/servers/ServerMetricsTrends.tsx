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

const toNumber = (value?: string | number) => {
  const parsed = typeof value === 'string' ? Number(value) : value ?? 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

const toDeltas = (values: number[]) =>
  values.map((value, index) => (index === 0 ? 0 : Math.max(0, value - values[index - 1])));

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
  const netRxHistory = history.map((point) => toNumber(point.networkRxBytes));
  const netTxHistory = history.map((point) => toNumber(point.networkTxBytes));
  const throughput = toDeltas(netRxHistory.map((value, index) => value + netTxHistory[index]));

  const cards: TrendCard[] = [
    {
      label: 'CPU',
      value: `${(latest?.cpuPercent ?? 0).toFixed(1)}%`,
      color: 'text-primary-600 dark:text-primary-400',
      stroke: '#06b6d4',
      data: toChartData(cpuHistory),
    },
    {
      label: 'Memory',
      value: allocatedMemoryMb
        ? `${(latest?.memoryUsageMb ?? 0).toFixed(0)} / ${allocatedMemoryMb} MB`
        : 'n/a',
      color: 'text-emerald-600 dark:text-emerald-400',
      stroke: '#34d399',
      data: toChartData(memoryHistory),
      formatTooltip: (value) => `${value.toFixed(0)} MB`,
    },
    {
      label: 'Disk Usage',
      value: formatBytes((latest?.diskUsageMb ?? 0) * 1024 * 1024),
      color: 'text-amber-600 dark:text-amber-400',
      stroke: '#fbbf24',
      data: toChartData(diskHistory),
      formatTooltip: (value) => formatBytes(value * 1024 * 1024),
    },
    {
      label: 'Disk IO',
      value: formatBytes((latest?.diskIoMb ?? 0) * 1024 * 1024),
      color: 'text-orange-600 dark:text-orange-400',
      stroke: '#fb923c',
      data: toChartData(diskIoHistory),
      formatTooltip: (value) => formatBytes(value * 1024 * 1024),
    },
    {
      label: 'Network',
      value: formatBytes(throughput[throughput.length - 1] ?? 0),
      color: 'text-violet-600 dark:text-violet-400',
      stroke: '#a78bfa',
      data: toChartData(throughput),
      formatTooltip: (value) => formatBytes(value),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-border bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:hover:border-primary/30"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground dark:text-muted-foreground">
                {card.label}
              </div>
              <div className={`text-lg font-semibold ${card.color}`}>{card.value}</div>
            </div>
            <div className="text-[11px] text-muted-foreground dark:text-muted-foreground">{timeRangeLabel}</div>
          </div>
          <div className="mt-3">
            <div className="h-24 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={card.data}>
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid #1e293b',
                      fontSize: 12,
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
      ))}
    </div>
  );
}

export default ServerMetricsTrends;
