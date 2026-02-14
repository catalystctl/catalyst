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
import { Cpu, MemoryStick, Network, Waves, ArrowUpRight } from 'lucide-react';
import type { ClusterMetrics, NodeMetricData } from '@/hooks/useClusterMetrics';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface ClusterResourcesChartProps {
  data: ClusterMetrics | undefined;
  isLoading: boolean;
}

const COLORS = [
  '#0891b2',
  '#7c3aed',
  '#059669',
  '#d97706',
  '#dc2626',
  '#2563eb',
  '#db2777',
  '#65a30d',
];

interface HistoryPoint {
  time: string;
  timestamp: number;
  [key: string]: string | number;
}

export function ClusterResourcesChart({ data, isLoading }: ClusterResourcesChartProps) {
  const [metric, setMetric] = useState<'cpu' | 'memory' | 'network'>('cpu');
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const maxPoints = 30;

  useEffect(() => {
    if (!data?.nodes) return;

    const now = Date.now();
    const timeLabel = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    setHistory((prev) => {
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

      const updated = [...prev, newPoint];
      if (updated.length > maxPoints) {
        return updated.slice(-maxPoints);
      }
      return updated;
    });
  }, [data, metric]);

  useEffect(() => {
    setHistory([]);
  }, [metric]);

  if (isLoading || !data) {
    return (
      <Card className="group relative overflow-hidden border-slate-200/80 bg-gradient-to-br from-white to-slate-50/50 shadow-sm dark:border-slate-700/50 dark:from-slate-900 dark:to-slate-800/50 lg:col-span-2">
        <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgNDBWMGg0MHYyMEgwTDIwIDBoMjBMMCAgNDBWMGg2MEgwLDAgNDBWTDIweiBmaWxsPSJub25lIiBzdHJva2Utd2lkdGg9IiNlNWU1ZTdlNyIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48L3JlY3Q+PHJlY3Qgd2lkdGg9iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQiIG9wYWNpdHk9IjAuMDIiLz4vc3ZnPg==')] opacity-50 dark:opacity-20" />
        <CardHeader className="relative pb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-950/50 dark:to-violet-900/30">
                  <Waves className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-violet-200/50 dark:ring-violet-800/50" />
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
      case 'cpu':
        return 'CPU Usage (%)';
      case 'memory':
        return 'Memory Usage (%)';
      case 'network':
        return 'Network I/O (MB)';
    }
  };

  const getUnit = () => {
    switch (metric) {
      case 'cpu':
      case 'memory':
        return '%';
      case 'network':
        return 'MB';
    }
  };

  const getYDomain = () => {
    if (metric === 'cpu' || metric === 'memory') return [0, 100];
    return [0, 'auto'];
  };

  return (
    <Card className="group relative overflow-hidden border-slate-200/80 bg-gradient-to-br from-white to-slate-50/50 shadow-sm transition-all hover:shadow-md dark:border-slate-700/50 dark:from-slate-900 dark:to-slate-800/50 lg:col-span-2">
      <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgNDBWMGg0MHYyMEgwTDIwIDBoMjBMMCAgNDBWMGg2MEgwLDAgNDBWTDIweiBmaWxsPSJub25lIiBzdHJva2Utd2lkdGg9IiNlNWU1ZTdlNyIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48L3JlY3Q+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkZSIgb3BhY2l0eT0iMC4wMiIvPjwvc3ZnPg==')] opacity-50 dark:opacity-20" />
      <CardHeader className="relative pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2.5">
              <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-950/50 dark:to-violet-900/30">
                <Waves className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-violet-200/50 dark:ring-violet-800/50" />
              </div>
              <div>
                <span>Cluster Resources</span>
                <p className="text-sm font-normal text-slate-600 dark:text-slate-400">
                  Real-time metrics
                </p>
              </div>
            </CardTitle>
            <CardDescription className="ml-11">
              <Badge
                variant="outline"
                className="border-violet-200/50 bg-violet-50/50 text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/50 dark:text-violet-400"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
                </span>
                <span className="ml-1.5 font-semibold">Live</span>
              </Badge>
              <span className="mt-1 block text-xs text-slate-600 dark:text-slate-400">
                {data.onlineCount} of {data.nodes.length} nodes online
              </span>
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            value={metric}
            onValueChange={(v) => v && setMetric(v as typeof metric)}
            className="border border-slate-200 dark:border-slate-700"
          >
            <ToggleGroupItem
              value="cpu"
              className="gap-1.5 px-3 data-[state=on]:bg-violet-100 data-[state=on]:text-violet-700 dark:data-[state=on]:bg-violet-900/30 dark:data-[state=on]:text-violet-400"
            >
              <Cpu className="h-4 w-4" />
              <span className="hidden sm:inline">CPU</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="memory"
              className="gap-1.5 px-3 data-[state=on]:bg-violet-100 data-[state=on]:text-violet-700 dark:data-[state=on]:bg-violet-900/30 dark:data-[state=on]:text-violet-400"
            >
              <MemoryStick className="h-4 w-4" />
              <span className="hidden sm:inline">Memory</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="network"
              className="gap-1.5 px-3 data-[state=on]:bg-violet-100 data-[state=on]:text-violet-700 dark:data-[state=on]:bg-violet-900/30 dark:data-[state=on]:text-violet-400"
            >
              <Network className="h-4 w-4" />
              <span className="hidden sm:inline">Network</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative h-72 overflow-hidden rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900/50">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-50/50 to-transparent dark:from-slate-800/20" />
          <div className="relative h-full">
            {history.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10 }}
                    className="text-slate-500"
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={getYDomain()}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => `${v}${getUnit()}`}
                    className="text-slate-500"
                    axisLine={false}
                    tickLine={false}
                    width={45}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/95">
                          <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {label}
                          </p>
                          {payload.map((entry, index) => (
                            <div key={index} className="flex items-center gap-2 text-sm">
                              <span
                                className="h-2 w-2 rounded-full shadow-sm"
                                style={{ backgroundColor: entry.color }}
                              />
                              <span className="text-slate-600 dark:text-slate-400">
                                {entry.name?.replace(/_/g, ' ')}:
                              </span>
                              <span className="font-semibold text-slate-900 dark:text-white">
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
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-400">
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
                        stroke={node.isOnline ? COLORS[index % COLORS.length] : '#94a3b8'}
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5, stroke: 'white', strokeWidth: 2 }}
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
                    <div className="absolute inset-0 -m-2 rounded-full bg-gradient-to-br from-violet-100 to-violet-200 blur-xl dark:from-violet-900 dark:to-violet-800" />
                    <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-50 to-violet-100 shadow-sm dark:from-violet-950/50 dark:to-violet-900/30">
                      <Waves className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-400">
                    Collecting metrics...
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
          <div className="flex items-center gap-4">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {getMetricLabel()}
            </span>
            {metric === 'cpu' && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Avg: {data.totalCpu}%
              </span>
            )}
            {metric === 'memory' && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Avg: {data.totalMemory}%
              </span>
            )}
            {metric === 'network' && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                RX: {data.avgNetworkRx.toFixed(1)} MB | TX: {data.avgNetworkTx.toFixed(1)} MB
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="font-medium">Updates every 5s</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
