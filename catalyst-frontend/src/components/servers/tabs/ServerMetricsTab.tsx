import { useTranslation } from 'react-i18next';
import ServerMetrics from '../ServerMetrics';
import ServerMetricsTrends from '../ServerMetricsTrends';
import MetricsTimeRangeSelector from '../MetricsTimeRangeSelector';
import type { MetricsTimeRange } from '../../../hooks/useServerMetricsHistory';
import type { ServerMetricsPoint } from '../../../types/server';
import TabHeader from './TabHeader';
import { BarChart3 } from 'lucide-react';
import { formatBytes } from '../../../utils/formatters';

interface LiveMetrics {
  cpuPercent?: number;
  memoryPercent?: number;
  memoryUsageMb?: number;
  diskUsageMb?: number;
  diskTotalMb?: number;
  diskIoMb?: number;
  networkRxBytes?: number;
  networkTxBytes?: number;
}

interface MetricsHistory {
  latest?: ServerMetricsPoint | null;
  history: any[];
}

interface Props {
  serverCpuPercent: number;
  serverMemoryPercent: number;
  allocatedMemoryMb: number;
  allocatedDiskMb: number;
  liveMetrics: LiveMetrics | null;
  isConnected: boolean;
  serverStatus?: string;
  metricsHistory: MetricsHistory | undefined;
  metricsTimeRange: MetricsTimeRange;
  onMetricsTimeRangeChange: (range: MetricsTimeRange) => void;
}

export default function ServerMetricsTab({
  serverCpuPercent,
  serverMemoryPercent,
  allocatedMemoryMb,
  allocatedDiskMb,
  liveMetrics,
  isConnected,
  serverStatus,
  metricsHistory,
  metricsTimeRange,
  onMetricsTimeRangeChange,
}: Props) {
  const { t } = useTranslation('server-tabs');
  const isRunning = !serverStatus || serverStatus === 'running';
  // Offline servers must not show stale live usage from the last running tick.
  const cpu = isRunning ? (liveMetrics?.cpuPercent ?? serverCpuPercent ?? 0) : 0;
  const memory = isRunning ? (liveMetrics?.memoryPercent ?? serverMemoryPercent ?? 0) : 0;
  const memUsed = isRunning ? liveMetrics?.memoryUsageMb : undefined;
  const diskUsed = liveMetrics?.diskUsageMb;
  const diskTotal = liveMetrics?.diskTotalMb || allocatedDiskMb;
  // Live network counters are cumulative totals; per-second rates live in
  // the trends chart below (history buckets are MB/s).

  return (
    <div className="space-y-4">
      <TabHeader
        icon={BarChart3}
        title={t('tabs.metrics.title')}
        description={
          !isRunning
            ? t('tabs.metrics.serverOffline')
            : isConnected
              ? [
                  memUsed != null ? t('tabs.metrics.ram', { used: memUsed }) : null,
                  diskUsed != null && diskTotal
                    ? t('tabs.metrics.disk', { used: diskUsed, total: diskTotal })
                    : null,
                  liveMetrics?.networkRxBytes != null
                    ? t('tabs.metrics.rx', { value: formatBytes(liveMetrics.networkRxBytes) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || t('tabs.metrics.liveUsage')
              : t('tabs.metrics.agentOffline')
        }
        actions={
          <MetricsTimeRangeSelector
            selectedRange={metricsTimeRange}
            onRangeChange={onMetricsTimeRangeChange}
          />
        }
      />

      <ServerMetrics cpu={cpu} memory={memory} isLive={isRunning && isConnected} />

      <ServerMetricsTrends
        history={metricsHistory?.history ?? []}
        latest={metricsHistory?.latest ?? null}
        allocatedMemoryMb={allocatedMemoryMb}
        timeRangeLabel={metricsTimeRange.label}
      />
    </div>
  );
}
