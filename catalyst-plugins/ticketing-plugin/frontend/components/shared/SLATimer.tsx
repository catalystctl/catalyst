import type { TicketSLA } from '../../types';
import { cn } from '@/plugins/plugin-ui';
import { AlertTriangle, Clock } from 'lucide-react';

function remaining(deadline: string | null | undefined): {
  label: string;
  overdue: boolean;
  urgent: boolean;
} {
  if (!deadline) return { label: '—', overdue: false, urgent: false };
  const ms = new Date(deadline).getTime() - Date.now();
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / 3_600_000);
  const mins = Math.floor((abs % 3_600_000) / 60_000);
  const label =
    hours > 48
      ? `${Math.floor(hours / 24)}d`
      : hours > 0
        ? `${hours}h`
        : `${Math.max(mins, 1)}m`;
  return {
    label: overdue ? `−${label}` : label,
    overdue,
    urgent: !overdue && abs < 3_600_000,
  };
}

export function SLATimer({
  sla,
  className,
}: {
  sla?: TicketSLA | null;
  className?: string;
}) {
  if (!sla) {
    return <span className={cn('text-[11px] text-muted-foreground/50', className)}>—</span>;
  }

  const breached = Boolean(
    sla.resolutionBreached || sla.responseBreached || sla.isBreached,
  );
  const { label, overdue, urgent } = remaining(sla.resolutionDeadline);

  if (breached || overdue) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md bg-danger/10 px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-danger',
          className,
        )}
        title="SLA breached"
      >
        <AlertTriangle className="h-3 w-3" />
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[11px] tabular-nums',
        urgent ? 'text-warning' : 'text-muted-foreground',
        className,
      )}
      title="Resolution deadline"
    >
      <Clock className="h-3 w-3 opacity-70" />
      {label}
    </span>
  );
}
