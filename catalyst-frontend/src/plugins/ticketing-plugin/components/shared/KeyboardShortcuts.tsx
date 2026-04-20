import { useEffect, useCallback } from 'react';
import { KEYBOARD_SHORTCUTS } from '../../constants';
import { Dialog, DialogContent, DialogHeader, DialogTitle, cn, SURFACE_2, FONT_DISPLAY } from '../../../plugin-ui';

interface KeyboardShortcutsProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardShortcuts({ open, onClose }: KeyboardShortcutsProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    },
    [open, onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => !isOpen && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onClick={(e: React.MouseEvent<HTMLDivElement>) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <DialogHeader>
          <DialogTitle className={FONT_DISPLAY}>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 pt-2">
          {KEYBOARD_SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.key}
              className={cn(
                'flex items-center justify-between rounded-md px-3 py-2 transition-colors',
                SURFACE_2,
              )}
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{shortcut.label}</span>
                <span className="text-xs text-muted-foreground">{shortcut.description}</span>
              </div>

              <kbd
                className={cn(
                  'inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-surface-3 px-1.5 font-mono text-[11px] font-medium text-foreground',
                )}
              >
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
