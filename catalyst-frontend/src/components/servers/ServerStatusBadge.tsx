import { Play, Square, Loader2, AlertTriangle, ArrowRightLeft, Ban } from 'lucide-react';
import type { ServerStatus } from '../../types/server';

const colorMap: Record<ServerStatus, string> = {
  stopped: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  installing: 'bg-primary-100 text-primary-700 dark:bg-primary-500/10 dark:text-primary-400',
  starting: 'bg-primary-100 text-primary-700 dark:bg-primary-500/10 dark:text-primary-400',
  running: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  stopping: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  crashed: 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
  transferring: 'bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
  suspended: 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${colorMap[status]}`}
      aria-label={`Server status: ${status}`}
    >
      {iconMap[status]}
      {status}
    </span>
  );
}

export default ServerStatusBadge;
