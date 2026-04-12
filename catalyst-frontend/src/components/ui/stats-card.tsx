import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  variant?: string;
  onClick?: () => void;
  className?: string;
}

export function StatsCard({ title, value, subtitle, icon, onClick, className }: StatsCardProps) {
  return (
    <Card className={cn('transition-all duration-150 hover:shadow-surface-md', onClick && 'cursor-pointer', className)} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {icon && <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-1 text-muted-foreground">{icon}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
