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
  metricsHistory,
  metricsTimeRange,
  onMetricsTimeRangeChange,
}: Props) {
  const cpu = liveMetrics?.cpuPercent ?? serverCpuPercent ?? 0;
  const memory = liveMetrics?.memoryPercent ?? serverMemoryPercent ?? 0;
  const memUsed = liveMetrics?.memoryUsageMb;
  const diskUsed = liveMetrics?.diskUsageMb;
  const diskTotal = liveMetrics?.diskTotalMb || allocatedDiskMb;

  return (
    <div className="space-y-4">
      <TabHeader
        icon={BarChart3}
        title="Metrics"
        description={
          isConnected
            ? [
                memUsed != null ? `${memUsed} MB RAM` : null,
                diskUsed != null && diskTotal ? `${diskUsed}/${diskTotal} MB disk` : null,
                liveMetrics?.networkRxBytes != null ? `RX ${formatBytes(liveMetrics.networkRxBytes)}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Live resource usage.'
            : 'Agent offline. Showing last known values.'
        }
        actions={
          <MetricsTimeRangeSelector
            selectedRange={metricsTimeRange}
            onRangeChange={onMetricsTimeRangeChange}
          />
        }
      />

      <ServerMetrics cpu={cpu} memory={memory} />

      <ServerMetricsTrends
        history={metricsHistory?.history ?? []}
        latest={metricsHistory?.latest ?? null}
        allocatedMemoryMb={allocatedMemoryMb}
        timeRangeLabel={metricsTimeRange.label}
      />
    </div>
  );
}
