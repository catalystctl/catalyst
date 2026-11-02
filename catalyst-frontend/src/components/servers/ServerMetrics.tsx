import { useTranslation } from 'react-i18next';
import { BracketLabel, Meter, Segmented, StatusLed } from '../deck/primitives';
import { cn } from '@/lib/utils';
import {
  cpuCoresUsed,
  cpuPercentOfAllocation,
  formatCpuCores,
  resolveCpuCores,
} from '../../utils/cpu';

type Metric = {
  label: string;
  value: number;
  reading: string;
  title?: string;
};

/** Severity belongs on the reading; the meter stays a neutral glance. */
const severityClass = (value: number) =>
  value >= 90 ? 'text-danger' : value >= 75 ? 'text-warning' : undefined;

function ServerMetrics({
  cpu = 0,
  memory = 0,
  allocatedCpuCores,
  isLive = true,
}: {
  cpu?: number;
  memory?: number;
  /** Cores the server may use; CPU is per core, so the bar needs the share. */
  allocatedCpuCores?: number | null;
  isLive?: boolean;
}) {
  const { t } = useTranslation('servers');
  const cpuCores = resolveCpuCores(allocatedCpuCores);
  const cpuShare = cpuPercentOfAllocation(cpu, cpuCores);
  const metrics: Metric[] = [
    {
      label: t('metrics.labels.cpu'),
      // The bar shows the share of the allocation; the reading names the cores
      // so >100% per-core figures stop reading as an overflow.
      value: cpuShare,
      reading: t('metrics.cpuAllocation', {
        used: formatCpuCores(cpuCoresUsed(cpu, cpuCores)),
        total: formatCpuCores(cpuCores),
      }),
      title: t('metrics.cpuPercentOfCores', { percent: Math.round(cpuShare) }),
    },
    { label: t('metrics.labels.memory'), value: memory, reading: `${memory.toFixed(0)}%` },
  ];

  return (
    <div className="deck-panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
        <BracketLabel>{t('metrics.resourceUsage')}</BracketLabel>
        <span className="flex items-center gap-1.5 text-micro text-muted-foreground">
          <StatusLed tone={isLive ? 'go' : 'idle'} pulse={isLive} />
          {isLive ? t('metrics.live') : t('metrics.offline')}
        </span>
      </div>

      <div className="flex flex-col">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="flex items-center gap-3 border-b border-border/40 px-3 py-2 last:border-b-0"
          >
            <span className="type-overline w-16 shrink-0">{metric.label}</span>
            {/* Bounded at the call site: an unbounded flex-1 track renders as a
                4px hairline ~1200px long and stops reading as a proportion. */}
            <Meter value={metric.value} width="flex-1 max-w-[16rem]" />
            <Segmented
              className={cn('ml-auto min-w-[3rem] text-right', severityClass(metric.value))}
              title={metric.title}
            >
              {metric.reading}
            </Segmented>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ServerMetrics;
