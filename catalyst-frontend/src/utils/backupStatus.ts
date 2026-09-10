import i18n from '@/i18n';
import type { Backup, BackupStatus } from '../types/backup';

export const getBackupStatus = (backup: Backup): BackupStatus => {
  if (backup.restoredAt) return 'restored';
  if (backup.metadata?.remoteUploadStatus === 'failed') return 'failed';
  if (backup.sizeMb > 0) return 'completed';
  if (backup.sizeMb === 0) return 'in_progress';
  return 'unknown';
};

/**
 * Localized backup status label. A switch keeps every key a literal in the
 * source so extraction and translation stay exact.
 */
export const formatBackupStatus = (status: BackupStatus) => {
  switch (status) {
    case 'completed':
      return i18n.t('backupStatus.completed', { ns: 'common' });
    case 'in_progress':
      return i18n.t('backupStatus.inProgress', { ns: 'common' });
    case 'failed':
      return i18n.t('backupStatus.failed', { ns: 'common' });
    case 'restored':
      return i18n.t('backupStatus.restored', { ns: 'common' });
    default:
      return i18n.t('actions.unknown', { ns: 'common' });
  }
};
