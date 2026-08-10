import { useSyncExternalStore } from 'react';

function subscribeToMediaQuery(query: string, onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mql = window.matchMedia(query);
  mql.addEventListener('change', onStoreChange);
  return () => mql.removeEventListener('change', onStoreChange);
}

function getMediaQuerySnapshot(query: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(query).matches;
}

/** SSR-safe media query hook. Returns false during SSR / before hydration. */
export function useMediaQuery(query: string): boolean {
  // useSyncExternalStore avoids setState-in-effect cascading-render lint errors
  // while staying correct for SSR (server snapshot = false).
  return useSyncExternalStore(
    (onStoreChange) => subscribeToMediaQuery(query, onStoreChange),
    () => getMediaQuerySnapshot(query),
    () => false,
  );
}

/** Convenience hook for the mobile breakpoint. Unblocks responsive work. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 768px)');
}
