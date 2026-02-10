import { useQuery } from '@tanstack/react-query';
import { nodesApi } from '../services/api/nodes';

export function useNodes() {
  return useQuery({
    queryKey: ['nodes'],
    queryFn: nodesApi.list,
  });
}

export function useAccessibleNodes() {
  return useQuery({
    queryKey: ['nodes', 'accessible'],
    queryFn: nodesApi.getAccessibleNodes,
  });
}

export function useNode(nodeId?: string) {
  return useQuery({
    queryKey: ['node', nodeId],
    queryFn: () => (nodeId ? nodesApi.get(nodeId) : Promise.reject(new Error('missing node id'))),
    enabled: Boolean(nodeId),
  });
}

export function useNodeStats(nodeId?: string) {
  return useQuery({
    queryKey: ['node-stats', nodeId],
    queryFn: () => (nodeId ? nodesApi.stats(nodeId) : Promise.reject(new Error('missing node id'))),
    enabled: Boolean(nodeId),
    refetchInterval: 10000,
  });
}

export function useNodeMetrics(nodeId?: string) {
  return useQuery({
    queryKey: ['node-metrics', nodeId],
    queryFn: () =>
      nodeId ? nodesApi.metrics(nodeId, { hours: 1, limit: 60 }) : Promise.reject(new Error('missing node id')),
    enabled: Boolean(nodeId),
    refetchInterval: 30000,
  });
}
