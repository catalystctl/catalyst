import { InboxIcon } from 'lucide-react';

interface TabEmptyStateProps {
 /** Main message */
 title: string;
 /** Supporting description */
 description?: string;
 /** Optional action element (button, link, etc.) */
 action?: React.ReactNode;
}

/**
 * Standardized empty state for server detail tabs.
 * Subtle icon + centered message + optional action.
 */
export default function TabEmptyState({
 title,
 description,
 action,
}: TabEmptyStateProps) {
 return (
 <div className="flex flex-col items-center rounded-lg border border-dashed border-border/60 bg-surface-2/30 px-6 py-10 text-center">
 <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted-foreground/40">
 <InboxIcon className="h-5 w-5" />
 </div>
 <p className="mt-3 text-sm font-medium text-muted-foreground/70">
 {title}
 </p>
 {description && (
 <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-muted-foreground/40">
 {description}
 </p>
 )}
 {action && <div className="mt-4">{action}</div>}
 </div>
 );
}
