import { useState } from 'react';

type EulaModalProps = {
  eulaText: string;
  onAccept: () => void;
  onDecline: () => void;
  isLoading?: boolean;
};

export default function EulaModal({ eulaText, onAccept, onDecline, isLoading }: EulaModalProps) {
  const [canAccept, setCanAccept] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
      setCanAccept(true);
    }
  };

  // If content doesn't overflow, enable accept immediately
  const handleContentRef = (el: HTMLDivElement | null) => {
    if (el && el.scrollHeight <= el.clientHeight) {
      setCanAccept(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-white shadow-2xl dark:border-border dark:bg-zinc-950">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-5 dark:border-border">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <svg className="h-5 w-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground dark:text-zinc-100">
              Minecraft EULA
            </h2>
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">
              You must agree to the Minecraft End User License Agreement before the server can start.
            </p>
          </div>
        </div>

        {/* EULA text */}
        <div className="px-6 py-4">
          <div
            className="max-h-72 overflow-y-auto rounded-lg border border-border bg-surface-2 p-4 text-sm leading-relaxed text-muted-foreground dark:border-border dark:bg-surface-1 dark:text-muted-foreground"
            onScroll={handleScroll}
            ref={handleContentRef}
          >
            {eulaText || 'EULA text could not be loaded from the server files.'}
          </div>
          {!canAccept && (
            <p className="mt-2 text-xs text-muted-foreground dark:text-muted-foreground">
              Scroll to the bottom to enable the accept button.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4 dark:border-border">
          <button
            className="rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:border-border dark:bg-surface-1 dark:text-zinc-300 dark:hover:border-rose-500/30 dark:hover:bg-rose-950/20 dark:hover:text-rose-400"
            onClick={onDecline}
            disabled={isLoading}
          >
            Decline
          </button>
          <button
            className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/30 transition-all duration-200 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onAccept}
            disabled={isLoading || !canAccept}
          >
            {isLoading ? 'Submitting...' : 'I Agree'}
          </button>
        </div>
      </div>
    </div>
  );
}
