import { Skeleton } from './Skeleton';

export function UserCardSkeleton() {
  return (
    <div className="rounded-sm border border-border/50 bg-surface-1/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <Skeleton height={16} width="50%" className="h-4" />
          <Skeleton height={12} width="30%" />
        </div>
        <div className="flex gap-2">
          <Skeleton height={28} width={48} />
          <Skeleton height={28} width={56} />
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Skeleton height={28} />
        <div>
          <Skeleton height={10} width={40} className="mb-1.5" />
          <div className="flex gap-2">
            <Skeleton height={20} width={60} />
            <Skeleton height={20} width={70} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function UserCardSkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <UserCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default UserCardSkeleton;
