import type { ReactNode } from 'react';

interface ServerTabCardProps {
  children: ReactNode;
  className?: string;
}

export default function ServerTabCard({
  children,
  className = '',
}: ServerTabCardProps) {
  return (
    <div className={`overflow-hidden rounded-lg border border-border/70 bg-card px-3 py-2.5 ${className}`}>
      {children}
    </div>
  );
}
