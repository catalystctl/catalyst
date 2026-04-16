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

  useEffect(() => {
    if (!serverId) return;

    const disconnect = createServerEventsStream(
      serverId,
      (type: ServerEventType, data: Record<string, unknown>) => {
        if (type !== 'resource_stats' || String(data.serverId) !== serverId) return;

        const now = performance.now();
        if (now - lastUpdateRef.current < UPDATE_THROTTLE_MS) {
          if (!rafRef.current) {
            rafRef.current = requestAnimationFrame(() => {
              rafRef.current = 0;
            });
          }
          return;
        }
        lastUpdateRef.current = now;

        const cpuPercent = clampPercent(Number(data.cpuPercent ?? data.cpu ?? 0));
        const memoryUsageMb = Number(data.memoryUsageMb ?? 0);
        const memoryPercent =
          typeof data.memory === 'number'
            ? clampPercent(data.memory)
            : memoryBudget
              ? clampPercent((memoryUsageMb / memoryBudget) * 100)
              : 0;

        setMetrics({
          cpuPercent,
          memoryPercent,
          memoryUsageMb,
          networkRxBytes: String(data.networkRxBytes ?? ''),
          networkTxBytes: String(data.networkTxBytes ?? ''),
          diskIoMb: Number(data.diskIoMb ?? 0),
          diskUsageMb: Number(data.diskUsageMb ?? 0),
          diskTotalMb: Number(data.diskTotalMb ?? 0),
          timestamp: new Date().toISOString(),
        });
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
