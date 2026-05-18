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
    default: 'border-border/30',
    success: 'border-success/30',
    danger: 'border-danger/30',
    warning: 'border-warning/30',
    info: 'border-info/30',
  };

  const iconBgStyles = {
    default: 'bg-surface-2/30 text-muted-foreground',
    success: 'bg-success/10 text-success',
    danger: 'bg-danger/10 text-danger',
    warning: 'bg-warning/10 text-warning',
    info: 'bg-info/10 text-info',
  };

  return (
    <div
      className={cn(
        'rounded-md border bg-surface-2/30 px-3 py-2 transition-all duration-150',
        variantStyles[variant],
        onClick && 'cursor-pointer hover:border-primary/20 hover:bg-primary/[0.02]',
        className,
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">{title}</p>
          <p className="mt-1 text-sm font-semibold font-mono tabular-nums text-foreground">{value}</p>
          {subtitle && <p className="mt-0.5 text-[10px] text-muted-foreground/40">{subtitle}</p>}
        </div>
        {icon && (
          <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', iconBgStyles[variant])}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
