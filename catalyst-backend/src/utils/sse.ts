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

  const write = (chunk: string) => {
    try {
      reply.raw.write(chunk);
    } catch {
      /* closed */
    }
  };

  return {
    write,
    push: (event, data) => write(formatSse(event, data)),
    comment: (text) => write(formatSseComment(text)),
  };
}
