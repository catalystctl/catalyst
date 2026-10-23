/**
 * Guard against Fastify re-sending an already dispatched payload as `undefined`.
 *
 * Fastify's `wrap-thenable` calls `reply.send(payload)` again when an async
 * handler resolves to `undefined` after having called `reply.send()` itself. It
 * only skips that extra send when the reply has already finished
 * (`reply.sent`), and `sent` is `raw.writableEnded`:
 *
 *   - A buffered payload (string/Buffer) is written with `res.end()` inside the
 *     first send, so the guard holds and the extra send is a no-op.
 *   - A **stream** payload is piped: `raw.writableEnded` stays false and
 *     `raw.headersSent` also stays false (Fastify falls back to `setHeader` so
 *     stream errors can still produce a 404). The extra `send(undefined)` then
 *     reaches `onSendEnd` with a null payload, which sets `content-length: 0`
 *     and answers 200 with an empty body.
 *
 * Compression is what makes JSON responses take the stream path, so with
 * `ENABLE_COMPRESSION` on every response above the compression threshold came
 * back empty (issue #317). File downloads hit the same footgun.
 *
 * Swallowing only the redundant `send(undefined)` keeps the first body and
 * leaves every other send path — including a real second payload, which Fastify
 * already rejects with FST_ERR_REP_ALREADY_SENT — untouched.
 */
import type { FastifyReply } from "fastify";

type SendFn = (payload?: unknown) => FastifyReply;

/** Install the duplicate-send guard on one reply (call from an `onRequest` hook). */
export function guardDuplicateUndefinedSend(reply: FastifyReply): void {
  const original = reply.send.bind(reply) as SendFn;
  let dispatched = false;
  reply.send = ((payload?: unknown) => {
    if (payload === undefined && dispatched) {
      return reply;
    }
    dispatched = true;
    return original(payload);
  }) as FastifyReply["send"];
}
