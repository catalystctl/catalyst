interface StatItemProps {
 label: string;
 value: string | number;
}

interface StatGridProps {
 items: StatItemProps[];
 /** Number of columns at sm breakpoint and above. Default: 2 */
 columns?: 2 | 3 | 4;
 className?: string;
}

/**
 * Compact labelled-value strip: one frame, 1px hairline cells, mono tabular
 * values. No per-item rounded card.
 */
export default function StatGrid({
 items,
 columns = 2,
 className = '',
}: StatGridProps) {
 const colsClass =
   columns === 4
     ? 'grid-cols-2 md:grid-cols-4'
     : columns === 3
       ? 'grid-cols-1 sm:grid-cols-3'
       : 'grid-cols-1 sm:grid-cols-2';

 return (
   <div
     className={`grid gap-px overflow-hidden rounded-sm border border-border/50 bg-border/50 ${colsClass} ${className}`}
   >
     {items.map((item) => (
       <div
         key={String(item.label)}
         className="min-w-0 bg-card px-3 py-2"
       >
         <div className="type-overline truncate">
           {item.label}
         </div>
         <div className="mt-0.5 truncate font-mono text-data tabular-nums text-foreground">
           {String(item.value)}
         </div>
       </div>
     ))}
   </div>
 );

}
