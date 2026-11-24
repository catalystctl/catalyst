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
 * True for events that originate in a typing surface. Shortcuts must not fire
 * there: Cmd/Ctrl+K over an email field, or a future single-letter shortcut in
 * a textarea, would fight the input instead of the app.
 */
function isTypingTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.tagName !== 'string') return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  // jsdom (and older browsers) do not implement `isContentEditable`, so read
  // the attribute as well and walk up: the event can land on an inner node.
  if (target.isContentEditable === true) return true;
  const editable = target.closest?.('[contenteditable]') as HTMLElement | null;
  return Boolean(editable && editable.getAttribute('contenteditable') !== 'false');
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
        // A modifier-driven shortcut still wins inside a field (⌘K in a text
        // input is unambiguous); an unmodified one is typing, not a command.
        const hasModifier = metaKey || ctrlKey || altKey;
        if (!hasModifier && isTypingTarget(event)) return;
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
