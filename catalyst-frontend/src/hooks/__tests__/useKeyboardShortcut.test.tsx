import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcut } from '../useKeyboardShortcut';

/** Dispatch a keydown from `target`, the way the browser does. */
function press(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcut', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('fires an unmodified shortcut from the page body', () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: '/', callback }));
    press(document.body, { key: '/' });
    expect(callback).toHaveBeenCalledOnce();
  });

  it('ignores an unmodified shortcut typed into an input', () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: '/', callback }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    press(input, { key: '/' });
    expect(callback).not.toHaveBeenCalled();
  });

  it('ignores typing targets for textarea, select and contenteditable', () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'n', callback }));

    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    // React (and every framework) writes the attribute; jsdom does not reflect
    // the `contentEditable` property onto it, so set the attribute directly.
    editable.setAttribute('contenteditable', 'true');
    document.body.append(textarea, select, editable);

    press(textarea, { key: 'n' });
    press(select, { key: 'n' });
    press(editable, { key: 'n' });
    expect(callback).not.toHaveBeenCalled();
  });

  it('still honours a modifier shortcut inside an input', () => {
    const callback = vi.fn();
    renderHook(() => useKeyboardShortcut({ key: 'k', metaKey: true, callback }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    // jsdom reports a non-Mac platform, so Cmd/Ctrl+K resolves through ctrlKey.
    press(input, { key: 'k', ctrlKey: true, metaKey: true });
    expect(callback).toHaveBeenCalledOnce();
  });
});