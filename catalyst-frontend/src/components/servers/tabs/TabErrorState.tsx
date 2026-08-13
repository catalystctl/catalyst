import { AlertCircle } from 'lucide-react';

interface TabErrorStateProps {
  message?: string;
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export default function TabErrorState({ message, title, description, onRetry }: TabErrorStateProps) {
  const heading = message ?? title ?? 'Something went wrong';

  return (
    <div className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3">
      <div className="flex items-start gap-2.5 text-xs text-danger">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger/10">
          <AlertCircle className="h-3 w-3" />
        </div>
        <div>
          <p>{heading}</p>
          {description && <p className="type-meta mt-1">{description}</p>}
        </div>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2.5 ml-7 rounded-md border border-danger/20 bg-danger/5 px-2.5 py-1 text-[10px] font-semibold text-danger transition-colors hover:bg-danger/10 hover:border-danger/30"
        >
          Retry
        </button>
      )}
    </div>
  );
}
