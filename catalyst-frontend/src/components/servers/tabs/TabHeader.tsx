import type { ComponentType } from 'react';

interface TabHeaderProps {
  /** Lucide icon component */
  icon: ComponentType<{ className?: string }>;
  /** Tab title */
  title: string;
  /** Short description shown beneath the title */
  description?: string;
  /** Optional right-side content (actions, badges, etc.) */
  actions?: React.ReactNode;
  /** Icon accent color variant */
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

const variantStyles: Record<string, { icon: string; bg: string; glow: string }> = {
  default: {
    icon: 'text-primary',
    bg: 'bg-primary/10',
    glow: 'shadow-[0_0_12px_-2px_hsl(var(--primary)/0.15)]',
  },
  success: {
    icon: 'text-success',
    bg: 'bg-success/10',
    glow: 'shadow-[0_0_12px_-2px_hsl(var(--success)/0.15)]',
  },
  warning: {
    icon: 'text-warning',
    bg: 'bg-warning/10',
    glow: 'shadow-[0_0_12px_-2px_hsl(var(--warning)/0.15)]',
  },
  danger: {
    icon: 'text-danger',
    bg: 'bg-danger/10',
    glow: 'shadow-[0_0_12px_-2px_hsl(var(--danger)/0.15)]',
  },
};

/**
 * Standardized header for server detail tabs.
 * Icon badge with soft glow + title + description + optional actions.
 */
export default function TabHeader({
  icon: Icon,
  title,
  description,
  actions,
  variant = 'default',
}: TabHeaderProps) {
  const style = variantStyles[variant];

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {/* Icon badge with soft glow */}
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-current/10 ${style.bg} ${style.glow} ${style.icon} transition-shadow duration-300`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
