import {
 LineChart,
 Line,
 XAxis,
 YAxis,
 CartesianGrid,
 Tooltip,
 ResponsiveContainer,
 Legend,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BracketLabel, StatusLed } from '@/components/deck/primitives';
import { Cpu, MemoryStick, Network, Waves, History, Radio } from 'lucide-react';
import type {
 ClusterMetrics,
 ClusterTimelinePoint,
 TimeRange,
} from '@/hooks/useClusterMetrics';
import { useClusterHistoricalMetrics } from '@/hooks/useClusterMetrics';
import { formatTime } from '@/i18n/format';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type MetricType = 'cpu' | 'memory' | 'network';
type DataMode = 'live' | 'historical';

interface ClusterResourcesChartProps {
 data: ClusterMetrics | undefined;
 isLoading: boolean;
}

const COLORS = [
 'hsl(var(--primary))',
 'hsl(var(--success))',
 'hsl(var(--warning))',
 'hsl(var(--info))',
 'hsl(var(--danger))',
 'hsl(var(--muted-foreground))',
];

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
 { value: '1h', label: '1h' },
 { value: '6h', label: '6h' },
 { value: '24h', label: '24h' },
 { value: '7d', label: '7d' },
];

// ── Live history point (accumulated from polling) ──

interface LivePoint {
 time: string;
 timestamp: number;
 [key: string]: string | number;
}

function createLivePoint(data: ClusterMetrics, metric: MetricType): LivePoint {
 const timeLabel = formatTime(Date.now(), {
 hour: '2-digit',
 minute: '2-digit',
 second: '2-digit',
 });

 const point: LivePoint = { time: timeLabel, timestamp: Date.now() };

 data.nodes.forEach((node) => {
 const key = node.nodeName.replace(/\s+/g, '_');
 if (metric === 'cpu') point[key] = node.isOnline ? node.cpu : 0;
 else if (metric === 'memory') point[key] = node.isOnline ? node.memory : 0;
 else point[key] = node.isOnline ? Math.round(node.networkRx + node.networkTx) : 0;
 });

 return point;
}

// ── In-memory live history buffer ──

const MAX_LIVE_POINTS = 30;

function useLiveHistory(data: ClusterMetrics | undefined, metric: MetricType) {
 const [history, setHistory] = useState<LivePoint[]>([]);
 const [prevSync, setPrevSync] = useState<{ metric: MetricType | null; data: ClusterMetrics | undefined }>({
 metric: null,
 data: undefined,
 });

 // Metric changed → reset history
 if (prevSync.metric !== null && prevSync.metric !== metric) {
 if (data?.nodes) {
 setHistory([createLivePoint(data, metric)]);
 } else {
 setHistory([]);
 }
 setPrevSync({ metric, data });
 return history;
 }

 // New data arrived → append
 if (data && data !== prevSync.data) {
 setHistory((old) => {
 const updated = [...old, createLivePoint(data, metric)];
 return updated.length > MAX_LIVE_POINTS ? updated.slice(-MAX_LIVE_POINTS) : updated;
 });
 setPrevSync({ metric, data });
 return history;
 }

 // Sync tracker when props change without triggering history updates
 if (prevSync.metric !== metric || prevSync.data !== data) {
 setPrevSync({ metric, data });
 return history;
 }

 return history;
}

// ── Main component ──

export function ClusterResourcesChart({ data, isLoading }: ClusterResourcesChartProps) {
 const { t } = useTranslation('admin');
 const [metric, setMetric] = useState<MetricType>('cpu');
 const [dataMode, setDataMode] = useState<DataMode>('live');
 const [timeRange, setTimeRange] = useState<TimeRange>('1h');
 const liveHistory = useLiveHistory(data, metric);

 const { data: historical, isLoading: isHistoricalLoading } =
 useClusterHistoricalMetrics(dataMode === 'historical' ? timeRange : '1h');

 const isLive = dataMode === 'live';
 const chartData: ClusterTimelinePoint[] | LivePoint[] = isLive
 ? liveHistory
 : historical?.timeline ?? [];
 const showLoading = (isLive && (isLoading || !data)) || (!isLive && isHistoricalLoading);

 // ── Helpers ──

 const getMetricLabel = () => {
 switch (metric) {
 case 'cpu':
 return t('chart.metricLabel.cpu');
 case 'memory':
 return t('chart.metricLabel.memory');
 case 'network':
 return t('chart.metricLabel.network');
 }
 };

 const getUnit = () => {
 switch (metric) {
 case 'cpu':
 case 'memory':
 return '%';
 case 'network':
 return ' MB/s';
 }
 };

 const getYDomain = (): [number, number | 'auto'] => {
 if (metric === 'cpu' || metric === 'memory') return [0, 100];
 return [0, 'auto'];
 };

 /** Build the recharts `dataKey` for a given node name + selected metric. */
 const dataKeyForNode = (nodeName: string) => {
 const key = nodeName.replace(/\s+/g, '_');
 if (isLive) return key;
 return `${key}_${metric}`;
 };

 const nodesList = data?.nodes ?? historical?.nodes ?? [];

 return (
 <div className="deck-panel overflow-hidden">
 {/* Header strip: identity + live/historical state */}
 <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
 <div className="flex flex-wrap items-center gap-2">
 <Waves className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
 <BracketLabel>{t('chart.title')}</BracketLabel>
 <span className="text-micro text-muted-foreground">
 {isLive ? t('chart.subtitle.live') : t('chart.subtitle.historical', { range: timeRange })}
 </span>
 {isLive ? (
 <span className="inline-flex items-center gap-1.5 text-micro text-muted-foreground">
 <StatusLed tone="go" pulse />
 {t('chart.mode.live')}
 </span>
 ) : (
 <span className="inline-flex items-center gap-1.5 font-mono text-micro tabular-nums text-muted-foreground">
 <History className="h-3 w-3" />
 {timeRange}
 </span>
 )}
 <span className="font-mono text-micro tabular-nums text-muted-foreground">
 {data
 ? t('chart.nodesOnline', { online: data.onlineCount, total: data.nodes.length })
 : historical
 ? t('chart.nodesOnline', {
 online: historical.nodes.filter((n) => n.isOnline).length,
 total: historical.nodes.length,
 })
 : '—'}
 </span>
 </div>

 {/* Metric + Mode + Range controls */}
 <div className="flex flex-wrap items-center gap-2">
 {/* Data mode toggle: Live / Historical */}
 <ToggleGroup
 type="single"
 value={dataMode}
 onValueChange={(v) => v && setDataMode(v as DataMode)}
 className="rounded-sm border border-border/50"
 >
 <ToggleGroupItem
 value="live"
 className="h-7 gap-1.5 px-2.5 text-mini data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
 >
 <Radio className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{t('chart.mode.live')}</span>
 </ToggleGroupItem>
 <ToggleGroupItem
 value="historical"
 className="h-7 gap-1.5 px-2.5 text-mini data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
 >
 <History className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{t('chart.mode.historical')}</span>
 </ToggleGroupItem>
 </ToggleGroup>

 {/* Time range (only in historical mode) */}
 {!isLive && (
 <ToggleGroup
 type="single"
 value={timeRange}
 onValueChange={(v) => v && setTimeRange(v as TimeRange)}
 className="rounded-sm border border-border/50"
 >
 {TIME_RANGE_OPTIONS.map((opt) => (
 <ToggleGroupItem
 key={opt.value}
 value={opt.value}
 className="h-7 px-2 font-mono text-mini tabular-nums data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
 >
 {opt.label}
 </ToggleGroupItem>
 ))}
 </ToggleGroup>
 )}

 {/* Metric selector */}
 <ToggleGroup
 type="single"
 value={metric}
 onValueChange={(v) => v && setMetric(v as MetricType)}
 className="rounded-sm border border-border/50"
 >
 <ToggleGroupItem
 value="cpu"
 className="h-7 gap-1.5 px-2.5 text-mini data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
 >
 <Cpu className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{t('chart.metric.cpu')}</span>
 </ToggleGroupItem>
 <ToggleGroupItem
 value="memory"
 className="h-7 gap-1.5 px-2.5 text-mini data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
 >
 <MemoryStick className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{t('chart.metric.memory')}</span>
 </ToggleGroupItem>
 <ToggleGroupItem
 value="network"
 className="h-7 gap-1.5 px-2.5 text-mini data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
 >
 <Network className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{t('chart.metric.network')}</span>
 </ToggleGroupItem>
 </ToggleGroup>
 </div>
 </div>

 <div className="p-3">
 {/* ── Chart area ── */}
 <div className="relative h-72 overflow-hidden rounded-sm border border-border/50 bg-card">
 <div className="relative h-full">
 {showLoading ? (
 <Skeleton className="h-full w-full" />
 ) : chartData.length > 0 ? (
 <ResponsiveContainer width="100%" height="100%">
 <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
 <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
 <XAxis
 dataKey="time"
 tick={{ fontSize: 10 }}
 className="text-muted-foreground"
 axisLine={false}
 tickLine={false}
 interval="preserveStartEnd"
 />
 <YAxis
 domain={getYDomain()}
 tick={{ fontSize: 10 }}
 tickFormatter={(v) => `${v}${getUnit()}`}
 className="text-muted-foreground"
 axisLine={false}
 tickLine={false}
 width={45}
 />
 <Tooltip
 content={({ active, payload, label }) => {
 if (!active || !payload?.length) return null;
 return (
 <div className="rounded-sm border border-border/60 bg-card/95 px-3 py-2">
 <p className="mb-2 font-mono text-mini tabular-nums text-foreground">
 {label}
 </p>
 {payload.map((entry, index) => (
 <div key={index} className="flex items-center gap-2 text-mini">
 <span
 className="h-2 w-2 rounded-sm"
 style={{ backgroundColor: entry.color }}
 />
 <span className="text-muted-foreground">
 {String(entry.name ?? '').replace(/_/g, ' ')}:
 </span>
 <span className="font-mono tabular-nums text-foreground">
 {typeof entry.value === 'number'
 ? entry.value.toFixed(1)
 : entry.value}
 {getUnit()}
 </span>
 </div>
 ))}
 </div>
 );
 }}
 />
 <Legend
 wrapperStyle={{ paddingTop: '10px' }}
 formatter={(value) => {
 // Strip metric suffix from key in historical mode
 const clean = value.replace(/_(cpu|memory|network)$/, '');
 return (
 <span className="text-mini text-muted-foreground">
 {clean.replace(/_/g, ' ')}
 </span>
 );
 }}
 />
 {nodesList.map((node, index) => {
 const dataKey = dataKeyForNode(node.nodeName);
 return (
 <Line
 key={node.nodeId}
 type="monotone"
 dataKey={dataKey}
 name={node.nodeName}
 stroke={
 node.isOnline
 ? COLORS[index % COLORS.length]
 : 'hsl(var(--muted-foreground))'
 }
 strokeWidth={2.5}
 dot={false}
 activeDot={{ r: 5, stroke: 'hsl(var(--card))', strokeWidth: 2 }}
 strokeDasharray={node.isOnline ? undefined : '5 5'}
 connectNulls
 animationBegin={0}
 animationDuration={500}
 />
 );
 })}
 </LineChart>
 </ResponsiveContainer>
 ) : (
 <div className="flex h-full items-center justify-center">
 <div className="flex flex-col items-center text-center">
 <Waves className="h-5 w-5 text-muted-foreground" />
 <p className="mt-2 text-mini text-muted-foreground">
 {isLive ? t('chart.empty.live') : t('chart.empty.historical')}
 </p>
 </div>
 </div>
 )}
 </div>
 </div>

 {/* ── Footer stats ── */}
 <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-mini">
 <div className="flex items-center gap-3">
 <span className="font-display text-data font-semibold text-foreground">
 {getMetricLabel()}
 </span>
 {data && (
 <>
 {metric === 'cpu' && (
 <Badge variant="secondary" className="font-mono text-micro tabular-nums">
 {t('chart.avg', { value: data.totalCpu })}
 </Badge>
 )}
 {metric === 'memory' && (
 <Badge variant="secondary" className="font-mono text-micro tabular-nums">
 {t('chart.avg', { value: data.totalMemory })}
 </Badge>
 )}
 {metric === 'network' && (
 <Badge variant="secondary" className="font-mono text-micro tabular-nums">
 {t('chart.networkThroughput', {
 rx: data.avgNetworkRx.toFixed(1),
 tx: data.avgNetworkTx.toFixed(1),
 })}
 </Badge>
 )}
 </>
 )}
 </div>
 <div className="flex items-center gap-1.5 text-muted-foreground">
 {isLive ? (
 <>
 <StatusLed tone="go" pulse />
 <span className="font-medium">{t('chart.updatesEvery')}</span>
 </>
 ) : (
 <span className="font-mono font-medium tabular-nums">
 {t('chart.dataPoints', { value: chartData.length })}
 </span>
 )}
 </div>
 </div>
 </div>
 </div>
 );
}
