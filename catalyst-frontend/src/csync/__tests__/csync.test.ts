/**
 * Catalyst Sync unit tests — core cache, prefix invalidation, patch fan-out, mutations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, hashQueryKey, partialMatchKey, matchQuery } from '../index';

describe('csync core', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0, gcTime: 1000 },
      },
      mutationCache: undefined as any,
    });
    // Replace default mutation cache that reports system errors
    (client as any).mutationCache = {
      notifyError: vi.fn(),
      subscribe: () => () => {},
    };
  });

  afterEach(() => {
    client.clear();
  });

  it('hashes query keys stably regardless of object key order', () => {
    expect(hashQueryKey(['servers', { b: 1, a: 2 }])).toBe(
      hashQueryKey(['servers', { a: 2, b: 1 }]),
    );
  });

  it('partial-matches hierarchical keys like RQ v5', () => {
    expect(partialMatchKey(['servers', 'abc', 'backups'], ['servers'])).toBe(true);
    expect(partialMatchKey(['servers', 'abc'], ['servers', 'abc'])).toBe(true);
    expect(partialMatchKey(['servers'], ['servers', 'abc'])).toBe(false);
    expect(partialMatchKey(['nodes', 'x'], ['servers'])).toBe(false);
  });

  it('fetches and caches query data', async () => {
    const queryFn = vi.fn(async () => ({ id: '1', name: 'alpha' }));
    const data = await client.fetchQuery({
      queryKey: ['servers', '1'],
      queryFn,
    });
    expect(data).toEqual({ id: '1', name: 'alpha' });
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['servers', '1'])).toEqual({ id: '1', name: 'alpha' });
  });

  it('dedupes in-flight fetches for the same key', async () => {
    let resolve!: (v: string) => void;
    const p = new Promise<string>((r) => {
      resolve = r;
    });
    const queryFn = vi.fn(() => p);
    const a = client.fetchQuery({ queryKey: ['x'], queryFn });
    const b = client.fetchQuery({ queryKey: ['x'], queryFn });
    resolve('ok');
    expect(await a).toBe('ok');
    expect(await b).toBe('ok');
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('setQueryData writes without fetch', () => {
    client.setQueryData(['servers', '1'], { id: '1', status: 'running' });
    expect(client.getQueryData(['servers', '1'])).toEqual({ id: '1', status: 'running' });
  });

  it('setQueriesData patches all list views by predicate (SSE fan-out)', () => {
    client.setQueryData(['servers'], [
      { id: 'a', status: 'stopped' },
      { id: 'b', status: 'running' },
    ]);
    client.setQueryData(['servers', { status: 'stopped' }], [{ id: 'a', status: 'stopped' }]);
    client.setQueryData(['servers', 'a'], { id: 'a', status: 'stopped' });

    // Patch list rows only (not detail keys where key[1] is string id)
    client.setQueriesData(
      {
        predicate: (query) => {
          if (!Array.isArray(query.queryKey) || query.queryKey[0] !== 'servers') return false;
          if (query.queryKey.length === 1) return true;
          if (query.queryKey.length >= 2 && typeof query.queryKey[1] === 'object') return true;
          return false;
        },
      },
      (prev: any) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((s: any) => (s.id === 'a' ? { ...s, status: 'starting' } : s));
      },
    );

    expect(client.getQueryData(['servers'])).toEqual([
      { id: 'a', status: 'starting' },
      { id: 'b', status: 'running' },
    ]);
    expect(client.getQueryData(['servers', { status: 'stopped' }])).toEqual([
      { id: 'a', status: 'starting' },
    ]);
    // detail untouched by list predicate
    expect(client.getQueryData(['servers', 'a'])).toEqual({ id: 'a', status: 'stopped' });

    // detail patch
    client.setQueriesData(
      {
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0] === 'servers' &&
          query.queryKey[1] === 'a',
      },
      (prev: any) => (prev ? { ...prev, status: 'starting' } : prev),
    );
    expect(client.getQueryData(['servers', 'a'])).toEqual({ id: 'a', status: 'starting' });
  });

  it('invalidateQueries refetches only active (observed) queries by default', async () => {
    const fn = vi.fn(async () => 1);
    await client.fetchQuery({ queryKey: ['n'], queryFn: fn });
    expect(fn).toHaveBeenCalledTimes(1);

    // no observers → active refetch skipped
    await client.invalidateQueries({ queryKey: ['n'] });
    expect(fn).toHaveBeenCalledTimes(1);

    // force all
    await client.invalidateQueries({ queryKey: ['n'] }, { refetchType: 'all' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('prefix invalidate matches nested keys', async () => {
    const listFn = vi.fn(async () => []);
    const detailFn = vi.fn(async () => ({ id: '1' }));
    await client.fetchQuery({ queryKey: ['servers'], queryFn: listFn });
    await client.fetchQuery({ queryKey: ['servers', '1'], queryFn: detailFn });

    await client.invalidateQueries({ queryKey: ['servers'] }, { refetchType: 'all' });
    expect(listFn).toHaveBeenCalledTimes(2);
    expect(detailFn).toHaveBeenCalledTimes(2);
  });

  it('removeQueries evicts detail caches', () => {
    client.setQueryData(['servers', '1'], { id: '1' });
    client.setQueryData(['servers'], [{ id: '1' }]);
    client.removeQueries({ queryKey: ['servers', '1'] });
    expect(client.getQueryData(['servers', '1'])).toBeUndefined();
    expect(client.getQueryData(['servers'])).toEqual([{ id: '1' }]);
  });

  it('clear wipes the entire cache (auth/logout)', () => {
    client.setQueryData(['a'], 1);
    client.setQueryData(['b'], 2);
    client.clear();
    expect(client.getQueryData(['a'])).toBeUndefined();
    expect(client.getQueryData(['b'])).toBeUndefined();
  });

  it('cancelQueries marks in-flight as cancelled', async () => {
    let resolve!: (v: string) => void;
    const p = new Promise<string>((r) => {
      resolve = r;
    });
    const fetchP = client.fetchQuery({ queryKey: ['slow'], queryFn: () => p });
    await client.cancelQueries({ queryKey: ['slow'] });
    resolve('late');
    await expect(fetchP).rejects.toBeTruthy();
  });

  it('revalidateTags matches by first key segment', async () => {
    const fn = vi.fn(async () => 'x');
    await client.fetchQuery({ queryKey: ['alerts', { scope: 'all' }], queryFn: fn });
    await client.revalidateTags(['alerts'], { refetchType: 'all' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('matchQuery supports exact and predicate filters', () => {
    client.setQueryData(['servers', '1'], { id: '1' });
    client.setQueryData(['servers'], []);
    const all = client.getQueryCache().findAll({ queryKey: ['servers'] });
    expect(all.length).toBe(2);
    const exact = client.getQueryCache().findAll({ queryKey: ['servers'], exact: true });
    expect(exact.length).toBe(1);
    expect(
      matchQuery(
        { predicate: (q) => q.queryKey[0] === 'servers' },
        client.getQueryCache().getAll()[0],
      ),
    ).toBe(true);
  });

  it('getQueryCache().subscribe emits updated events', () => {
    const events: string[] = [];
    const unsub = client.getQueryCache().subscribe((e) => {
      events.push(e.type);
    });
    client.setQueryData(['profile'], { name: 'Ada' });
    expect(events).toContain('added');
    expect(events).toContain('updated');
    unsub();
  });
});

describe('csync patch-first server state simulation', () => {
  it('updates list + detail without requiring refetch', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
      mutationCache: { notifyError: () => {}, subscribe: () => () => {} } as any,
    });

    client.setQueryData(['servers'], [
      { id: 's1', status: 'stopped' },
      { id: 's2', status: 'running' },
    ]);
    client.setQueryData(['servers', 's1'], { id: 's1', status: 'stopped' });

    const serverId = 's1';
    const next = 'starting';

    client.setQueriesData(
      {
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          query.queryKey[0] === 'servers' &&
          query.queryKey.length >= 2 &&
          typeof query.queryKey[1] === 'string',
      },
      (prev: any) => {
        if (!prev || prev.id !== serverId) return prev;
        return { ...prev, status: next };
      },
    );
    client.setQueriesData(
      {
        predicate: (query) => {
          if (!Array.isArray(query.queryKey) || query.queryKey[0] !== 'servers') return false;
          if (query.queryKey.length === 1) return true;
          if (query.queryKey.length >= 2 && typeof query.queryKey[1] === 'object') return true;
          return false;
        },
      },
      (prev: any) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((s: any) => (s.id === serverId ? { ...s, status: next } : s));
      },
    );

    expect(client.getQueryData(['servers', 's1'])).toEqual({ id: 's1', status: 'starting' });
    expect(client.getQueryData(['servers'])).toEqual([
      { id: 's1', status: 'starting' },
      { id: 's2', status: 'running' },
    ]);
  });
});
