import type { TicketStatus } from '../../types';
import { STATUS_CONFIG } from '../../constants';
import { Badge, cn } from '../../../plugin-ui';
import {
  CircleDot,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  CircleDot,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
};

interface StatusBadgeProps {
  status: TicketStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = ICON_MAP[config.icon];

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 border px-2 py-0.5 text-xs font-medium',
        config.bg,
        config.color,
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {config.label}
    </Badge>
  );
}
