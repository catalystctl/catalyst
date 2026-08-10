import type { TicketStatus } from '../../types';
import { STATUS_CONFIG } from '../../constants';
import { cn } from '@/plugins/plugin-ui';

export function StatusBadge({
  status,
  className,
  compact = false,
}: {
  status: TicketStatus;
  className?: string;
  compact?: boolean;
}) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.open;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-medium tabular-nums',
        compact ? 'px-1.5 py-0 text-[10px] leading-5' : 'px-2 py-0.5 text-[11px] leading-5',
        config.bg,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', config.rail)} />
      {config.label}
    </span>
  );
}
