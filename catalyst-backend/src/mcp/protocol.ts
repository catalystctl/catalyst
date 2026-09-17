/**
 * Minimal MCP Streamable-HTTP dispatcher (stateless, JSON responses).
 *
 * The spec allows a Streamable HTTP server to answer POSTs with a single
 * `application/json` response instead of an SSE stream, which is what this
 * does: no session ids, no resumability, no cross-request state. Every MCP
 * request is self-contained (Bearer key on each HTTP call), so any backend
 * replica can serve any request and there is nothing to stick or replicate.
 *
 * Tool calls execute through `callUpstream` (the route wires it to
 * `app.inject` with the caller's own key), so REST auth/authz/audit apply.
 * This module adds the MCP-specific guards: a per-key tool-call budget that
 * bounds agentic loops, and an explicit-confirmation gate for destructive
 * tools. Both are in-band (CallToolResult with isError) so MCP clients
 * surface them as assistant-visible text instead of transport failures.
 */

import { getMcpTool, planUpstreamRequest, MCP_TOOLS, type McpUpstreamRequest } from "./tools.js";
import { getCurrentVersion } from "../lib/panel-version.js";

export interface McpUpstreamResult {
  status: number;
  payload: unknown;
}

export interface McpContext {
  /** Per-key tool budget per minute (from MCP settings). */
  toolRateLimitMax: number;
  /** Key fingerprint for bucketing (sha256 hex slice, never the key). */
  keyHash: string;
  callUpstream: (req: McpUpstreamRequest, toolName: string) => Promise<McpUpstreamResult>;
}

interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

const SERVER_NAME = "catalyst-panel";
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
]);

/** Cap tool-result text: model context is the scarcest resource here. */
const MAX_RESULT_CHARS = 65_536;

// ── Per-key tool-call budget ────────────────────────────────────────────────
// Process-local sliding window (same degraded-mode semantics as the rest of
// the rate-limit stack: each replica enforces its own bucket). The global
// Fastify rate limiter still bounds raw HTTP POSTs; this bounds *tool calls*,
// which is what an agentic loop actually spends.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function toolBudgetExceeded(keyHash: string, max: number): { exceeded: boolean; retryInSec: number } {
  const now = Date.now();
  const bucket = buckets.get(keyHash);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(keyHash, { count: 1, resetAt: now + 60_000 });
    return { exceeded: false, retryInSec: 0 };
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return { exceeded: true, retryInSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { exceeded: false, retryInSec: 0 };
}

/** Test helper. */
export function clearMcpToolRateLimits(): void {
  buckets.clear();
}

// ── Result helpers ──────────────────────────────────────────────────────────

function toJsonText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length > MAX_RESULT_CHARS) {
    return `${text.slice(0, MAX_RESULT_CHARS)}…[truncated ${text.length - MAX_RESULT_CHARS} chars]`;
  }
  return text;
}

function toolResult(text: string, isError = false): Record<string, unknown> {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

function upstreamErrorText(method: string, path: string, status: number, payload: unknown): string {
  let detail = "";
  if (payload !== null && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.error ?? record.message;
    const code = record.code;
    if (typeof message === "string" && message) detail = message;
    if (typeof code === "string" && code) detail = detail ? `${detail} (${code})` : code;
  } else if (typeof payload === "string" && payload) {
    detail = payload.slice(0, 500);
  }
  return `Upstream ${method} ${path} failed with HTTP ${status}${detail ? `: ${detail}` : ""}`;
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

function invalidRequest(id: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid Request" } satisfies RpcError };
}

function serverVersion(): string {
  try {
    return getCurrentVersion() ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function handleCall(
  toolName: unknown,
  toolArgs: unknown,
  ctx: McpContext,
): Promise<Record<string, unknown>> {
  if (typeof toolName !== "string" || !toolName) {
    return toolResult("Missing required parameter: name.", true);
  }
  const tool = getMcpTool(toolName);
  if (!tool) {
    return toolResult(`Unknown tool: ${toolName}. Call tools/list to enumerate available tools.`, true);
  }
  const args =
    toolArgs === undefined || toolArgs === null
      ? {}
      : typeof toolArgs === "object" && !Array.isArray(toolArgs)
        ? (toolArgs as Record<string, any>)
        : null;
  if (args === null) {
    return toolResult("Invalid params: arguments must be an object.", true);
  }

  if (tool.destructive && args.confirm !== true) {
    return toolResult(
      `Destructive action "${toolName}" requires explicit confirmation. ` +
        `Retry the call with {"confirm": true} alongside the other arguments. ` +
        `Only confirm after the user has approved this exact action.`,
      true,
    );
  }

  const budget = toolBudgetExceeded(ctx.keyHash, ctx.toolRateLimitMax);
  if (budget.exceeded) {
    return toolResult(
      `MCP tool budget exceeded (${ctx.toolRateLimitMax} calls/min for this key). ` +
        `Retry in ~${budget.retryInSec}s, or batch fewer calls per turn.`,
      true,
    );
  }

  let plan: McpUpstreamRequest;
  try {
    plan = planUpstreamRequest(tool, args);
  } catch (error) {
    return toolResult(
      `Failed to build upstream request for "${toolName}": ${(error as Error).message}`,
      true,
    );
  }

  try {
    const upstream = await ctx.callUpstream(plan, toolName);
    if (upstream.status >= 200 && upstream.status < 300) {
      return toolResult(toJsonText(upstream.payload));
    }
    return toolResult(upstreamErrorText(plan.method, plan.path, upstream.status, upstream.payload), true);
  } catch (error) {
    return toolResult(
      `Upstream ${plan.method} ${plan.path} errored: ${(error as Error).message}`.slice(0, 2000),
      true,
    );
  }
}

/**
 * Handle one decoded JSON-RPC message. Returns the response envelope, or
 * null for notifications (caller should answer HTTP 202 with no body).
 */
export async function handleMcpMessage(
  msg: unknown,
  ctx: McpContext,
): Promise<Record<string, unknown> | null> {
  if (Array.isArray(msg)) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch requests are not supported; send one request per POST." } satisfies RpcError };
  }
  if (msg === null || typeof msg !== "object") return invalidRequest(null);
  const record = msg as Record<string, unknown>;
  if (record.jsonrpc !== "2.0" || typeof record.method !== "string") return invalidRequest(record.id);

  const hasId = record.id !== undefined;
  const id = hasId ? (record.id as string | number | null) : null;
  const method = record.method;
  const params = (record.params ?? {}) as Record<string, unknown>;

  // Notifications (no id) never produce a response body.
  if (!hasId) return null;

  switch (method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested)
        ? requested
        : DEFAULT_PROTOCOL_VERSION;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: serverVersion() },
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list": {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: MCP_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            ...(t.destructive ? { annotations: { destructiveHint: true, readOnlyHint: false } } : {}),
          })),
        },
      };
    }
    case "tools/call": {
      const result = await handleCall(params.name, params.arguments, ctx);
      return { jsonrpc: "2.0", id, result };
    }
    default:
      // notifications/* with an id is a client bug; answer Method not found.
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` } satisfies RpcError,
      };
  }
}
