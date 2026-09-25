interface TabLoadingStateProps {
 /** Number of skeleton rows to render. Default: 3 */
 rows?: number;
 /** Skeleton row height class. Default: h-14 */
 rowHeight?: string;
}

/**
 * Standardized loading state for server detail tabs. Flat pulse rows — no
 * gradient shimmer and no nested rounded cards.
 */
export default function TabLoadingState({
 rows = 3,
 rowHeight = 'h-14',
}: TabLoadingStateProps) {
 return (
 <div className="space-y-1.5">
 {Array.from({ length: rows }).map((_, i) => (
 <div
 key={i}
 className={`${rowHeight} animate-pulse rounded-sm bg-surface-2/60`}
 />
 ))}
 </div>
 );
}
