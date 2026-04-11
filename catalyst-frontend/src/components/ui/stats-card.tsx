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
    <Card className={cn('transition-all hover:shadow-md', onClick && 'cursor-pointer', className)} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{title}</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          {icon && <div className="text-slate-400 dark:text-slate-500">{icon}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
