import { InboxIcon } from 'lucide-react';

interface TabEmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export default function TabEmptyState({
  title,
  description,
  action,
}: TabEmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-border/50 bg-surface-2/20 px-5 py-7 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground">
        <InboxIcon className="h-4 w-4" />
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">
        {title}
      </p>
      {description && (
        <p className="type-meta mt-1 max-w-xs">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
