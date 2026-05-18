import { Skeleton } from './Skeleton';

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <div className="rounded-xl border border-border/30 bg-card overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/30 bg-surface-2 px-4 py-3 grid gap-4"
           style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} height={14} className="h-3.5" />
        ))}
      </div>
      {/* Rows */}
      <div className="divide-y divide-border/30">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="px-4 py-3 grid gap-4"
               style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Skeleton key={colIndex} height={14} className="h-3.5" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default TableSkeleton;
