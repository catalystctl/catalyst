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
        })
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
        onlineNodes.reduce((sum, n) => sum + n.networkRx, 0) / Math.max(1, onlineNodes.length)
      );
      const avgNetworkTx = Math.round(
        onlineNodes.reduce((sum, n) => sum + n.networkTx, 0) / Math.max(1, onlineNodes.length)
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
