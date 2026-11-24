import { afterEach, describe, expect, it, vi } from 'vitest';
import { serversApi } from '../servers';

/**
 * Rebuild/reinstall accept an optional "pull latest image" flag. The agent
 * force-refreshes the cached image tag only when the flag is sent, so the API
 * client must transmit { pullLatestImage: true } exactly when requested and
 * omit the body otherwise (Fastify rejects an empty JSON body).
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubPost() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost.test');
    let body: unknown;
    if (typeof init?.body === 'string') {
      body = JSON.parse(init.body);
    }
    calls.push({ url: url.pathname, body });
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ success: true, data: undefined }),
    } as Response;
  });
  vi.stubGlobal('fetch', stub);
  return calls;
}

describe('serversApi rebuild/reinstall pullLatestImage', () => {
  it('sends pullLatestImage:true when requested', async () => {
    const calls = stubPost();
    await serversApi.rebuild('s1', { pullLatestImage: true });
    await serversApi.reinstall('s2', { pullLatestImage: true });
    expect(calls[0]).toEqual({ url: '/api/servers/s1/rebuild', body: { pullLatestImage: true } });
    expect(calls[1]).toEqual({ url: '/api/servers/s2/reinstall', body: { pullLatestImage: true } });
  });

  it('omits the body by default and when the flag is false', async () => {
    const calls = stubPost();
    await serversApi.rebuild('s1');
    await serversApi.reinstall('s2', { pullLatestImage: false });
    expect(calls[0].url).toBe('/api/servers/s1/rebuild');
    expect(calls[0].body).toBeUndefined();
    expect(calls[1].url).toBe('/api/servers/s2/reinstall');
    expect(calls[1].body).toBeUndefined();
  });
});