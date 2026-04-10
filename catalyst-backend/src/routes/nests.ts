import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { hasPermission } from "../lib/permissions";
import { serialize } from '../utils/serialize';

const ensurePermission = async (
  userId: string,
  reply: FastifyReply,
  requiredPermission: string
) => {
  const has = await hasPermission(prisma, userId, requiredPermission);
  if (!has) {
    reply.status(403).send({ error: "Insufficient permissions" });
    return false;
  }
  return true;
};

const ensureAdmin = async (userId: string, reply: FastifyReply) => {
  const roles = await prisma.role.findMany({
    where: { users: { some: { id: userId } } },
    select: { permissions: true, name: true },
  });
  const permissions = roles.flatMap((role) => role.permissions);
  const isAdmin =
    permissions.includes("*") ||
    permissions.includes("admin.write") ||
    roles.some((role) => role.name.toLowerCase() === "administrator");
  if (!isAdmin) {
    reply.status(403).send({ error: "Admin access required" });
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
      const has = await ensurePermission(request.user.userId, reply, "template.read");
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
      const has = await ensurePermission(request.user.userId, reply, "template.read");
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
        return reply.status(404).send({ error: "Nest not found" });
      }

      reply.send(serialize({ success: true, data: nest }));
    }
  );

  // Create nest (admin only)
  app.post(
    "/",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(await ensureAdmin(request.user.userId, reply))) return;

      const { name, description, icon, author } = request.body as {
        name: string;
        description?: string;
        icon?: string;
        author?: string;
      };

      if (!name || !name.trim()) {
        return reply.status(400).send({ error: "Nest name is required" });
      }

      const existing = await prisma.nest.findUnique({
        where: { name: name.trim() },
      });

      if (existing) {
        return reply.status(409).send({ error: "A nest with this name already exists" });
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
    }
  );

  // Update nest (admin only)
  app.put(
    "/:nestId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(await ensureAdmin(request.user.userId, reply))) return;

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
        return reply.status(404).send({ error: "Nest not found" });
      }

      if (name !== undefined && name.trim()) {
        const existing = await prisma.nest.findFirst({
          where: { name: name.trim(), id: { not: nestId } },
        });
        if (existing) {
          return reply.status(409).send({ error: "A nest with this name already exists" });
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
    }
  );

  // Delete nest (admin only, sets templates' nestId to null)
  app.delete(
    "/:nestId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(await ensureAdmin(request.user.userId, reply))) return;

      const { nestId } = request.params as { nestId: string };

      const nest = await prisma.nest.findUnique({
        where: { id: nestId },
        include: {
          _count: { select: { templates: true } },
        },
      });

      if (!nest) {
        return reply.status(404).send({ error: "Nest not found" });
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

      reply.send({ success: true });
    }
  );
}
