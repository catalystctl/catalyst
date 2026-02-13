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
import { Cpu, MemoryStick, Network } from 'lucide-react';
import type { ClusterMetrics, NodeMetricData } from '@/hooks/useClusterMetrics';
import { useState, useEffect, useRef } from 'react';

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
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Cluster Resources</CardTitle>
              <CardDescription>Real-time resource utilization</CardDescription>
            </div>
            <Skeleton className="h-6 w-20" />
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
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
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              Cluster Resources
              <Badge variant="secondary" className="gap-1 font-normal">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Live
              </Badge>
            </CardTitle>
            <CardDescription>
              {data.onlineCount} of {data.nodes.length} nodes online
            </CardDescription>
          </div>
          <ToggleGroup type="single" value={metric} onValueChange={(v) => v && setMetric(v as typeof metric)} className="border border-slate-200 dark:border-slate-700">
            <ToggleGroupItem value="cpu" className="gap-1.5 px-3 data-[state=on]:bg-primary-100 data-[state=on]:text-primary-700 dark:data-[state=on]:bg-primary-900/30 dark:data-[state=on]:text-primary-400">
              <Cpu className="h-4 w-4" />
              <span className="hidden sm:inline">CPU</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="memory" className="gap-1.5 px-3 data-[state=on]:bg-primary-100 data-[state=on]:text-primary-700 dark:data-[state=on]:bg-primary-900/30 dark:data-[state=on]:text-primary-400">
              <MemoryStick className="h-4 w-4" />
              <span className="hidden sm:inline">Memory</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="network" className="gap-1.5 px-3 data-[state=on]:bg-primary-100 data-[state=on]:text-primary-700 dark:data-[state=on]:bg-primary-900/30 dark:data-[state=on]:text-primary-400">
              <Network className="h-4 w-4" />
              <span className="hidden sm:inline">Network</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-72">
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
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                        <p className="mb-2 text-xs font-medium text-slate-500">{label}</p>
                        {payload.map((entry, index) => (
                          <div key={index} className="flex items-center gap-2 text-sm">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: entry.color }}
                            />
                            <span className="text-slate-600 dark:text-slate-400">
                              {entry.name?.replace(/_/g, ' ')}:
                            </span>
                            <span className="font-medium text-slate-900 dark:text-white">
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
                    <span className="text-xs text-slate-600 dark:text-slate-400">
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
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      strokeDasharray={node.isOnline ? undefined : '5 5'}
                      connectNulls
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Collecting metrics data...
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">
          <div className="flex items-center gap-4">
            <span className="font-medium">{getMetricLabel()}</span>
            {metric === 'cpu' && <span>Avg: {data.totalCpu}%</span>}
            {metric === 'memory' && <span>Avg: {data.totalMemory}%</span>}
            {metric === 'network' && (
              <span>
                RX: {data.avgNetworkRx.toFixed(1)} MB | TX: {data.avgNetworkTx.toFixed(1)} MB
              </span>
            )}
          </div>
          <span>Updates every 5s</span>
        </div>
      </CardContent>
    </Card>
  );
}
