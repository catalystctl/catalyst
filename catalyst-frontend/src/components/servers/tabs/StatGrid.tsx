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
      ? 'grid-cols-2 md:grid-cols-4'
      : columns === 3
        ? 'grid-cols-1 sm:grid-cols-3'
        : 'grid-cols-1 sm:grid-cols-2';

  return (
    <div
      className={`grid gap-1.5 ${colsClass} ${className}`}
    >
      {items.map((item) => (
        <div
          key={String(item.label)}
          className="rounded-md bg-surface-2/30 px-3 py-2"
        >
          <div className="type-overline">
            {item.label}
          </div>
          <div className="type-numeric mt-0.5 text-sm text-foreground">
            {String(item.value)}
          </div>
        </div>
      ))}
    </div>
  );

}
