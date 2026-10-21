/**
 * Regression (customer report, 1.85.0 → 1.85.1 update): the always-mounted
 * "update available" flyout reads qk.updateCheck() (staleTime 5 min, no
 * polling). Only UpdateProgressModal invalidated that key on phase change —
 * and after the update the stale cache kept the flyout visible until a
 * manual page refresh. useSseAdminEvents must invalidate the update-check
 * cache on terminal panel_update_state events.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const hookSource = readFileSync(
  resolve(__dirname, '../../hooks/useSseAdminEvents.ts'),
  'utf8',
);

describe('panel_update_state SSE handling', () => {
  const handler = hookSource.match(
    new RegExp("if \\(type === 'panel_update_state'\\) \\{[\\s\\S]*?\\n {8}\\}"),
  )?.[0];
  expect(handler).toBeDefined();

  it('patches the update-state cache for the progress modal', () => {
    expect(handler).toContain('setQueryData(qk.adminUpdateState()');
    expect(handler).toContain('invalidateOnce');
  });

  it('invalidates the update-check cache on terminal states (flyout freshness)', () => {
    expect(handler).toContain("nextState === 'completed'");
    expect(handler).toContain("nextState === 'failed'");
    expect(handler).toContain('qk.updateCheck()');
  });
});
