/**
 * Console output fidelity: shell characters must reach the terminal verbatim.
 *
 * Regression: the panel's websocket gateway used to strip < and > from console
 * data (an XSS defense that the xterm renderer never needed), so lines like
 * `Xvfb :99 >/dev/null 2>&1 &` displayed as `Xvfb :99 /dev/null 2&1 &` —
 * corrupting what customers read and copy out of the console. The gateway now
 * relays data verbatim; this test pins the other half of the contract: the
 * frontend must write those characters to the terminal unchanged.
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => ({ writes: [] as string[] }));

vi.mock('@xterm/xterm', () => {
  class Terminal {
    options: Record<string, unknown> = {};
    rows = 24;
    buffer = { active: { length: 1, viewportY: 0 } };
    constructor(opts: Record<string, unknown> = {}) {
      this.options = { ...opts };
    }
    loadAddon(addon: { activate?: (term: unknown) => void } = {}) {
      addon.activate?.(this);
    }
    open() {}
    write(data: string, cb?: () => void) {
      capture.writes.push(data);
      cb?.();
    }
    refresh() {}
    scrollToBottom() {}
    onScroll() {
      return { dispose() {} };
    }
    hasSelection() {
      return false;
    }
    getSelection() {
      return '';
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
    activate() {}
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

describe('XtermConsole output fidelity', () => {
  beforeEach(() => {
    capture.writes = [];
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
  });

  it('writes shell redirects and angle brackets to the terminal verbatim', () => {
    const raw = 'Xvfb :99 -screen 0 1024x768x24 >/dev/null 2>&1 &\n';
    render(
      <XtermConsole
        entries={[{ id: '1', stream: 'stdout', data: raw }]}
      />,
    );

    const written = capture.writes.join('');
    expect(written).toContain('>/dev/null 2>&1');
    expect(written).not.toContain('2&1');
  });
});
