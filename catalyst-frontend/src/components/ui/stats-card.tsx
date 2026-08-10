import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  variant?: 'default' | 'success' | 'danger' | 'warning' | 'info';
  onClick?: () => void;
  className?: string;
}

export function StatsCard({ title, value, subtitle, icon, variant = 'default', onClick, className }: StatsCardProps) {
  const variantStyles = {
    default: 'border-border/70',
    success: 'border-success/25',
    danger: 'border-danger/25',
    warning: 'border-warning/25',
    info: 'border-info/25',
  };

  const iconBgStyles = {
    default: 'bg-surface-2 text-muted-foreground',
    success: 'bg-success/12 text-success',
    danger: 'bg-danger/12 text-danger',
    warning: 'bg-warning/12 text-warning',
    info: 'bg-info/12 text-info',
  };

  return (
    <div
      className={cn(
        'rounded-xl border bg-card/80 px-3.5 py-3 shadow-panel transition-all duration-200 ease-standard',
        variantStyles[variant],
        onClick && 'pressable cursor-pointer hover:border-primary/30 hover:bg-primary/[0.03]',
        className,
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            {title}
          </p>
          <p className="mt-1 font-mono text-base font-semibold tabular-nums tracking-tight text-foreground">
            {value}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/65">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              iconBgStyles[variant],
            )}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
