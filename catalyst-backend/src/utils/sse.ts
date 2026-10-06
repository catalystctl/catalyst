/**
 * Shared helpers for long-lived Server-Sent Event responses.
 *
 * Fastify will finish/end the HTTP response when a route handler returns unless
 * the reply is hijacked. Without hijack(), EventSource clients see a brief
 * open then "failed loading" as the socket closes after the first frames.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

export function formatSse(event: string, data: unknown): string {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${json.replace(/\n/g, '\\n')}\n\n`;
}

export function formatSseComment(comment: string): string {
  return `: ${comment}\n\n`;
}

/**
 * Open an SSE response on `reply.raw`, take ownership of the socket, and
 * return a small writer API. Call only after auth/authorization have succeeded
 * (JSON errors must still go through the normal Fastify reply path).
 *
 * A `retry: 3000` field is emitted once before the first event so reconnecting
 * EventSource clients use a 3s delay instead of the browser default.
 *
 * Write failures propagate: the stream is marked errored, the underlying
 * socket is destroyed, and the call throws. Node's `res.write()` silently
 * no-ops into a dead/half-open socket, which is exactly the "connected but
 * dead" zombie (a cleared heartbeat with an open HTTP stream the browser
 * never notices). Destroying the socket makes the browser's EventSource see
 * the close and reconnect; heartbeat catch-blocks in the routes keep
 * clearing their interval — the socket is dead either way.
 *
 * Backpressure: when `write()` returns false the chunk's byte length is
 * accumulated into a pending counter, reset by a one-time 'drain' listener.
 * A reader that lets pending bytes exceed 4MB is killed the same way (mark
 * failed + throw) so a slow/stalled consumer cannot pin unbounded userland
 * buffers; the browser reconnects.
 */
export function openSseStream(
  request: FastifyRequest,
  reply: FastifyReply,
  extraHeaders: Record<string, string> = {},
): {
  write: (chunk: string) => void;
  push: (event: string, data: unknown) => void;
  comment: (text: string) => void;
} {
  // Prevent Fastify from ending the response when this handler returns.
  // Available on Fastify 3+; cast for typings that omit it.
  const anyReply = reply as FastifyReply & { hijack?: () => void };
  if (typeof anyReply.hijack === 'function') {
    anyReply.hijack();
  }

  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    reply.raw.setHeader('Access-Control-Allow-Origin', origin);
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // Disable compression for this socket if something already negotiated it.
  reply.raw.setHeader('Content-Encoding', 'identity');

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...extraHeaders,
  });

  // Flush headers immediately on platforms that buffer.
  try {
    (reply.raw as any).flushHeaders?.();
  } catch {
    /* ignore */
  }

  const raw = reply.raw as unknown as {
    write: (chunk: string) => unknown;
    destroyed?: boolean;
    writableEnded?: boolean;
    destroy?: (err?: Error) => void;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    once?: (event: string, listener: (...args: unknown[]) => void) => void;
    removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  };

  let failed = false;
  // Idempotent: mark the stream dead and destroy the socket so the browser's
  // EventSource observes the close and reconnects instead of sitting on a
  // stream that will never deliver again. No error is forwarded to destroy()
  // on purpose — forwarding would re-emit 'error' on the socket and the HTTP
  // server would treat it as a clientError; the failure is already surfaced
  // to the caller (throw) and to gateway fan-out logging.
  const markFailed = (): void => {
    if (failed) return;
    failed = true;
    clearDrainListener();
    try {
      raw.destroy?.();
    } catch {
      /* socket already gone */
    }
  };
  // Socket-level errors (ECONNRESET etc.) arrive as events, not write throws.
  raw.on('error', markFailed);

  // Backpressure accounting: bytes handed to a full kernel/userland buffer
  // (write() returned false) and not yet drained. Above the cap the reader is
  // considered a zombie slow-consumer and the stream is killed.
  const PENDING_BYTES_MAX = 4 * 1024 * 1024;
  let pendingBytes = 0;
  let drainListener: ((...args: unknown[]) => void) | null = null;
  function clearDrainListener(): void {
    if (!drainListener) return;
    const fn = drainListener;
    drainListener = null;
    try {
      raw.removeListener?.('drain', fn);
    } catch {
      /* listener bookkeeping is best-effort */
    }
  }

  const write = (chunk: string): void => {
    if (failed || raw.destroyed === true || raw.writableEnded === true) {
      markFailed();
      throw new Error('SSE stream is closed');
    }
    try {
      const flushed = raw.write(chunk);
      if (flushed === false) {
        pendingBytes += Buffer.byteLength(chunk);
        if (!drainListener) {
          const onDrain = (): void => {
            pendingBytes = 0;
            drainListener = null;
          };
          drainListener = onDrain;
          // One-time listener; fall back to on() for sockets without once().
          if (typeof raw.once === 'function') raw.once('drain', onDrain);
          else raw.on('drain', onDrain);
        }
        if (pendingBytes > PENDING_BYTES_MAX) {
          markFailed();
          throw new Error('SSE backpressure limit exceeded (slow reader)');
        }
      }
    } catch (err) {
      markFailed();
      throw err instanceof Error ? err : new Error(String(err));
    }
  };

  // Reconnect hint, emitted once before the first event. Setup-time failure is
  // swallowed: markFailed() already ran, and the route's first push will throw.
  try {
    write('retry: 3000\n\n');
  } catch {
    /* dead on arrival — first real write surfaces it */
  }

  return {
    write,
    push: (event, data) => write(formatSse(event, data)),
    comment: (text) => write(formatSseComment(text)),
  };
}
