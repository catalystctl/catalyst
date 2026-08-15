import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type WorkspaceHeaderVariant = 'default' | 'success' | 'warning' | 'danger';

const cardTone: Record<WorkspaceHeaderVariant, string> = {
  default: 'border-border/70 bg-card',
  success: 'border-success/20 bg-success/5',
  warning: 'border-warning/20 bg-warning/5',
  danger: 'border-danger/25 bg-danger/5',
};

const iconTone: Record<WorkspaceHeaderVariant, string> = {
  default: 'border-border bg-surface-2 text-primary',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-danger',
};

export interface WorkspaceHeaderProps {
  icon: ComponentType<{ className?: string }>;
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
  icon: Icon,
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
    <div className={cn('min-w-0 overflow-hidden rounded-lg border', cardTone[variant], className)}>
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <div
            className={cn(
              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
              iconTone[variant],
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {typeof title === 'string' ? (
                <Heading className="truncate text-sm font-semibold tracking-tight text-foreground">
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
