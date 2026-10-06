import { useTranslation } from 'react-i18next';
import type { QueryKey } from '@/csync';
import { formatDateTime, formatRelativeTime } from '@/i18n/format';
import { useQueryFreshness } from '@/hooks/useDataFreshness';
import { cn } from '@/lib/utils';

interface LastUpdatedProps {
  /** Cache key prefix to read the newest dataUpdatedAt from; omit for cache-wide. */
  queryKey?: QueryKey;
  /** Explicit timestamp override (skips the cache lookup when provided). */
  updatedAt?: number;
  /** Extra wrapper classes. */
  className?: string;
}

/**
 * Per-section "Updated {relative}" stamp with an absolute-time tooltip —
 * the page-level half of the freshness contract (REALTIME_AUDIT.md §6):
 * users must be able to tell how old the data on screen is without hunting
 * for the shell chip.
 */
export default function LastUpdated({ queryKey, updatedAt, className }: LastUpdatedProps) {
  const { t } = useTranslation('common');
  const freshness = useQueryFreshness(updatedAt === undefined ? queryKey : undefined);
  const at = updatedAt ?? freshness.updatedAt;

  const label =
    at === 0
      ? t('freshness.never')
      : t('freshness.updatedAt', { when: formatRelativeTime(at, freshness.now) });
  const tooltip = at === 0 ? label : `${label} · ${formatDateTime(at, { dateStyle: 'medium', timeStyle: 'medium' })}`;

  return (
    <span
      className={cn('whitespace-nowrap font-mono text-micro tabular-nums text-muted-foreground', className)}
      title={tooltip}
      aria-label={tooltip}
    >
      {label}
    </span>
  );
}
