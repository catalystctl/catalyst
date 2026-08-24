import { describe, expect, it } from 'vitest';
import { isEditableCopyTarget, shouldCopyXtermSelection } from './consoleClipboard';

function key(
  init: KeyboardEventInit,
  target?: EventTarget | null,
): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (target !== undefined) {
    Object.defineProperty(ev, 'target', { value: target });
  }
  return ev;
}

describe('isEditableCopyTarget', () => {
  it('treats xterm helper textarea as the terminal, not an input', () => {
    const ta = document.createElement('textarea');
    ta.className = 'xterm-helper-textarea';
    expect(isEditableCopyTarget(ta)).toBe(false);
  });

  it('detects command inputs', () => {
    expect(isEditableCopyTarget(document.createElement('input'))).toBe(true);
    expect(isEditableCopyTarget(document.createElement('textarea'))).toBe(true);
  });
});

describe('shouldCopyXtermSelection', () => {
  const input = document.createElement('input');
  const helper = document.createElement('textarea');
  helper.className = 'xterm-helper-textarea';

  it('copies Ctrl+C when the terminal has a selection', () => {
    expect(shouldCopyXtermSelection(key({ key: 'c', ctrlKey: true }, helper), true)).toBe(true);
  });

  it('does not steal Ctrl+C from the command input', () => {
    expect(shouldCopyXtermSelection(key({ key: 'c', ctrlKey: true }, input), true)).toBe(false);
  });

  it('copies Ctrl+Shift+C even if the command input is focused (Linux / Brave Inspect collision)', () => {
    expect(shouldCopyXtermSelection(key({ key: 'C', ctrlKey: true, shiftKey: true }, input), true)).toBe(true);
    expect(shouldCopyXtermSelection(key({ key: 'c', ctrlKey: true, shiftKey: true }, helper), true)).toBe(true);
  });

  it('copies Cmd+C on macOS, but not Cmd+Shift+C', () => {
    expect(shouldCopyXtermSelection(key({ key: 'c', metaKey: true }, helper), true)).toBe(true);
    expect(shouldCopyXtermSelection(key({ key: 'c', metaKey: true, shiftKey: true }, helper), true)).toBe(false);
  });

  it('ignores the chord when nothing is selected', () => {
    expect(shouldCopyXtermSelection(key({ key: 'c', ctrlKey: true }, helper), false)).toBe(false);
    expect(shouldCopyXtermSelection(key({ key: 'C', ctrlKey: true, shiftKey: true }, helper), false)).toBe(false);
  });

  it('ignores unrelated modifiers and keys', () => {
    expect(shouldCopyXtermSelection(key({ key: 'c', ctrlKey: true, altKey: true }, helper), true)).toBe(false);
    expect(shouldCopyXtermSelection(key({ key: 'c', ctrlKey: true, metaKey: true }, helper), true)).toBe(false);
    expect(shouldCopyXtermSelection(key({ key: 'f', ctrlKey: true }, helper), true)).toBe(false);
  });
});
