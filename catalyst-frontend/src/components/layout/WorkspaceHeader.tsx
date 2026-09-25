import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type WorkspaceHeaderVariant = 'default' | 'success' | 'warning' | 'danger';

const cardTone: Record<WorkspaceHeaderVariant, string> = {
  default: 'border-border/70 bg-card',
  success: 'border-success/20 bg-success/5',
  warning: 'border-warning/20 bg-warning/5',
  danger: 'border-danger/25 bg-danger/5',
};

// Variant is carried by the left status edge — the accent hue stays
// reserved for interactive elements, status owns state color.
const edgeTone: Record<WorkspaceHeaderVariant, string> = {
  default: 'border-l-border/40',
  success: 'border-l-success/70',
  warning: 'border-l-warning/70',
  danger: 'border-l-danger/80',
};

export interface WorkspaceHeaderProps {
  /**
   * Deprecated no-op. The old icon-chip header pattern is gone; the prop is
   * still accepted so existing call sites (and plugin pages) keep compiling.
   */
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  titleAddon?: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  stats?: ReactNode;
  actions?: ReactNode;
  banners?: ReactNode;
  toolbar?: ReactNode;
  variant?: WorkspaceHeaderVariant;
  headingLevel?: 'h1' | 'h2';
  className?: string;
}

export function WorkspaceHeader({
  title,
  titleAddon,
  description,
  extra,
  stats,
  actions,
  banners,
  toolbar,
  variant = 'default',
  headingLevel = 'h1',
  className,
}: WorkspaceHeaderProps) {
  const Heading = headingLevel;

  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-md border border-l-2',
        cardTone[variant],
        edgeTone[variant],
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {typeof title === 'string' ? (
              <Heading className="font-display truncate text-lg font-semibold tracking-tight text-foreground">
                {title}
              </Heading>
            ) : (
              title
            )}
            {titleAddon}
          </div>
          {description ? (
            typeof description === 'string' ? (
              <p className="type-meta mt-0.5 truncate">{description}</p>
            ) : (
              description
            )
          ) : null}
          {extra}
        </div>
        {stats}
        {actions ? <div className="ml-auto shrink-0">{actions}</div> : null}
      </div>
      {banners}
      {toolbar}
    </div>
  );
}

export default WorkspaceHeader;
