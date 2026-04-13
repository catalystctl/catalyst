import { Card, CardContent } from '@/components/ui/card';
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
    default: '',
    success: 'border-l-2 border-l-success',
    danger: 'border-l-2 border-l-danger',
    warning: 'border-l-2 border-l-warning',
    info: 'border-l-2 border-l-info',
  };

  const iconStyles = {
    default: 'text-muted-foreground',
    success: 'text-success',
    danger: 'text-danger',
    warning: 'text-warning',
    info: 'text-info',
  };

  return (
    <Card className={cn('transition-all duration-200 hover:shadow-elevated dark:hover:shadow-elevated-dark', onClick && 'cursor-pointer', variantStyles[variant], className)} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="mt-1 text-2xl font-display font-bold text-foreground">{value}</p>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {icon && <div className={cn('text-lg', iconStyles[variant])}>{icon}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
