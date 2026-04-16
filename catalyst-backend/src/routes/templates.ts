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
        sendSignalTo: 'SIGTERM' | 'SIGINT' | 'SIGKILL';
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
          variables: typeof variables === 'string' ? JSON.parse(variables) : (Array.isArray(variables) ? variables : []),
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
          sendSignalTo?: 'SIGTERM' | 'SIGINT' | 'SIGKILL';
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
      if (variables !== undefined) nextData.variables = typeof variables === 'string' ? JSON.parse(variables) : (Array.isArray(variables) ? variables : []);
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

  // Import Pterodactyl egg
  app.post(
    "/import-pterodactyl",
    { onRequest: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const has = await ensurePermission(prisma, request.user.userId, reply, "template.create");
      if (!has) return;

      const egg = request.body as Record<string, any>;
      const { nestId } = request.body as { nestId?: string };

      // Validate required fields
      if (!egg?.name || typeof egg.name !== 'string') {
        return reply.status(400).send({ error: "Missing required field: name" });
      }
      if (!egg?.startup || typeof egg.startup !== 'string') {
        return reply.status(400).send({ error: "Missing required field: startup" });
      }
      if (!egg?.images || !Array.isArray(egg.images) || egg.images.length === 0) {
        return reply.status(400).send({ error: "Missing required field: images (must be a non-empty array)" });
      }

      // Validate nestId if provided
      if (nestId) {
        const nest = await prisma.nest.findUnique({ where: { id: nestId } });
        if (!nest) {
          return reply.status(400).send({ error: "Nest not found" });
        }
      }

      // Check for name conflict
      const sanitizedName = egg.name.trim();
      const existing = await prisma.serverTemplate.findUnique({
        where: { name: sanitizedName },
      });
      if (existing) {
        return reply.status(409).send({ error: `A template with the name '${sanitizedName}' already exists` });
      }

      // Map Pterodactyl variables to Catalyst format
      const pteroVariables: any[] = Array.isArray(egg.variables) ? egg.variables : [];
      const mappedVariables = pteroVariables.map((v: any) => ({
        name: v.env_variable || v.name,
        description: v.description || "",
        default: v.default_value ?? "",
        required: v.rules ? v.rules.includes("required") : false,
        input: v.field_type === "select" ? "select" : v.field_type === "number" ? "number" : "text",
        rules: v.rules ? v.rules.split("|").map((r: string) => r.trim()).filter(Boolean) : [],
      }));

      // Map images
      const mappedImages = Array.isArray(egg.images)
        ? egg.images.map((img: string, i: number) => ({
            name: `image-${i}`,
            image: img,
          }))
        : [];

      // Build features from Pterodactyl egg data
      const eggFeatures: Record<string, any> = {};
      if (Array.isArray(egg.features)) {
        eggFeatures.pterodactylFeatures = egg.features;
      }
      if (egg.config?.startup) {
        eggFeatures.startupDetection = egg.config.startup;
      }
      if (egg.config?.logs) {
        eggFeatures.logDetection = egg.config.logs;
      }
      // Store Pterodactyl config file definitions for the config editor
      if (egg.config?.files) {
        try {
          const configFiles = typeof egg.config.files === 'string'
            ? JSON.parse(egg.config.files)
            : egg.config.files;
          if (typeof configFiles === 'object' && configFiles !== null) {
            const keys = Object.keys(configFiles);
            if (keys.length > 0) {
              eggFeatures.pterodactylConfigFiles = configFiles;
              eggFeatures.configFile = keys[0];
              eggFeatures.configFiles = keys;
            }
          }
        } catch { /* ignore invalid config files */ }
      }

      const template = await prisma.serverTemplate.create({
        data: {
          name: sanitizedName,
          description: egg.description || null,
          author: egg.author || "Pterodactyl Import",
          version: egg.meta?.version || "PTDL_v2",
          image: egg.images[0],
          images: mappedImages,
          defaultImage: egg.images[0] || null,
          installImage: egg.scripts?.installation?.container || null,
          startup: egg.startup,
          stopCommand: "minecraft:stop", // Pterodactyl default
          sendSignalTo: "SIGTERM",
          variables: mappedVariables,
          installScript: egg.scripts?.installation?.script || null,
          supportedPorts: [25565],
          allocatedMemoryMb: 1024,
          allocatedCpuCores: 1,
          features: eggFeatures,
          nestId: nestId || null,
        },
      });

      reply.status(201).send({ success: true, data: template });
    }
  );
}
