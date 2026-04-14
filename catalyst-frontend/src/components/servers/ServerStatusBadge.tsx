import { Play, Square, Loader2, AlertTriangle, ArrowRightLeft, Ban } from 'lucide-react';
import type { ServerStatus } from '../../types/server';

const colorMap: Record<ServerStatus, string> = {
  stopped: 'bg-surface-3 text-muted-foreground dark:bg-surface-2 dark:text-muted-foreground',
  installing: 'bg-primary-muted text-primary',
  starting: 'bg-primary-muted text-primary',
  running: 'bg-success-muted text-success',
  stopping: 'bg-warning-muted text-warning',
  crashed: 'bg-danger-muted text-danger',
  transferring: 'bg-info-muted text-info',
  suspended: 'bg-danger-muted text-danger',
};

const iconMap: Record<ServerStatus, React.ReactNode> = {
  stopped: <Square className="h-3 w-3" />,
  installing: <Loader2 className="h-3 w-3 animate-spin" />,
  starting: <Loader2 className="h-3 w-3 animate-spin" />,
  running: <Play className="h-3 w-3" />,
  stopping: <Loader2 className="h-3 w-3 animate-spin" />,
  crashed: <AlertTriangle className="h-3 w-3" />,
  transferring: <ArrowRightLeft className="h-3 w-3" />,
  suspended: <Ban className="h-3 w-3" />,
};

function ServerStatusBadge({ status }: { status: ServerStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${colorMap[status]}`}
      aria-label={`Server status: ${status}`}
    >
      {iconMap[status]}
      {status}
    </span>
  );
}

export default ServerStatusBadge;
