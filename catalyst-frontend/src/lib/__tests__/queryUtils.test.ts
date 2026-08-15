/**
 * Regression: power-state optimistic writes must not turn the servers list
 * into a non-array. useServers select() then returns [] until a hard refresh.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '../../csync';
import {
  isServerListQueryKey,
  optimisticInvalidate,
  optimisticSet,
  patchServerListStatus,
} from '../queryUtils';

describe('queryUtils server list cache', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0, gcTime: 1000 },
      },
    });
  });

  afterEach(() => {
    client.clear();
  });

  const list = [
    { id: 'a', status: 'running' },
    { id: 'b', status: 'running' },
  ];

  function seed() {
    client.setQueryData(['servers'], list);
    client.setQueryData(['servers', {}], list);
    client.setQueryData(['servers', 'a'], { id: 'a', status: 'running' });
    client.setQueryData(['servers', 'a', 'files'], [{ name: 'server.jar' }]);
  }

  it('treats a query key as one prefix, not per-segment prefixes', () => {
    seed();

    // This is the stop-server write that used to empty the list:
    // matchQueryKeys(['servers', id]) treated 'servers' as its own prefix,
    // so `{ ...srv, status }` spread Server[] into `{ 0: row, status }`.
    optimisticSet(client, ['servers', 'a'], (srv: { id: string; status: string } | undefined) =>
      srv ? { ...srv, status: 'stopping' } : srv,
    );

    expect(Array.isArray(client.getQueryData(['servers']))).toBe(true);
    expect(client.getQueryData(['servers'])).toEqual(list);
    expect(Array.isArray(client.getQueryData(['servers', {}]))).toBe(true);
    expect(client.getQueryData(['servers', {}])).toEqual(list);
    expect(client.getQueryData(['servers', 'a'])).toEqual({ id: 'a', status: 'stopping' });
    expect(client.getQueryData(['servers', 'a', 'files'])).toEqual([{ name: 'server.jar' }]);
  });

  it('patchServerListStatus updates list views only', () => {
    seed();
    patchServerListStatus(client, 'a', 'stopping');

    expect(client.getQueryData(['servers'])).toEqual([
      { id: 'a', status: 'stopping' },
      { id: 'b', status: 'running' },
    ]);
    expect(client.getQueryData(['servers', {}])).toEqual([
      { id: 'a', status: 'stopping' },
      { id: 'b', status: 'running' },
    ]);
    expect(client.getQueryData(['servers', 'a'])).toEqual({ id: 'a', status: 'running' });
    expect(client.getQueryData(['servers', 'a', 'files'])).toEqual([{ name: 'server.jar' }]);
  });

  it('stop-path writes keep list arrays and update status', () => {
    seed();
    client.setQueryData(['servers', 'a'], (srv: { id: string; status: string } | undefined) =>
      srv ? { ...srv, status: 'stopping', lastExitCode: undefined } : srv,
    );
    patchServerListStatus(client, 'a', 'stopping');

    expect(Array.isArray(client.getQueryData(['servers']))).toBe(true);
    expect(client.getQueryData(['servers'])).toEqual([
      { id: 'a', status: 'stopping' },
      { id: 'b', status: 'running' },
    ]);
    expect(client.getQueryData(['servers', {}])).toEqual([
      { id: 'a', status: 'stopping' },
      { id: 'b', status: 'running' },
    ]);
    expect(client.getQueryData(['servers', 'a'])).toEqual({
      id: 'a',
      status: 'stopping',
      lastExitCode: undefined,
    });
    expect(client.getQueryData(['servers', 'a', 'files'])).toEqual([{ name: 'server.jar' }]);
  });

  it('optimisticInvalidate passes the full key once', () => {
    const spy = vi.spyOn(client, 'invalidateQueries');
    optimisticInvalidate(client, ['servers', 'abc']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['servers', 'abc'] });
  });

  it('isServerListQueryKey distinguishes list keys from detail keys', () => {
    expect(isServerListQueryKey(['servers'])).toBe(true);
    expect(isServerListQueryKey(['servers', { search: '', status: undefined }])).toBe(true);
    expect(isServerListQueryKey(['servers', null])).toBe(true);
    expect(isServerListQueryKey(['servers', 'abc'])).toBe(false);
    expect(isServerListQueryKey(['servers', 'abc', 'files'])).toBe(false);
    expect(isServerListQueryKey(['admin-servers'])).toBe(false);
  });
});
