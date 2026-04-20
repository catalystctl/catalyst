import { Skeleton, cn } from '../../../plugin-ui';

interface LoadingSkeletonProps {
  rows?: number;
  className?: string;
}

export function LoadingSkeleton({ rows = 6, className }: LoadingSkeletonProps) {
  return (
    <div className={cn('space-y-1', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-2.5">
          {/* Checkbox */}
          <Skeleton className="h-4 w-4 rounded-sm" />

          {/* Ticket number */}
          <Skeleton className="h-4 w-24 flex-shrink-0" />

          {/* Title (varying width) */}
          <Skeleton className="h-4 flex-1" style={{ maxWidth: `${50 + (i * 7) % 30}%` }} />

          {/* Status */}
          <Skeleton className="h-5 w-20 rounded-full" />

          {/* Priority */}
          <Skeleton className="h-4 w-16" />

          {/* Category */}
          <Skeleton className="h-4 w-20 hidden sm:block" />

          {/* Assignee */}
          <Skeleton className="h-6 w-6 rounded-full hidden md:block" />
          <Skeleton className="h-4 w-16 hidden md:block" />

          {/* Time */}
          <Skeleton className="h-4 w-12 flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}
