import { Play, Square, Loader2, AlertTriangle, ArrowRightLeft, Ban } from 'lucide-react';
import type { ServerStatus } from '../../types/server';

const colorMap: Record<ServerStatus, string> = {
  stopped: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  installing: 'bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary-400',
  starting: 'bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary-400',
  running: 'bg-success/15 text-success dark:bg-success/20 dark:text-emerald-400',
  stopping: 'bg-warning/15 text-warning dark:bg-warning/20 dark:text-amber-400',
  crashed: 'bg-danger/15 text-danger dark:bg-danger/20 dark:text-rose-400',
  transferring: 'bg-info/15 text-info dark:bg-info/20 dark:text-blue-400',
  suspended: 'bg-danger/15 text-danger dark:bg-danger/20 dark:text-rose-400',
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
