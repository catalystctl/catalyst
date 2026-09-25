import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type WorkspaceHeaderVariant = 'default' | 'success' | 'warning' | 'danger';

const cardTone: Record<WorkspaceHeaderVariant, string> = {
  default: 'border-border/70 bg-card',
  success: 'border-success/35 bg-card',
  warning: 'border-warning/35 bg-card',
  danger: 'border-danger/40 bg-card',
};

// Variant is carried by a status LED in the heading, not by a thick colored
// side border — the "side tab" is the most recognizable tell of AI-generated
// UI (flagged by the impeccable detector) and is deliberately not used.
const ledTone: Record<WorkspaceHeaderVariant, 'idle' | 'go' | 'hazard' | 'alarm'> = {
  default: 'idle',
  success: 'go',
  warning: 'hazard',
  danger: 'alarm',
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

void ledTone;

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
        'min-w-0 overflow-hidden rounded-sm border',
        cardTone[variant],
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'led',
                variant === 'success'
                  ? 'bg-success'
                  : variant === 'warning'
                    ? 'bg-warning'
                    : variant === 'danger'
                      ? 'bg-danger'
                      : 'bg-surface-3',
              )}
              aria-hidden
            />
            {typeof title === 'string' ? (
              <Heading className="truncate font-display text-xl font-semibold tracking-tight text-foreground">
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
