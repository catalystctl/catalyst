/**
 * xterm canvas selection is not a DOM selection. Right-click copy works because
 * xterm handles the `copy` event from its internal selection. Ctrl/Cmd+C does
 * not: nothing puts that selection on the clipboard, and ServerConsoleTab only
 * bound Ctrl+F. On Brave/Linux, Ctrl+Shift+C is Inspect Element — intercept it
 * when there is a selection; do not treat it as a user-facing copy shortcut.
 */

const XTERM_HELPER_CLASS = 'xterm-helper-textarea';

export function isEditableCopyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target.classList.contains(XTERM_HELPER_CLASS)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function shouldCopyXtermSelection(ev: KeyboardEvent, hasSelection: boolean): boolean {
  if (!hasSelection || ev.altKey) return false;
  if (ev.key !== 'c' && ev.key !== 'C') return false;

  const cmd = ev.metaKey;
  const ctrl = ev.ctrlKey;
  if (cmd === ctrl) return false;

  // Cmd+Shift+C is not a copy chord on macOS (and is Inspect in some browsers).
  if (cmd && ev.shiftKey) return false;

  // Ctrl/Cmd+C in a real input copies that field. Ctrl+Shift+C is the Linux
  // terminal copy chord — take it even if the command box is focused.
  if (!ev.shiftKey && isEditableCopyTarget(ev.target)) return false;

  return true;
}
