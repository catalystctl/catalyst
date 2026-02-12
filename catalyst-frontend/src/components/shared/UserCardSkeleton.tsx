import { Skeleton } from './Skeleton';

export function UserCardSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-surface-light dark:border-slate-800 dark:bg-slate-950/60">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton height={20} width="50%" className="h-5" />
          <Skeleton height={12} width="30%" className="h-3" />
        </div>
        <div className="flex gap-2">
          <Skeleton height={28} width={48} rounded="md" className="h-7" />
          <Skeleton height={28} width={56} rounded="md" className="h-7" />
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <Skeleton height={32} rounded="xl" className="h-8" />
        <div>
          <Skeleton height={10} width={40} className="h-2.5 mb-2" />
          <div className="flex gap-2">
            <Skeleton height={24} width={60} rounded="full" className="h-6" />
            <Skeleton height={24} width={70} rounded="full" className="h-6" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function UserCardSkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <UserCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default UserCardSkeleton;
