import ServerMetrics from '../ServerMetrics';
import ServerMetricsTrends from '../ServerMetricsTrends';
import MetricsTimeRangeSelector from '../MetricsTimeRangeSelector';
import type { MetricsTimeRange } from '../../../hooks/useServerMetricsHistory';
import type { ServerMetricsPoint } from '../../../types/server';
import ServerTabCard from './ServerTabCard';
import StatGrid from './StatGrid';
import TabHeader from './TabHeader';
import SectionHeader from './SectionHeader';
import { BarChart3, Activity, TrendingUp } from 'lucide-react';

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
 const liveDiskUsageMb = liveMetrics?.diskUsageMb;
 const liveDiskTotalMb = liveMetrics?.diskTotalMb;
 const liveDiskIoMb = liveMetrics?.diskIoMb;
 const diskPercent =
 liveDiskUsageMb != null && (liveDiskTotalMb || allocatedDiskMb)
 ? Math.min(100, (liveDiskUsageMb / (liveDiskTotalMb || allocatedDiskMb)) * 100)
 : null;

 return (
 <div className="space-y-4">
 {/* ── Header with live indicator ── */}
 <TabHeader
 icon={BarChart3}
 title="Metrics"
 description="Real-time and historical resource usage."
 actions={
 <div className="flex items-center gap-2">
 <span
 className={`relative flex h-2 w-2 ${isConnected ? '' : 'opacity-40'}`}
 >
 {isConnected && (
 <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/40" />
 )}
 <span className={`relative inline-flex h-2 w-2 rounded-full ${isConnected ? 'bg-success' : 'bg-muted-foreground'}`} />
 </span>
 <span className={`text-[10px] font-semibold uppercase tracking-wide ${isConnected ? 'text-success' : 'text-muted-foreground/50'}`}>
 {isConnected ? 'Live' : 'Offline'}
 </span>
 </div>
 }
 variant={isConnected ? 'success' : 'default'}
 />

 {/* ── Live metrics grid ── */}
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
 <ServerMetrics cpu={cpu} memory={memory} />
 <ServerTabCard className="lg:col-span-2">
 <SectionHeader icon={Activity} title="Live snapshot" />
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
 label: 'Disk I/O',
 value: liveDiskIoMb != null ? `${liveDiskIoMb} MB` : 'n/a',
 },
 {
 label: 'Net RX',
 value: (() => {
 const rate = liveMetrics?.networkRxBytes;
 if (rate != null && typeof rate === 'number') return `${rate.toFixed(2)} MB/s`;
 return 'n/a';
 })(),
 },
 {
 label: 'Net TX',
 value: (() => {
 const rate = liveMetrics?.networkTxBytes;
 if (rate != null && typeof rate === 'number') return `${rate.toFixed(2)} MB/s`;
 return 'n/a';
 })(),
 },
 ]}
 />
 </ServerTabCard>
 </div>

 {/* ── Historical metrics ── */}
 <ServerTabCard>
 <div className="flex items-center justify-between">
 <SectionHeader icon={TrendingUp} title="Historical" />
 <MetricsTimeRangeSelector
 selectedRange={metricsTimeRange}
 onRangeChange={onMetricsTimeRangeChange}
 />
 </div>
 </ServerTabCard>
 <ServerMetricsTrends
 history={metricsHistory?.history ?? []}
 latest={metricsHistory?.latest ?? null}
 allocatedMemoryMb={allocatedMemoryMb}
 timeRangeLabel={metricsTimeRange.label}
 />
 </div>
 );
}
