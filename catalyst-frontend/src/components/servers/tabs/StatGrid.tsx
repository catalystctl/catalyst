interface StatItemProps {
  label: string;
  value: string | number;
}

interface StatGridProps {
  items: StatItemProps[];
  /** Number of columns at sm breakpoint and above. Default: 2 */
  columns?: 2 | 3 | 4;
  className?: string;
}

/**
 * Grid of stat items with refined treatment:
 * small uppercase labels + prominent values with font-mono for data.
 */
export default function StatGrid({
  items,
  columns = 2,
  className = '',
}: StatGridProps) {
  const colsClass =
    columns === 4
      ? 'sm:grid-cols-4'
      : columns === 3
        ? 'sm:grid-cols-3'
        : 'sm:grid-cols-2';

  return (
    <div
      className={`grid grid-cols-1 gap-1.5 ${colsClass} ${className}`}
    >
      {items.map((item) => (
        <div
          key={String(item.label)}
          className="rounded-md border border-border/30 bg-surface-2/30 px-3 py-2"
        >
          <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
            {item.label}
          </div>
          <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-foreground">
            {String(item.value)}
          </div>
        </div>
      ))}
    </div>
  );
}
