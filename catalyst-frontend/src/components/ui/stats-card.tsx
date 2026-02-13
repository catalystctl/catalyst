import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  className?: string;
}

const variantStyles = {
  default: {
    card: 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 hover:border-primary-500 dark:hover:border-primary-500/30',
    icon: 'bg-slate-100 dark:bg-slate-800 group-hover:bg-primary-100 dark:group-hover:bg-primary-900/30',
    iconText: 'text-slate-600 dark:text-slate-400 group-hover:text-primary-600 dark:group-hover:text-primary-400',
    value: 'text-slate-900 dark:text-white',
    subtitle: 'text-slate-500 dark:text-slate-400',
  },
  success: {
    card: 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-950/20 hover:border-emerald-400 dark:hover:border-emerald-500/50',
    icon: 'bg-emerald-200 dark:bg-emerald-900/50 group-hover:bg-emerald-300 dark:group-hover:bg-emerald-900/70',
    iconText: 'text-emerald-700 dark:text-emerald-400',
    value: 'text-emerald-700 dark:text-emerald-400',
    subtitle: 'text-emerald-600 dark:text-emerald-500',
  },
  warning: {
    card: 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-950/20 hover:border-amber-400 dark:hover:border-amber-500/50',
    icon: 'bg-amber-200 dark:bg-amber-900/50 group-hover:bg-amber-300 dark:group-hover:bg-amber-900/70',
    iconText: 'text-amber-700 dark:text-amber-400',
    value: 'text-amber-700 dark:text-amber-400',
    subtitle: 'text-amber-600 dark:text-amber-500',
  },
  danger: {
    card: 'border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-950/20 hover:border-rose-400 dark:hover:border-rose-500/50',
    icon: 'bg-rose-200 dark:bg-rose-900/50 group-hover:bg-rose-300 dark:group-hover:bg-rose-900/70',
    iconText: 'text-rose-700 dark:text-rose-400',
    value: 'text-rose-700 dark:text-rose-400',
    subtitle: 'text-rose-600 dark:text-rose-500',
  },
};

export function StatsCard({
  title,
  value,
  subtitle,
  icon,
  onClick,
  variant = 'default',
  className,
}: StatsCardProps) {
  const styles = variantStyles[variant];
  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={cn(
        'group w-full rounded-xl p-4 text-left shadow-surface-light dark:shadow-surface-dark transition-all duration-300',
        onClick && 'cursor-pointer hover:scale-105',
        styles.card,
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </div>
        {icon && (
          <div className={cn('rounded-full p-2 transition-all duration-300', styles.icon)}>
            <div className={cn('h-4 w-4', styles.iconText)}>{icon}</div>
          </div>
        )}
      </div>
      <div className={cn('mt-3 text-3xl font-bold', styles.value)}>{value}</div>
      {subtitle && <div className={cn('mt-1 text-xs', styles.subtitle)}>{subtitle}</div>}
    </Component>
  );
}

export default StatsCard;
