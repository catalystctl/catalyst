import { cn } from '@/lib/utils';
import { PRIORITY_CONFIG } from '../../constants';

export function PriorityDot({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={cn('h-2 w-2 rounded-full', cfg.dot)} />
      <span className={cfg.color}>{cfg.label}</span>
    </span>
  );
}
