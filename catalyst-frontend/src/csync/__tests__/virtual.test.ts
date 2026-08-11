/**
 * useVirtualizer — scroll window must advance with scrollTop.
 * Regression: ref-only scroll + memo without scroll dep froze the first viewport.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVirtualizer } from '../virtual';

function makeScrollEl(height = 200, scrollHeight = 5000) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  let scrollTop = 0;
  Object.defineProperty(el, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
    configurable: true,
  });
  el.scrollTo = ((opts: ScrollToOptions | number) => {
    if (typeof opts === 'number') scrollTop = opts;
    else if (opts && typeof opts.top === 'number') scrollTop = opts.top;
    el.dispatchEvent(new Event('scroll'));
  }) as typeof el.scrollTo;
  return el;
}

describe('useVirtualizer', () => {
  let el: HTMLDivElement;

  beforeEach(() => {
    el = makeScrollEl(260, 20_000);
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
  });

  it('renders the first window at scrollTop 0', () => {
    const { result } = renderHook(() =>
      useVirtualizer({
        count: 500,
        getScrollElement: () => el,
        estimateSize: () => 26,
        overscan: 2,
      }),
    );

    const items = result.current.getVirtualItems();
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].index).toBe(0);
    // ~260/26 ≈ 10 rows + overscan — nowhere near full 500
    expect(items[items.length - 1].index).toBeLessThan(40);
    expect(result.current.totalSize).toBe(500 * 26);
  });

  it('advances the visible window when the user scrolls (regression)', () => {
    const { result } = renderHook(() =>
      useVirtualizer({
        count: 500,
        getScrollElement: () => el,
        estimateSize: () => 26,
        overscan: 2,
      }),
    );

    const firstEnd = result.current.getVirtualItems().at(-1)!.index;

    act(() => {
      el.scrollTop = 26 * 100; // jump ~100 rows down
      el.dispatchEvent(new Event('scroll'));
    });

    const items = result.current.getVirtualItems();
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].index).toBeGreaterThan(50);
    expect(items[0].index).toBeGreaterThan(firstEnd - 5);
    // Must not still be stuck on the initial top window
    expect(items.every((it) => it.index < 40)).toBe(false);
  });

  it('scrollToIndex updates the window toward the target', () => {
    const { result } = renderHook(() =>
      useVirtualizer({
        count: 500,
        getScrollElement: () => el,
        estimateSize: () => 26,
        overscan: 1,
      }),
    );

    act(() => {
      result.current.scrollToIndex(400, { align: 'start' });
    });

    const items = result.current.getVirtualItems();
    expect(items.some((it) => it.index >= 390)).toBe(true);
  });

  it('returns empty items when count is 0', () => {
    const { result } = renderHook(() =>
      useVirtualizer({
        count: 0,
        getScrollElement: () => el,
        estimateSize: () => 26,
      }),
    );
    expect(result.current.getVirtualItems()).toEqual([]);
    expect(result.current.totalSize).toBe(0);
  });

  it('does not thrash when getScrollElement identity changes each render', () => {
    let renders = 0;
    const { rerender } = renderHook(() => {
      renders += 1;
      // Fresh arrow every render — old impl re-bound scroll and bumped forever
      return useVirtualizer({
        count: 20,
        getScrollElement: () => el,
        estimateSize: () => 26,
      });
    });

    const before = renders;
    rerender();
    rerender();
    rerender();
    // A few parent re-renders should not explode into an update loop
    expect(renders - before).toBeLessThan(10);
  });

  it('scrollToIndex identity is stable across count/measure changes', () => {
    let count = 50;
    const { result, rerender } = renderHook(() =>
      useVirtualizer({
        count,
        getScrollElement: () => el,
        estimateSize: () => 26,
        overscan: 1,
      }),
    );

    const first = result.current.scrollToIndex;
    count = 80;
    rerender();
    expect(result.current.scrollToIndex).toBe(first);

    act(() => {
      result.current.scrollToIndex(70, { align: 'end' });
    });
    // Still the same function after scrolling/window update
    expect(result.current.scrollToIndex).toBe(first);
  });

  it('scrollToIndex align end lands near the bottom of the list', () => {
    const { result } = renderHook(() =>
      useVirtualizer({
        count: 200,
        getScrollElement: () => el,
        estimateSize: () => 26,
        overscan: 2,
      }),
    );

    act(() => {
      result.current.scrollToIndex(199, { align: 'end' });
    });

    const items = result.current.getVirtualItems();
    expect(items.some((it) => it.index >= 190)).toBe(true);
    // DOM scrollTop should be near total - viewport
    const expectedBottom = 200 * 26 - el.clientHeight;
    expect(el.scrollTop).toBeGreaterThan(expectedBottom - 5);
  });
});
