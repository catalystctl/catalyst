import type { BackupStatus } from '../../types/backup';
import { formatBackupStatus } from '../../utils/backupStatus';

const colorMap: Record<BackupStatus, string> = {
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30',
  in_progress: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30',
  failed: 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/30',
  restored: 'bg-primary-100 text-primary-700 border-primary-200 dark:bg-primary-500/10 dark:text-primary-400 dark:border-primary-500/30',
  unknown: 'bg-surface-2 text-muted-foreground border-border dark:bg-surface-2/40 dark:text-zinc-300 dark:border-zinc-600/60',
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
