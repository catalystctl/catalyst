/**
 * SSE write-failure propagation (REALTIME_AUDIT P4 / §4.4 zombie stream).
 *
 * A dead or half-open socket must not swallow heartbeat writes: the stream is
 * marked errored, the socket is destroyed (so the browser's EventSource sees
 * the close and reconnects), and the write throws so route heartbeat
 * catch-blocks keep clearing their interval.
 */
import { describe, it, expect } from 'vitest';
import { openSseStream } from '../utils/sse.js';

type FakeListener = (...args: unknown[]) => void;

function makeReply(options: { writeThrows?: boolean } = {}) {
  const listeners: Record<string, FakeListener[]> = {};
  const raw = {
    destroyed: false,
    writableEnded: false,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    writeHead() {},
    flushHeaders() {},
    write(_chunk: string) {
      if (options.writeThrows) throw new Error('EPIPE');
      return true;
    },
    destroy() {
      raw.destroyed = true;
    },
    on(event: string, fn: FakeListener) {
      (listeners[event] ??= []).push(fn);
    },
    emit(event: string) {
      for (const fn of listeners[event] ?? []) fn();
    },
  };
  const reply = { raw, hijack: () => {} } as never;
  const request = { headers: {} } as never;
  return { raw, reply, request };
}

describe('openSseStream write failure propagation', () => {
  it('writes normally while the socket is alive', () => {
    const { reply, request } = makeReply();
    const sse = openSseStream(request, reply);
    expect(() => sse.comment('heartbeat')).not.toThrow();
    expect(() => sse.push('ping', { t: 1 })).not.toThrow();
  });

  it('marks the stream errored, destroys the socket and throws on write failure', () => {
    const { raw, reply, request } = makeReply({ writeThrows: true });
    const sse = openSseStream(request, reply);
    expect(() => sse.comment('heartbeat')).toThrow();
    expect(raw.destroyed).toBe(true);
    // Subsequent pushes keep throwing instead of silently no-oping.
    expect(() => sse.push('ping', { t: 1 })).toThrow();
  });

  it('detects a socket that died without a write throw (Node no-ops writes)', () => {
    const { raw, reply, request } = makeReply();
    const sse = openSseStream(request, reply);
    expect(() => sse.comment('heartbeat')).not.toThrow();
    // Peer closed: res.write() would silently succeed — we must not.
    raw.destroyed = true;
    expect(() => sse.comment('heartbeat')).toThrow();
    expect(raw.destroyed).toBe(true);
  });

  it('marks the stream errored when the socket emits an error', () => {
    const { raw, reply, request } = makeReply();
    const sse = openSseStream(request, reply);
    raw.emit('error');
    expect(() => sse.comment('heartbeat')).toThrow();
    expect(raw.destroyed).toBe(true);
  });

  it('throws once the response has ended', () => {
    const { raw, reply, request } = makeReply();
    const sse = openSseStream(request, reply);
    raw.writableEnded = true;
    expect(() => sse.push('ping', { t: 2 })).toThrow();
  });
});
