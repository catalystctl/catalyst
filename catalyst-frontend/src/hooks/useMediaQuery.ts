import { useEffect, useState } from 'react';

/** SSR-safe media query hook. Returns false during SSR / before mount. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** Convenience hook for the mobile breakpoint. Unblocks responsive work. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 768px)');
}
