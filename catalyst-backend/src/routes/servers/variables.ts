import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { createAuditLog } from '../../middleware/audit.js';
import { checkIsAdmin, ensureNotSuspended, enforceKeyScope, validateVariableRule } from './_helpers.js';
import { canManageViaNode } from "../../lib/server-access.js";
import { apiError } from "../../lib/http-error";
import { ErrorCodes } from "../../shared-types";

export async function serverVariablesRoutes(app: FastifyInstance) {
  app.get(
    "/:serverId/variables",
    { schema: { summary: "Manage server variables", description: "Manage server variables.", tags: ["Variables"], params: { type: "object", required: ['serverId'], properties: { serverId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate], config: { requiredPermission: "server.read" } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { template: true },
      });
      if (!server) {
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
      }

      // Key-scope ceiling: a scoped API key must itself hold server.read
      // (enforceKeyScope is session-inert).
      if (request.user.apiKeyId && !enforceKeyScope(request.user, "server.read")) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "API key scope does not permit this operation");
      }

      // Permission check: owner | ServerAccess with server.read | role
      // server.read (admin.read is read-everything) | node+node.manage | admin.write/*
      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findFirst({
          where: { userId, serverId, permissions: { has: "server.read" } },
        });
        if (!access && !checkIsAdmin(request, "admin.read")) {
          const { resolveServerPermissions } = await import("../../lib/permissions-catalog.js");
          const { hasGrant, hasNodeAccess } = await import("../../lib/permissions.js");
          const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
          // node_manage accepts node.server_manage and legacy node.update.
          const nodeManage = canManageViaNode(
            await hasNodeAccess(prisma, userId, server.nodeId),
            rolePerms,
          );
          if (!hasGrant(rolePerms, "server.read") && !nodeManage) {
            return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
          }
        }
      }

      const templateVariables = (server.template?.variables as any[]) || [];
      const environment = (server.environment as Record<string, string>) || {};

      const variables = templateVariables.map((varDef) => {
        const currentValue = environment[varDef.name] ?? varDef.default ?? "";
        return {
          name: varDef.name,
          description: varDef.description ?? "",
          default: varDef.default ?? "",
          required: varDef.required ?? false,
          input: varDef.input ?? "text",
          rules: varDef.rules ?? [],
          value: String(currentValue),
        };
      });

      return reply.send({ success: true, data: variables });
    }
  );

  app.patch(
    "/:serverId/variables",
    { schema: { summary: "Manage server variables", description: "Manage server variables.", tags: ["Variables"], params: { type: "object", required: ['serverId'], properties: { serverId: { type: "string" } } }, response: { 200: { type: "object", additionalProperties: true } } },  onRequest: [app.authenticate], config: { requiredPermission: "server.update" } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const body = request.body as Record<string, string>;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { template: true },
      });
      if (!server) {
        return apiError(reply, 404, ErrorCodes.SERVER_NOT_FOUND, "Server not found");
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Key-scope ceiling: environment variables shape container startup, so
      // a scoped API key must itself hold server.update.
      if (request.user.apiKeyId && !enforceKeyScope(request.user, "server.update")) {
        return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "API key scope does not permit this operation");
      }

      // Permission check: owner | ServerAccess with server.update | global
      // role with server.update/admin | node+node.manage. Environment is a
      // server setting, so server.rebuild is not the grant for it.
      if (server.ownerId !== userId) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.update" },
          },
        });
        // Server-scoped role resolution: global roles + RoleServerGrant +
        // RoleNodeGrant rows covering this server (mirrors decideServerAccess's
        // requiredPermission branch).
        const { resolveServerPermissions } = await import("../../lib/permissions-catalog.js");
        const rolePerms = await resolveServerPermissions(userId, serverId, server.nodeId);
        const roleAllowed =
          rolePerms.includes("*") ||
          rolePerms.includes("admin.write") ||
          rolePerms.includes("server.update");
        if (!access && !roleAllowed) {
          const { hasNodeAccess } = await import("../../lib/permissions.js");
          // node_manage accepts node.server_manage and legacy node.update.
          const nodeManage = canManageViaNode(
            await hasNodeAccess(prisma, userId, server.nodeId),
            rolePerms,
          );
          if (!nodeManage) {
            return apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Forbidden");
          }
        }
      }

      const templateVariables = (server.template?.variables as any[]) || [];
      const environment = { ...(server.environment as Record<string, string>) };
      const errors: Record<string, string> = {};
      let hasErrors = false;

      for (const varDef of templateVariables) {
        const name = varDef.name;
        const submitted = body[name];
        const isPresent = name in body;

        // Required check
        if (varDef.required) {
          if (!isPresent || submitted === undefined || submitted === null || String(submitted).trim() === "") {
            errors[name] = "This field is required";
            hasErrors = true;
            continue;
          }
        }

        // If not present and not required, skip validation and keep current value
        if (!isPresent) {
          continue;
        }

        const strValue = String(submitted);

        // Type validation based on input type
        if (varDef.input === "number") {
          if (strValue.trim() !== "" && Number.isNaN(Number(strValue))) {
            errors[name] = "Must be a valid number";
            hasErrors = true;
            continue;
          }
        }

        if (varDef.input === "checkbox") {
          // Normalize checkbox to "true" or "false"
          const normalized = strValue === "true" || strValue === "1" || strValue === "on" ? "true" : "false";
          environment[name] = normalized;
          continue;
        }

        // Rule validation
        const rules: string[] = varDef.rules ?? [];
        for (const rule of rules) {
          const err = validateVariableRule(strValue, rule, rules);
          if (err) {
            errors[name] = err;
            hasErrors = true;
            break;
          }
        }
        if (hasErrors && errors[name]) {
          continue;
        }

        environment[name] = strValue;
      }

      if (hasErrors) {
        return reply.status(422).send({
          error: "Validation failed",
          code: ErrorCodes.VALIDATION_ERROR,
          fields: errors,
        });
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: { environment },
      });

      await createAuditLog(userId, {
        action: "server.variables_updated",
        resource: "server",
        resourceId: serverId,
        request,
        details: { updatedKeys: Object.keys(body), updatedCount: Object.keys(body).length },
      });

      // 3-scope broadcast: admin + global + per-server stream.
      const wsGateway = app.wsGateway;
      const variablesUpdatedEvent = {
        type: 'server_updated',
        serverId,
        nodeId: updated.nodeId,
        updatedBy: userId,
        change: 'variables_updated',
        timestamp: new Date().toISOString(),
      };
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('server_updated', variablesUpdatedEvent);
      }
      if (wsGateway?.pushToGlobalSubscribers) {
        wsGateway.pushToGlobalSubscribers('server_updated', variablesUpdatedEvent);
      }
      if (wsGateway?.routeToClients) {
        void wsGateway.routeToClients(serverId, variablesUpdatedEvent).catch(() => {});
      }

      return reply.send({ success: true, data: updated.environment });
    }
  );
}
