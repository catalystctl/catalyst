import type { Backup, BackupStatus } from '../types/backup';

export const getBackupStatus = (backup: Backup): BackupStatus => {
  if (backup.restoredAt) return 'restored';
  if (backup.metadata?.remoteUploadStatus === 'failed') return 'failed';
  if (backup.sizeMb > 0) return 'completed';
  if (backup.sizeMb === 0) return 'in_progress';
  return 'unknown';
};
