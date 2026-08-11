import { Play, Square, Loader2, AlertTriangle, ArrowRightLeft, Ban, Copy, HardDriveDownload, Archive, OctagonX } from 'lucide-react';
import type { ServerStatus } from '../../types/server';

const colorMap: Record<ServerStatus, string> = {
  stopped: 'bg-surface-3 text-muted-foreground',
  installing: 'bg-primary-muted text-primary',
  starting: 'bg-primary-muted text-primary',
  running: 'bg-success-muted text-success',
  stopping: 'bg-warning-muted text-warning',
  crashed: 'bg-danger-muted text-danger',
  transferring: 'bg-info-muted text-info',
  cloning: 'bg-info-muted text-info',
  suspended: 'bg-danger-muted text-danger',
  restoring: 'bg-info-muted text-info',
  creating_backup: 'bg-info-muted text-info',
  archived: 'bg-surface-3 text-muted-foreground',
  error: 'bg-danger-muted text-danger',
};

const iconMap: Record<ServerStatus, React.ReactNode> = {
  stopped: <Square className="h-3 w-3" />,
  installing: <Loader2 className="h-3 w-3 animate-spin" />,
  starting: <Loader2 className="h-3 w-3 animate-spin" />,
  running: <Play className="h-3 w-3" />,
  stopping: <Loader2 className="h-3 w-3 animate-spin" />,
  crashed: <AlertTriangle className="h-3 w-3" />,
  transferring: <ArrowRightLeft className="h-3 w-3" />,
  cloning: <Copy className="h-3 w-3 animate-pulse" />,
  suspended: <Ban className="h-3 w-3" />,
  restoring: <HardDriveDownload className="h-3 w-3 animate-pulse" />,
  creating_backup: <Archive className="h-3 w-3 animate-pulse" />,
  archived: <Archive className="h-3 w-3" />,
  error: <OctagonX className="h-3 w-3" />,
};

type Props = {
  status: ServerStatus;
  /** Optional soft progress from SSE (install/transfer/clone). */
  operationStage?: string | null;
  operationProgress?: number | null;
};

function ServerStatusBadge({ status, operationStage, operationProgress }: Props) {
  const showProgress =
    typeof operationProgress === 'number' &&
    operationProgress >= 0 &&
    ['installing', 'transferring', 'cloning', 'restoring', 'creating_backup', 'starting', 'stopping'].includes(
      status,
    );

  const label = showProgress
    ? `${status} ${Math.round(operationProgress)}%`
    : operationStage && status !== 'running' && status !== 'stopped'
      ? `${status}`
      : status;

  const title =
    operationStage || showProgress
      ? [operationStage, showProgress ? `${Math.round(operationProgress!)}%` : null]
          .filter(Boolean)
          .join(' · ')
      : `Server status: ${status}`;

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${colorMap[status]}`}
      aria-label={title}
      title={title}
    >
      {iconMap[status]}
      <span className="truncate">{label}</span>
      {showProgress && (
        <span
          className="ml-0.5 h-1 w-8 overflow-hidden rounded-full bg-black/15 dark:bg-white/15"
          aria-hidden
        >
          <span
            className="block h-full rounded-full bg-current transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(0, operationProgress!))}%` }}
          />
        </span>
      )}
    </span>
  );
}

export default ServerStatusBadge;
