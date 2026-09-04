import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { getWsGateway } from '../websocket/gateway';
import { captureSystemError } from '../services/error-logger';

/** Keys that must never land in audit details (case-insensitive substring match). */
const SENSITIVE_KEY_RE =
  /password|passwd|secret|token|apikey|api_key|authorization|cookie|private[_-]?key|credential|refresh[_-]?token|access[_-]?token|client[_-]?secret|totp|otp|session/i;

export interface AuditRequestContext {
  ip?: string | null;
  userAgent?: string | null;
  method?: string | null;
  path?: string | null;
  requestId?: string | null;
  /** Optional extra request-scoped fields (e.g. bulk: true). */
  extra?: Record<string, unknown>;
}

export interface AuditLogOptions {
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown> | null;
  /** When provided, request IP / UA / route are auto-merged into details. */
  request?: FastifyRequest | AuditRequestContext | null;
}

export interface ServerAuditSnapshot {
  id?: string | null;
  name?: string | null;
  uuid?: string | null;
  status?: string | null;
  nodeId?: string | null;
  ownerId?: string | null;
  primaryPort?: number | null;
  primaryIp?: string | null;
  networkMode?: string | null;
  templateId?: string | null;
  template?: { id?: string | null; name?: string | null; slug?: string | null } | null;
  node?: { id?: string | null; name?: string | null; publicAddress?: string | null; isOnline?: boolean | null } | null;
  allocatedMemoryMb?: number | null;
  allocatedCpuCores?: number | null;
  allocatedDiskMb?: number | null;
  suspendedAt?: Date | string | null;
  suspensionReason?: string | null;
}

/**
 * Extract request context suitable for audit enrichment.
 * Safe to call with a partial Fastify request or a plain context object.
 */
export function getAuditRequestContext(
  request?: FastifyRequest | AuditRequestContext | null
): AuditRequestContext {
  if (!request) return {};

  // Already a plain context object
  if (!('headers' in request) && !('raw' in request)) {
    return request as AuditRequestContext;
  }

  const req = request as FastifyRequest;
  const headers = (req.headers || {}) as Record<string, string | string[] | undefined>;
  const ua = headers['user-agent'];
  const requestIdHeader = headers['x-request-id'] ?? headers['x-correlation-id'];
  const requestId =
    (typeof (req as any).id === 'string' ? (req as any).id : null) ||
    (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) ||
    null;

  return {
    ip: req.ip || (req.socket as any)?.remoteAddress || null,
    userAgent: Array.isArray(ua) ? ua[0] : ua || null,
    method: req.method || null,
    path: (req as any).routerPath || req.url?.split('?')[0] || null,
    requestId: requestId ? String(requestId).slice(0, 128) : null,
  };
}

/**
 * Build a rich, redacted server snapshot for audit details.
 * Prefer including this on every server-scoped audit entry.
 */
export function buildServerAuditDetails(
  server: ServerAuditSnapshot | null | undefined,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  if (!server) {
    return sanitizeAuditDetails(extra) as Record<string, unknown>;
  }

  const snapshot: Record<string, unknown> = {
    serverName: server.name ?? undefined,
    serverUuid: server.uuid ?? undefined,
    previousStatus: server.status ?? undefined,
    status: server.status ?? undefined,
    nodeId: server.nodeId ?? server.node?.id ?? undefined,
    nodeName: server.node?.name ?? undefined,
    nodeAddress: server.node?.publicAddress ?? undefined,
    nodeOnline: server.node?.isOnline ?? undefined,
    ownerId: server.ownerId ?? undefined,
    primaryPort: server.primaryPort ?? undefined,
    primaryIp: server.primaryIp ?? undefined,
    networkMode: server.networkMode ?? undefined,
    templateId: server.templateId ?? server.template?.id ?? undefined,
    templateName: server.template?.name ?? undefined,
    templateSlug: server.template?.slug ?? undefined,
    allocatedMemoryMb: server.allocatedMemoryMb ?? undefined,
    allocatedCpuCores: server.allocatedCpuCores ?? undefined,
    allocatedDiskMb: server.allocatedDiskMb ?? undefined,
  };

  if (server.suspendedAt) {
    snapshot.suspendedAt =
      server.suspendedAt instanceof Date
        ? server.suspendedAt.toISOString()
        : String(server.suspendedAt);
  }
  if (server.suspensionReason) {
    snapshot.suspensionReason = server.suspensionReason;
  }

  return sanitizeAuditDetails({ ...snapshot, ...extra }) as Record<string, unknown>;
}

/**
 * Recursively strip secrets / huge blobs from audit detail payloads.
 * Returns a JSON-safe plain object/array/primitive.
 */
export function sanitizeAuditDetails(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[max-depth]';

  if (typeof value === 'string') {
    // Cap extremely long strings (e.g. file contents accidentally logged)
    return value.length > 4000 ? `${value.slice(0, 4000)}…[truncated ${value.length} chars]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();

  if (Array.isArray(value)) {
    const capped = value.slice(0, 100).map((item) => sanitizeAuditDetails(item, depth + 1));
    if (value.length > 100) {
      capped.push(`[…${value.length - 100} more items]`);
    }
    return capped;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [rawKey, rawVal] of Object.entries(value as Record<string, unknown>)) {
      if (rawVal === undefined) continue;
      if (SENSITIVE_KEY_RE.test(rawKey)) {
        out[rawKey] = '[redacted]';
        continue;
      }
      // Drop Buffer-like / binary
      if (
        rawVal &&
        typeof rawVal === 'object' &&
        (Buffer.isBuffer(rawVal) ||
          (rawVal as any).type === 'Buffer' ||
          ArrayBuffer.isView(rawVal))
      ) {
        out[rawKey] = '[binary]';
        continue;
      }
      out[rawKey] = sanitizeAuditDetails(rawVal, depth + 1);
    }
    return out;
  }

  try {
    return String(value);
  } catch {
    return '[unserializable]';
  }
}

function mergeRequestIntoDetails(
  details: Record<string, unknown>,
  request?: FastifyRequest | AuditRequestContext | null
): Record<string, unknown> {
  const ctx = getAuditRequestContext(request);
  const requestMeta: Record<string, unknown> = {};
  if (ctx.ip) requestMeta.ip = ctx.ip;
  if (ctx.userAgent) requestMeta.userAgent = String(ctx.userAgent).slice(0, 512);
  if (ctx.method) requestMeta.method = ctx.method;
  if (ctx.path) requestMeta.path = ctx.path;
  if (ctx.requestId) requestMeta.requestId = ctx.requestId;

  return {
    ...details,
    ...(Object.keys(requestMeta).length > 0 ? { _request: requestMeta } : {}),
    // Flat convenience copies for older UI that expects top-level ip
    ...(ctx.ip && details.ip === undefined ? { ip: ctx.ip } : {}),
    ...(ctx.userAgent && details.userAgent === undefined
      ? { userAgent: String(ctx.userAgent).slice(0, 512) }
      : {}),
    ...(ctx.extra || {}),
  };
}

/**
 * Create an audit log entry.
 *
 * Automatically enriches `details` with:
 * - actor info (`_actor.username`, `_actor.email`, `_actor.userId`)
 * - request context (`_request.ip/method/path/userAgent/requestId`) when `request` is passed
 * - redaction of secrets and oversized payloads
 * - ISO timestamp under `_meta.recordedAt`
 *
 * Prefer this over raw `prisma.auditLog.create` so every entry gets the same enrichment.
 */
export async function createAuditLog(
  userId: string | null | undefined,
  options: AuditLogOptions
): Promise<void> {
  try {
    // Auto-enrich: look up actor username/email (best-effort)
    let actorInfo: Record<string, string> = {};
    if (userId) {
      try {
        const actor = await prisma.user.findUnique({
          where: { id: userId },
          select: { username: true, email: true, name: true },
        });
        if (actor) {
          actorInfo = {
            '_actor.userId': userId,
            '_actor.username': actor.username,
            '_actor.email': actor.email,
            ...(actor.name ? { '_actor.name': actor.name } : {}),
          };
        } else {
          actorInfo = { '_actor.userId': userId };
        }
      } catch {
        actorInfo = userId ? { '_actor.userId': userId } : {};
      }
    }

    const rawDetails =
      options.details && typeof options.details === 'object' && !Array.isArray(options.details)
        ? { ...(options.details as Record<string, unknown>) }
        : options.details !== null && options.details !== undefined
          ? { value: options.details as unknown }
          : {};

    const withRequest = mergeRequestIntoDetails(rawDetails, options.request);
    const sanitized = sanitizeAuditDetails(withRequest) as Record<string, unknown>;

    const details = {
      ...actorInfo,
      ...sanitized,
      _meta: {
        recordedAt: new Date().toISOString(),
        action: options.action,
        resource: options.resource,
        ...(options.resourceId ? { resourceId: options.resourceId } : {}),
      },
    };

    const entry = await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action: options.action,
        resource: options.resource,
        resourceId: options.resourceId,
        details,
      },
    });

    try {
      const wsGateway = getWsGateway();
      wsGateway?.pushToAdminSubscribers('audit_log_created', {
        id: entry.id,
        action: entry.action,
        userId: entry.userId,
        resource: entry.resource,
        resourceId: entry.resourceId,
        // Include a compact detail summary so live UIs can show something immediately
        detailsSummary: summarizeDetails(details),
        timestamp:
          entry.timestamp instanceof Date
            ? entry.timestamp.toISOString()
            : new Date().toISOString(),
      });
    } catch {
      /* ignore — audit logging is best-effort */
    }
  } catch (error: any) {
    captureSystemError({
      level: 'warn',
      component: 'AuditMiddleware',
      message: 'Failed to create audit log',
      stack: error?.stack,
      metadata: { userId, action: options.action, resource: options.resource },
    }).catch(() => {});
  }
}

/** Short human-readable summary for SSE payloads (not stored). */
function summarizeDetails(details: Record<string, unknown>): string {
  const skip = new Set(['_actor.username', '_actor.email', '_actor.userId', '_actor.name', '_meta', '_request']);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (skip.has(k) || k.startsWith('_')) continue;
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'object') continue;
    parts.push(`${k}=${String(v)}`);
    if (parts.length >= 6) break;
  }
  return parts.join(', ').slice(0, 240);
}

/**
 * Enrich a plain details object the same way createAuditLog would (for createMany paths).
 * Does NOT look up the actor — pass actor fields yourself or call resolveActorDetails.
 */
export async function resolveActorDetails(userId: string | null | undefined): Promise<Record<string, string>> {
  if (!userId) return {};
  try {
    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, email: true, name: true },
    });
    if (!actor) return { '_actor.userId': userId };
    return {
      '_actor.userId': userId,
      '_actor.username': actor.username,
      '_actor.email': actor.email,
      ...(actor.name ? { '_actor.name': actor.name } : {}),
    };
  } catch {
    return { '_actor.userId': userId };
  }
}

/**
 * Build fully-enriched details for bulk createMany (actor + request + sanitize + meta).
 */
export async function enrichAuditDetails(params: {
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  request?: FastifyRequest | AuditRequestContext | null;
  /** Pre-resolved actor details to avoid N lookups in bulk loops. */
  actorDetails?: Record<string, string>;
}): Promise<Record<string, unknown>> {
  const actorInfo =
    params.actorDetails ?? (await resolveActorDetails(params.userId));
  const raw =
    params.details && typeof params.details === 'object' ? { ...params.details } : {};
  const withRequest = mergeRequestIntoDetails(raw, params.request);
  const sanitized = sanitizeAuditDetails(withRequest) as Record<string, unknown>;
  return {
    ...actorInfo,
    ...sanitized,
    _meta: {
      recordedAt: new Date().toISOString(),
      action: params.action,
      resource: params.resource,
      ...(params.resourceId ? { resourceId: params.resourceId } : {}),
    },
  };
}

/**
 * Log authentication attempts
 */
export async function logAuthAttempt(
  email: string,
  success: boolean,
  ip: string,
  userAgent?: string
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      await createAuditLog(user.id, {
        action: success ? 'login_success' : 'login_failed',
        resource: 'auth',
        resourceId: user.id,
        details: {
          email,
          ip,
          userAgent: userAgent ? String(userAgent).slice(0, 512) : undefined,
          success,
          outcome: success ? 'success' : 'failure',
        },
      });
    } else {
      // Still record failed attempts for unknown emails (no userId) for security forensics
      await createAuditLog(null, {
        action: 'login_failed',
        resource: 'auth',
        details: {
          email,
          ip,
          userAgent: userAgent ? String(userAgent).slice(0, 512) : undefined,
          success: false,
          outcome: 'failure',
          reason: 'unknown_user',
        },
      });
    }
  } catch (error: any) {
    captureSystemError({
      level: 'warn',
      component: 'AuditMiddleware',
      message: 'Failed to log auth attempt',
      stack: error?.stack,
      metadata: { email, success, ip },
    }).catch(() => {});
  }
}

/**
 * Log server actions (start, stop, restart, etc.)
 */
export async function logServerAction(
  userId: string,
  serverId: string,
  action: string,
  details?: Record<string, unknown> | null,
  request?: FastifyRequest | AuditRequestContext | null
): Promise<void> {
  await createAuditLog(userId, {
    action: action.startsWith('server_') || action.startsWith('server.')
      ? action.includes('.')
        ? action
        : action.replace(/^server_/, 'server.')
      : `server.${action}`,
    resource: 'server',
    resourceId: serverId,
    details: details || undefined,
    request,
  });
}

/** No-op middleware placeholder kept for route compatibility if imported. */
export async function auditMiddleware(
  _request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  // Intentionally empty — audit is explicit via createAuditLog at call sites.
}
