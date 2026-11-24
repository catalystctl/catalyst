// @vitest-environment jsdom
/**
 * Realtime invalidation coverage (audit 2026-11-24 §A5, §C2, §C3, §C5).
 *
 * Each case drives a real SSE event through the hook's handler and asserts on
 * the query keys the resulting invalidations target — the caches here were
 * either never invalidated (A5 `server-permissions`, C5 `providerKeyStatus`,
 * `backup-secondary-drive`, `rolePresets`, `agentConfig`), lagged a poll window
 * (C3 `admin-env-restart-status`) or were patched for the fleet table only
 * (C2 `dashboard-resources`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@/csync';

/** Captured admin-stream handler (installed by createAdminEventsStream). */
let adminHandler: ((type: string, data: Record<string, unknown>) => void) | null = null;
/** Captured global server-stream handler (installed by createServerEventsStream). */
let serverHandler: ((type: string, data: Record<string, unknown>) => void) | null = null;

vi.mock('../../services/api/admin-events', () => ({
  ADMIN_EVENT_TYPES: [],
  hasAdminReadPermission: () => true,
  createAdminEventsStream: (onEvent: (t: string, d: Record<string, unknown>) => void) => {
    adminHandler = onEvent;
    return () => {};
  },
}));

vi.mock('../../services/api/server-events', () => ({
  SERVER_EVENT_TYPES: [],
  createServerEventsStream: (
    _serverId: string,
    onEvent: (t: string, d: Record<string, unknown>) => void,
  ) => {
    serverHandler = onEvent;
    return () => {};
  },
}));

const { useSseAdminEvents } = await import('../../hooks/useSseAdminEvents');
const { useServerStateUpdates } = await import('../../hooks/useServerStateUpdates');

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 5000 } } as never,
    mutationCache: { notifyError: vi.fn(), subscribe: () => () => {} } as never,
  });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client, children });
  };
}

/** Collect the query keys invalidateOnce/invalidateQueries was asked to drop. */
function recordInvalidations(client: QueryClient) {
  const keys: unknown[][] = [];
  const original = client.invalidateQueries.bind(client);
  const spy = vi
    .spyOn(client, 'invalidateQueries')
    .mockImplementation(((filters: any, opts?: any) => {
      if (filters?.queryKey) keys.push(filters.queryKey as unknown[]);
      return original(filters, opts);
    }) as never);
  return { keys, spy };
}

/** Drive the admin stream handler and let the rAF/microtask scheduler flush. */
async function fireAdmin(type: string, data: Record<string, unknown> = {}) {
  expect(adminHandler, 'admin stream handler was not installed').toBeTruthy();
  await act(async () => {
    adminHandler!(type, data);
    // createAdminWorkScheduler batches into rAF → microtask (or a 50ms timer
    // while the document is hidden). Flush both.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

describe('useSseAdminEvents invalidations (A5/C3/C5)', () => {
  let client: QueryClient;

  beforeEach(async () => {
    client = makeClient();
    adminHandler = null;
    // The hook only subscribes when the caller holds literal admin.read.
    const { useAuthStore } = await import('../../stores/authStore');
    useAuthStore.setState({ user: { id: 'u1', permissions: ['admin.read'] } as never });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    adminHandler = null;
  });

  it('role_updated invalidates the shared server-permission catalog (A5)', async () => {
    const { keys } = recordInvalidations(client);
    const { unmount } = renderHook(() => useSseAdminEvents(), { wrapper: wrapper(client) });

    await fireAdmin('role_updated', { roleId: 'r1' });

    expect(keys).toContainEqual(['server-permissions']);
    // …alongside the caches it already dropped (roles list, caller perms).
    expect(keys).toContainEqual(['admin-roles']);
    expect(keys).toContainEqual(['my-permissions']);
    unmount();
  });

  it('role create/delete also refreshes the role presets list (C5)', async () => {
    for (const type of ['role_created', 'role_deleted']) {
      const fresh = makeClient();
      const { keys } = recordInvalidations(fresh);
      const { unmount } = renderHook(() => useSseAdminEvents(), { wrapper: wrapper(fresh) });
      await fireAdmin(type, { roleId: 'r1' });
      expect(keys, `${type} must invalidate role-presets`).toContainEqual(['role-presets']);
      unmount();
    }
  });

  it('api_key_* events refresh the mod/plugin provider key status (C5)', async () => {
    for (const type of ['api_key_created', 'api_key_updated', 'api_key_deleted']) {
      const fresh = makeClient();
      const { keys } = recordInvalidations(fresh);
      const { unmount } = renderHook(() => useSseAdminEvents(), { wrapper: wrapper(fresh) });
      await fireAdmin(type, { keyId: 'k1' });
      expect(keys, `${type} must invalidate providers/key-status`).toContainEqual([
        'providers',
        'key-status',
      ]);
      unmount();
    }
  });

  it('system_settings_updated refreshes provider keys and the backup secondary drive (C5)', async () => {
    const { keys } = recordInvalidations(client);
    const { unmount } = renderHook(() => useSseAdminEvents(), { wrapper: wrapper(client) });

    await fireAdmin('system_settings_updated', {});
    // Predicate-only invalidation carries no queryKey in the filters; assert
    // the spy saw a predicate that matches the backup-secondary-drive caches.
    const predicateCall = (
      client.invalidateQueries as unknown as { mock: { calls: any[][] } }
    ).mock.calls.find(([filters]) => typeof filters?.predicate === 'function' && !filters.queryKey);
    expect(predicateCall, 'system_settings_updated must invalidate by predicate').toBeTruthy();
    const matches = predicateCall![0].predicate({ queryKey: ['backup-secondary-drive', 's1'] });
    expect(matches).toBe(true);
    expect(keys).toContainEqual(['providers', 'key-status']);
    unmount();
  });

  it('env_settings_updated refreshes the restart banner status (C3)', async () => {
    const { keys } = recordInvalidations(client);
    const { unmount } = renderHook(() => useSseAdminEvents(), { wrapper: wrapper(client) });

    await fireAdmin('env_settings_updated', {});

    expect(keys).toContainEqual(['admin-env']);
    expect(keys).toContainEqual(['admin-env-restart-status']);
    unmount();
  });

  it('node_updated and agent_update_* refresh the agent config editor (C5)', async () => {
    for (const [type, data] of [
      ['node_updated', { nodeId: 'n1' }],
      ['agent_update_started', { nodeId: 'n1' }],
      ['agent_update_progress', { nodeId: 'n1', progress: 40 }],
      ['agent_update_failed', { nodeId: 'n1', error: 'boom' }],
    ] as const) {
      const fresh = makeClient();
      const { keys } = recordInvalidations(fresh);
      const { unmount } = renderHook(() => useSseAdminEvents(), { wrapper: wrapper(fresh) });
      await fireAdmin(type, data as Record<string, unknown>);
      expect(keys, `${type} must invalidate the agent config`).toContainEqual([
        'nodes',
        'n1',
        'agent-config',
      ]);
      unmount();
    }
  });

  it('alert_resolved still refreshes the alert caches after the dead branch removal (C8)', async () => {
    const { keys } = recordInvalidations(client);
    const { unmount } = renderHook(() => useSseAdminEvents(), { wrapper: wrapper(client) });

    await fireAdmin('alert_resolved', { alertId: 'a1' });

    expect(keys).toContainEqual(['alerts']);
    expect(keys).toContainEqual(['alerts-stats']);
    unmount();
  });
});

describe('useServerStateUpdates dashboard-resources patch (C2)', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = makeClient();
    serverHandler = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    serverHandler = null;
  });

  it('re-derives the capacity tiles from live per-server samples', async () => {
    client.setQueryData(['servers'], [
      { id: 's1', status: 'running', allocatedCpuCores: 4, allocatedMemoryMb: 8192 },
      { id: 's2', status: 'running', allocatedCpuCores: 4, allocatedMemoryMb: 8192 },
      { id: 's3', status: 'stopped', allocatedCpuCores: 8, allocatedMemoryMb: 16384 },
    ]);
    client.setQueryData(['dashboard-resources'], {
      cpuUtilization: 0,
      memoryUtilization: 0,
      networkThroughput: 0,
    });

    const { unmount } = renderHook(() => useServerStateUpdates(), { wrapper: wrapper(client) });
    expect(serverHandler, 'server stream handler was not installed').toBeTruthy();

    await act(async () => {
      // s1: 100% of its 4 cores → 4 cores used of the running 8-core ceiling.
      serverHandler!('resource_stats', {
        serverId: 's1',
        cpuPercent: 100,
        memoryUsageMb: 4096,
        timestamp: 1,
      });
      // s2: idle CPU, 2 GiB used.
      serverHandler!('resource_stats', {
        serverId: 's2',
        cpuPercent: 0,
        memoryUsageMb: 2048,
        timestamp: 1,
      });
      await vi.advanceTimersByTimeAsync(500);
    });

    const resources = client.getQueryData(['dashboard-resources']) as {
      cpuUtilization: number;
      memoryUtilization: number;
      networkThroughput: number;
    };
    // 4 cores of 8 running cores = 50%; 6 GiB of 16 GiB = 38%. The stopped
    // server's allocation is excluded, like the REST aggregate.
    expect(resources.cpuUtilization).toBe(50);
    expect(resources.memoryUtilization).toBe(38);
    // Not derivable from cumulative counters here — left for the next poll.
    expect(resources.networkThroughput).toBe(0);
    unmount();
  });

  it('leaves the tiles untouched when no fleet row can be aggregated', async () => {
    client.setQueryData(['dashboard-resources'], {
      cpuUtilization: 12,
      memoryUtilization: 34,
      networkThroughput: 5.5,
    });

    const { unmount } = renderHook(() => useServerStateUpdates(), { wrapper: wrapper(client) });
    await act(async () => {
      serverHandler!('resource_stats', { serverId: 'unknown', cpuPercent: 90, timestamp: 1 });
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(client.getQueryData(['dashboard-resources'])).toEqual({
      cpuUtilization: 12,
      memoryUtilization: 34,
      networkThroughput: 5.5,
    });
    unmount();
  });

  it('still patches the fleet list rows themselves', async () => {
    client.setQueryData(['servers'], [
      { id: 's1', status: 'running', allocatedCpuCores: 2, allocatedMemoryMb: 2048 },
    ]);
    const { unmount } = renderHook(() => useServerStateUpdates(), { wrapper: wrapper(client) });
    await act(async () => {
      serverHandler!('resource_stats', { serverId: 's1', cpuPercent: 55, memoryUsageMb: 1024, timestamp: 1 });
      await vi.advanceTimersByTimeAsync(500);
    });
    const rows = client.getQueryData(['servers']) as Array<Record<string, unknown>>;
    expect(rows[0].cpuPercent).toBe(55);
    expect(rows[0].memoryPercent).toBe(50);
    unmount();
  });
});