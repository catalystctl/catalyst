import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/error-logger', () => ({
  captureSystemError: vi.fn(async () => {}),
}));

import { captureSystemError } from '../../services/error-logger';
import {
  createGatedHandler,
  setPluginGateEnabled,
  DEFAULT_GATE_CONFIG,
} from '../runtime/request-gate';

function makeReply() {
  const state: { statusCode: number | null; body: any } = { statusCode: null, body: null };
  const reply: any = {
    state,
    status(code: number) {
      state.statusCode = code;
      return {
        send(body: any) {
          state.body = body;
          return body;
        },
      };
    },
  };
  return reply;
}

function gateFor(name: string, overrides: Record<string, unknown> = {}) {
  const gated = createGatedHandler(
    {
      pluginName: name,
      requestTimeoutMs: 5000,
      memoryLimitMb: 1024,
      maxConcurrentRequests: 10,
      ...overrides,
    },
    async () => ({ success: true }),
  );
  setPluginGateEnabled(name, true);
  return gated;
}

describe('request-gate heap pressure', () => {
  it('defaults above normal backend heaps so healthy processes are not gated', () => {
    // 256MB tripped on routine 350MB+ backend heaps and 503d the requesting
    // plugin (e.g. cs16-admin). The threshold must stay well above that.
    expect(DEFAULT_GATE_CONFIG.memoryLimitMb).toBeGreaterThan(256);
  });

  it('never 503s on heap pressure — serves the request and warns as process-wide', async () => {
    const name = `heap-warn-${Date.now()}`;
    // memoryLimitMb 0 forces the pressure path regardless of actual heap size.
    const gated = gateFor(name, { memoryLimitMb: 0 });
    const reply = makeReply();

    const result = await gated({ url: '/x' } as any, reply);

    expect(result).toEqual({ success: true });
    expect(reply.state.statusCode).toBeNull();
    expect(captureSystemError).toHaveBeenCalledWith(
      expect.objectContaining({
        component: 'PluginGateway',
        metadata: expect.objectContaining({ pluginName: name, scope: 'process' }),
      }),
    );
    const msg = String((captureSystemError as any).mock.calls.at(-1)?.[0]?.message ?? '');
    expect(msg).toMatch(/process-wide|Backend process heap pressure/);
    expect(msg).not.toMatch(/exceeded memory limit/);
  });

  it('still enforces the concurrent-request limit', async () => {
    const name = `concurrency-${Date.now()}`;
    let release!: () => void;
    const blocker = new Promise<any>((resolve) => {
      release = () => resolve({ success: true });
    });
    const gated = createGatedHandler(
      {
        pluginName: name,
        requestTimeoutMs: 5000,
        memoryLimitMb: 0,
        maxConcurrentRequests: 1,
      },
      () => blocker,
    );
    setPluginGateEnabled(name, true);

    const first = gated({ url: '/a' } as any, makeReply());
    const secondReply = makeReply();
    await gated({ url: '/b' } as any, secondReply);

    expect(secondReply.state.statusCode).toBe(503);
    expect(secondReply.state.body?.error).toMatch(/concurrent request limit/);

    release();
    await expect(first).resolves.toEqual({ success: true });
  });

  it('denies traffic while the plugin gate is disabled', async () => {
    const name = `disabled-${Date.now()}`;
    const gated = createGatedHandler(
      {
        pluginName: name,
        requestTimeoutMs: 5000,
        memoryLimitMb: 0,
        maxConcurrentRequests: 10,
      },
      async () => ({ success: true }),
    );
    // createGatedHandler starts denied; do not enable.
    const reply = makeReply();
    await gated({ url: '/x' } as any, reply);
    expect(reply.state.statusCode).toBe(503);
    expect(reply.state.body?.error).toMatch(/disabled or unloaded/);
  });
});
