import type { TicketPriority } from '../../types';
import { PRIORITY_CONFIG } from '../../constants';
import { cn } from '@/plugins/plugin-ui';

export function PriorityBadge({
  priority,
  className,
  showLabel = true,
}: {
  priority: TicketPriority;
  className?: string;
  showLabel?: boolean;
}) {
  const config = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.medium;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] font-medium',
        config.color,
        className,
      )}
      title={config.label}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 flex-shrink-0 rounded-full ring-2 ring-current/15',
          config.dot,
        )}
      />
      {showLabel && <span className="truncate">{config.label}</span>}
    </span>
  );
}
