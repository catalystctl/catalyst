import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Numbered, titled section — the spine of the single-screen editors
 * (role creator, server/node/template creation, user management).
 *
 * One decision per card: identity, placement, resources… so the form reads
 * as a small checklist instead of a wall of fields. The optional eyebrow is
 * a short right-aligned tag naming the decision's dimension.
 */
export function FormSection({
  index,
  title,
  eyebrow,
  children,
  className,
}: {
  index: number;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('overflow-hidden rounded-sm border border-border bg-card', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border text-micro font-semibold text-muted-foreground">
            {index}
          </span>
          <span className="truncate text-mini font-semibold text-foreground">{title}</span>
        </div>
        {eyebrow && (
          <span className="shrink-0 text-micro uppercase tracking-wider text-muted-foreground/70">
            {eyebrow}
          </span>
        )}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}
