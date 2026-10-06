import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatDateTime, formatRelativeTime } from '@/i18n/format';
import { useDataFreshness } from '@/hooks/useDataFreshness';
import { StatusLed } from '../deck/primitives';

/**
 * Shell freshness chip — "when was this data last refreshed, and is the live
 * stream healthy?" (REALTIME_AUDIT.md §6).
 *
 * All state lives in the shared `useDataFreshness` hook: cache-wide newest
 * `dataUpdatedAt`, worst-wins aggregate of every shared EventSource, and an
 * adaptive ticker. Desktop shows the full reading; on narrow screens the chip
 * collapses to just the status LED (the aria-label/title keep the full text).
 */
type LiveTone = 'go' | 'hazard' | 'alarm';

function toneFor(status: string): LiveTone {
  if (status === 'connected') return 'go';
  if (status === 'error' || status === 'closed') return 'alarm';
  return 'hazard';
}

export default function DataFreshness() {
  const { t } = useTranslation('layout');
  const { updatedAt, streamStatus, isFetching, now } = useDataFreshness();

  const never = updatedAt === 0;
  const liveLabel = t(
    streamStatus === 'connected'
      ? 'shell.live'
      : streamStatus === 'error' || streamStatus === 'closed'
        ? 'shell.offline'
        : 'shell.reconnecting',
  );
  const freshnessLabel = never
    ? t('shell.lastRefreshedNever')
    : t('shell.lastRefreshed', { when: formatRelativeTime(updatedAt, now) });
  const refreshSuffix = isFetching ? ` · ${t('shell.refreshing')}` : '';
  const label = `${freshnessLabel} · ${liveLabel}${refreshSuffix}`;
  const absolute = never
    ? ''
    : formatDateTime(updatedAt, { dateStyle: 'medium', timeStyle: 'medium' });
  const tooltip = absolute ? `${label} · ${absolute}` : label;
  const tone = toneFor(streamStatus);

  return (
    <span
      className="flex h-7 shrink-0 items-center gap-2 rounded-sm border border-border/70 bg-card px-2 font-mono text-micro tabular-nums text-muted-foreground shadow-panel sm:px-2.5"
      aria-label={label}
      title={tooltip}
    >
      <StatusLed tone={tone} pulse={isFetching || streamStatus === 'connected'} />
      <span className="hidden whitespace-nowrap sm:inline">{freshnessLabel}</span>
      <span className="deck-hatch hidden h-3 w-px shrink-0 sm:inline-block" aria-hidden />
      <span
        className={cn(
          'hidden whitespace-nowrap sm:inline',
          tone === 'go' ? 'text-success' : tone === 'alarm' ? 'text-danger' : 'text-warning',
        )}
        aria-hidden
      >
        {liveLabel}
      </span>
    </span>
  );
}
