import { InboxIcon } from 'lucide-react';

interface TabEmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/**
 * Empty state that sits inside the deck panel: no nested card, no stretched
 * height — just a flat centred block so the panel edge stays unbroken.
 */
export default function TabEmptyState({
  title,
  description,
  action,
}: TabEmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-5 py-6 text-center">
      <InboxIcon className="h-4 w-4 text-muted-foreground/70" />
      <p className="mt-2 text-data font-medium text-foreground">
        {title}
      </p>
      {description && (
        <p className="type-meta mt-1 max-w-xs">
          {description}
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
