import { cn } from '../../lib/utils';

interface SkeletonProps {
 className?: string;
 width?: string | number;
 height?: string | number;
 rounded?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const roundedClasses = {
 none: 'rounded-none',
 sm: 'rounded-sm',
 md: 'rounded-md',
 lg: 'rounded-lg',
 xl: 'rounded-xl',
 full: 'rounded-full',
};

export function Skeleton({ className, width, height, rounded = 'sm' }: SkeletonProps) {
 return (
 <div
 className={cn(
 'animate-pulse bg-surface-3',
 roundedClasses[rounded],
 className
 )}
 style={{
 width: typeof width === 'number' ? `${width}px` : width,
 height: typeof height === 'number' ? `${height}px` : height,
 }}
 />
 );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
 return (
 <div className={cn('space-y-1.5', className)}>
 {Array.from({ length: lines }).map((_, i) => (
 <Skeleton
 key={i}
 height={12}
 className="h-3"
 rounded="sm"
 />
 ))}
 </div>
 );
}

export default Skeleton;
