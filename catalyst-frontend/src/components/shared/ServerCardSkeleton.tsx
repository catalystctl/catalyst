import { Skeleton } from './Skeleton';

export function ServerCardSkeleton() {
  return (
    <div className="deck-panel flex items-center gap-3 px-4 py-3">
      <Skeleton height={32} width={32} />
      <div className="flex-1 space-y-1.5">
        <Skeleton height={14} width="40%" />
        <Skeleton height={12} width="25%" />
      </div>
      <Skeleton height={20} width={52} />
    </div>
  );
}

export function ServerCardSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <ServerCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default ServerCardSkeleton;
