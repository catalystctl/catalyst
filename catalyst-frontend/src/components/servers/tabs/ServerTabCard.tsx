import type { ReactNode } from 'react';

interface ServerTabCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Standardized card wrapper used across all server detail tabs.
 * Subtle inner depth + lift-on-hover effect.
 */
export default function ServerTabCard({
  children,
  className = '',
}: ServerTabCardProps) {
  return (
    <div
      className={`group/card rounded-xl border border-border/40 bg-card px-5 py-4 shadow-[inset_0_1px_0_hsl(var(--card)/0.8),0_1px_2px_hsl(var(--border)/0.15)] transition-all duration-200 hover:border-primary/15 hover:shadow-[inset_0_1px_0_hsl(var(--card)/0.8),0_2px_8px_-2px_hsl(var(--primary)/0.06)] ${className}`}
    >
      {children}
    </div>
  );
}
