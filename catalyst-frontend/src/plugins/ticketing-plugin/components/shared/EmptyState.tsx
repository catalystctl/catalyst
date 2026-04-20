import type { LucideIcon } from 'lucide-react';
import { Button, cn, SURFACE_2, TEXT_MUTED, FONT_DISPLAY } from '../../../plugin-ui';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg p-8 text-center',
        SURFACE_2,
        className,
      )}
    >
      {Icon && (
        <div className={cn('flex h-12 w-12 items-center justify-center rounded-full bg-zinc-500/10')}>
          <Icon className="h-6 w-6 text-zinc-500" />
        </div>
      )}
      <h3 className={cn('text-sm font-semibold text-foreground', FONT_DISPLAY)}>{title}</h3>
      {description && <p className={cn('max-w-sm text-xs', TEXT_MUTED)}>{description}</p>}
      {action && (
        <Button size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
