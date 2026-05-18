import type { ReactNode } from 'react';

interface ServerTabCardProps {
 children: ReactNode;
 className?: string;
}

/**
 * Standardized card wrapper used across all server detail tabs.
 * Clean border + subtle hover effect.
 */
export default function ServerTabCard({
 children,
 className = '',
}: ServerTabCardProps) {
 return (
 <div
 className={`group/card rounded-xl border border-border/40 bg-card px-5 py-4 transition-all duration-200 hover:border-primary/15 ${className}`}
 >
 {children}
 </div>
 );
}
