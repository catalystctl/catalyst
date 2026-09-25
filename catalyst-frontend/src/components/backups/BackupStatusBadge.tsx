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

// State colour only: the LED carries the tone, the label stays quiet.
const dotMap: Record<BackupStatus, string> = {
  completed: 'bg-success',
  in_progress: 'bg-warning',
  failed: 'bg-danger',
  restored: 'bg-info',
  unknown: 'bg-surface-3',
};

const textMap: Record<BackupStatus, string> = {
  completed: 'text-success',
  in_progress: 'text-warning',
  failed: 'text-danger',
  restored: 'text-info',
  unknown: 'text-muted-foreground',
};

function BackupStatusBadge({ status }: { status: BackupStatus }) {
  const { t } = useTranslation('server-tabs');
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-surface-1/60 px-1.5 py-0.5 text-micro font-medium ${textMap[status]}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 ${dotMap[status]} ${status === 'in_progress' ? 'deck-led-pulse' : ''}`}
        aria-hidden
      />
      {backupStatusLabel(t, status)}
    </span>
  );
}

export default BackupStatusBadge;
