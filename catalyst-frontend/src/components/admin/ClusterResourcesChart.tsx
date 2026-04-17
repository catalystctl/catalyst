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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Cpu, MemoryStick, Network, Waves, History, Radio } from 'lucide-react';
import type {
  ClusterMetrics,
  ClusterHistoricalMetrics,
  ClusterTimelinePoint,
  TimeRange,
} from '@/hooks/useClusterMetrics';
import { useClusterHistoricalMetrics } from '@/hooks/useClusterMetrics';
import { useState, useEffect, useRef } from 'react';

type MetricType = 'cpu' | 'memory' | 'network';
type DataMode = 'live' | 'historical';

interface ClusterResourcesChartProps {
  data: ClusterMetrics | undefined;
  isLoading: boolean;
}

const COLORS = [
  'hsl(var(--primary))',
  'hsl(270 70% 55%)',
  'hsl(160 70% 40%)',
  'hsl(38 90% 50%)',
  'hsl(0 75% 55%)',
  'hsl(220 80% 55%)',
  'hsl(330 70% 50%)',
  'hsl(80 60% 40%)',
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
  const timeLabel = new Date().toLocaleTimeString('en-US', {
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
  const prevMetricRef = useRef<MetricType | null>(null);

  useEffect(() => {
    if (!data?.nodes) return;

    const prev = prevMetricRef.current;
    if (prev !== null && prev !== metric) {
      // Metric changed — reset history
      setHistory([createLivePoint(data, metric)]);
    } else {
      setHistory((prev) => {
        const updated = [...prev, createLivePoint(data, metric)];
        return updated.length > MAX_LIVE_POINTS ? updated.slice(-MAX_LIVE_POINTS) : updated;
      });
    }
    prevMetricRef.current = metric;
  }, [data, metric]);

  return history;
}

// ── Main component ──

export function ClusterResourcesChart({ data, isLoading }: ClusterResourcesChartProps) {
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
        return 'CPU Usage (%)';
      case 'memory':
        return 'Memory Usage (%)';
      case 'network':
        return 'Network I/O (MB/s)';
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
    <Card className="group relative overflow-hidden border-border/80 bg-card shadow-sm transition-all hover:shadow-md dark:border-border/50 lg:col-span-2">
      <CardHeader className="relative pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2.5">
              <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/30">
                <Waves className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-primary-200/50 dark:ring-primary-800/50" />
              </div>
              <div>
                <span>Cluster Resources</span>
                <p className="text-sm font-normal text-muted-foreground">
                  {isLive ? 'Real-time metrics' : `${timeRange} historical metrics`}
                </p>
              </div>
            </CardTitle>
            <CardDescription className="ml-11">
              {isLive ? (
                <Badge
                  variant="outline"
                  className="border-primary-200/50 bg-primary-50/50 text-primary-700 dark:border-primary-900/50 dark:bg-primary-950/50 dark:text-primary-400"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-500" />
                  </span>
                  <span className="ml-1.5 font-semibold">Live</span>
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-primary-200/50 bg-primary-50/50 text-primary-700 dark:border-primary-900/50 dark:bg-primary-950/50 dark:text-primary-400"
                >
                  <History className="mr-1 h-3 w-3" />
                  <span className="font-semibold">{timeRange}</span>
                </Badge>
              )}
              <span className="mt-1 block text-xs text-muted-foreground">
                {data
                  ? `${data.onlineCount} of ${data.nodes.length} nodes online`
                  : historical
                    ? `${historical.nodes.filter((n) => n.isOnline).length} of ${historical.nodes.length} nodes online`
                    : '—'}
              </span>
            </CardDescription>
          </div>

          {/* Metric + Mode + Range controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Data mode toggle: Live / Historical */}
            <ToggleGroup
              type="single"
              value={dataMode}
              onValueChange={(v) => v && setDataMode(v as DataMode)}
              className="border border-border dark:border-border"
            >
              <ToggleGroupItem
                value="live"
                className="gap-1.5 px-3 data-[state=on]:bg-primary-100 data-[state=on]:text-primary-700 dark:data-[state=on]:bg-primary-900/30 dark:data-[state=on]:text-primary-400"
              >
                <Radio className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Live</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="historical"
                className="gap-1.5 px-3 data-[state=on]:bg-primary-100 data-[state=on]:text-primary-700 dark:data-[state=on]:bg-primary-900/30 dark:data-[state=on]:text-primary-400"
              >
                <History className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Historical</span>
              </ToggleGroupItem>
            </ToggleGroup>

            {/* Time range (only in historical mode) */}
            {!isLive && (
              <ToggleGroup
                type="single"
                value={timeRange}
                onValueChange={(v) => v && setTimeRange(v as TimeRange)}
                className="border border-border dark:border-border"
              >
                {TIME_RANGE_OPTIONS.map((opt) => (
                  <ToggleGroupItem
                    key={opt.value}
                    value={opt.value}
                    className="px-2.5 text-xs data-[state=on]:bg-primary-100 data-[state=on]:text-primary-700 dark:data-[state=on]:bg-primary-900/30 dark:data-[state=on]:text-primary-400"
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
              className="border border-border dark:border-border"
            >
              <ToggleGroupItem
                value="cpu"
                className="gap-1.5 px-3 data-[state=on]:bg-primary-100 data-[state=on]:text-primary-700 dark:data-[state=on]:bg-primary-900/30 dark:data-[state=on]:text-primary-400"
              >
                <Cpu className="h-4 w-4" />
                <span className="hidden sm:inline">CPU</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="memory"
                className="gap-1.5 px-3 data-[state=on]:bg-primary-100 data-[state=on]:text-primary-700 dark:data-[state=on]:bg-primary-900/30 dark:data-[state=on]:text-primary-400"
              >
                <MemoryStick className="h-4 w-4" />
                <span className="hidden sm:inline">Memory</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="network"
                className="gap-1.5 px-3 data-[state=on]:bg-primary-100 data-[state=on]:text-primary-700 dark:data-[state=on]:bg-primary-900/30 dark:data-[state=on]:text-primary-400"
              >
                <Network className="h-4 w-4" />
                <span className="hidden sm:inline">Network</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* ── Chart area ── */}
        <div className="relative h-72 overflow-hidden rounded-xl border border-border bg-card dark:bg-surface-1/50">
          <div className="absolute inset-0 bg-surface-2/20" />
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
                        <div className="rounded-lg border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur-sm">
                          <p className="mb-2 text-xs font-semibold text-foreground dark:text-zinc-300">
                            {label}
                          </p>
                          {payload.map((entry, index) => (
                            <div key={index} className="flex items-center gap-2 text-sm">
                              <span
                                className="h-2 w-2 rounded-full shadow-sm"
                                style={{ backgroundColor: entry.color }}
                              />
                              <span className="text-muted-foreground">
                                {String(entry.name ?? '').replace(/_/g, ' ')}:
                              </span>
                              <span className="font-semibold text-foreground dark:text-white">
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
                        <span className="text-xs font-medium text-foreground dark:text-muted-foreground">
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
                <div className="text-center">
                  <div className="relative inline-flex">
                    <div className="absolute inset-0 -m-2 rounded-full bg-surface-2 blur-xl" />
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 shadow-sm">
                      <Waves className="h-6 w-6 text-primary-600 dark:text-primary-400" />
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-medium text-muted-foreground">
                    {isLive ? 'Collecting metrics...' : 'No historical data for this range'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer stats ── */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
          <div className="flex items-center gap-4">
            <span className="font-semibold text-foreground dark:text-zinc-300">
              {getMetricLabel()}
            </span>
            {data && (
              <>
                {metric === 'cpu' && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-foreground dark:text-zinc-300">
                    Avg: {data.totalCpu}%
                  </span>
                )}
                {metric === 'memory' && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-foreground dark:text-zinc-300">
                    Avg: {data.totalMemory}%
                  </span>
                )}
                {metric === 'network' && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium text-foreground dark:text-zinc-300">
                    RX: {data.avgNetworkRx.toFixed(1)} MB/s | TX: {data.avgNetworkTx.toFixed(1)} MB/s
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {isLive ? (
              <>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
                </span>
                <span className="font-medium">Updates every 5s</span>
              </>
            ) : (
              <span className="font-medium">
                {chartData.length} data points · refreshes every 60s
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
