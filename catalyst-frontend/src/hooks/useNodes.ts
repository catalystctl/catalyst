import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { nodesApi } from '../services/api/nodes';

export function useNodes() {
  return useQuery({
    queryKey: qk.nodes(),
    queryFn: nodesApi.list,
    refetchInterval: 30000,
  });
}

export function useAccessibleNodes() {
  return useQuery({
    queryKey: qk.accessibleNodes(),
    queryFn: async () => {
      const response = await fetch('/api/nodes/accessible', {
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      return {
        nodes: data.data || [],
        hasWildcard: data.hasWildcard || false,
      };
    },
  });
}

export function useNode(nodeId?: string) {
  return useQuery({
    queryKey: qk.node(nodeId!),
    queryFn: () => (nodeId ? nodesApi.get(nodeId) : Promise.reject(new Error('missing node id'))),
    enabled: Boolean(nodeId),
  });
}

export function useNodeStats(nodeId?: string) {
  return useQuery({
    queryKey: qk.nodeStats(nodeId!),
    queryFn: () => (nodeId ? nodesApi.stats(nodeId) : Promise.reject(new Error('missing node id'))),
    enabled: Boolean(nodeId),
    refetchInterval: 10000,
  });
}

export function useNodeMetrics(nodeId?: string) {
  return useQuery({
    queryKey: qk.nodeMetrics(nodeId!),
    queryFn: () =>
      nodeId ? nodesApi.metrics(nodeId, { hours: 1, limit: 60 }) : Promise.reject(new Error('missing node id')),
    enabled: Boolean(nodeId),
    refetchInterval: 30000,
  });
}
