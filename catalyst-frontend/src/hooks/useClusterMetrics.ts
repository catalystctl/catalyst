import { useQuery } from '@tanstack/react-query';
import { nodesApi } from '../services/api/nodes';
import { useAdminNodes } from './useAdmin';

export interface NodeMetricData {
  nodeId: string;
  nodeName: string;
  isOnline: boolean;
  cpu: number;
  memory: number;
  networkRx: number;
  networkTx: number;
  timestamp: string;
}

export interface NodeMetricHistoryPoint {
  nodeId: string;
  nodeName: string;
  isOnline: boolean;
  cpu: number | null;
  memory: number | null;
  networkRx: number | null;
  networkTx: number | null;
  timestamp: string;
}

export interface ClusterMetrics {
  nodes: NodeMetricData[];
  totalCpu: number;
  totalMemory: number;
  avgNetworkRx: number;
  avgNetworkTx: number;
  onlineCount: number;
  offlineCount: number;
  lastUpdated: string;
}

export interface ClusterHistoricalMetrics {
  /** Per-node history arrays (each chronologically sorted). */
  nodes: Array<{
    nodeId: string;
    nodeName: string;
    isOnline: boolean;
    history: NodeMetricHistoryPoint[];
  }>;
  /**
   * A unified timeline of data-points keyed by node name.
   * Each point stores CPU, memory, and network per node so the chart
   * component can pick the right field based on the selected metric.
   * Node keys are formatted as `{nodeName}_cpu`, `{nodeName}_memory`,
   * `{nodeName}_network` so recharts can bind them directly as `dataKey`.
   */
  timeline: ClusterTimelinePoint[];
}

export interface ClusterTimelinePoint {
  timestamp: string;
  time: string;
  [key: string]: string | number | null;
}

export type TimeRange = '1h' | '6h' | '24h' | '7d';

const TIME_RANGE_HOURS: Record<TimeRange, number> = {
  '1h': 1,
  '6h': 6,
  '24h': 24,
  '7d': 168,
};

/** Number of data-point buckets the backend should return. */
const TIME_RANGE_LIMITS: Record<TimeRange, number> = {
  '1h': 60,
  '6h': 72,
  '24h': 96,
  '7d': 168,
};

/**
 * Fetches live (latest-only) cluster metrics. Polls at `refreshInterval`.
 * Used for the live badge, summary stats, and real-time overlay.
 */
export function useClusterMetrics(refreshInterval = 5000) {
  const { data: nodesData } = useAdminNodes();
  const nodes = nodesData?.nodes ?? [];

  return useQuery({
    queryKey: ['cluster-metrics', nodes.map((n) => n.id)],
    queryFn: async (): Promise<ClusterMetrics> => {
      const nodeMetrics: NodeMetricData[] = [];

      await Promise.all(
        nodes.map(async (node) => {
          try {
            const metrics = await nodesApi.metrics(node.id, { hours: 1, limit: 1 });
            const latest = metrics?.latest;

            nodeMetrics.push({
              nodeId: node.id,
              nodeName: node.name,
              isOnline: node.isOnline,
              cpu: latest?.cpuPercent ?? 0,
              memory: latest?.memoryTotalMb
                ? Math.round((latest.memoryUsageMb / latest.memoryTotalMb) * 100)
                : 0,
              networkRx: parseInt(latest?.networkRxBytes ?? '0') / (1024 * 1024),
              networkTx: parseInt(latest?.networkTxBytes ?? '0') / (1024 * 1024),
              timestamp: latest?.timestamp ?? new Date().toISOString(),
            });
          } catch {
            nodeMetrics.push({
              nodeId: node.id,
              nodeName: node.name,
              isOnline: false,
              cpu: 0,
              memory: 0,
              networkRx: 0,
              networkTx: 0,
              timestamp: new Date().toISOString(),
            });
          }
        }),
      );

      const onlineNodes = nodeMetrics.filter((n) => n.isOnline);
      const totalCpu =
        onlineNodes.length > 0
          ? Math.round(onlineNodes.reduce((sum, n) => sum + n.cpu, 0) / onlineNodes.length)
          : 0;
      const totalMemory =
        onlineNodes.length > 0
          ? Math.round(onlineNodes.reduce((sum, n) => sum + n.memory, 0) / onlineNodes.length)
          : 0;
      const avgNetworkRx = Math.round(
        onlineNodes.reduce((sum, n) => sum + n.networkRx, 0) / Math.max(1, onlineNodes.length),
      );
      const avgNetworkTx = Math.round(
        onlineNodes.reduce((sum, n) => sum + n.networkTx, 0) / Math.max(1, onlineNodes.length),
      );

      return {
        nodes: nodeMetrics,
        totalCpu,
        totalMemory,
        avgNetworkRx,
        avgNetworkTx,
        onlineCount: onlineNodes.length,
        offlineCount: nodeMetrics.length - onlineNodes.length,
        lastUpdated: new Date().toISOString(),
      };
    },
    refetchInterval: refreshInterval,
    staleTime: refreshInterval / 2,
    enabled: nodes.length > 0,
  });
}

/**
 * Fetches historical cluster metrics for a given time range.
 * Returns per-node histories and a unified timeline with keys
 * `{nodeName}_cpu`, `{nodeName}_memory`, `{nodeName}_network`
 * so recharts can bind the right `dataKey` per selected metric.
 */
export function useClusterHistoricalMetrics(range: TimeRange = '1h') {
  const { data: nodesData } = useAdminNodes();
  const nodes = nodesData?.nodes ?? [];

  return useQuery({
    queryKey: ['cluster-historical-metrics', range, nodes.map((n) => n.id)],
    queryFn: async (): Promise<ClusterHistoricalMetrics> => {
      const hours = TIME_RANGE_HOURS[range];
      const limit = TIME_RANGE_LIMITS[range];

      const nodeResults = await Promise.all(
        nodes.map(async (node) => {
          try {
            const metrics = await nodesApi.metrics(node.id, { hours, limit });
            const history: NodeMetricHistoryPoint[] = (metrics?.history ?? []).map((p) => ({
              nodeId: node.id,
              nodeName: node.name,
              isOnline: node.isOnline,
              cpu: p.cpuPercent,
              memory: p.memoryTotalMb
                ? Math.round((p.memoryUsageMb / p.memoryTotalMb) * 100)
                : null,
              networkRx: parseInt(p.networkRxBytes ?? '0') / (1024 * 1024),
              networkTx: parseInt(p.networkTxBytes ?? '0') / (1024 * 1024),
              timestamp: p.timestamp,
            }));
            return {
              nodeId: node.id,
              nodeName: node.name,
              isOnline: node.isOnline,
              history,
            };
          } catch {
            return {
              nodeId: node.id,
              nodeName: node.name,
              isOnline: false,
              history: [],
            };
          }
        }),
      );

      // Build a unified timeline by bucketing all node histories together.
      const bucketSeconds = (() => {
        const totalSeconds = hours * 3600;
        return Math.ceil(totalSeconds / Math.max(1, limit));
      })();

      const timestampMap = new Map<string, ClusterTimelinePoint>();

      for (const nodeResult of nodeResults) {
        const nodeKey = nodeResult.nodeName.replace(/\s+/g, '_');
        for (const point of nodeResult.history) {
          const ts = new Date(point.timestamp);
          const bucketMs =
            Math.round(ts.getTime() / (bucketSeconds * 1000)) * bucketSeconds * 1000;
          const bucketKey = new Date(bucketMs).toISOString();

          if (!timestampMap.has(bucketKey)) {
            timestampMap.set(bucketKey, {
              timestamp: bucketKey,
              time: new Date(bucketMs).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                ...(range === '1h' ? { second: '2-digit' } : {}),
                ...(range === '7d' ? { month: 'short', day: 'numeric' } : {}),
              }),
            });
          }

          const entry = timestampMap.get(bucketKey)!;
          // Store all three metrics so the chart can pick the right one
          entry[`${nodeKey}_cpu`] = nodeResult.isOnline ? point.cpu : null;
          entry[`${nodeKey}_memory`] = nodeResult.isOnline ? point.memory : null;
          entry[`${nodeKey}_network`] = nodeResult.isOnline
            ? Math.round((point.networkRx ?? 0) + (point.networkTx ?? 0))
            : null;
        }
      }

      const timeline = Array.from(timestampMap.values()).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      return { nodes: nodeResults, timeline };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: nodes.length > 0,
  });
}
