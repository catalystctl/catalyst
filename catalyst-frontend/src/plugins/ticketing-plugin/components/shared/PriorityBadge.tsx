import type { TicketPriority } from '../../types';
import { PRIORITY_CONFIG } from '../../constants';
import { cn } from '../../../plugin-ui';

interface PriorityBadgeProps {
  priority: TicketPriority;
  className?: string;
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority];

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', config.color, className)}>
      <span className={cn('h-2 w-2 rounded-full', config.dot)} />
      <span className="font-medium">{config.label}</span>
    </span>
  );
}
