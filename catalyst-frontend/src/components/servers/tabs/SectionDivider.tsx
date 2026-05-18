interface SectionDividerProps {
  title: string;
}

/**
 * Section divider with editorial small-caps title and accent dot.
 * Used to separate sections within a tab (e.g. Configuration tab).
 */
export default function SectionDivider({ title }: SectionDividerProps) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
      <span className="h-1 w-1 rounded-full bg-primary/50" />
      {title}
      <span className="h-px flex-1 bg-border/40" />
    </h3>
  );
}
