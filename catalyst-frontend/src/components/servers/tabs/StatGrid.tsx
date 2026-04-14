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
 * A grid of stat items, each with a label and value.
 * Used in Tasks, Databases, and Metrics tabs for displaying structured data.
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
      className={`grid grid-cols-1 gap-2 text-xs text-muted-foreground ${colsClass} ${className}`}
    >
      {items.map((item) => (
        <div
          key={String(item.label)}
          className="rounded-md border border-border bg-card px-3 py-2"
        >
          <div className="text-muted-foreground">{item.label}</div>
          <div className="text-sm font-semibold text-foreground">
            {String(item.value)}
          </div>
        </div>
      ))}
    </div>
  );
}
