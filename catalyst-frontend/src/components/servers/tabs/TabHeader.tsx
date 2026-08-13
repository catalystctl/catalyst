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

const variantStyles: Record<string, string> = {
  default: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};


/**
 * Standardized header for server detail tabs.
 * Icon badge + title + description + optional actions.
 */
export default function TabHeader({
 icon: Icon,
 title,
 description,
 actions,
 variant = 'default',
}: TabHeaderProps) {
  const iconClass = variantStyles[variant] ?? variantStyles.default;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} />
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="type-meta hidden truncate sm:block" title={description}>
            {description}
          </p>
        ) : null}

      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );

}
