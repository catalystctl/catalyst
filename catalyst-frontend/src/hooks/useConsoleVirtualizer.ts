import { useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ProcessedEntry } from '../components/console/types';

const MIN_ROW_HEIGHT = 22 + 4; // LINE_HEIGHT + ROW_PAD
const OVERSCAN = 15;

export function useConsoleVirtualizer(
  processedEntries: ProcessedEntry[],
  parentRef: React.RefObject<HTMLDivElement | null>,
  charsPerLine: number,
) {
  const estimateSize = useCallback(
    (index: number) => {
      const entry = processedEntries[index];
      if (!entry) return MIN_ROW_HEIGHT;
      const wrappedLines = Math.max(1, Math.ceil(entry.textLength / charsPerLine));
      return wrappedLines * MIN_ROW_HEIGHT;
    },
    [processedEntries, charsPerLine],
  );

  const getItemKey = useCallback(
    (index: number) => processedEntries[index]?.id ?? `console-row-${index}`,
    [processedEntries],
  );

  const measureElement = useCallback((el: Element) => el.getBoundingClientRect().height, []);

  const virtualizer = useVirtualizer({
    count: processedEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: OVERSCAN,
    getItemKey,
    measureElement,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const scrollToIndex = virtualizer.scrollToIndex.bind(virtualizer);

  return useMemo(
    () => ({
      virtualItems,
      totalSize,
      measureElement: virtualizer.measureElement,
      scrollToIndex,
    }),
    [virtualItems, totalSize, virtualizer.measureElement, scrollToIndex],
  );
}
