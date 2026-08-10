import type { ReactNode } from 'react';
import { Ticket } from 'lucide-react';
import { cn, TEXT_MUTED, FONT_DISPLAY } from '@/plugins/plugin-ui';

export function EmptyState({
  title = 'No tickets',
  description = 'Create a ticket to get started.',
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface-2">
        <Ticket className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="max-w-xs space-y-1">
        <h3 className={cn('text-sm font-semibold text-foreground', FONT_DISPLAY)}>{title}</h3>
        <p className={cn('text-xs leading-relaxed', TEXT_MUTED)}>{description}</p>
      </div>
      {action}
    </div>
  );
}
