/**
 * Regression test for issue #317: with compression enabled, an async handler
 * that calls `reply.send()` instead of returning the payload had its response
 * replaced by an empty body (`content-encoding: gzip`, `content-length: 0`).
 *
 * The compressed payload is a stream, so Fastify's `wrap-thenable` does not
 * consider the reply finished and sends `undefined` a second time. The guard
 * installed by `guardDuplicateUndefinedSend` (wired in server.ts as an
 * `onRequest` hook) drops that redundant send.
 */
import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCompress from "@fastify/compress";
import { gunzipSync } from "node:zlib";
import { guardDuplicateUndefinedSend } from "../lib/reply-send-guard.js";

const BODY_CHARS = 8000;

async function buildApp(withGuard: boolean): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	// threshold=1 compresses everything; syncThreshold=0 forces the streaming
	// path that reproduced the bug (the sync path always worked).
	await app.register(fastifyCompress, {
		global: true,
		encodings: ["gzip"],
		threshold: 1,
		syncThreshold: 0,
	} as never);
	if (withGuard) {
		app.addHook("onRequest", async (_request, reply) => {
			guardDuplicateUndefinedSend(reply);
		});
	}
	// No `return` on purpose: this is the shape that broke.
	app.get("/send", async (_request, reply) => {
		reply.send({ data: "x".repeat(BODY_CHARS) });
	});
	app.get("/send-empty", async (_request, reply) => {
		reply.code(204).send();
	});
	app.get("/return", async () => ({ data: "x".repeat(BODY_CHARS) }));
	await app.ready();
	return app;
}

describe("compression with a non-returning async handler (#317)", () => {
	it("keeps the body when the handler calls reply.send without returning", async () => {
		const app = await buildApp(true);
		try {
			const res = await app.inject({
				method: "GET",
				url: "/send",
				headers: { "accept-encoding": "gzip" },
			});
			expect(res.statusCode).toBe(200);
			expect(res.headers["content-encoding"]).toBe("gzip");
			const decoded = (res.headers["content-encoding"] === "gzip"
				? gunzipSync(res.rawPayload)
				: res.rawPayload
			).toString("utf8");
			expect(JSON.parse(decoded).data).toHaveLength(BODY_CHARS);
		} finally {
			await app.close();
		}
	});

	it("still sends a body when the handler returns the payload", async () => {
		const app = await buildApp(true);
		try {
			const res = await app.inject({
				method: "GET",
				url: "/return",
				headers: { "accept-encoding": "gzip" },
			});
			expect(res.statusCode).toBe(200);
			const decoded = gunzipSync(res.rawPayload).toString("utf8");
			expect(JSON.parse(decoded).data).toHaveLength(BODY_CHARS);
		} finally {
			await app.close();
		}
	});

	it("leaves bodyless 204 responses alone", async () => {
		const app = await buildApp(true);
		try {
			const res = await app.inject({
				method: "GET",
				url: "/send-empty",
				headers: { "accept-encoding": "gzip" },
			});
			expect(res.statusCode).toBe(204);
			expect(res.rawPayload.length).toBe(0);
		} finally {
			await app.close();
		}
	});

	it("documents the unguarded failure mode", async () => {
		// Without the guard the body is empty — this is what #317 reported and
		// why the hook exists. If Fastify ever fixes wrap-thenable, this test
		// starts failing and the guard can be removed.
		const app = await buildApp(false);
		try {
			const res = await app.inject({
				method: "GET",
				url: "/send",
				headers: { "accept-encoding": "gzip" },
			});
			expect(res.statusCode).toBe(200);
			expect(res.rawPayload.length).toBe(0);
		} finally {
			await app.close();
		}
	});
});
