import i18n from '@/i18n';
import { formatNumber } from '@/i18n/format';

export const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${formatNumber(value, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  })} ${units[index]}`;
};

export const formatPercent = (value: number) =>
  `${formatNumber(value, { maximumFractionDigits: 0, useGrouping: false })}%`;

export const formatFileMode = (mode?: number) => {
  if (!Number.isFinite(mode)) return '---';
  const safeMode = mode as number;
  return safeMode.toString(8).padStart(3, '0');
};

export const formatBackupSize = (sizeMb: number) => formatBytes(sizeMb * 1024 * 1024);

/**
 * Compact relative time for card metadata ("just now", "3h ago", "2d ago",
 * "5mo ago", "1y ago"). Accepts ISO strings, epoch seconds or epoch
 * milliseconds; returns '' for values it cannot parse.
 */
export const formatRelativeTime = (
  value: string | number | null | undefined,
): string => {
  if (value === null || value === undefined || value === '') return '';
  const ts =
    typeof value === 'number'
      ? value < 1e12
        ? value * 1000
        : value
      : Date.parse(value);
  if (!Number.isFinite(ts)) return '';
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return i18n.t('relativeTime.justNow', { ns: 'common' });
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return i18n.t('relativeTime.minutesAgo', { ns: 'common', value: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t('relativeTime.hoursAgo', { ns: 'common', value: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return i18n.t('relativeTime.daysAgo', { ns: 'common', value: days });
  const months = Math.floor(days / 30);
  if (months < 12) return i18n.t('relativeTime.monthsAgo', { ns: 'common', value: months });
  return i18n.t('relativeTime.yearsAgo', { ns: 'common', value: Math.floor(months / 12) });
};
