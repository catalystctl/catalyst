import type { ReactNode } from 'react';

interface ServerTabCardProps {
  children: ReactNode;
  className?: string;
}

/**
 * The deck surface for a tab section: one `.deck-panel` frame (1px edge, 4px
 * radius) with internal padding. Sections inside it separate with 1px rules
 * rather than nested rounded cards.
 */
export default function ServerTabCard({
  children,
  className = '',
}: ServerTabCardProps) {
  return (
    <div className={`deck-panel overflow-hidden px-3 py-2.5 ${className}`}>
      {children}
    </div>
  );
}
