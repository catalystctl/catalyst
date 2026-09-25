import { useTranslation } from 'react-i18next';
import { BracketLabel, Meter, Segmented, StatusLed } from '../deck/primitives';
import { cn } from '@/lib/utils';

type Metric = {
  label: string;
  value: number;
};

/** Severity belongs on the reading; the meter stays a neutral glance. */
const severityClass = (value: number) =>
  value >= 90 ? 'text-danger' : value >= 75 ? 'text-warning' : undefined;

function ServerMetrics({ cpu = 0, memory = 0, isLive = true }: { cpu?: number; memory?: number; isLive?: boolean }) {
  const { t } = useTranslation('servers');
  const metrics: Metric[] = [
    { label: t('metrics.labels.cpu'), value: cpu },
    { label: t('metrics.labels.memory'), value: memory },
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
            <Meter value={metric.value} width="flex-1" />
            <Segmented className={cn('min-w-[3rem] text-right', severityClass(metric.value))}>
              {metric.value.toFixed(0)}%
            </Segmented>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ServerMetrics;
