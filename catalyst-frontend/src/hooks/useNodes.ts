import { useQuery } from '@tanstack/react-query';
import { qk } from '../lib/queryKeys';
import { nodesApi } from '../services/api/nodes';
import { reportSystemError } from '../services/api/systemErrors';

export function useNodes() {
  return useQuery({
    queryKey: qk.nodes(),
    queryFn: nodesApi.list,
    refetchInterval: 15000,
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
    refetchInterval: 15000,
  });
}

export function useNode(nodeId?: string) {
  return useQuery({
    queryKey: qk.node(nodeId!),
    queryFn: () => {
      if (nodeId) return nodesApi.get(nodeId);
      reportSystemError({ level: 'error', component: 'useNodes', message: 'missing node id', metadata: { context: 'useNode query' } });
      return Promise.reject(new Error('missing node id'));
    },
    enabled: Boolean(nodeId),
    refetchInterval: 10000,
  });
}

export function useNodeStats(nodeId?: string) {
  return useQuery({
    queryKey: qk.nodeStats(nodeId!),
    queryFn: () => {
      if (nodeId) return nodesApi.stats(nodeId);
      reportSystemError({ level: 'error', component: 'useNodes', message: 'missing node id', metadata: { context: 'useNodeStats query' } });
      return Promise.reject(new Error('missing node id'));
    },
    enabled: Boolean(nodeId),
    refetchInterval: 10000,
  });
}

export function useNodeMetrics(nodeId?: string) {
  return useQuery({
    queryKey: qk.nodeMetrics(nodeId!),
    queryFn: () => {
      if (nodeId) return nodesApi.metrics(nodeId, { hours: 1, limit: 60 });
      reportSystemError({ level: 'error', component: 'useNodes', message: 'missing node id', metadata: { context: 'useNodeMetrics query' } });
      return Promise.reject(new Error('missing node id'));
    },
    enabled: Boolean(nodeId),
    refetchInterval: 15000,
  });
}
