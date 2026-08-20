/**
 * Lightweight list virtualizer with a TanStack Virtual–compatible surface.
 * Used by console (dynamic row heights) and file list (fixed rows).
 *
 * Fixes applied for production readiness:
 * - Measurements keyed by item key (not index) so prepend/reorder doesn't map wrong heights
 * - ResizeObserver on measured rows for dynamic height changes
 * - Scroll element rebind on element change (not just count flip)
 * - No hard rAF cap; retries until element available or count goes 0 or unmount
 * - getItemKey identity tracked for memo invalidation
 * - scrollToIndex: 'auto' implemented, no lie on clamped/smooth scroll
 * - Scroll compensation for size changes above viewport
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

  // Keyed by item key (stable across reorder/prepend), not index
  const sizeMapRef = useRef<Map<string | number, number>>(new Map());
  // Track last key for each index to detect re-key
  const keyAtIndexRef = useRef<Map<number, string | number>>(new Map());
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  const getScrollElementRef = useRef(getScrollElement);
  getScrollElementRef.current = getScrollElement;
  const estimateSizeRef = useRef(estimateSize);
  estimateSizeRef.current = estimateSize;
  const measureElementOptRef = useRef(options.measureElement);
  measureElementOptRef.current = options.measureElement;
  const getItemKeyRef = useRef(getItemKey);
  getItemKeyRef.current = getItemKey;
  // Track previous scrollTop to compensate for size changes above viewport
  const prevScrollTopRef = useRef(0);

  const getKey = useCallback((index: number): string | number => {
    try {
      return getItemKeyRef.current(index);
    } catch {
      return index;
    }
  }, []);

  const measureElement = useCallback((el: Element | null) => {
    if (!el) return;
    const indexAttr = (el as HTMLElement).dataset.index;
    if (indexAttr == null) return;
    const index = Number(indexAttr);
    if (!Number.isFinite(index)) return;
    const key = getKey(index);
    const height =
      measureElementOptRef.current?.(el) ?? el.getBoundingClientRect().height;
    const prev = sizeMapRef.current.get(key);
    if (prev !== height && height > 0) {
      sizeMapRef.current.set(key, height);
      keyAtIndexRef.current.set(index, key);
      setMeasuredVersion((n) => n + 1);
    } else if (!keyAtIndexRef.current.has(index)) {
      keyAtIndexRef.current.set(index, key);
    }
  }, [getKey]);

  // Row ResizeObserver: remeasure when measured row content resizes
  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const observedRowsRef = useRef<Map<Element, number>>(new Map());

  const ensureRowObserver = useCallback(() => {
    if (rowObserverRef.current) return rowObserverRef.current;
    if (typeof ResizeObserver === 'undefined') return null;
    rowObserverRef.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const idxAttr = el.dataset.index;
        if (idxAttr == null) continue;
        const index = Number(idxAttr);
        if (!Number.isFinite(index)) continue;
        const key = getKey(index);
        const h = measureElementOptRef.current?.(el) ?? el.getBoundingClientRect().height;
        if (h > 0 && sizeMapRef.current.get(key) !== h) {
          sizeMapRef.current.set(key, h);
          changed = true;
        }
      }
      if (changed) setMeasuredVersion((n) => n + 1);
    });
    return rowObserverRef.current;
  }, [getKey]);

  // When measureElement is called, also observe that row for future resizes
  const measureElementWithObserve = useCallback((el: Element | null) => {
    measureElement(el);
    if (!el) return;
    const ro = ensureRowObserver();
    if (ro && !observedRowsRef.current.has(el)) {
      const idxAttr = (el as HTMLElement).dataset.index;
      if (idxAttr != null) {
        const idx = Number(idxAttr);
        if (Number.isFinite(idx)) {
          ro.observe(el);
          observedRowsRef.current.set(el, idx);
        }
      }
    }
  }, [measureElement, ensureRowObserver]);

  useEffect(() => {
    const observedRows = observedRowsRef.current;
    return () => {
      rowObserverRef.current?.disconnect();
      observedRows.clear();
    };
  }, []);

  // Drop stale measurements when list shrinks or keys change
  useEffect(() => {
    // Clear entries for indices beyond count
    let changed = false;
    for (const [idx] of keyAtIndexRef.current) {
      if (idx >= count) {
        const k = keyAtIndexRef.current.get(idx);
        if (k != null) sizeMapRef.current.delete(k);
        keyAtIndexRef.current.delete(idx);
        changed = true;
      }
    }
    if (sizeMapRef.current.size > Math.max(count * 2, 32)) {
      sizeMapRef.current.clear();
      keyAtIndexRef.current.clear();
      changed = true;
    }
    if (changed) setMeasuredVersion((n) => n + 1);
  }, [count]);

  // Invalidate key mapping when getItemKey identity changes. offsets depends on
  // getItemKey so the window recomputes after the size map is cleared.
  const prevGetItemKeyRef = useRef(getItemKey);
  if (prevGetItemKeyRef.current !== getItemKey) {
    prevGetItemKeyRef.current = getItemKey;
    // Keys may have changed — clear size map keyed by old keys
    sizeMapRef.current.clear();
    keyAtIndexRef.current.clear();
  }

  const getSize = useCallback(
    (index: number) => {
      const k = getKey(index);
      return sizeMapRef.current.get(k) ?? estimateSizeRef.current(index);
    },
    [getKey],
  );

  const offsets = useMemo(() => {
    const starts: number[] = new Array(count);
    let acc = 0;
    for (let i = 0; i < count; i++) {
      starts[i] = acc;
      acc += getSize(i);
    }
    return { starts, total: acc };
    // measuredVersion / getItemKey invalidate cached sizes after measure or re-key.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- size map is ref-backed
  }, [count, getSize, measuredVersion, getItemKey]);

  // Scroll position compensation: when measured sizes above viewport change, keep viewport stable
  const offsetsRefForComp = useRef(offsets);
  useEffect(() => {
    const prevStarts = offsetsRefForComp.current.starts;
    const nextStarts = offsets.starts;
    if (prevStarts.length === nextStarts.length && count > 0) {
      // Find first visible index
      const vpTop = scrollTop;
      let visibleIdx = 0;
      for (let i = 0; i < count; i++) {
        if ((nextStarts[i] ?? 0) <= vpTop && vpTop < (nextStarts[i] ?? 0) + getSize(i)) {
          visibleIdx = i;
          break;
        }
        if ((nextStarts[i] ?? 0) > vpTop) { visibleIdx = i; break; }
      }
      const prevVisibleStart = prevStarts[visibleIdx] ?? 0;
      const nextVisibleStart = nextStarts[visibleIdx] ?? 0;
      const delta = nextVisibleStart - prevVisibleStart;
      if (delta !== 0 && Math.abs(delta) < 5000) {
        const el = getScrollElementRef.current();
        if (el) {
          const newTop = Math.max(0, el.scrollTop + delta);
          if (Math.abs(newTop - el.scrollTop) > 0.5) {
            el.scrollTop = newTop;
            setScrollTop(newTop);
          }
        }
      }
    }
    offsetsRefForComp.current = offsets;
  }, [offsets, count, scrollTop, getSize]);

  // Attach scroll + resize listeners. Rebind when scroll element identity changes.
  const hasItems = count > 0;
  const scrollElKeyRef = useRef<HTMLElement | null>(null);
  const [scrollElVersion, setScrollElVersion] = useState(0);

  // Poll for scroll element changes: if getScrollElement returns different node, rebind
  useEffect(() => {
    if (!hasItems) return;
    const id = setInterval(() => {
      const cur = getScrollElementRef.current();
      if (cur !== scrollElKeyRef.current) {
        setScrollElVersion((n) => n + 1);
      }
    }, 300);
    return () => clearInterval(id);
  }, [hasItems]);

  useLayoutEffect(() => {
    if (!hasItems) return;

    let el: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;
    let cancelled = false;
    let raf = 0;

    const onScroll = (): void => {
      if (!el) return;
      const top = el.scrollTop;
      prevScrollTopRef.current = top;
      setScrollTop(top);
    };

    const attach = (node: HTMLElement): void => {
      el = node;
      scrollElKeyRef.current = node;
      setScrollTop(node.scrollTop);
      prevScrollTopRef.current = node.scrollTop;
      setViewport(node.clientHeight);
      node.addEventListener('scroll', onScroll, { passive: true });
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => {
          setViewport(node.clientHeight);
        });
        ro.observe(node);
      }
    };

    const tryAttach = (): void => {
      if (cancelled) return;
      const node = getScrollElementRef.current();
      if (node) {
        attach(node);
        return;
      }
      raf = requestAnimationFrame(tryAttach);
    };

    tryAttach();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      if (el) el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
    // scrollElVersion ensures rebind when element identity changes without count change
  }, [hasItems, scrollElVersion]);

  const virtualItems = useMemo(() => {
    const { starts } = offsets;
    const vp = viewport || 600;

    if (count === 0) return [] as VirtualItem[];

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
        key: getKey(i),
        start,
        end: start + size,
        size,
        lane: 0,
      });

      if (start + size > endLimit) {
        const extraEnd = Math.min(count - 1, i + overscan);
        for (let j = i + 1; j <= extraEnd; j++) {
          const s = starts[j] ?? 0;
          const sz = getSize(j);
          items.push({
            index: j,
            key: getKey(j),
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
  }, [offsets, count, getSize, overscan, scrollTop, viewport, getKey]);

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
      const rawAlign = opts?.align ?? 'start';
      // 'auto': minimal scroll to bring into view
      if (rawAlign === 'auto') {
        const curTop = el.scrollTop;
        const curBottom = curTop + vp;
        const itemTop = start;
        const itemBottom = start + size;
        if (itemTop >= curTop && itemBottom <= curBottom) return;
        if (itemTop < curTop) top = itemTop;
        else top = itemBottom - vp;
      } else if (rawAlign === 'end') top = start + size - vp;
      else if (rawAlign === 'center') top = start + size / 2 - vp / 2;
      const requested = Math.max(0, top);
      el.scrollTo({ top: requested, behavior: opts?.behavior ?? 'auto' });
      // Don't lie about scrollTop on smooth scroll or clamped scroll — wait for actual scroll event
      // Only sync immediately for instant auto scroll where we can trust the position
      const isSmooth = opts?.behavior === 'smooth';
      if (!isSmooth) {
        // Use rAF to read actual scrollTop after clamp
        requestAnimationFrame(() => {
          if (el) setScrollTop(el.scrollTop);
        });
      }
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
      measureElement: measureElementWithObserve,
      scrollToIndex,
    }),
    [getVirtualItems, getTotalSize, offsets.total, virtualItems, measureElementWithObserve, scrollToIndex],
  );
}

function defaultGetItemKey(i: number): string | number {
  return i;
}
