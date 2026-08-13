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
    <div className={`rounded-xl border border-border/50 bg-card px-5 py-4 ${className}`}>
      {children}
    </div>
  );
}
