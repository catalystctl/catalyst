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
import { cpuPercentOfAllocation, formatCpuCores, formatCpuPercent, resolveCpuCores } from '../../utils/cpu';
import { useCpuFormat } from '../../hooks/useCpuFormat';
import { cn } from '@/lib/utils';

type TrendCard = {
 label: string;
 value: string;
 color: string;
 stroke: string;
 data: Array<{ index: number; value: number | null }>;
 /**
 * Top of the card's axis; the bottom is always zero. Every series here is a
 * magnitude measured from zero, so an auto-fitted domain lies about scale: a
 * server jittering between 0.02% and 0.4% of its CPU drew a full-height spike,
 * and hovering the peak reported "0 / 4 cores". A zero-based axis makes the
 * line's height mean the number it printed.
 */
 domainMax: number | 'auto';
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
 allocatedCpuCores,
 timeRangeLabel,
}: {
 history: ServerMetricsPoint[];
 latest: ServerMetricsPoint | null;
 allocatedMemoryMb?: number;
 /** Cores the server may use; CPU history is per core. */
 allocatedCpuCores?: number | null;
 timeRangeLabel?: string;
}) {
 const { t } = useTranslation('servers');
 const { format: cpuFormat, read } = useCpuFormat();
 const resolvedTimeRangeLabel = timeRangeLabel ?? t('metrics.last60Min');
 const cpuCores = resolveCpuCores(allocatedCpuCores);
 // The chart plots the share of the allocation, matching the gauge above it and
 // the 0-100 axis below; the raw per-core figure would run to cores * 100. The
 // format preference changes only the printed value and the tooltip.
 const cpuShareHistory = history.map((point) => point.cpuPercent == null
  ? null
  : cpuPercentOfAllocation(point.cpuPercent, allocatedCpuCores));
 const cpuLatest = read(latest?.cpuPercent ?? 0, cpuCores);
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
 // Memory has a real ceiling (the allocation); a sample above it is the
 // agent's problem, but the axis must still show it rather than clip it.
 const memoryCeiling = allocatedMemoryMb > 0
 ? Math.max(allocatedMemoryMb, ...memoryHistory.map((value) => value ?? 0))
 : 'auto';

 const cards: TrendCard[] = [
 {
 label: t('metrics.labels.cpu'),
 // Same scale as the gauge above it; only the printed value follows the
 // user's format preference.
 value: cpuFormat === 'share' ? `${formatCpuPercent(cpuLatest.share)}%` : cpuLatest.text,
 color: percentTone(cpuLatest.share),
 stroke: 'hsl(var(--primary))',
 data: toChartData(cpuShareHistory),
 // The plotted value is the share of the allocation, which is capped at 100.
 domainMax: 100,
 formatTooltip: (value) => {
 return t('metrics.cpuAllocationDetail', {
 used: formatCpuCores((value / 100) * cpuCores),
 total: formatCpuCores(cpuCores),
 percent: formatCpuPercent(value),
 });
 },
 },
 {
 label: t('metrics.labels.memory'),
 value: allocatedMemoryMb
 ? `${(latest?.memoryUsageMb ?? 0).toFixed(0)} / ${allocatedMemoryMb} MB`
 : '—',
 color: percentTone(memoryPercent),
 stroke: 'hsl(var(--success))',
 data: toChartData(memoryHistory),
 domainMax: memoryCeiling,
 formatTooltip: (value) => `${value.toFixed(0)} MB`,
 },
 {
 label: t('metrics.labels.diskUsage'),
 value: formatBytes((latest?.diskUsageMb ?? 0) * 1024 * 1024),
 color: 'text-foreground',
 stroke: 'hsl(var(--warning))',
 data: toChartData(diskHistory),
 domainMax: 'auto',
 formatTooltip: (value) => formatBytes(value * 1024 * 1024),
 },
 {
 label: t('metrics.labels.diskIo'),
 value: formatBytes((latest?.diskIoMb ?? 0) * 1024 * 1024),
 color: 'text-foreground',
 stroke: 'hsl(var(--info))',
 data: toChartData(diskIoHistory),
 domainMax: 'auto',
 formatTooltip: (value) => formatBytes(value * 1024 * 1024),
 },
 {
 label: t('metrics.labels.network'),
 value: `${lastThroughput.toFixed(2)} MB/s`,
 color: 'text-foreground',
 stroke: 'hsl(var(--info))',
 data: toChartData(throughput),
 domainMax: 'auto',
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
 <YAxis hide domain={[0, card.domainMax]} />
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
