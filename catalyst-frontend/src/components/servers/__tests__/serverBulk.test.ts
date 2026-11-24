import { describe, expect, it } from 'vitest';
import {
  bulkActionPlan,
  bulkActionTargets,
  selectAllState,
  serverEligibleForBulkAction,
  serverHasPermission,
  toggleAllVisible,
} from '../serverBulk';

const server = (
  id: string,
  status: string,
  permissions: string[],
): { id: string; status: any; effectivePermissions: string[] } => ({
  id,
  status,
  effectivePermissions: permissions,
});

describe('fleet bulk power selection (audit D9)', () => {
  it('treats the wildcard grant as every action permission', () => {
    expect(serverHasPermission({ effectivePermissions: ['*'] }, 'server.start')).toBe(true);
    expect(serverHasPermission({ effectivePermissions: ['server.start'] }, 'server.stop')).toBe(false);
    expect(serverHasPermission({ effectivePermissions: [] }, 'server.start')).toBe(false);
  });

  it('requires the action permission AND a status the action applies to', () => {
    const stopped = server('a', 'stopped', ['server.start', 'server.stop']);
    const running = server('b', 'running', ['server.start', 'server.stop']);
    expect(serverEligibleForBulkAction(stopped, 'start')).toBe(true);
    expect(serverEligibleForBulkAction(running, 'start')).toBe(false);
    expect(serverEligibleForBulkAction(running, 'stop')).toBe(true);
    // restart needs BOTH start and stop
    expect(serverEligibleForBulkAction(server('c', 'running', ['server.start']), 'restart')).toBe(false);
    expect(serverEligibleForBulkAction(server('d', 'running', ['server.start', 'server.stop']), 'restart')).toBe(true);
  });

  it('never targets a server in a transitional state', () => {
    const installing = server('a', 'installing', ['*']);
    expect(serverEligibleForBulkAction(installing, 'start')).toBe(false);
    expect(serverEligibleForBulkAction(installing, 'restart')).toBe(false);
  });

  it('builds one target list per action, preserving selection order', () => {
    const selected = [
      server('a', 'stopped', ['*']),
      server('b', 'running', ['*']),
      server('c', 'stopped', ['server.read']),
    ];
    const plan = bulkActionPlan(selected);
    expect(plan.start).toEqual(['a']);
    expect(plan.stop).toEqual(['b']);
    expect(plan.restart).toEqual(['a', 'b']);
    expect(bulkActionTargets(selected, 'start')).toEqual(['a']);
  });

  it('reports select-all against the filtered list only', () => {
    expect(selectAllState(new Set(), ['a', 'b'])).toBe('none');
    expect(selectAllState(new Set(['a']), ['a', 'b'])).toBe('some');
    expect(selectAllState(new Set(['a', 'b']), ['a', 'b'])).toBe('all');
    // Selected rows outside the filter do not make the header box say "all".
    expect(selectAllState(new Set(['a', 'z']), ['a', 'b'])).toBe('some');
    expect(selectAllState(new Set(), [])).toBe('none');
  });

  it('toggles the whole visible list without touching hidden selections', () => {
    const all = toggleAllVisible(new Set(['z']), ['a', 'b'], true);
    expect([...all].sort()).toEqual(['a', 'b', 'z']);
    const none = toggleAllVisible(all, ['a', 'b'], false);
    expect([...none]).toEqual(['z']);
  });
});