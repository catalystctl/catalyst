import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { getWsGateway } from '../websocket/gateway';
import { captureSystemError } from '../services/error-logger';

interface AuditLogOptions {
  action: string;
  resource: string;
  resourceId?: string;
  details?: any;
}

/**
 * Create an audit log entry.
 *
 * Automatically enriches `details` with actor info (`_actor.username`,
 * `_actor.userId`) so the frontend can display who performed the action
 * without a separate user lookup.
 */
export async function createAuditLog(
  userId: string,
  options: AuditLogOptions
): Promise<void> {
  try {
    // Auto-enrich: look up actor username/email (best-effort, cached)
    let actorInfo: Record<string, string> = {};
    try {
      const actor = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, email: true },
      });
      if (actor) {
        actorInfo = { '_actor.username': actor.username, '_actor.email': actor.email };
      }
    } catch { /* best-effort */ }

    const details = {
      ...actorInfo,
      ...(options.details || {}),
    };

    const entry = await prisma.auditLog.create({
      data: {
        userId,
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
        timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : new Date().toISOString(),
      });
    } catch { /* ignore — audit logging is best-effort */ }
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
    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: success ? 'login_success' : 'login_failed',
          resource: 'auth',
          details: {
            '_actor.username': user.username,
            '_actor.email': user.email,
            ip,
            userAgent,
            timestamp: new Date().toISOString(),
          },
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
  details?: any
): Promise<void> {
  await createAuditLog(userId, {
    action: `server_${action}`,
    resource: 'server',
    resourceId: serverId,
    details,
  });
}
