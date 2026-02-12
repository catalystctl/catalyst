import { useEffect, useCallback } from 'react';

interface UseKeyboardShortcutOptions {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  callback: () => void;
  preventDefault?: boolean;
}

/**
 * Hook for registering keyboard shortcuts
 */
export function useKeyboardShortcut({
  key,
  metaKey = false,
  ctrlKey = false,
  shiftKey = false,
  altKey = false,
  callback,
  preventDefault = true,
}: UseKeyboardShortcutOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdKey = isMac ? event.metaKey : event.ctrlKey;

      const keyMatches = event.key.toLowerCase() === key.toLowerCase();
      const metaMatches = metaKey ? cmdKey : true;
      const ctrlMatches = ctrlKey ? event.ctrlKey : !event.ctrlKey || metaKey;
      const shiftMatches = shiftKey ? event.shiftKey : !event.shiftKey;
      const altMatches = altKey ? event.altKey : !event.altKey;

      if (keyMatches && metaMatches && ctrlMatches && shiftMatches && altMatches) {
        if (preventDefault) {
          event.preventDefault();
        }
        callback();
      }
    },
    [key, metaKey, ctrlKey, shiftKey, altKey, callback, preventDefault]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}

/**
 * Hook for Cmd/Ctrl+K shortcut specifically
 */
export function useCmdK(callback: () => void) {
  useKeyboardShortcut({
    key: 'k',
    metaKey: true,
    callback,
    preventDefault: true,
  });
}
