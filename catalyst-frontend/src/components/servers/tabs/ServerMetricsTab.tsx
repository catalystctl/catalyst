import ServerMetrics from '../ServerMetrics';
import ServerMetricsTrends from '../ServerMetricsTrends';
import MetricsTimeRangeSelector from '../MetricsTimeRangeSelector';
import type { MetricsTimeRange } from '../../../hooks/useServerMetricsHistory';
import ServerTabCard from './ServerTabCard';
import StatGrid from './StatGrid';

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
  latest?: {
    networkRxBytes?: number;
    networkTxBytes?: number;
  } | null;
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
  const liveDiskUsageMb = liveMetrics?.diskUsageMb;
  const liveDiskTotalMb = liveMetrics?.diskTotalMb;
  const liveDiskIoMb = liveMetrics?.diskIoMb;
  const diskPercent =
    liveDiskUsageMb != null && (liveDiskTotalMb || allocatedDiskMb)
      ? Math.min(
          100,
          (liveDiskUsageMb / (liveDiskTotalMb || allocatedDiskMb)) * 100,
        )
      : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ServerMetrics cpu={cpu} memory={memory} />
        <ServerTabCard className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-foreground">
              Live snapshot
            </div>
            <div
              className={`flex items-center gap-2 text-xs ${
                isConnected ? 'text-success' : 'text-muted-foreground'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isConnected ? 'bg-success' : 'bg-muted-foreground'
                }`}
              />
              {isConnected ? 'Live' : 'Offline'}
            </div>
          </div>
          <StatGrid
            columns={2}
            items={[
              {
                label: 'Memory used',
                value: liveMetrics?.memoryUsageMb
                  ? `${liveMetrics.memoryUsageMb} MB`
                  : 'n/a',
              },
              {
                label: 'Disk usage',
                value:
                  liveDiskUsageMb != null && (liveDiskTotalMb || allocatedDiskMb)
                    ? `${liveDiskUsageMb} / ${liveDiskTotalMb || allocatedDiskMb} MB${
                        diskPercent != null ? ` (${diskPercent.toFixed(0)}%)` : ''
                      }`
                    : 'n/a',
              },
              {
                label: 'Disk IO (last tick)',
                value: liveDiskIoMb != null ? `${liveDiskIoMb} MB` : 'n/a',
              },
              {
                label: 'Network RX',
                value: (() => {
                  // Use the last history point's rate (MB/s) if available
                  const lastPoint = metricsHistory?.history?.[metricsHistory.history.length - 1];
                  const rate = lastPoint?.networkRxBytes;
                  if (rate != null && typeof rate === 'number') return `${rate.toFixed(2)} MB/s`;
                  return 'n/a';
                })(),
              },
              {
                label: 'Network TX',
                value: (() => {
                  const lastPoint = metricsHistory?.history?.[metricsHistory.history.length - 1];
                  const rate = lastPoint?.networkTxBytes;
                  if (rate != null && typeof rate === 'number') return `${rate.toFixed(2)} MB/s`;
                  return 'n/a';
                })(),
              },
            ]}
          />
        </ServerTabCard>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 transition-all duration-300 hover:border-primary/30">
        <div className="text-sm font-semibold text-foreground">
          Historical metrics
        </div>
        <MetricsTimeRangeSelector
          selectedRange={metricsTimeRange}
          onRangeChange={onMetricsTimeRangeChange}
        />
      </div>
      <ServerMetricsTrends
        history={metricsHistory?.history ?? []}
        latest={metricsHistory?.latest ?? null}
        allocatedMemoryMb={allocatedMemoryMb}
        timeRangeLabel={metricsTimeRange.label}
      />
    </div>
  );
}
