import { useState, useEffect } from 'react';
import type { TicketSLA } from '../../types';
import { cn } from '../../../plugin-ui';

interface SLATimerProps {
  sla: TicketSLA | null;
  className?: string;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainHours = hours % 24;
    return `${days}d ${remainHours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function SLATimer({ sla, className }: SLATimerProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  if (!sla) return null;

  // Paused
  if (sla.isPaused) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border border-zinc-500/30 bg-zinc-500/15 px-2 py-0.5 text-[10px] font-medium text-zinc-400',
          className,
        )}
      >
        Paused
      </span>
    );
  }

  // Breached
  if (sla.isBreached && sla.resolutionDeadline) {
    const breachTime = new Date(sla.resolutionDeadline).getTime();
    const since = now - breachTime;
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400',
          className,
        )}
      >
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
        Breached {formatDuration(since)}
      </span>
    );
  }

  // Active countdown
  const deadline = sla.resolutionDeadline;
  if (!deadline) return null;

  const deadlineTime = new Date(deadline).getTime();
  const remaining = deadlineTime - now;

  if (remaining <= 0) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border border-red-500/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400',
          className,
        )}
      >
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
        Breached
      </span>
    );
  }

  // Determine color based on urgency using the more urgent deadline
  const responseDeadline = sla.responseDeadline
    ? new Date(sla.responseDeadline).getTime()
    : null;
  const responseRemaining = responseDeadline ? responseDeadline - now : remaining;
  const urgentRemaining = responseRemaining !== null ? Math.min(remaining, responseRemaining) : remaining;

  let colorClass = 'text-emerald-400 border-emerald-500/30 bg-emerald-500/15';
  let dotClass = 'bg-emerald-500';

  if (urgentRemaining < 3600000) {
    // < 1 hour
    colorClass = 'text-red-400 border-red-500/30 bg-red-500/15';
    dotClass = 'bg-red-500';
  } else if (urgentRemaining < 14400000) {
    // < 4 hours
    colorClass = 'text-amber-400 border-amber-500/30 bg-amber-500/15';
    dotClass = 'bg-amber-500';
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
        colorClass,
        className,
      )}
    >
      <span className={cn('mr-1 inline-block h-1.5 w-1.5 rounded-full', dotClass)} />
      {formatDuration(remaining)}
    </span>
  );
}
