import React, { useEffect, useCallback } from 'react';

interface KeyboardShortcutsProps {
  onNewTicket?: () => void;
  onClose?: () => void;
  onFocusSearch?: () => void;
  enabled?: boolean;
}

export function KeyboardShortcuts({
  onNewTicket,
  onClose,
  onFocusSearch,
  enabled = true,
}: KeyboardShortcutsProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }

      if (isInput) return;

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        onNewTicket?.();
      } else if (e.key === '/') {
        e.preventDefault();
        onFocusSearch?.();
      }
    },
    [enabled, onNewTicket, onClose, onFocusSearch]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return null;
}

// ─── Shortcut Hints ────────────────────────────────────────

interface ShortcutHintProps {
  keys: string[];
  description: string;
}

export function ShortcutHint({ keys, description }: ShortcutHintProps) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-0.5">
        {keys.map((key, i) => (
          <React.Fragment key={key}>
            <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 text-[10px] font-mono font-medium text-foreground">
              {key}
            </kbd>
            {i < keys.length - 1 && <span className="text-[10px]">+</span>}
          </React.Fragment>
        ))}
      </span>
      {description}
    </span>
  );
}
