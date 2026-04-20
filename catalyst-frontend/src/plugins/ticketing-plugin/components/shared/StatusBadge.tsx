import { Badge } from '@/components/ui/badge';
import { STATUS_CONFIG } from '../../constants';

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.open;
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.badge} className="gap-1.5">
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}
