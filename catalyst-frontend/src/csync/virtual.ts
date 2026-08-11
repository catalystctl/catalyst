/**
 * Lightweight list virtualizer with a TanStack Virtual–compatible surface.
 * Used by console (dynamic row heights) and file list (fixed rows).
 *
 * Critical: scrollTop / viewport MUST be reactive state (not ref-only).
 * Reading refs inside useMemo without listing a version dep freezes the
 * visible window on the initial viewport — console showed ~50 lines then blank.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type VirtualItem = {
  index: number;
  key: string | number;
  start: number;
  end: number;
  size: number;
  lane: number;
};

type Options = {
  count: number;
  getScrollElement: () => HTMLElement | null;
  estimateSize: (index: number) => number;
  overscan?: number;
  getItemKey?: (index: number) => string | number;
  measureElement?: (el: Element) => number;
};

export function useVirtualizer(options: Options) {
  const {
    count,
    getScrollElement,
    estimateSize,
    overscan = 5,
    getItemKey = defaultGetItemKey,
  } = options;

  const sizeMapRef = useRef<Map<number, number>>(new Map());
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  // Keep latest callbacks in refs so scroll/measure effects stay stable.
  const getScrollElementRef = useRef(getScrollElement);
  getScrollElementRef.current = getScrollElement;
  const estimateSizeRef = useRef(estimateSize);
  estimateSizeRef.current = estimateSize;
  const measureElementOptRef = useRef(options.measureElement);
  measureElementOptRef.current = options.measureElement;
  const getItemKeyRef = useRef(getItemKey);
  getItemKeyRef.current = getItemKey;

  const measureElement = useCallback((el: Element | null) => {
    if (!el) return;
    const indexAttr = (el as HTMLElement).dataset.index;
    if (indexAttr == null) return;
    const index = Number(indexAttr);
    if (!Number.isFinite(index)) return;
    const height =
      measureElementOptRef.current?.(el) ?? el.getBoundingClientRect().height;
    const prev = sizeMapRef.current.get(index);
    if (prev !== height && height > 0) {
      sizeMapRef.current.set(index, height);
      setMeasuredVersion((n) => n + 1);
    }
  }, []);

  // Drop stale measurements when the list shrinks a lot (e.g. clear console).
  useEffect(() => {
    if (sizeMapRef.current.size > Math.max(count * 2, 32)) {
      sizeMapRef.current.clear();
      setMeasuredVersion((n) => n + 1);
    }
  }, [count]);

  const getSize = useCallback(
    (index: number) => sizeMapRef.current.get(index) ?? estimateSizeRef.current(index),
    // measuredVersion invalidates closed-over map reads after remeasure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measuredVersion, estimateSize],
  );

  const offsets = useMemo(() => {
    const starts: number[] = new Array(count);
    let acc = 0;
    for (let i = 0; i < count; i++) {
      starts[i] = acc;
      acc += getSize(i);
    }
    return { starts, total: acc };
  }, [count, getSize]);

  // Attach scroll + resize listeners. Re-run when count flips 0↔N.
  // If the scroll element is not mounted yet, retry via rAF a few times
  // (latent freeze: count>0 but parentRef still null on first layout).
  const hasItems = count > 0;
  useLayoutEffect(() => {
    if (!hasItems) return;

    let el: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;
    let cancelled = false;
    let tries = 0;
    let raf = 0;

    const onScroll = () => {
      if (!el) return;
      setScrollTop(el.scrollTop);
    };

    const attach = (node: HTMLElement) => {
      el = node;
      setScrollTop(node.scrollTop);
      setViewport(node.clientHeight);
      node.addEventListener('scroll', onScroll, { passive: true });
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => {
          setViewport(node.clientHeight);
        });
        ro.observe(node);
      }
    };

    const tryAttach = () => {
      if (cancelled) return;
      const node = getScrollElementRef.current();
      if (node) {
        attach(node);
        return;
      }
      // Element not ready yet — retry a handful of frames then give up.
      if (tries++ < 20) {
        raf = requestAnimationFrame(tryAttach);
      }
    };

    tryAttach();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      if (el) el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, [hasItems]);

  const virtualItems = useMemo(() => {
    const { starts } = offsets;
    const vp = viewport || 600;

    if (count === 0) return [] as VirtualItem[];

    // Binary search first row that intersects the viewport
    let lo = 0;
    let hi = count - 1;
    let startIdx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const midStart = starts[mid] ?? 0;
      const midSize = getSize(mid);
      const midEnd = midStart + midSize;
      if (midEnd < scrollTop) {
        lo = mid + 1;
      } else if (midStart > scrollTop) {
        hi = mid - 1;
      } else {
        startIdx = mid;
        break;
      }
      startIdx = lo;
    }

    startIdx = Math.max(0, startIdx - overscan);
    const endLimit = scrollTop + vp;
    const items: VirtualItem[] = [];

    for (let i = startIdx; i < count; i++) {
      const start = starts[i] ?? 0;
      const size = getSize(i);
      items.push({
        index: i,
        key: getItemKeyRef.current(i),
        start,
        end: start + size,
        size,
        lane: 0,
      });

      // Past the viewport — add overscan trailing rows then stop
      if (start + size > endLimit) {
        const extraEnd = Math.min(count - 1, i + overscan);
        for (let j = i + 1; j <= extraEnd; j++) {
          const s = starts[j] ?? 0;
          const sz = getSize(j);
          items.push({
            index: j,
            key: getItemKeyRef.current(j),
            start: s,
            end: s + sz,
            size: sz,
            lane: 0,
          });
        }
        break;
      }
    }

    return items;
  }, [offsets, count, getSize, overscan, scrollTop, viewport]);

  // Stable identity: console auto-scroll used to put scrollToIndex in effect deps.
  // Recreating it on every measure cancelled the pending rAF after trackers advanced.
  const countRef = useRef(count);
  countRef.current = count;
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const getSizeLatestRef = useRef(getSize);
  getSizeLatestRef.current = getSize;

  const scrollToIndex = useCallback(
    (
      index: number,
      opts?: { align?: 'start' | 'center' | 'end' | 'auto'; behavior?: ScrollBehavior },
    ) => {
      const el = getScrollElementRef.current();
      if (!el) return;
      const n = countRef.current;
      if (n <= 0) return;
      const clamped = Math.max(0, Math.min(n - 1, index));
      const { starts } = offsetsRef.current;
      const size = getSizeLatestRef.current(clamped);
      const start = starts[clamped] ?? 0;
      const vp = el.clientHeight;
      let top = start;
      const align = opts?.align ?? 'start';
      if (align === 'end') top = start + size - vp;
      else if (align === 'center') top = start + size / 2 - vp / 2;
      el.scrollTo({ top: Math.max(0, top), behavior: opts?.behavior ?? 'auto' });
      // Reflect immediately so the next paint uses the new window
      setScrollTop(Math.max(0, top));
    },
    [],
  );

  const getTotalSize = useCallback(() => offsets.total, [offsets.total]);
  const getVirtualItems = useCallback(() => virtualItems, [virtualItems]);

  return useMemo(
    () => ({
      getVirtualItems,
      getTotalSize,
      totalSize: offsets.total,
      virtualItems,
      measureElement,
      scrollToIndex,
    }),
    [getVirtualItems, getTotalSize, offsets.total, virtualItems, measureElement, scrollToIndex],
  );
}

function defaultGetItemKey(i: number) {
  return i;
}
