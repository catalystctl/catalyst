import { afterEach, describe, expect, it, vi } from 'vitest';
import { serversApi } from '../servers';
import type { Server } from '../../../types/server';

/**
 * GET /api/servers caps a single response (max 500 rows), so serversApi.list
 * follows offset pages until a short page. These tests stub fetch and drive
 * the loop: page merging, the short-page stop, the explicit-limit cap and
 * the runaway guard.
 */

function serverRow(id: string): Server {
  return { id, name: `srv-${id}`, status: 'stopped' } as unknown as Server;
}

function callsOf(calls: string[]) {
  return calls.map((full) => {
    const url = new URL(full, 'http://localhost.test');
    return {
      path: url.pathname,
      params: Object.fromEntries(url.searchParams.entries()),
    };
  });
}

/** Stub fetch so /api/servers answers from a queue of pages keyed by offset. */
function stubServerPages(pagesByOffset: Record<number, Server[]>) {
  const calls: string[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost.test');
    calls.push(url.pathname + url.search);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const rows = pagesByOffset[offset] ?? [];
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ success: true, data: rows }),
    } as Response;
  });
  vi.stubGlobal('fetch', stub);
  return { calls, stub };
}

/** Stub fetch so /api/servers always answers a full page (runaway backend). */
function stubAlwaysFullPage() {
  const calls: string[] = [];
  const fullPage = Array.from({ length: 500 }, (_, i) => serverRow(`p${i}`));
  const stub = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost.test');
    calls.push(url.pathname + url.search);
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ success: true, data: fullPage }),
    } as Response;
  });
  vi.stubGlobal('fetch', stub);
  return { calls, stub };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('serversApi.list pagination', () => {
  it('follows offset pages until a short page and merges them in order', async () => {
    const firstPage = Array.from({ length: 500 }, (_, i) => serverRow(`a${i}`));
    const lastPage = [serverRow('b0'), serverRow('b1'), serverRow('b2')];
    const { calls } = stubServerPages({ 0: firstPage, 500: lastPage });

    const servers = await serversApi.list();

    expect(servers).toHaveLength(503);
    expect(servers[0]).toEqual(serverRow('a0'));
    expect(servers.slice(-3)).toEqual(lastPage);
    const requests = callsOf(calls);
    expect(requests).toHaveLength(2);
    expect(requests[0].path).toBe('/api/servers');
    expect(requests[0].params).toMatchObject({ limit: '500', offset: '0', withMetrics: '1' });
    expect(requests[1].params).toMatchObject({ limit: '500', offset: '500', withMetrics: '1' });
  });

  it('stops after one request when the first page is short', async () => {
    const page = [serverRow('x1'), serverRow('x2'), serverRow('x3'), serverRow('x4')];
    const { calls } = stubServerPages({ 0: page });

    const servers = await serversApi.list();

    expect(servers).toEqual(page);
    const requests = callsOf(calls);
    expect(requests).toHaveLength(1);
    expect(requests[0].params).toMatchObject({ limit: '500', offset: '0', withMetrics: '1' });
  });

  it('forwards filter params and an explicit limit caps the total', async () => {
    const page = Array.from({ length: 120 }, (_, i) => serverRow(`c${i}`));
    const { calls } = stubServerPages({ 0: page });

    const servers = await serversApi.list({ limit: 120, search: 'mc' });

    expect(servers).toHaveLength(120);
    // A full page equal to the requested cap must not trigger a second fetch.
    const requests = callsOf(calls);
    expect(requests).toHaveLength(1);
    expect(requests[0].params).toMatchObject({
      limit: '120',
      offset: '0',
      withMetrics: '1',
      search: 'mc',
    });
  });

  it('stops at the page guard when the backend never returns a short page', async () => {
    const { calls } = stubAlwaysFullPage();

    const servers = await serversApi.list();

    // 20-page guard: a pathological backend must not loop forever.
    expect(calls).toHaveLength(20);
    expect(servers).toHaveLength(20 * 500);
  });
});
