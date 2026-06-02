import { useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const ROW_HEIGHT = 44;
const OVERSCAN = 20;

export function useFileListVirtualizer(
  count: number,
  parentRef: React.RefObject<HTMLDivElement | null>,
) {
  const estimateSize = useCallback(() => ROW_HEIGHT, []);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return useMemo(
    () => ({
      virtualItems,
      totalSize,
      measureElement: virtualizer.measureElement,
    }),
    [virtualItems, totalSize, virtualizer.measureElement],
  );
}
