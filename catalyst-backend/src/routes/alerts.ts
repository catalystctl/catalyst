import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { serialize } from '../utils/serialize';
import { hasNodeAccess, hasGrant } from '../lib/permissions';
import { apiError } from '../lib/http-error';
import { ErrorCodes } from '../shared-types';
import { pushOwnerVisibleAlertEvent } from '../services/alert-service.js';

export async function alertRoutes(app: FastifyInstance) {
  // Using shared prisma instance from db.ts
  const authenticate = (app as any).authenticate;
  const isAdminUser = (request: FastifyRequest, required: 'admin.read' | 'admin.write' = 'admin.read') => {
    // Request grant set — hasGrant: '*' everything, admin.write any concrete
    // permission, admin.read read-class only (must not authorize rule
    // mutations or alert resolution). Reading request.user.permissions makes
    // this the API-key scope ceiling.
    const perms: string[] = (request as any).user?.permissions ?? [];
    return hasGrant(perms, required);
  };
  const ensureServerAccess = async ({
    userId,
    serverId,
    reply,
    isAdmin,
    requiredPermissions,
    actor,
  }: {
    userId: string;
    serverId: string;
    reply: FastifyReply;
    isAdmin: boolean;
    requiredPermissions: string[];
    actor?: { apiKeyId?: string; permissions?: string[] } | null;
  }) => {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { id: true, ownerId: true, nodeId: true },
    });
    if (!server) {
      apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, 'Server not found');
      return null;
    }
    // API-key scope ceiling: the decision below may rest on DB state the key
    // cannot see (ownership, role grants); the key itself must still carry
    // one of the required permissions.
    if (actor?.apiKeyId && !requiredPermissions.some((permission) => hasGrant(actor.permissions ?? [], permission))) {
      apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Forbidden');
      return null;
    }
    if (isAdmin || server.ownerId === userId) {
      return server;
    }
    const access = await prisma.serverAccess.findFirst({
      where: {
        serverId,
        userId,
        permissions: { hasSome: requiredPermissions },
      },
    });
    if (access) {
      return server;
    }
    // SECURITY: a role that grants the required alert permission counts the
    // same as a per-server grant on every server (decideServerAccess
    // role_permission contract; mirrored by getEffectiveServerPermissions).
    const { resolveServerPermissions } = await import('../lib/permissions-catalog.js');
    const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
    if (requiredPermissions.some((permission) => hasGrant(rolePerms, permission))) {
      return server;
    }
    // Bare node assignment must not grant alert management for every server
    // on the node — require the node_manage pairing (hasGrant honors the
    // legacy node.update grant).
    const hasNodeAccessToServer =
      (await hasNodeAccess(prisma, userId, server.nodeId)) &&
      hasGrant(rolePerms, 'node.server_manage');
    if (hasNodeAccessToServer) {
      return server;
    }
    apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Forbidden');
    return null;
  };

  // Mask webhook URLs / emails in delivery targets and rule actions. Full
  // values stay owner- and write-admin-only (audit alerts.md fix #3).
  const redactTarget = (target: string): string => {
    if (typeof target !== 'string' || !target) return target;
    if (target.includes('://')) {
      try {
        const url = new URL(target);
        return `${url.protocol}//${url.host}/****`;
      } catch {
        return '****';
      }
    }
    const at = target.indexOf('@');
    if (at > 0) return `${target.slice(0, 1)}***${target.slice(at)}`;
    return '****';
  };
  const redactRuleActions = (actions: unknown): unknown => {
    if (!actions || typeof actions !== 'object' || Array.isArray(actions)) return actions;
    const masked: Record<string, unknown> = { ...(actions as Record<string, unknown>) };
    if (Array.isArray(masked.webhooks)) {
      masked.webhooks = (masked.webhooks as unknown[]).map((w) => {
        if (typeof w === 'string') return redactTarget(w);
        if (w && typeof w === 'object' && typeof (w as Record<string, unknown>).url === 'string') {
          return { ...(w as Record<string, unknown>), url: redactTarget((w as Record<string, unknown>).url as string) };
        }
        return w;
      });
    }
    if (Array.isArray(masked.emails)) {
      masked.emails = (masked.emails as unknown[]).map((e) => (typeof e === 'string' ? redactTarget(e) : e));
    }
    return masked;
  };
  const redactAlertDeliveries = (alert: Record<string, unknown>, revealSecrets: boolean) => {
    if (revealSecrets || !Array.isArray(alert.deliveries)) return alert;
    return {
      ...alert,
      deliveries: (alert.deliveries as Record<string, unknown>[]).map((d) => ({
        ...d,
        target: redactTarget(d?.target as string),
      })),
    };
  };

  // Create an alert rule
  app.post(
    '/alert-rules',
    { schema: { summary: "Create an alert rule", description: "Create an alert rule for a server, node, or global scope.", tags: ["Alerts"], response: { 200: { type: "object", additionalProperties: true } } },  preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const isAdmin = isAdminUser(request, 'admin.write');
      const { name, description, type, target, targetId, conditions, actions, enabled } = request.body as {
        name: string;
        description?: string;
        type: string;
        target: string;
        targetId?: string;
        conditions: any;
        actions: any;
        enabled?: boolean;
      };

      // Validation
      if (!name || !type || !target || !conditions || !actions) {
        return apiError(
          reply,
          400,
          ErrorCodes.VALIDATION_ERROR,
          'Missing required fields: name, type, target, conditions, actions',
          { params: { fields: 'name, type, target, conditions, actions' } },
        );
      }

      // Validate type
      const validTypes = ['resource_threshold', 'node_offline', 'server_crashed'];
      if (!validTypes.includes(type)) {
        return apiError(
          reply,
          400,
          ErrorCodes.VALIDATION_ERROR,
          `Invalid type. Must be one of: ${validTypes.join(', ')}`,
          { params: { types: validTypes.join(', ') } },
        );
      }

      // Validate target
      const validTargets = ['server', 'node', 'global'];
      if (!validTargets.includes(target)) {
        return apiError(
          reply,
          400,
          ErrorCodes.VALIDATION_ERROR,
          `Invalid target. Must be one of: ${validTargets.join(', ')}`,
          { params: { targets: validTargets.join(', ') } },
        );
      }

      // resource_threshold rules with target=global are not implemented (no fleet aggregation).
      // Reject at create time so operators don't configure silent no-ops.
      if (type === 'resource_threshold' && target === 'global') {
        return apiError(
          reply,
          400,
          ErrorCodes.VALIDATION_ERROR,
          'resource_threshold rules with target "global" are not supported; use target "server" or "node"',
        );
      }

      // Validate targetId
      if ((target === 'server' || target === 'node') && !targetId) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'targetId is required for server or node rules');
      }

      if (target === 'server' && targetId) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId: targetId,
          reply,
          isAdmin,
          requiredPermissions: ['alert.create'],
          actor: request.user,
        });
        if (!server) {
          return;
        }
      }

      if (target === 'node' && targetId) {
        const node = await prisma.node.findUnique({ where: { id: targetId }, select: { id: true } });
        if (!node) {
          return apiError(reply, 404, ErrorCodes.NODE_NOT_FOUND, 'Node not found');
        }
      }

      // Check admin permissions for global rules
      if ((target === 'global' || target === 'node') && !isAdmin) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Admin access required for this alert rule target');
      }

      // Create alert rule
      const rule = await prisma.alertRule.create({
        data: {
          userId: user.userId,
          name,
          description,
          type,
          target,
          targetId,
          conditions,
          actions,
          enabled: enabled !== undefined ? enabled : true,
        },
      });

      reply.send(serialize({ success: true, rule }));


      const wsGateway = (app as any).wsGateway;
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('alert_rule_created', { type: 'alert_rule_created', rule, createdBy: user.userId, timestamp: new Date().toISOString() });
      }    }
  );

  // List alert rules
  app.get(
    '/alert-rules',
    { schema: { summary: "List alert rules", description: "List alert rules visible to the authenticated user.", tags: ["Alerts"], response: { 200: { type: "object", additionalProperties: true } } },  preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const { type, enabled, scope, target, targetId } = request.query as {
        type?: string;
        enabled?: string;
        scope?: 'mine' | 'all';
        target?: string;
        targetId?: string;
      };
      const isAdmin = isAdminUser(request);

      const where: any = {};
      if (type) where.type = type;
      if (enabled !== undefined) where.enabled = enabled === 'true';
      if (target) where.target = target;
      if (targetId) where.targetId = targetId;
      if (!isAdmin || scope !== 'all') {
        where.userId = user.userId;
      }

      const rules = await prisma.alertRule.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      // Rule actions embed webhook secrets — owner/write-admin only.
      const canReveal = isAdminUser(request, 'admin.write');
      const visible = rules.map((rule: any) =>
        canReveal || rule.userId === user.userId ? rule : { ...rule, actions: redactRuleActions(rule.actions) },
      );
      reply.send(serialize({ rules: visible }));
    }
  );

  // Get a specific alert rule
  app.get(
    '/alert-rules/:ruleId',
    { schema: { summary: "Get an alert rule", description: "Retrieve an alert rule by ID.", tags: ["Alerts"], params: { type: "object", required: ['ruleId'], properties: { ruleId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const isAdmin = isAdminUser(request);
      const { ruleId } = request.params as { ruleId: string };

      const rule = await prisma.alertRule.findUnique({
        where: { id: ruleId },
      });

      if (!rule) {
        return apiError(reply, 404, ErrorCodes.ALERT_RULE_NOT_FOUND, 'Alert rule not found');
      }
      if (!isAdmin && rule.userId !== user.userId) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Forbidden');
      }

      // Rule actions embed webhook secrets — owner/write-admin only.
      const canReveal = isAdminUser(request, 'admin.write') || rule.userId === user.userId;
      reply.send(serialize({ rule: canReveal ? rule : { ...rule, actions: redactRuleActions(rule.actions) } }));
    }
  );

  // Update an alert rule
  app.put(
    '/alert-rules/:ruleId',
    { schema: { summary: "Update an alert rule", description: "Update an alert rule by ID.", tags: ["Alerts"], params: { type: "object", required: ['ruleId'], properties: { ruleId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const isAdmin = isAdminUser(request, 'admin.write');
      const { ruleId } = request.params as { ruleId: string };
      const { name, description, conditions, actions, enabled } = request.body as {
        name?: string;
        description?: string;
        conditions?: any;
        actions?: any;
        enabled?: boolean;
      };

      const existing = await prisma.alertRule.findUnique({ where: { id: ruleId } });
      if (!existing) {
        return apiError(reply, 404, ErrorCodes.ALERT_RULE_NOT_FOUND, 'Alert rule not found');
      }
      if (!isAdmin && existing.userId !== user.userId) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Forbidden');
      }
      if ((existing.target === 'global' || existing.target === 'node') && !isAdmin) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Admin access required for this alert rule target');
      }
      if (existing.target === 'server' && existing.targetId) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId: existing.targetId,
          reply,
          isAdmin,
          requiredPermissions: ['alert.update'],
          actor: request.user,
        });
        if (!server) {
          return;
        }
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (conditions !== undefined) updateData.conditions = conditions;
      if (actions !== undefined) updateData.actions = actions;
      if (enabled !== undefined) updateData.enabled = enabled;

      const rule = await prisma.alertRule.update({
        where: { id: ruleId },
        data: updateData,
      });

      reply.send(serialize({
        success: true,
        // Rule actions embed webhook secrets — owner/write-admin only.
        rule: isAdmin || existing.userId === user.userId ? rule : { ...rule, actions: redactRuleActions(rule.actions) },
      }));

      // Broadcast alert_rule_updated event
      const wsGatewayAlertUpdated = (app as any).wsGateway;
      if (wsGatewayAlertUpdated?.pushToAdminSubscribers) {
        wsGatewayAlertUpdated.pushToAdminSubscribers('alert_rule_updated', {
          type: 'alert_rule_updated',
          ruleId: rule.id,
          rule,
          updatedBy: user.userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );
  app.delete(
    '/alert-rules/:ruleId',
    { schema: { summary: "Delete an alert rule", description: "Delete an alert rule by ID.", tags: ["Alerts"], params: { type: "object", required: ['ruleId'], properties: { ruleId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const isAdmin = isAdminUser(request, 'admin.write');
      const { ruleId } = request.params as { ruleId: string };

      const existing = await prisma.alertRule.findUnique({ where: { id: ruleId } });
      if (!existing) {
        return apiError(reply, 404, ErrorCodes.ALERT_RULE_NOT_FOUND, 'Alert rule not found');
      }
      if (!isAdmin && existing.userId !== user.userId) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Forbidden');
      }
      if ((existing.target === 'global' || existing.target === 'node') && !isAdmin) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Admin access required for this alert rule target');
      }
      if (existing.target === 'server' && existing.targetId) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId: existing.targetId,
          reply,
          isAdmin,
          requiredPermissions: ['alert.delete'],
          actor: request.user,
        });
        if (!server) {
          return;
        }
      }

      await prisma.alertRule.delete({ where: { id: ruleId } });

      reply.send({ success: true, message: 'Alert rule deleted' });
      const wsGateway = (app as any).wsGateway;
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('alert_rule_deleted', { type: 'alert_rule_deleted', ruleId: existing.id, deletedBy: user.userId, timestamp: new Date().toISOString() });
      }
    }
  );

  // Get alert deliveries for an alert
  app.get(
    '/alerts/:alertId/deliveries',
    { schema: { summary: "List alert deliveries", description: "List alert deliveries.", tags: ["Alerts"], params: { type: "object", required: ['alertId'], properties: { alertId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const isAdmin = isAdminUser(request);
      const { alertId } = request.params as { alertId: string };
      const alert = await prisma.alert.findUnique({ where: { id: alertId }, select: { id: true, userId: true, serverId: true } });
      if (!alert) {
        return apiError(reply, 404, ErrorCodes.ALERT_NOT_FOUND, 'Alert not found');
      }
      // alert.read holders for the alert's server may view its deliveries
      // (audit alerts.md fix #2); everyone else must own the alert.
      if (!isAdmin && alert.userId !== user.userId && alert.serverId) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId: alert.serverId,
          reply,
          isAdmin,
          requiredPermissions: ['alert.read'],
          actor: request.user,
        });
        if (!server) {
          return;
        }
      } else if (!isAdmin && alert.userId !== user.userId) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Forbidden');
      }
      const deliveries = await prisma.alertDelivery.findMany({
        where: { alertId },
        orderBy: { createdAt: 'desc' },
      });
      // Delivery targets carry webhook secrets — owner/write-admin only.
      const revealSecrets = isAdminUser(request, 'admin.write') || alert.userId === user.userId;
      const visible = revealSecrets
        ? deliveries
        : deliveries.map((d: any) => ({ ...d, target: redactTarget(d?.target) }));
      reply.send({ deliveries: visible });
    }
  );

  // List alerts
  app.get(
    '/alerts',
    { schema: { summary: "List alerts", description: "List alerts with filtering and pagination.", tags: ["Alerts"], response: { 200: { type: "object", additionalProperties: true } } },  preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const {
        page = 1,
        limit = 50,
        serverId,
        nodeId,
        type,
        severity,
        resolved,
        scope,
      } = request.query as {
        page?: number;
        limit?: number;
        serverId?: string;
        nodeId?: string;
        type?: string;
        severity?: string;
        resolved?: string;
        scope?: 'mine' | 'all';
      };
      const isAdmin = isAdminUser(request);
      let serverScoped = false;
      if (serverId && !isAdmin) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId,
          reply,
          isAdmin,
          requiredPermissions: ['alert.read'],
          actor: request.user,
        });
        if (!server) {
          return;
        }
        // alert.read holders (and the server owner) see every alert on the
        // server, not just their own (audit alerts.md fix #2).
        serverScoped = true;
      }

      // Clamp pagination: NaN/negative inputs would make Prisma throw a
      // validation error (500) instead of returning a sane page.
      const pageNum = Math.max(1, Math.floor(Number(page)) || 1);
      const limitNum = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 25));
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};
      if (serverId) where.serverId = serverId;
      if (nodeId) where.nodeId = nodeId;
      if (type) where.type = type;
      if (severity) where.severity = severity;
      if (resolved !== undefined) where.resolved = resolved === 'true';
      if (!isAdmin || scope !== 'all') {
        // Server-scoped callers already passed the alert.read gate for this
        // server; everyone else sees only their own alerts.
        if (!serverScoped) {
          where.userId = user.userId;
        }
      }

      const [alerts, total] = await Promise.all([
        prisma.alert.findMany({
          where,
          skip,
          take: limitNum,
          include: {
            rule: { select: { id: true, name: true } },
            server: {
              select: { id: true, name: true },
            },
            node: {
              select: { id: true, name: true },
            },
            // P1-12: latest delivery attempts per alert so the list view can
            // show webhook/email status without N+1 fetches.
            deliveries: {
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.alert.count({ where }),
      ]);

      reply.send({
        // Delivery targets carry webhook secrets — alert owner and
        // write-admin only (audit alerts.md fix #3).
        alerts: alerts.map((alert: any) =>
          redactAlertDeliveries(alert, isAdminUser(request, 'admin.write') || alert.userId === user.userId),
        ),
        pagination: {
          page: Number(page),
          limit: limitNum,
          total,
           totalPages: Math.ceil(total / limitNum),
        },
      });
    }
  );

  // Get a specific alert
  app.get(
    '/alerts/:alertId',
    { schema: { summary: "Get an alert", description: "Retrieve an alert and its delivery history by ID.", tags: ["Alerts"], params: { type: "object", required: ['alertId'], properties: { alertId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const isAdmin = isAdminUser(request);
      const { alertId } = request.params as { alertId: string };

      const alert = await prisma.alert.findUnique({
        where: { id: alertId },
        include: {
          rule: { select: { id: true, name: true } },
          server: {
            select: { id: true, name: true },
          },
          node: {
            select: { id: true, name: true },
          },
          deliveries: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!alert) {
        return apiError(reply, 404, ErrorCodes.ALERT_NOT_FOUND, 'Alert not found');
      }
      // alert.read holders for the alert's server may view it (audit
      // alerts.md fix #2); everyone else must own the alert.
      if (!isAdmin && alert.userId !== user.userId && alert.server?.id) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId: alert.server.id,
          reply,
          isAdmin,
          requiredPermissions: ['alert.read'],
          actor: request.user,
        });
        if (!server) {
          return;
        }
      } else if (!isAdmin && alert.userId !== user.userId) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Forbidden');
      }

      // Delivery targets carry webhook secrets — alert owner and
      // write-admin only (audit alerts.md fix #3).
      const visible = redactAlertDeliveries(alert, isAdminUser(request, 'admin.write') || alert.userId === user.userId);
      reply.send(serialize({ alert: visible }));
    }
  );

  // Resolve an alert
  app.post(
    '/alerts/:alertId/resolve',
    { schema: { summary: "Resolve an alert", description: "Resolve an alert.", tags: ["Alerts"], params: { type: "object", required: ['alertId'], properties: { alertId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const isAdmin = isAdminUser(request, 'admin.write');
      const { alertId } = request.params as { alertId: string };
      const alert = await prisma.alert.findUnique({
        where: { id: alertId },
        select: { id: true, userId: true, serverId: true },
      });
      if (!alert) {
        return apiError(reply, 404, ErrorCodes.ALERT_NOT_FOUND, 'Alert not found');
      }
      if (!isAdmin && alert.userId !== user.userId) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Forbidden');
      }
      if (alert.serverId && !isAdmin) {
        const server = await ensureServerAccess({
          userId: user.userId,
          serverId: alert.serverId,
          reply,
          isAdmin,
          requiredPermissions: ['alert.update'],
          actor: request.user,
        });
        if (!server) {
          return;
        }
      }

      const alertService = (app as any).alertService;
      if (alertService) {
        await alertService.resolveAlert(alertId, user.userId);
      } else {
        // Fallback when the alert service is not wired: emit the same
        // admin + owner-visible events alertService.resolveAlert() pushes.
        const updated = await prisma.alert.update({
          where: { id: alertId },
          data: {
            resolved: true,
            resolvedAt: new Date(),
            resolvedBy: user.userId,
          },
          select: { id: true, serverId: true, userId: true, severity: true, title: true, message: true },
        });
        const wsGatewayFallback = (app as any).wsGateway;
        if (wsGatewayFallback?.pushToAdminSubscribers) {
          wsGatewayFallback.pushToAdminSubscribers('alert_resolved', {
            type: 'alert_resolved',
            alertId: updated.id,
            timestamp: Date.now(),
          });
        }
        pushOwnerVisibleAlertEvent(wsGatewayFallback, updated, true);
      }

      reply.send({ success: true, message: 'Alert resolved' });
    }
  );

  // Bulk resolve alerts
  app.post(
    '/alerts/bulk-resolve',
    { schema: { summary: "Resolve alerts in bulk", description: "Resolve alerts in bulk.", tags: ["Alerts"], response: { 200: { type: "object", additionalProperties: true } } },  preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const isAdmin = isAdminUser(request, 'admin.write');
      const { alertIds } = request.body as { alertIds: string[] };

      if (!alertIds || !Array.isArray(alertIds)) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, 'alertIds must be an array');
      }

      if (!isAdmin) {
        const alerts = await prisma.alert.findMany({
          where: { id: { in: alertIds } },
          select: { id: true, userId: true, serverId: true },
        });
        const invalid = alerts.some((alert) => alert.userId !== user.userId);
        if (invalid) {
          return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, 'Forbidden');
        }
        const serverIds = Array.from(
          new Set(alerts.map((alert) => alert.serverId).filter((serverId): serverId is string => Boolean(serverId))),
        ) as string[];
        const accessChecks = await Promise.all(
          serverIds.map((serverId) => ensureServerAccess({
            userId: user.userId,
            serverId,
            reply,
            isAdmin,
            requiredPermissions: ['alert.update'],
            actor: request.user,
          })),
        );
        if (accessChecks.some((server) => !server)) {
          return;
        }
      }

      await prisma.alert.updateMany({
        where: { id: { in: alertIds } },
        data: {
          resolved: true,
          resolvedAt: new Date(),
          resolvedBy: user.userId,
        },
      });

      // Notify admin SSE subscribers + owner-visible 'alert' events for each
      // resolved alert (per-server / user-scoped global delivery).
      const wsGateway = (app as any).wsGateway;
      const resolvedAlerts = await prisma.alert.findMany({
        where: { id: { in: alertIds } },
        select: { id: true, serverId: true, userId: true, severity: true, title: true, message: true },
      });
      if (wsGateway?.pushToAdminSubscribers) {
        for (const alert of resolvedAlerts) {
          wsGateway.pushToAdminSubscribers('alert_resolved', {
            type: 'alert_resolved',
            alertId: alert.id,
            timestamp: Date.now(),
          });
        }
      }
      for (const alert of resolvedAlerts) {
        pushOwnerVisibleAlertEvent(wsGateway, alert, true);
      }

      reply.send({ success: true, message: `${alertIds.length} alerts resolved` });
    }
  );

  // Get alert statistics
  app.get(
    '/alerts/stats',
    { schema: { summary: "Get alert statistics", description: "Get counts of alerts by status, severity, and type.", tags: ["Alerts"], response: { 200: { type: "object", additionalProperties: true } } },  preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      const { scope } = request.query as { scope?: 'mine' | 'all' };
      const isAdmin = isAdminUser(request);
      const where = !isAdmin || scope !== 'all' ? { userId: user.userId } : {};
      const [total, unresolved, bySeverity, byType] = await Promise.all([
        prisma.alert.count({ where }),
        prisma.alert.count({ where: { ...where, resolved: false } }),
        prisma.alert.groupBy({
          by: ['severity'],
          _count: true,
          where: { ...where, resolved: false },
        }),
        prisma.alert.groupBy({
          by: ['type'],
          _count: true,
          where: { ...where, resolved: false },
        }),
      ]);

      reply.send({
        total,
        unresolved,
        bySeverity: Object.fromEntries(bySeverity.map((s) => [s.severity, s._count])),
        byType: Object.fromEntries(byType.map((t) => [t.type, t._count])),
      });
    }
  );
}
