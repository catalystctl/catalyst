interface TabLoadingStateProps {
 /** Number of skeleton rows to render. Default: 3 */
 rows?: number;
 /** Skeleton row height class. Default: h-14 */
 rowHeight?: string;
}

/**
 * Standardized loading state for server detail tabs.
 * Shimmer-style skeleton rows.
 */
export default function TabLoadingState({
 rows = 3,
 rowHeight = 'h-14',
}: TabLoadingStateProps) {
 return (
 <div className="space-y-2.5">
 {Array.from({ length: rows }).map((_, i) => (
 <div
 key={i}
 className={`${rowHeight} overflow-hidden rounded-lg bg-surface-2/60`}
 >
 {/* Shimmer overlay */}
 <div className="h-full w-full animate-pulse bg-gradient-to-r from-transparent via-surface-3/30 to-transparent bg-[length:200%_100%]" />
 </div>
 ))}
 </div>
 );
}
