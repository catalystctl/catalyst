/**
 * SSE-based real-time server metrics hook.
 *
 * Uses the dedicated /api/servers/:serverId/metrics/stream endpoint
 * (shared EventSource hub) and returns resource_stats (CPU, memory, disk, network).
 *
 * Throttled to ~4 Hz to avoid flooding React state.
 *
 * The metrics stream's connection status is surfaced alongside the payload
 * (audit F10/P1.8): consumers must not label usage "live" from the console
 * socket while this stream is down, or vice versa.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createServerMetricsStream,
  type ServerEventType,
  type StreamStatus,
} from '../services/api/server-events';
import { serversApi } from '../services/api/servers';
import type { ServerMetrics as ServerMetricsType } from '../types/server';

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
// CPU is normalized against allocated cores backend-side (100 per core), so a
// multi-core server legitimately reports >100%. Keep the raw value for the
// numeric label; the gauge bar itself still caps at 100% width.
const clampCpu = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
const UPDATE_THROTTLE_MS = 250;
/** P1-17: REST stats poll cadence while the metrics stream is not connected. */
const FALLBACK_POLL_MS = 30_000;

export function useServerMetrics(serverId?: string, allocatedMemoryMb?: number) {
  const [metrics, setMetrics] = useState<ServerMetricsType | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');

  const memoryBudget = useMemo(
    () => (allocatedMemoryMb && allocatedMemoryMb > 0 ? allocatedMemoryMb : 0),
    [allocatedMemoryMb],
  );

  const lastUpdateRef = useRef(0);
  const rafRef = useRef<number>(0);
  const pendingDataRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!serverId) return;

    const disconnect = createServerMetricsStream(
      serverId,
      (type: ServerEventType, data: Record<string, unknown>) => {
        if (type !== 'resource_stats') return;
        // metrics/stream may omit serverId; accept either match or missing
        if (data.serverId != null && String(data.serverId) !== serverId) return;

        const applyMetrics = (d: Record<string, unknown>) => {
          const cpuPercent = clampCpu(Number(d.cpuPercent ?? d.cpu ?? 0));
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
      // Surface the metrics stream's own status (F10) — not the console's.
      setStatus,
    );

    return () => {
      disconnect();
      // No stream for this key any more — never claim "live" off a dead socket.
      setStatus('closed');
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [serverId, memoryBudget]);

  // P1-17: REST fallback — while the SSE metrics stream is not connected the
  // gauges would freeze at their last value (or stay empty). Poll the stats
  // snapshot endpoint instead; it maps onto the same metrics state. `status`
  // is left untouched so consumers can still tell the reading is not live.
  useEffect(() => {
    if (!serverId || status === 'connected') return;
    let cancelled = false;

    const poll = async () => {
      try {
        const d = await serversApi.stats(serverId);
        if (cancelled || !d || typeof d.cpuPercent !== 'number') return;
        const memoryUsageMb = Number(d.memoryUsageMb ?? 0);
        setMetrics({
          cpuPercent: clampCpu(Number(d.cpuPercent)),
          memoryPercent: clampPercent(
            typeof d.memoryPercentage === 'number'
              ? d.memoryPercentage
              : memoryBudget
                ? (memoryUsageMb / memoryBudget) * 100
                : 0,
          ),
          memoryUsageMb,
          networkRxBytes: Number(d.networkRxBytes ?? 0),
          networkTxBytes: Number(d.networkTxBytes ?? 0),
          diskIoMb: Number(d.diskIoMb ?? 0),
          diskUsageMb: Number(d.diskUsageMb ?? 0),
          // Stats response carries no disk total; consumers fall back to
          // allocatedDiskMb when it is absent.
          timestamp: d.timestamp ? String(d.timestamp) : new Date().toISOString(),
        });
      } catch {
        // Best-effort fallback; the next tick retries.
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), FALLBACK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [serverId, status, memoryBudget]);

  return { metrics, status } as const;
}
