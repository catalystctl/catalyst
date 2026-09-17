/**
 * Panel-hosted MCP endpoint (Streamable HTTP, stateless JSON mode).
 *
 * Mounted at /api/mcp:
 *   POST   — JSON-RPC request (initialize, tools/list, tools/call, ping).
 *             Answers with a single application/json response; notifications
 *             get HTTP 202 with no body. Batch arrays are rejected.
 *   GET    — Minimal SSE keep-alive stream for clients that open one. Capped
 *             per key; the server never pushes tool results over it (stateless).
 *   DELETE — 404: there are no sessions to terminate in stateless mode.
 *
 * Security properties (deliberate, see docs):
 * - Bearer API-key auth ONLY. Session cookies are never read, so a victim's
 *   browser cannot be CSRF-driven into this endpoint, and CORS stays closed
 *   for browsers (MCP clients are non-browser HTTP callers).
 * - The master switch lives in MCP settings (Admin > Security). While
 *   disabled every method 404s identically, revealing nothing to scanners.
 * - Tool calls re-enter this same Fastify instance via app.inject with the
 *   caller's unmodified Bearer key, so REST permission checks, scoped
 *   grants, and audit logs apply exactly as for direct API use. The MCP
 *   layer adds: a per-key tool-call budget and a confirm:true gate for
 *   destructive tools (see src/mcp/).
 */

import crypto from "crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { apiError } from "../lib/http-error";
import { ErrorCodes } from "../shared-types";
import { verifyApiKey as verifyApiKeyService } from "../services/api-key-service";
import { getMcpSettings } from "../services/mcp-settings";
import { openSseStream } from "../utils/sse.js";
import {
  handleMcpMessage,
  type McpContext,
  type McpUpstreamResult,
} from "../mcp/protocol.js";
import type { McpUpstreamRequest } from "../mcp/tools.js";

const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_SSE_STREAMS_PER_KEY = 5;
const MAX_SSE_STREAMS_GLOBAL = 200;
const HEARTBEAT_INTERVAL_MS = 25_000;

const sseStreamsByKey = new Map<string, number>();
let sseStreamsTotal = 0;

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.substring(7).trim();
  }
  return "";
}

function keyFingerprint(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

interface McpIdentity {
  userId: string;
  rawKey: string;
  keyHash: string;
}

/**
 * Gate every /api/mcp method: master switch, then Bearer API-key auth with
 * the same banned/locked enforcement as the main session path. Returns null
 * after sending the error response.
 */
async function authenticateMcp(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<McpIdentity | null> {
  const settings = await getMcpSettings();
  if (!settings.enabled) {
    // Identical shape to the global 404 handler: disabled is undiscoverable.
    apiError(reply, 404, ErrorCodes.NOT_FOUND, "Not Found");
    return null;
  }
  const token = bearerToken(request);
  if (!token || !token.startsWith("catalyst")) {
    // No fallback to session cookies — see module docstring.
    apiError(reply, 401, ErrorCodes.UNAUTHORIZED, "Unauthorized");
    return null;
  }
  let verification: Awaited<ReturnType<typeof verifyApiKeyService>>;
  try {
    verification = await verifyApiKeyService(token);
  } catch {
    verification = null;
  }
  if (!verification?.valid || !verification?.key || !verification?.user) {
    apiError(reply, 401, ErrorCodes.UNAUTHORIZED, "Invalid or expired API key");
    return null;
  }
  const account = await prisma.user.findUnique({
    where: { id: verification.user.id },
    select: { banned: true, lockedUntil: true },
  });
  if (account?.banned) {
    apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Account is banned");
    return null;
  }
  if (account?.lockedUntil && new Date(account.lockedUntil) > new Date()) {
    apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Account is locked");
    return null;
  }
  return { userId: verification.user.id, rawKey: token, keyHash: keyFingerprint(token) };
}

function buildUpstreamUrl(plan: McpUpstreamRequest): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(plan.query)) {
    params.set(key, value);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return `${plan.path}${suffix}`;
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  const callUpstream = async (
    identity: McpIdentity,
    plan: McpUpstreamRequest,
    toolName: string,
  ): Promise<McpUpstreamResult> => {
    const hasBody = plan.body !== undefined;
    const injectPromise = app.inject({
      method: plan.method,
      url: buildUpstreamUrl(plan),
      headers: {
        authorization: `Bearer ${identity.rawKey}`,
        "content-type": "application/json",
        "x-mcp-tool": toolName,
      },
      ...(hasBody ? { payload: JSON.stringify(plan.body) } : {}),
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Upstream ${plan.method} ${plan.path} timed out`)), UPSTREAM_TIMEOUT_MS);
    });
    const res = await Promise.race([injectPromise, timeoutPromise]);
    const raw = typeof res.body === "string" ? res.body : "";
    let payload: unknown;
    if (!raw) {
      payload = null;
    } else {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw.length > 8000 ? `${raw.slice(0, 8000)}…[truncated]` : raw;
      }
    }
    return { status: res.statusCode, payload };
  };

  // ── POST /api/mcp — JSON-RPC over Streamable HTTP (stateless) ──────────
  app.post(
    "/mcp",
    {
      // Tool arguments are small JSON (even write_file content is bounded by
      // model context in practice); 2MB stops abuse while direct REST stays
      // available for large transfers.
      bodyLimit: 2_000_000,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const identity = await authenticateMcp(request, reply);
      if (!identity) return;
      const settings = await getMcpSettings();

      let body: unknown = request.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          return reply.status(200).send({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          });
        }
      }

      const ctx: McpContext = {
        toolRateLimitMax: settings.toolRateLimitMax,
        keyHash: identity.keyHash,
        callUpstream: (plan, toolName) => callUpstream(identity, plan, toolName),
      };
      const response = await handleMcpMessage(body, ctx);
      if (response === null) {
        // Notification: accepted, no response body per JSON-RPC.
        return reply.status(202).send();
      }
      return reply.status(200).send(response);
    },
  );

  // ── GET /api/mcp — keep-alive SSE stream (stateless: no server messages) ──
  // Some MCP clients open this on connect and hold it for the session. We
  // accept and heartbeat it within tight caps; tool results always travel
  // over POST responses, never this stream.
  app.get(
    "/mcp",
    {
      // Long-lived like the console/metrics SSE routes; excluded from the
      // global rate limiter so an open stream is not counted per minute.
      config: { rateLimit: false },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const identity = await authenticateMcp(request, reply);
      if (!identity) return;

      const perKey = sseStreamsByKey.get(identity.keyHash) ?? 0;
      if (perKey >= MAX_SSE_STREAMS_PER_KEY || sseStreamsTotal >= MAX_SSE_STREAMS_GLOBAL) {
        apiError(reply, 503, ErrorCodes.RATE_LIMITED, "Too many open MCP streams. Close idle clients and retry.");
        return;
      }
      sseStreamsByKey.set(identity.keyHash, perKey + 1);
      sseStreamsTotal += 1;

      const sse = openSseStream(request, reply);
      sse.comment("mcp-connected");

      const heartbeat = setInterval(() => {
        try {
          sse.comment("heartbeat");
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_INTERVAL_MS);

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(heartbeat);
        const current = sseStreamsByKey.get(identity.keyHash) ?? 1;
        if (current <= 1) sseStreamsByKey.delete(identity.keyHash);
        else sseStreamsByKey.set(identity.keyHash, current - 1);
        sseStreamsTotal = Math.max(0, sseStreamsTotal - 1);
      };
      request.raw.on("close", cleanup);
    },
  );

  // ── DELETE /api/mcp — no sessions exist in stateless mode ───────────────
  app.delete("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = await authenticateMcp(request, reply);
    if (!identity) return;
    apiError(reply, 404, ErrorCodes.NOT_FOUND, "Not Found");
  });
}
