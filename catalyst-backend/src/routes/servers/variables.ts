import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { checkIsAdmin, ensureNotSuspended, hasNodeAccess, validateVariableRule } from './_helpers.js';

export async function serverVariablesRoutes(app: FastifyInstance) {
  app.get(
    "/:serverId/variables",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { template: true },
      });
      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      // Permission check
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.read")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.read" },
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
          return reply.status(403).send({ error: "Forbidden" });
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
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = request.params as { serverId: string };
      const userId = request.user.userId;
      const body = request.body as Record<string, string>;

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: { template: true },
      });
      if (!server) {
        return reply.status(404).send({ error: "Server not found" });
      }

      if (!ensureNotSuspended(server, reply)) {
        return;
      }

      // Permission check: owner, admin, or server.rebuild (rebuild implies config change)
      if (server.ownerId !== userId && !checkIsAdmin(request, "admin.write")) {
        const access = await prisma.serverAccess.findFirst({
          where: {
            userId,
            serverId,
            permissions: { has: "server.rebuild" },
          },
        });
        const hasNodeAccessToServer = await hasNodeAccess(prisma, userId, server.nodeId);
        if (!access && !hasNodeAccessToServer) {
          return reply.status(403).send({ error: "Forbidden" });
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
          const err = validateVariableRule(strValue, rule);
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
          code: "VALIDATION_ERROR",
          fields: errors,
        });
      }

      const updated = await prisma.server.update({
        where: { id: serverId },
        data: { environment },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "server.variables_updated",
          resource: "server",
          resourceId: serverId,
          details: { updatedKeys: Object.keys(body) },
        },
      });

      const wsGateway = app.wsGateway;
      if (wsGateway?.pushToAdminSubscribers) {
        wsGateway.pushToAdminSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'variables_updated',
          timestamp: new Date().toISOString(),
        });
      }
      if (wsGateway?.pushToGlobalSubscribers) {
        wsGateway.pushToGlobalSubscribers('server_updated', {
          type: 'server_updated',
          serverId,
          updatedBy: userId,
          change: 'variables_updated',
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send({ success: true, data: updated.environment });
    }
  );
}
