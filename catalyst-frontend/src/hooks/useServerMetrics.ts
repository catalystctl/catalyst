/**
 * SSE-based real-time server metrics hook.
 *
 * Connects to /api/servers/:serverId/metrics/stream and returns
 * resource_stats events (CPU, memory, disk, network).
 *
 * Throttled to ~4 Hz to avoid flooding React state.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createServerEventsStream, type ServerEventType } from '../services/api/server-events';
import type { ServerMetrics as ServerMetricsType } from '../types/server';

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const UPDATE_THROTTLE_MS = 250;

export function useServerMetrics(serverId?: string, allocatedMemoryMb?: number) {
  const [metrics, setMetrics] = useState<ServerMetricsType | null>(null);

  const memoryBudget = useMemo(
    () => (allocatedMemoryMb && allocatedMemoryMb > 0 ? allocatedMemoryMb : 0),
    [allocatedMemoryMb],
  );

  const lastUpdateRef = useRef(0);
  const rafRef = useRef<number>(0);
  const pendingDataRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!serverId) return;

    const disconnect = createServerEventsStream(
      serverId,
      (type: ServerEventType, data: Record<string, unknown>) => {
        if (type !== 'resource_stats' || String(data.serverId) !== serverId) return;

        const applyMetrics = (d: Record<string, unknown>) => {
          const cpuPercent = clampPercent(Number(d.cpuPercent ?? d.cpu ?? 0));
          const memoryUsageMb = Number(d.memoryUsageMb ?? 0);
          const memoryPercent =
            typeof d.memory === 'number'
              ? clampPercent(d.memory)
              : memoryBudget
                ? clampPercent((memoryUsageMb / memoryBudget) * 100)
                : 0;

          setMetrics({
            cpuPercent,
            memoryPercent,
            memoryUsageMb,
            networkRxBytes: Number(d.networkRxBytes ?? 0),
            networkTxBytes: Number(d.networkTxBytes ?? 0),
            diskIoMb: Number(d.diskIoMb ?? 0),
            diskUsageMb: Number(d.diskUsageMb ?? 0),
            diskTotalMb: Number(d.diskTotalMb ?? 0),
            timestamp: new Date().toISOString(),
          });
        };

        const now = performance.now();
        if (now - lastUpdateRef.current < UPDATE_THROTTLE_MS) {
          pendingDataRef.current = data;
          if (!rafRef.current) {
            rafRef.current = requestAnimationFrame(() => {
              rafRef.current = 0;
              if (pendingDataRef.current) {
                applyMetrics(pendingDataRef.current);
                lastUpdateRef.current = performance.now();
                pendingDataRef.current = null;
              }
            });
          }
          return;
        }
        lastUpdateRef.current = now;
        applyMetrics(data);
      },
      () => {},
    );

    return () => {
      disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [serverId, memoryBudget]);

  return metrics;
}
