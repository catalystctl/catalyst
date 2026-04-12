import { Play, Square, Loader2, AlertTriangle, ArrowRightLeft, Ban } from 'lucide-react';
import type { ServerStatus } from '../../types/server';

const colorMap: Record<ServerStatus, string> = {
  stopped: 'bg-surface-2 text-muted-foreground border border-border',
  installing: 'bg-primary/10 text-primary border border-primary/20',
  starting: 'bg-primary/10 text-primary border border-primary/20',
  running: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20',
  stopping: 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
  crashed: 'bg-destructive/10 text-destructive border border-destructive/20',
  transferring: 'bg-violet-500/10 text-violet-400 border border-violet-500/20',
  suspended: 'bg-destructive/10 text-destructive border border-destructive/20',
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
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${colorMap[status]}`}
      aria-label={`Server status: ${status}`}
    >
      {iconMap[status]}
      {status}
    </span>
  );
}

export default ServerStatusBadge;
