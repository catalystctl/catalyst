import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { BackupStatus } from '../../types/backup';

/**
 * Localized label for a backup status. A switch (not a status->key map) keeps
 * every translation key a literal in the source so extraction stays exact.
 */
function backupStatusLabel(t: TFunction, status: BackupStatus): string {
  switch (status) {
    case 'completed':
      return t('backups.status.completed', { ns: 'server-tabs' });
    case 'in_progress':
      return t('backups.status.inProgress', { ns: 'server-tabs' });
    case 'failed':
      return t('backups.status.failed', { ns: 'server-tabs' });
    case 'restored':
      return t('backups.status.restored', { ns: 'server-tabs' });
    default:
      return t('backups.status.unknown', { ns: 'server-tabs' });
  }
}

const colorMap: Record<BackupStatus, string> = {
 completed: 'bg-success/10 text-success border-success/20',
 in_progress: 'bg-warning/10 text-warning border-warning/20',
 failed: 'bg-danger/10 text-danger border-danger/20',
 restored: 'bg-primary/10 text-primary border-primary/20',
 unknown: 'bg-surface-2/40 text-muted-foreground border-border/30',
};

function BackupStatusBadge({ status }: { status: BackupStatus }) {
  const { t } = useTranslation('server-tabs');
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
        colorMap[status]
      }`}
    >
      {backupStatusLabel(t, status)}
    </span>
  );
}

export default BackupStatusBadge;
