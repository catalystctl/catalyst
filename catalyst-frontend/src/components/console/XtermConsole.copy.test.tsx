/**
 * Behavioral contract: with an xterm canvas selection, Ctrl/Cmd+C copies
 * term.getSelection() and preventDefault. Ctrl+Shift+C is intercepted so
 * Brave Inspect does not win. Does not steal Ctrl+C from a real input.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const termSel = vi.hoisted(() => ({ has: false, text: '' }));

vi.mock('@xterm/xterm', () => {
  class Terminal {
    options: Record<string, unknown>;
    rows = 24;
    buffer = { active: { length: 1, viewportY: 0 } };
    constructor(opts: Record<string, unknown> = {}) {
      this.options = { ...opts };
    }
    loadAddon() {}
    open() {}
    write(_data: string, cb?: () => void) {
      cb?.();
    }
    refresh() {}
    scrollToBottom() {}
    onScroll() {
      return { dispose() {} };
    }
    hasSelection() {
      return termSel.has;
    }
    getSelection() {
      return termSel.text;
    }
    dispose() {}
  }
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext() {}
    findPrevious() {}
    clearDecorations() {}
  },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import XtermConsole from './XtermConsole';

const ENTRIES = [{ id: '1', stream: 'stdout', data: 'hello from console\n' }];
const SELECTED = 'hello from console';

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('XtermConsole keyboard copy', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    termSel.has = false;
    termSel.text = '';
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 800;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 400;
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  function mount() {
    render(<XtermConsole entries={ENTRIES} />);
    expect(screen.getByRole('log', { name: 'Server console output' })).toBeInTheDocument();
  }

  it('copies the xterm selection on Ctrl+C and preventDefault', () => {
    mount();
    termSel.has = true;
    termSel.text = SELECTED;

    const event = press({ key: 'c', ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(SELECTED);
  });

  it('copies on Cmd+C', () => {
    mount();
    termSel.has = true;
    termSel.text = SELECTED;

    const event = press({ key: 'c', metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(writeText).toHaveBeenCalledWith(SELECTED);
  });

  it('intercepts Ctrl+Shift+C so Brave Inspect does not win', () => {
    mount();
    termSel.has = true;
    termSel.text = SELECTED;

    const event = press({ key: 'C', ctrlKey: true, shiftKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(writeText).toHaveBeenCalledWith(SELECTED);
  });

  it('does not copy or preventDefault when nothing is selected', () => {
    mount();

    const event = press({ key: 'c', ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('does not steal Ctrl+C from the command input', () => {
    mount();
    termSel.has = true;
    termSel.text = SELECTED;

    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = press({ key: 'c', ctrlKey: true }, input);
    input.remove();

    expect(event.defaultPrevented).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('still intercepts Ctrl+Shift+C when the command input is focused', () => {
    mount();
    termSel.has = true;
    termSel.text = SELECTED;

    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = press({ key: 'C', ctrlKey: true, shiftKey: true }, input);
    input.remove();

    expect(event.defaultPrevented).toBe(true);
    expect(writeText).toHaveBeenCalledWith(SELECTED);
  });

  it('removes the window listener on unmount', () => {
    const { unmount } = render(<XtermConsole entries={ENTRIES} />);
    termSel.has = true;
    termSel.text = SELECTED;
    unmount();

    const event = press({ key: 'c', ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
