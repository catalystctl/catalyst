/**
 * Behavioral contract: searching the console must not crash the tab.
 *
 * The search addon paints a decoration per match, and decorations belong to
 * xterm's *proposed* API — calling registerDecoration on a terminal built
 * without `allowProposedApi: true` throws, which unmounted XtermConsole into
 * the error boundary as soon as a query was typed. The mocked SearchAddon
 * mirrors that guard so dropping the option fails here instead of in the panel.
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => ({ terminal: null as any, findNextCalls: 0 }));

vi.mock('@xterm/xterm', () => {
  class Terminal {
    options: Record<string, unknown>;
    rows = 24;
    buffer = { active: { length: 1, viewportY: 0 } };
    constructor(opts: Record<string, unknown> = {}) {
      this.options = { ...opts };
      capture.terminal = this;
    }
    loadAddon(addon: { activate?: (term: unknown) => void } = {}) {
      addon.activate?.(this);
    }
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
    private term: any = null;
    activate(term: any) {
      this.term = term;
    }
    findNext(_query: string, options: { decorations?: unknown } = {}) {
      capture.findNextCalls += 1;
      // Same guard the real addon applies via Terminal.registerDecoration.
      if (options.decorations && !this.term?.options?.allowProposedApi) {
        throw new Error(
          'You must set the allowProposedApi option to true to use proposed API',
        );
      }
    }
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

class Boundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <div data-testid="crashed" /> : this.props.children;
  }
}

describe('XtermConsole search decorations', () => {
  beforeEach(() => {
    capture.findNextCalls = 0;
    capture.terminal = null;
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

  it('builds the terminal with the proposed API enabled', () => {
    render(<XtermConsole entries={ENTRIES} />);
    expect(capture.terminal?.options?.allowProposedApi).toBe(true);
  });

  it('highlights matches without unmounting the console', () => {
    render(
      <Boundary>
        <XtermConsole entries={ENTRIES} searchQuery="INFO" />
      </Boundary>,
    );

    expect(screen.queryByTestId('crashed')).toBeNull();
    expect(screen.getByRole('log', { name: 'Server console output' })).toBeInTheDocument();
    expect(capture.findNextCalls).toBeGreaterThan(0);

    cleanup();
  });
});
