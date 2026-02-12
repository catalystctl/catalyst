import { Skeleton } from './Skeleton';

export function ServerCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-surface-light dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <Skeleton height={20} width="60%" className="h-5" />
          <Skeleton height={14} width="40%" className="h-3.5" />
        </div>
        <Skeleton height={24} width={60} rounded="full" className="h-6" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Skeleton height={40} className="h-10" />
        <Skeleton height={40} className="h-10" />
        <Skeleton height={40} className="h-10" />
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton height={32} width={80} rounded="lg" className="h-8" />
        <Skeleton height={32} width={80} rounded="lg" className="h-8" />
      </div>
    </div>
  );
}

export function ServerCardSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <ServerCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default ServerCardSkeleton;
