import { useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocketStore } from '../stores/websocketStore';
import type { ServerMetrics as ServerMetricsType } from '../types/server';

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export function useServerMetrics(serverId?: string, allocatedMemoryMb?: number) {
  const [metrics, setMetrics] = useState<ServerMetricsType | null>(null);
  const { isConnected, subscribe, unsubscribe, onMessage } = useWebSocketStore();
  const memoryBudget = useMemo(
    () => (allocatedMemoryMb && allocatedMemoryMb > 0 ? allocatedMemoryMb : 0),
    [allocatedMemoryMb],
  );

  // Throttle metrics updates to ~4 Hz (250ms) to avoid flooding React with
  // state changes when the server is also pushing console output. Metrics
  // don't need 60fps — 4 updates/second is plenty for progress bars.
  const lastUpdateRef = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!serverId || !isConnected) return;

    subscribe(serverId);

    const unsubscribeHandler = onMessage((message) => {
      if (message.type !== 'resource_stats' || message.serverId !== serverId)
        return;

      const now = performance.now();
      if (now - lastUpdateRef.current < 250) {
        // Schedule a deferred update so the latest values aren't lost
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
          });
        }
        return;
      }
      lastUpdateRef.current = now;

      const cpuPercent = clampPercent(message.cpuPercent ?? message.cpu ?? 0);
      const memoryUsageMb = message.memoryUsageMb ?? 0;
      const memoryPercent =
        typeof message.memory === 'number'
          ? clampPercent(message.memory)
          : memoryBudget
            ? clampPercent((memoryUsageMb / memoryBudget) * 100)
            : 0;

      setMetrics({
        cpuPercent,
        memoryPercent,
        memoryUsageMb,
        networkRxBytes: message.networkRxBytes,
        networkTxBytes: message.networkTxBytes,
        diskIoMb: message.diskIoMb,
        diskUsageMb: message.diskUsageMb,
        diskTotalMb: message.diskTotalMb,
        timestamp: new Date().toISOString(),
      });
    });

    return () => {
      unsubscribeHandler();
      unsubscribe(serverId);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [serverId, isConnected, subscribe, unsubscribe, onMessage, memoryBudget]);

  return metrics;
}
