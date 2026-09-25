import { Skeleton } from './Skeleton';

export function ServerCardSkeleton() {
  return (
    <div className="rounded-sm border border-border/50 bg-surface-1/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1.5">
          <Skeleton height={16} width="55%" className="h-4" />
          <Skeleton height={12} width="35%" />
        </div>
        <Skeleton height={20} width={52} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Skeleton height={28} />
        <Skeleton height={28} />
        <Skeleton height={28} />
      </div>
      <div className="mt-3 flex gap-2">
        <Skeleton height={28} width={72} />
        <Skeleton height={28} width={72} />
      </div>
    </div>
  );
}

export function ServerCardSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <ServerCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default ServerCardSkeleton;
