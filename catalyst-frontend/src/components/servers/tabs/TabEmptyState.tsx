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
    <div className="flex flex-col items-center rounded-md border border-dashed border-border/50 bg-surface-2/20 px-5 py-7 text-center">
      <InboxIcon className="h-5 w-5 text-muted-foreground" />
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
