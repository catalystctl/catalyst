import { AlertCircle } from 'lucide-react';

interface TabErrorStateProps {
  /** Error message to display */
  message: string;
  /** Optional retry handler — shows a Retry button when provided */
  onRetry?: () => void;
}

/**
 * Standardized error state for server detail tabs.
 */
export default function TabErrorState({ message, onRetry }: TabErrorStateProps) {
  return (
    <div className="rounded-lg border border-danger/25 bg-danger/5 px-4 py-3">
      <div className="flex items-center gap-2.5 text-xs text-danger">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger/10">
          <AlertCircle className="h-3 w-3" />
        </div>
        <span>{message}</span>
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
