import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

/**
 * Canonical section header used inside ServerTabCard.
 * Every tab section uses this — no other section-header pattern should exist.
 *
 * Typographic-only: an uppercase overline closed by a hairline rule. The old
 * icon-in-a-tile pattern is gone; `icon` is still accepted as a deprecated
 * no-op so call sites (and plugin pages) keep compiling.
 */
export default function SectionHeader({
 title,
 description,
 accent = 'primary',
}: {
 icon?: ComponentType<{ className?: string }>;
 title: string;
 description?: string;
 accent?: 'primary' | 'warning' | 'danger';
}) {
 const titleColor =
 accent === 'danger'
 ? 'text-danger'
 : accent === 'warning'
 ? 'text-warning'
 : undefined;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-3">
        <h3 className={cn('type-overline shrink-0', titleColor)}>
          {title}
        </h3>
        <span className="h-px min-w-4 flex-1 bg-border/50" aria-hidden />
      </div>
      {description && (
        <p className="type-meta mt-0.5">
          {description}
        </p>
      )}
    </div>
  );

}
