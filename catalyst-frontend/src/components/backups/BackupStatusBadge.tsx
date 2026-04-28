import type { BackupStatus } from '../../types/backup';
import { formatBackupStatus } from '../../utils/backupStatus';

const colorMap: Record<BackupStatus, string> = {
  completed: 'bg-success/10 text-success border-success/20 dark:bg-success/50/10 dark:text-success dark:border-success/30',
  in_progress: 'bg-warning/10 text-warning border-warning/20 dark:bg-warning/50/10 dark:text-warning dark:border-warning/30',
  failed: 'bg-destructive/10 text-destructive border-destructive/20 dark:bg-destructive/50/10 dark:text-destructive dark:border-destructive/30',
  restored: 'bg-primary-100 text-primary-700 border-primary-200 dark:bg-primary-500/10 dark:text-primary-400 dark:border-primary/30',
  unknown: 'bg-surface-2 text-muted-foreground border-border dark:bg-surface-2/40 dark:text-muted-foreground dark:border-border/60',
};

function BackupStatusBadge({ status }: { status: BackupStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
        colorMap[status]
      }`}
    >
      {formatBackupStatus(status)}
    </span>
  );
}

export default BackupStatusBadge;
