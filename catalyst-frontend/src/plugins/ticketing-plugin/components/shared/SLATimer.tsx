import React from 'react';
import { cn } from '@/lib/utils';
import { Clock, AlertTriangle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { SLA_DEFAULTS } from '../../constants';
import type { SLA } from '../../types';

interface SLATimerProps {
  sla?: SLA;
  compact?: boolean;
}

export function SLATimer({ sla, compact = false }: SLATimerProps) {
  if (!sla) return null;

  const now = Date.now();
  const created = sla.firstResponseAt ? new Date(sla.firstResponseAt).getTime() : now;
  const targetMs = (sla.firstResponseTarget || SLA_DEFAULTS.firstResponse) * 60 * 1000;
  const deadline = created + targetMs;
  const remaining = deadline - now;

  if (remaining <= 0 || sla.breached) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              'bg-red-500/15 text-red-400 border border-red-500/30',
              compact && 'px-1.5 py-0'
            )}>
              <AlertTriangle className="h-3 w-3" />
              {!compact && 'SLA Breached'}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>SLA target exceeded</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const totalMinutes = sla.firstResponseTarget || SLA_DEFAULTS.firstResponse;
  const elapsed = totalMinutes - remaining / 60000;
  const ratio = elapsed / totalMinutes;

  let colorClass: string;
  let label: string;
  if (ratio >= SLA_DEFAULTS.warningThreshold) {
    colorClass = 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30';
    label = 'SLA Warning';
  } else {
    colorClass = 'bg-green-500/15 text-green-400 border-green-500/30';
    label = 'SLA OK';
  }

  const hours = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border',
            colorClass,
            compact && 'px-1.5 py-0'
          )}>
            <Clock className="h-3 w-3" />
            {!compact && (hours > 0 ? `${hours}h ${mins}m` : `${mins}m`)}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{label} - {hours > 0 ? `${hours}h ` : ''}{mins}m remaining</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── SLA Progress Bar ──────────────────────────────────────

interface SLAProgressBarProps {
  sla?: SLA;
}

export function SLAProgressBar({ sla }: SLAProgressBarProps) {
  if (!sla) return null;

  const now = Date.now();
  const created = sla.firstResponseAt ? new Date(sla.firstResponseAt).getTime() : now;
  const targetMs = (sla.firstResponseTarget || SLA_DEFAULTS.firstResponse) * 60 * 1000;
  const deadline = created + targetMs;
  const remaining = deadline - now;

  const totalMinutes = sla.firstResponseTarget || SLA_DEFAULTS.firstResponse;
  const elapsed = totalMinutes - remaining / 60000;
  const percentage = Math.min(100, Math.max(0, (elapsed / totalMinutes) * 100));

  let barColor = 'bg-green-500';
  if (percentage >= 100 || sla.breached) {
    barColor = 'bg-red-500';
  } else if (percentage >= SLA_DEFAULTS.warningThreshold * 100) {
    barColor = 'bg-yellow-500';
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">First Response SLA</span>
        <SLATimer sla={sla} />
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-3">
        <div
          className={cn('h-1.5 rounded-full transition-all duration-1000', barColor)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
