import type { BackupStatus } from '../../types/backup';
import { formatBackupStatus } from '../../utils/backupStatus';

const colorMap: Record<BackupStatus, string> = {
  completed: 'bg-success/10 text-success border-success/20',
  in_progress: 'bg-warning/10 text-warning border-warning/20',
  failed: 'bg-danger/10 text-danger border-danger/20',
  restored: 'bg-primary/10 text-primary border-primary/20',
  unknown: 'bg-surface-2/40 text-muted-foreground border-border/30',
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
