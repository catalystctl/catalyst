import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../client';

function stubFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const stub = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ success: true, data: {} }),
    } as Response;
  });
  vi.stubGlobal('fetch', stub);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiClient Content-Type handling', () => {
  it('omits Content-Type for FormData opted out with an empty string', async () => {
    const calls = stubFetch();
    const form = new FormData();
    form.append('file', new File(['avatar'], 'avatar.png', { type: 'image/png' }));

    await apiClient.post('/api/auth/profile/avatar', form, { headers: { 'Content-Type': '' } });

    expect(calls).toHaveLength(1);
    const headers = calls[0].init.headers as Record<string, string>;
    // The browser must set multipart/form-data with its own boundary.
    expect(headers['Content-Type']).toBeUndefined();
    expect(calls[0].init.body).toBe(form);
  });

  it('defaults to application/json for plain object bodies', async () => {
    const calls = stubFetch();

    await apiClient.post('/api/auth/profile', { username: 'kiko' });

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('preserves an explicitly set Content-Type', async () => {
    const calls = stubFetch();

    await apiClient.post('/api/auth/profile', { username: 'kiko' }, { headers: { 'Content-Type': 'application/merge-patch+json' } });

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/merge-patch+json');
  });
});
