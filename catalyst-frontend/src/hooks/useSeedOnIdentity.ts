import { useEffect, useRef } from 'react';

/**
 * Seed local form state once per identity instead of on every object identity
 * change.
 *
 * Live metrics are merged into the cached server object every 400 ms
 * (`useServerStateUpdates.flushMetrics`), which produces a new `server` object
 * each time. A form that re-seeds in a `useEffect` keyed on that object
 * therefore overwrites unsaved input within seconds while the server runs
 * (issue #320). Keying the effect on the server id — or on a modal's `open`
 * flag — keeps edits until they are saved or cancelled.
 *
 * @param identity Stable identity for the data being edited (usually `server.id`).
 * @param seed     Copies the stored values into local state.
 * @param options.active When false the identity is forgotten, so re-opening a
 *   modal re-seeds from the current stored values.
 */
export function useSeedOnIdentity(
  identity: string | null | undefined,
  seed: () => void,
  options?: { active?: boolean },
): void {
  const active = options?.active ?? true;
  const seededRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      seededRef.current = null;
      return;
    }
    if (!identity || seededRef.current === identity) return;
    seededRef.current = identity;
    seed();
  }, [identity, active, seed]);
}
