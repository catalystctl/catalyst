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
import { Cpu, MemoryStick, Network, Waves } from 'lucide-react';
import type { ClusterMetrics } from '@/hooks/useClusterMetrics';
import { useState, useReducer, useEffect, useRef } from 'react';

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

interface HistoryPoint {
  time: string;
  timestamp: number;
  [key: string]: string | number;
}

type HistoryAction =
  | { type: 'APPEND'; point: HistoryPoint; maxPoints: number }
  | { type: 'RESET'; point?: HistoryPoint };

function historyReducer(state: HistoryPoint[], action: HistoryAction): HistoryPoint[] {
  switch (action.type) {
    case 'APPEND': {
      const updated = [...state, action.point];
      return updated.length > action.maxPoints ? updated.slice(-action.maxPoints) : updated;
    }
    case 'RESET':
      return action.point ? [action.point] : [];
    default:
      return state;
  }
}

function createHistoryPoint(data: ClusterMetrics, metric: 'cpu' | 'memory' | 'network'): HistoryPoint {
  const now = Date.now();
  const timeLabel = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const newPoint: HistoryPoint = {
    time: timeLabel,
    timestamp: now,
  };

  data.nodes.forEach((node) => {
    const key = node.nodeName.replace(/\s+/g, '_');
    if (metric === 'cpu') {
      newPoint[key] = node.isOnline ? node.cpu : 0;
    } else if (metric === 'memory') {
      newPoint[key] = node.isOnline ? node.memory : 0;
    } else {
      newPoint[key] = node.isOnline ? Math.round(node.networkRx + node.networkTx) : 0;
    }
  });

  return newPoint;
}

export function ClusterResourcesChart({ data, isLoading }: ClusterResourcesChartProps) {
  const [metric, setMetric] = useState<'cpu' | 'memory' | 'network'>('cpu');
  const [history, dispatch] = useReducer(historyReducer, []);
  const prevMetricRef = useRef<'cpu' | 'memory' | 'network' | null>(null);
  const maxPoints = 30;

  useEffect(() => {
    if (!data?.nodes) return;

    const prevMetric = prevMetricRef.current;

    if (prevMetric !== null && prevMetric !== metric) {
      const newPoint = createHistoryPoint(data, metric);
      dispatch({ type: 'RESET', point: newPoint });
    } else {
      const newPoint = createHistoryPoint(data, metric);
      dispatch({ type: 'APPEND', point: newPoint, maxPoints });
    }

    prevMetricRef.current = metric;
  }, [data, metric, maxPoints]);

  if (isLoading || !data) {
    return (
      <Card className="group relative overflow-hidden border-border/80 bg-card shadow-sm dark:border-border/50 lg:col-span-2">
        <CardHeader className="relative pb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/30">
                  <Waves className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                  <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-primary-200/50 dark:ring-primary-800/50" />
                </div>
                Cluster Resources
              </CardTitle>
              <CardDescription>Real-time resource utilization</CardDescription>
            </div>
            <Skeleton className="h-8 w-20 rounded-full" />
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
    );
  }

  const getMetricLabel = () => {
    switch (metric) {
      case 'cpu': return 'CPU Usage (%)';
      case 'memory': return 'Memory Usage (%)';
      case 'network': return 'Network I/O (MB)';
    }
  };

  const getUnit = () => {
    switch (metric) {
      case 'cpu':
      case 'memory': return '%';
      case 'network': return 'MB';
    }
  };

  const getYDomain = (): [number, number | 'auto'] => {
    if (metric === 'cpu' || metric === 'memory') return [0, 100];
    return [0, 'auto'];
  };

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
                  Real-time metrics
                </p>
              </div>
            </CardTitle>
            <CardDescription className="ml-11">
              <Badge variant="outline" className="border-primary-200/50 bg-primary-50/50 text-primary-700 dark:border-primary-900/50 dark:bg-primary-950/50 dark:text-primary-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-500" />
                </span>
                <span className="ml-1.5 font-semibold">Live</span>
              </Badge>
              <span className="mt-1 block text-xs text-muted-foreground">
                {data.onlineCount} of {data.nodes.length} nodes online
              </span>
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            value={metric}
            onValueChange={(v) => v && setMetric(v as typeof metric)}
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
      </CardHeader>
      <CardContent>
        <div className="relative h-72 overflow-hidden rounded-xl border border-border bg-card dark:bg-surface-1/50">
          <div className="absolute inset-0 bg-surface-2/20" />
          <div className="relative h-full">
            {history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
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
                                {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
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
                    formatter={(value) => (
                      <span className="text-xs font-medium text-foreground dark:text-muted-foreground">
                        {value.replace(/_/g, ' ')}
                      </span>
                    )}
                  />
                  {data.nodes.map((node, index) => {
                    const key = node.nodeName.replace(/\s+/g, '_');
                    return (
                      <Line
                        key={node.nodeId}
                        type="monotone"
                        dataKey={key}
                        name={node.nodeName}
                        stroke={node.isOnline ? COLORS[index % COLORS.length] : 'hsl(var(--muted-foreground))'}
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
                    Collecting metrics...
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
          <div className="flex items-center gap-4">
            <span className="font-semibold text-foreground dark:text-zinc-300">
              {getMetricLabel()}
            </span>
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
                RX: {data.avgNetworkRx.toFixed(1)} MB | TX: {data.avgNetworkTx.toFixed(1)} MB
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            <span className="font-medium">Updates every 5s</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
