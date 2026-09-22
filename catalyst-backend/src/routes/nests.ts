import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { hasAnyPermission } from "../lib/permissions";
import { serialize } from '../utils/serialize';
import { apiError } from "../lib/http-error";
import { ErrorCodes } from "../shared-types";

// There is no nest.* permission. Nests group templates, so nest reads follow
// template.read and nest mutations follow the matching template.* permission.
// admin.write / * remain valid (hasAnyPermission treats "*" as everything).
const ensureAnyPermission = async (
  userId: string,
  reply: FastifyReply,
  required: string[]
) => {
  const has = await hasAnyPermission(prisma, userId, required);
  if (!has) {
    apiError(reply, 403, ErrorCodes.PERMISSION_DENIED, "Insufficient permissions");
    return false;
  }
  return true;
};

export async function nestRoutes(app: FastifyInstance) {
  // List all nests (with template count)
  app.get(
    "/",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const has = await ensureAnyPermission(request.user.userId, reply, ["template.read", "admin.read", "admin.write"]);
      if (!has) return;

      const nests = await prisma.nest.findMany({
        orderBy: { name: "asc" },
        include: {
          _count: {
            select: { templates: true },
          },
        },
      });

      const data = nests.map((nest) => ({
        ...nest,
        templateCount: nest._count.templates,
      }));

      reply.send({ success: true, data });
    }
  );

  // Get single nest (with templates)
  app.get(
    "/:nestId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const has = await ensureAnyPermission(request.user.userId, reply, ["template.read", "admin.read", "admin.write"]);
      if (!has) return;

      const { nestId } = request.params as { nestId: string };

      const nest = await prisma.nest.findUnique({
        where: { id: nestId },
        include: {
          templates: {
            orderBy: { name: "asc" },
          },
        },
      });

      if (!nest) {
        return apiError(reply, 404, ErrorCodes.NEST_NOT_FOUND, "Nest not found");
      }

      reply.send(serialize({ success: true, data: nest }));
    }
  );

  // Create nest (admin only)
  app.post(
    "/",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(await ensureAnyPermission(request.user.userId, reply, ["template.create", "admin.write"]))) return;

      const { name, description, icon, author } = request.body as {
        name: string;
        description?: string;
        icon?: string;
        author?: string;
      };

      if (!name || !name.trim()) {
        return apiError(reply, 400, ErrorCodes.VALIDATION_ERROR, "Nest name is required");
      }

      const existing = await prisma.nest.findUnique({
        where: { name: name.trim() },
      });

      if (existing) {
        return apiError(reply, 409, ErrorCodes.NEST_NAME_TAKEN, "A nest with this name already exists");
      }

      const nest = await prisma.nest.create({
        data: {
          name: name.trim(),
          description: description?.trim() || null,
          icon: icon?.trim() || null,
          author: author?.trim() || null,
        },
      });

      reply.status(201).send({ success: true, data: nest });

      // Broadcast nest_created event
      const wsGatewayNestCreated = (app as any).wsGateway;
      if (wsGatewayNestCreated?.pushToAdminSubscribers) {
        wsGatewayNestCreated.pushToAdminSubscribers('nest_created', {
          type: 'nest_created',
          nestId: nest.id,
          nestName: nest.name,
          createdBy: request.user.userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Update nest (admin only)
  app.put(
    "/:nestId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(await ensureAnyPermission(request.user.userId, reply, ["template.update", "admin.write"]))) return;

      const { nestId } = request.params as { nestId: string };
      const { name, description, icon, author } = request.body as {
        name?: string;
        description?: string;
        icon?: string;
        author?: string;
      };

      const nest = await prisma.nest.findUnique({
        where: { id: nestId },
      });

      if (!nest) {
        return apiError(reply, 404, ErrorCodes.NEST_NOT_FOUND, "Nest not found");
      }

      if (name !== undefined && name.trim()) {
        const existing = await prisma.nest.findFirst({
          where: { name: name.trim(), id: { not: nestId } },
        });
        if (existing) {
          return apiError(reply, 409, ErrorCodes.NEST_NAME_TAKEN, "A nest with this name already exists");
        }
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name.trim();
      if (description !== undefined) updateData.description = description?.trim() || null;
      if (icon !== undefined) updateData.icon = icon?.trim() || null;
      if (author !== undefined) updateData.author = author?.trim() || null;

      const updated = await prisma.nest.update({
        where: { id: nestId },
        data: updateData,
      });

      reply.send({ success: true, data: updated });

      // Broadcast nest_updated event
      const wsGatewayNestUpdated = (app as any).wsGateway;
      if (wsGatewayNestUpdated?.pushToAdminSubscribers) {
        wsGatewayNestUpdated.pushToAdminSubscribers('nest_updated', {
          type: 'nest_updated',
          nestId,
          updatedBy: request.user.userId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // Delete nest (admin only, sets templates' nestId to null)
  app.delete(
    "/:nestId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(await ensureAnyPermission(request.user.userId, reply, ["template.delete", "admin.write"]))) return;

      const { nestId } = request.params as { nestId: string };

      const nest = await prisma.nest.findUnique({
        where: { id: nestId },
        include: {
          _count: { select: { templates: true } },
        },
      });

      if (!nest) {
        return apiError(reply, 404, ErrorCodes.NEST_NOT_FOUND, "Nest not found");
      }

      // Disconnect templates before deleting (sets nestId to null)
      if (nest._count.templates > 0) {
        await prisma.serverTemplate.updateMany({
          where: { nestId },
          data: { nestId: null },
        });
      }

      await prisma.nest.delete({
        where: { id: nestId },
      });

      // Broadcast nest_deleted event
      const wsGatewayNestDeleted = (app as any).wsGateway;
      if (wsGatewayNestDeleted?.pushToAdminSubscribers) {
        wsGatewayNestDeleted.pushToAdminSubscribers('nest_deleted', {
          type: 'nest_deleted',
          nestId,
          nestName: nest.name,
          deletedBy: request.user.userId,
          timestamp: new Date().toISOString(),
        });
      }

      reply.send({ success: true });
    }
  );
}
