import React from 'react';
import { cn } from '@/lib/utils';

const gradients: Record<string, string> = {
  primary: 'from-primary-50 to-primary-100 dark:from-primary-950/50 dark:to-primary-900/30',
  success: 'from-emerald-50 to-emerald-100 dark:from-emerald-950/50 dark:to-emerald-900/30',
  warning: 'from-amber-50 to-amber-100 dark:from-amber-950/50 dark:to-amber-900/30',
  danger: 'from-red-50 to-red-100 dark:from-red-950/50 dark:to-red-900/30',
  info: 'from-sky-50 to-sky-100 dark:from-sky-950/50 dark:to-sky-900/30',
  violet: 'from-violet-50 to-violet-100 dark:from-violet-950/50 dark:to-violet-900/30',
};

const rings: Record<string, string> = {
  primary: 'ring-primary-200/50 dark:ring-primary-800/50',
  success: 'ring-emerald-200/50 dark:ring-emerald-800/50',
  warning: 'ring-amber-200/50 dark:ring-amber-800/50',
  danger: 'ring-red-200/50 dark:ring-red-800/50',
  info: 'ring-sky-200/50 dark:ring-sky-800/50',
  violet: 'ring-violet-200/50 dark:ring-violet-800/50',
};

export function IconBox({ children, color = 'primary' }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm">
      <div className={cn('absolute inset-0 rounded-lg bg-gradient-to-br', gradients[color] || gradients.primary)} />
      <div className={cn('absolute inset-0 rounded-lg ring-1 ring-inset', rings[color] || rings.primary)} />
      <span className="relative">{children}</span>
    </div>
  );
}

export function IconCircle({
  children,
  color = 'primary',
  size = 'md',
}: {
  children: React.ReactNode;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = { sm: 'h-8 w-8', md: 'h-11 w-11', lg: 'h-14 w-14' };
  return (
    <div className="relative flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm">
      <div className={cn('absolute inset-0 rounded-full bg-gradient-to-br', gradients[color] || gradients.primary)} />
      <div className={cn('absolute inset-0 rounded-full ring-1 ring-inset', 'ring-black/5 dark:ring-white/5')} />
      <span className={cn('relative', sizes[size])}>{children}</span>
    </div>
  );
}
