import type { ReactNode } from 'react';

interface ServerTabCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Standardized card wrapper used across all server detail tabs.
 * Provides consistent border, background, blur, and hover effects.
 */
export default function ServerTabCard({
  children,
  className = '',
}: ServerTabCardProps) {
  return (
    <div
      className={`rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30 ${className}`}
    >
      {children}
    </div>
  );
}
