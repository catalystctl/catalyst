interface SectionDividerProps {
  title: string;
}

/**
 * A centered section divider with horizontal lines on both sides.
 * Used in the Configuration tab and other places where sections need visual separation.
 *
 * Example: ─── Startup ───
 */
export default function SectionDivider({ title }: SectionDividerProps) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="h-px flex-1 bg-surface-3 dark:bg-surface-2/60" />
      {title}
      <span className="h-px flex-1 bg-surface-3 dark:bg-surface-2/60" />
    </h3>
  );
}
