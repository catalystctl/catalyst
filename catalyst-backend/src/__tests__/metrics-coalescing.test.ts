import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestImmediateStatsCoalesced } from '../lib/event-bus';

describe('requestImmediateStatsCoalesced', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares one in-flight request for concurrent callers with the same server key', async () => {
    let release!: (value: boolean) => void;
    const request = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve; }));

    const first = requestImmediateStatsCoalesced('node-a', 'server-a', request);
    const second = requestImmediateStatsCoalesced('node-a', 'server-a', request);

    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    release(true);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(request).toHaveBeenCalledOnce();
  });

  it('keeps a completed request deduplicated during the coalescing window', async () => {
    const request = vi.fn(async () => true);

    await expect(requestImmediateStatsCoalesced('node-b', 'server-b', request)).resolves.toBe(true);
    await expect(requestImmediateStatsCoalesced('node-b', 'server-b', request)).resolves.toBe(true);
    expect(request).toHaveBeenCalledOnce();

    await expect(requestImmediateStatsCoalesced('node-b', 'server-b', request)).resolves.toBe(true);
    expect(request).toHaveBeenCalledOnce();
  });

  it('returns false for a failed request while still suppressing the burst', async () => {
    const request = vi.fn(async () => { throw new Error('agent unavailable'); });

    await expect(requestImmediateStatsCoalesced('node-c', 'server-c', request)).resolves.toBe(false);
    await expect(requestImmediateStatsCoalesced('node-c', 'server-c', request)).resolves.toBe(false);
    expect(request).toHaveBeenCalledOnce();
  });
});
