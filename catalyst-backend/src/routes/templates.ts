import { prisma } from '../db.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { hasPermission } from "../lib/permissions";
import { serialize } from '../utils/serialize';

const ensurePermission = async (
  prisma: any,
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

export async function templateRoutes(app: FastifyInstance) {
  // Using shared prisma instance from db.ts

  // List all templates
  app.get(
    "/",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const has = await ensurePermission(prisma, request.user.userId, reply, "template.read");
      if (!has) return;
      const templates = await prisma.serverTemplate.findMany({
        orderBy: { createdAt: "desc" },
      });

      reply.send({ success: true, data: templates });
    }
  );

  // Get template details
  app.get(
    "/:templateId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const has = await ensurePermission(prisma, request.user.userId, reply, "template.read");
      if (!has) return;
      const { templateId } = request.params as { templateId: string };

      const template = await prisma.serverTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return reply.status(404).send({ error: "Template not found" });
      }

      reply.send(serialize({ success: true, data: template }));
    }
  );

  // Create template (admin only)
  app.post(
    "/",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const has = await ensurePermission(prisma, request.user.userId, reply, "template.create");
      if (!has) return;
      const {
        name,
        description,
        author,
        version,
        image,
        images,
        defaultImage,
        installImage,
        startup,
        stopCommand,
        sendSignalTo,
        variables,
        installScript,
        configFile,
        supportedPorts,
        allocatedMemoryMb,
        allocatedCpuCores,
        features,
      } = request.body as {
        name: string;
        description?: string;
        author: string;
        version: string;
        image: string;
        images?: Array<{ name: string; label?: string; image: string }>;
        defaultImage?: string;
        installImage?: string;
        startup: string;
        stopCommand: string;
        sendSignalTo: string;
        variables: any[];
        installScript?: string;
        configFile?: string;
        supportedPorts: number[];
        allocatedMemoryMb: number;
        allocatedCpuCores: number;
        features?: Record<string, any>;
      };

      const template = await prisma.serverTemplate.create({
        data: {
          name,
          description,
          author,
          version,
          image,
          images: Array.isArray(images) ? images : [],
          defaultImage: defaultImage || null,
          installImage,
          startup,
          stopCommand,
          sendSignalTo,
          variables,
          installScript,
          supportedPorts,
          allocatedMemoryMb,
          allocatedCpuCores,
          features: { ...(features || {}), ...(configFile ? { configFile } : {}) },
        },
      });

      reply.status(201).send({ success: true, data: template });
    }
  );

  // Update template
  app.put(
    "/:templateId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const has = await ensurePermission(prisma, request.user.userId, reply, "template.update");
      if (!has) return;
      const { templateId } = request.params as { templateId: string };
      const { images, defaultImage } = request.body as {
        images?: Array<{ name: string; label?: string; image: string }>;
        defaultImage?: string;
      };

      const template = await prisma.serverTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return reply.status(404).send({ error: "Template not found" });
      }

      const { name, description, author, version, image, installImage, startup, stopCommand, sendSignalTo, variables, installScript, configFile, supportedPorts, allocatedMemoryMb, allocatedCpuCores, features } =
        request.body as {
          name?: string;
          description?: string;
          author?: string;
          version?: string;
          image?: string;
          installImage?: string;
          startup?: string;
          stopCommand?: string;
          sendSignalTo?: string;
          variables?: any[];
          installScript?: string;
          configFile?: string;
          supportedPorts?: number[];
          allocatedMemoryMb?: number;
          allocatedCpuCores?: number;
          features?: Record<string, any>;
        };
      const nextData: Record<string, unknown> = {};
      if (name !== undefined) nextData.name = name;
      if (description !== undefined) nextData.description = description;
      if (author !== undefined) nextData.author = author;
      if (version !== undefined) nextData.version = version;
      if (image !== undefined) nextData.image = image;
      if (installImage !== undefined) nextData.installImage = installImage;
      if (startup !== undefined) nextData.startup = startup;
      if (stopCommand !== undefined) nextData.stopCommand = stopCommand;
      if (sendSignalTo !== undefined) nextData.sendSignalTo = sendSignalTo;
      if (variables !== undefined) nextData.variables = variables;
      if (installScript !== undefined) nextData.installScript = installScript;
      if (supportedPorts !== undefined) nextData.supportedPorts = supportedPorts;
      if (allocatedMemoryMb !== undefined) nextData.allocatedMemoryMb = allocatedMemoryMb;
      if (allocatedCpuCores !== undefined) nextData.allocatedCpuCores = allocatedCpuCores;
      if (features !== undefined) {
        nextData.features = { ...features, ...(configFile ? { configFile } : {}) };
      } else if (configFile !== undefined) {
        nextData.features = { ...(template.features as Record<string, unknown>), configFile };
      }
      if (images) {
        nextData.images = Array.isArray(images) ? images : [];
      }
      if (defaultImage !== undefined) {
        nextData.defaultImage = defaultImage || null;
      }

      const updated = await prisma.serverTemplate.update({
        where: { id: templateId },
        data: nextData as any,
      });

      reply.send(serialize({ success: true, data: updated }));
    }
  );

  // Delete template
  app.delete(
    "/:templateId",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const has = await ensurePermission(prisma, request.user.userId, reply, "template.delete");
      if (!has) return;
      const { templateId } = request.params as { templateId: string };

      // Check if template is in use
      const inUse = await prisma.server.findFirst({
        where: { templateId },
      });

      if (inUse) {
        return reply.status(409).send({
          error: "Cannot delete template that is in use",
        });
      }

      await prisma.serverTemplate.delete({ where: { id: templateId } });

      reply.send({ success: true });
    }
  );
}
