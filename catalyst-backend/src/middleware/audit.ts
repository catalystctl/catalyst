import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { getWsGateway } from '../websocket/gateway';

interface AuditLogOptions {
  action: string;
  resource: string;
  resourceId?: string;
  details?: any;
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(
  userId: string,
  options: AuditLogOptions
): Promise<void> {
  try {
    const entry = await prisma.auditLog.create({
      data: {
        userId,
        action: options.action,
        resource: options.resource,
        resourceId: options.resourceId,
        details: options.details || {},
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
    } catch {}
  } catch (error) {
    console.error('Failed to create audit log:', error);
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
            ip,
            userAgent,
            timestamp: new Date().toISOString(),
          },
        },
      });
    }
  } catch (error) {
    console.error('Failed to log auth attempt:', error);
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
