import {
 LineChart,
 Line,
 ResponsiveContainer,
 Tooltip,
 YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import type { ServerMetricsPoint } from '../../types/server';
import { formatBytes } from '../../utils/formatters';
import { cn } from '@/lib/utils';

type TrendCard = {
 label: string;
 value: string;
 color: string;
 stroke: string;
 data: Array<{ index: number; value: number | null }>;
 formatTooltip?: (value: number) => string;
};

// Null means "no sample in this bucket" and renders as a chart gap.
// Never coerce gaps to 0: that would fake idle periods and drag averages.
const toNullableNumber = (value?: string | number | null) => {
 if (value == null) return null;
 const parsed = typeof value === 'string' ? Number(value) : value;
 return Number.isFinite(parsed) ? parsed : null;
};

const toChartData = (values: Array<number | null>) => values.map((value, index) => ({ index, value }));

function ServerMetricsTrends({
 history,
 latest,
 allocatedMemoryMb = 0,
 timeRangeLabel,
}: {
 history: ServerMetricsPoint[];
 latest: ServerMetricsPoint | null;
 allocatedMemoryMb?: number;
 timeRangeLabel?: string;
}) {
 const { t } = useTranslation('servers');
 const resolvedTimeRangeLabel = timeRangeLabel ?? t('metrics.last60Min');
 const cpuHistory = history.map((point) => point.cpuPercent);
 const memoryHistory = history.map((point) => point.memoryUsageMb);
 const diskHistory = history.map((point) => point.diskUsageMb);
 const diskIoHistory = history.map((point) => point.diskIoMb ?? null);
 // Network values from backend are now MB/s delta rates (numeric)
 const netRxHistory = history.map((point) => toNullableNumber(point.networkRxBytes));
 const netTxHistory = history.map((point) => toNullableNumber(point.networkTxBytes));
 const throughput = netRxHistory.map((rx, i) => {
 const tx = netTxHistory[i];
 if (rx == null || tx == null) return null;
 return Math.round((rx + tx) * 100) / 100;
 });
 const lastThroughput = [...throughput].reverse().find((v) => v != null) ?? 0;

 // Value color encodes STATE, not identity: neutral until a threshold is
 // crossed. Chart strokes keep their series hues (data-viz identity).
 const percentTone = (pct: number) =>
 pct >= 90 ? 'text-danger' : pct >= 75 ? 'text-warning' : 'text-foreground';
 const memoryPercent =
 allocatedMemoryMb && allocatedMemoryMb > 0
 ? ((latest?.memoryUsageMb ?? 0) / allocatedMemoryMb) * 100
 : 0;

 const cards: TrendCard[] = [
 {
 label: t('metrics.labels.cpu'),
 value: `${(latest?.cpuPercent ?? 0).toFixed(1)}%`,
 color: percentTone(latest?.cpuPercent ?? 0),
 stroke: 'hsl(var(--primary))',
 data: toChartData(cpuHistory),
 },
 {
 label: t('metrics.labels.memory'),
 value: allocatedMemoryMb
 ? `${(latest?.memoryUsageMb ?? 0).toFixed(0)} / ${allocatedMemoryMb} MB`
 : 'n/a',
 color: percentTone(memoryPercent),
 stroke: 'hsl(var(--success))',
 data: toChartData(memoryHistory),
 formatTooltip: (value) => `${value.toFixed(0)} MB`,
 },
 {
 label: t('metrics.labels.diskUsage'),
 value: formatBytes((latest?.diskUsageMb ?? 0) * 1024 * 1024),
 color: 'text-foreground',
 stroke: 'hsl(var(--warning))',
 data: toChartData(diskHistory),
 formatTooltip: (value) => formatBytes(value * 1024 * 1024),
 },
 {
 label: t('metrics.labels.diskIo'),
 value: formatBytes((latest?.diskIoMb ?? 0) * 1024 * 1024),
 color: 'text-foreground',
 stroke: 'hsl(var(--warning))',
 data: toChartData(diskIoHistory),
 formatTooltip: (value) => formatBytes(value * 1024 * 1024),
 },
 {
 label: t('metrics.labels.network'),
 value: `${lastThroughput.toFixed(2)} MB/s`,
 color: 'text-foreground',
 stroke: 'hsl(var(--info))',
 data: toChartData(throughput),
 formatTooltip: (value) => `${value.toFixed(2)} MB/s`,
 },
 ];

 return (
 <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
 {cards.map((card) => (
 <div key={card.label} className="deck-panel flex flex-col overflow-hidden">
 <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
 <span className="type-overline">{card.label}</span>
 <span className="text-micro text-muted-foreground/70">{resolvedTimeRangeLabel}</span>
 </div>
 <div className="flex flex-1 flex-col p-3">
 <div className={cn('type-numeric text-data', card.color)}>{card.value}</div>
 <div className="mt-2 h-24 w-full">
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
 ))}
 </div>
 );
}

export default ServerMetricsTrends;
